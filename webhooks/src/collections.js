import { decrypt, encrypt, isEncrypted, SECRET_MASK } from "./crypto.js";
import { replayDelivery, sendTestEvent } from "./deliver.js";
import { EVENT_TYPES, DEFAULT_EVENTS, SLUGS } from "./events.js";
import { checkHostResolves } from "./request.js";

// Admin component paths are relative to apps/cms/src (the import map's base). apps/cms/next.config.mjs widens Turbopack's root to
// the repo root so these files, which live outside the app, can be bundled.
const ACTIONS = "../../../plugins/webhooks/src/admin/EndpointActions#EndpointActions";
const REPLAY = "../../../plugins/webhooks/src/admin/DeliveryActions#DeliveryActions";

// Minimal, self-contained checks: a plugin may not import from apps/cms (see plugins/README.md), so it relies only on the one
// stable, documented contract every Polysite install has: req.user.isSuperAdmin. Endpoints hold credentials, so only Super
// Admins manage them.
const isSuper = (user) => user?.isSuperAdmin === true;
const superOnly = ({ req: { user } }) => isSuper(user);

// Payload's own APIError isn't importable from here, so this carries the two properties its error handler reads to return a
// clean 4xx message instead of a generic 500.
function clientError(message, status = 400) {
  return Object.assign(new Error(message), { status, isPublic: true });
}

// A write-only secret field: encrypted at rest, masked on every read (admin form, REST, GraphQL) unless a caller opts in through
// context, and "mask means keep" on save -- the same pattern as the Email and Notifications plugins. `revealWebhookSecrets`
// returns the decrypted value (the delivery task only); `rawWebhookSecrets` returns the stored value untouched (the keep-on-save
// re-read below).
//
// `check` validates what a user typed and must run in beforeValidate: a field's own `validate` runs after its beforeChange hook,
// by which point the value is already ciphertext. So `validate` can only check presence; format and address checks live in `check`.
function secretField({ name, label, description, validate, check }) {
  return {
    name,
    type: "text",
    label,
    admin: { description },
    validate,
    hooks: {
      beforeValidate: [
        async ({ value, siblingData }) => {
          if (check && value && value !== SECRET_MASK && !isEncrypted(value)) {
            const problem = await check(value, siblingData);
            if (problem) throw clientError(problem);
          }
          return value;
        },
      ],
      afterRead: [
        ({ value, req }) => {
          if (req.context?.revealWebhookSecrets) return decrypt(value);
          if (req.context?.rawWebhookSecrets) return value;
          return value ? SECRET_MASK : value;
        },
      ],
      beforeChange: [
        async ({ value, originalDoc, req }) => {
          if (value === undefined) return value; // a partial update that doesn't touch this field
          let next = value;
          if (value === SECRET_MASK) {
            const current = originalDoc?.id
              ? await req.payload.findByID({ collection: SLUGS.endpoints, id: originalDoc.id, depth: 0, overrideAccess: true, context: { rawWebhookSecrets: true } })
              : null;
            next = current?.[name] ?? "";
          }
          return encrypt(next);
        },
      ],
    },
  };
}

const requiredOnCreate = (message) => (value, { operation }) => (operation === "create" && !value ? message : true);

const endpoints = {
  slug: SLUGS.endpoints,
  labels: { singular: "Webhook", plural: "Webhooks" },
  admin: {
    group: "Webhooks",
    useAsTitle: "name",
    defaultColumns: ["name", "host", "active", "events", "consecutiveFailures", "lastSuccessAt"],
    description:
      "Where Polysite tells other systems that something changed: a small signed JSON message, sent when content is published, a form is submitted, media is uploaded. Only Super Admins manage these because the URL and secret are credentials.",
  },
  access: { read: superOnly, create: superOnly, update: superOnly, delete: superOnly },
  hooks: {
    beforeChange: [
      // Switching a stopped endpoint back on starts it from a clean slate.
      ({ data, originalDoc }) => {
        if (originalDoc && originalDoc.active === false && data?.active === true) {
          data.consecutiveFailures = 0;
          data.disabledReason = null;
          data.disabledAt = null;
        }
        return data;
      },
    ],
  },
  fields: [
    { name: "actions", type: "ui", admin: { components: { Field: ACTIONS } } },
    { name: "name", type: "text", required: true, admin: { description: "For your own reference, for example \"Rebuild the static mirror\"." } },
    secretField({
      name: "url",
      label: "Destination URL",
      description:
        "Where the message is POSTed. https only (a private or internal address is refused). Write-only: once saved it shows as bullets, because a Zapier or Make address is a credential. Leave the bullets to keep it, or paste a new one to replace it.",
      validate: requiredOnCreate("A destination URL is required."),
      check: async (value, siblingData) => {
        try {
          await checkHostResolves(value);
        } catch (err) {
          return `Destination URL: ${err.message}`;
        }
        // Only the host name is kept in the clear, so the list says where each one goes.
        if (siblingData) siblingData.host = new URL(value).hostname;
        return null;
      },
    }),
    { name: "host", type: "text", label: "Host", admin: { readOnly: true, description: "The server the URL points to (the rest of the address stays hidden)." } },
    secretField({
      name: "secret",
      label: "Signing secret",
      description:
        "Every message is signed with it (HMAC-SHA256) so the receiver can check it really came from here and wasn't replayed. At least 16 characters, for example `openssl rand -hex 32`. Write-only; copy it into the receiver now.",
      validate: requiredOnCreate("A signing secret is required."),
      check: (value) => (value.length < 16 ? "Signing secret: use at least 16 characters." : null),
    }),
    {
      name: "site",
      type: "relationship",
      relationTo: "sites",
      admin: { description: "Leave empty to hear about every site. Choose a site to send only that site's events." },
    },
    {
      name: "events",
      type: "select",
      hasMany: true,
      required: true,
      defaultValue: DEFAULT_EVENTS,
      options: EVENT_TYPES,
      admin: { description: "A page or post event describes the live site: saving a draft sends nothing, publishing sends \"published\". Form events carry the ids only, never what was submitted." },
    },
    { name: "active", type: "checkbox", defaultValue: true, label: "Switched on", admin: { description: "Untick to pause. After repeated failures an endpoint is switched off for you; tick it again once the receiver is fixed." } },
    {
      type: "collapsible",
      label: "Health",
      admin: { initCollapsed: false },
      fields: [
        { name: "consecutiveFailures", type: "number", defaultValue: 0, admin: { readOnly: true, description: "Failed attempts in a row. Any success sets it back to zero." } },
        { name: "disabledReason", type: "text", admin: { readOnly: true, description: "Set when Polysite switched this endpoint off by itself." } },
        { name: "disabledAt", type: "date", admin: { readOnly: true } },
        { name: "lastSuccessAt", type: "date", admin: { readOnly: true } },
        { name: "lastFailureAt", type: "date", admin: { readOnly: true } },
        { name: "lastResponseCode", type: "number", admin: { readOnly: true, description: "The last HTTP status the receiver answered with." } },
      ],
    },
  ],
  endpoints: [
    {
      path: "/:id/test",
      method: "post",
      handler: async (req) => {
        if (!isSuper(req.user)) return Response.json({ error: "Forbidden" }, { status: 403 });
        const result = await sendTestEvent({ payload: req.payload, endpointId: req.routeParams?.id });
        return Response.json(result, { status: result.notFound ? 404 : 200 });
      },
    },
  ],
};

const deliveries = {
  slug: SLUGS.deliveries,
  labels: { singular: "Delivery", plural: "Deliveries" },
  admin: {
    group: "Webhooks",
    defaultColumns: ["createdAt", "status", "eventType", "endpointName", "attempts", "responseCode"],
    description:
      "A log of every message that was queued and what happened to it. It keeps the status, the number of attempts and the last error, never a secret and never the receiver's reply. Old entries are removed after 30 days.",
  },
  access: { read: superOnly, create: () => false, update: () => false, delete: superOnly },
  fields: [
    { name: "actions", type: "ui", admin: { components: { Field: REPLAY } } },
    {
      name: "status",
      type: "select",
      defaultValue: "queued",
      index: true,
      options: [
        { label: "Queued", value: "queued" },
        { label: "Sent", value: "sent" },
        { label: "Will retry", value: "retrying" },
        { label: "Failed", value: "failed" },
        { label: "Skipped", value: "skipped" },
      ],
    },
    { name: "eventType", type: "text", index: true },
    { name: "endpoint", type: "relationship", relationTo: SLUGS.endpoints, index: true },
    { name: "endpointName", type: "text", admin: { description: "Copied here so the log still reads well if the endpoint is deleted." } },
    { name: "eventId", type: "text", index: true },
    { name: "attempts", type: "number", defaultValue: 0 },
    { name: "responseCode", type: "number" },
    { name: "lastError", type: "textarea" },
    { name: "nextAttemptAt", type: "date" },
    { name: "sentAt", type: "date" },
    { name: "replays", type: "number", defaultValue: 0 },
    { name: "isTest", type: "checkbox", defaultValue: false },
    { name: "event", type: "json", admin: { readOnly: true, description: "Exactly what is sent: ids, collection, site, title and links. Never the content of a document." } },
  ],
  endpoints: [
    {
      path: "/:id/replay",
      method: "post",
      handler: async (req) => {
        if (!isSuper(req.user)) return Response.json({ error: "Forbidden" }, { status: 403 });
        const result = await replayDelivery({ payload: req.payload, deliveryId: req.routeParams?.id });
        return Response.json(result, { status: result.ok ? 200 : result.notFound ? 404 : 409 });
      },
    },
  ],
};

export const buildCollections = () => [endpoints, deliveries];
