import { decrypt, encrypt, isEncrypted, SECRET_MASK } from "./crypto.js";
import { assertUrlAllowed } from "./safePost.js";

export const SLUGS = {
  channels: "notification-channels",
  watches: "notification-watches",
  deliveries: "notification-deliveries",
  inbox: "notifications",
};

export const EVENTS = [
  { label: "Created", value: "created" },
  { label: "Updated", value: "updated" },
  { label: "Deleted", value: "deleted" },
  { label: "Published", value: "published" },
];

// Minimal, self-contained checks -- a plugin package may not import from
// apps/cms (see plugins/README.md), so it relies only on the one stable,
// documented contract every Polysite install has: req.user.isSuperAdmin.
const isSuper = (user) => user?.isSuperAdmin === true;

// Payload's own APIError isn't importable from here (a plugin can't resolve
// the CMS's node_modules), so this carries the same two properties its error
// handler reads to return a clean 4xx message instead of a generic 500.
function clientError(message, status = 400) {
  return Object.assign(new Error(message), { status, isPublic: true });
}

// A write-only secret field: encrypted at rest, masked on every read
// (admin form, REST, GraphQL) unless a caller opts in through context, and
// "mask means keep" on save -- the same pattern as the Email plugin's SMTP
// password. `revealNotifySecrets` returns the decrypted value (the delivery
// task only); `rawNotifySecrets` returns the stored value untouched (the
// keep-on-save re-read below).
//
// `check` validates the plaintext a user typed and must run in beforeValidate:
// Payload runs a field's own `validate` *after* its beforeChange hook, by
// which point the value is already ciphertext (caught for real -- a valid
// URL was rejected because validate was parsing "enc:v1:..."). So `validate`
// below can only check presence; format and SSRF checks live in `check`.
function secretField({ collection, name, label, description, condition, validate, check }) {
  return {
    name,
    type: "text",
    label,
    admin: { description, condition },
    validate,
    hooks: {
      beforeValidate: [
        ({ value, siblingData }) => {
          if (check && value && value !== SECRET_MASK && !isEncrypted(value)) {
            const problem = check(value, siblingData);
            if (problem) throw clientError(problem);
          }
          return value;
        },
      ],
      afterRead: [
        ({ value, req }) => {
          if (req.context?.revealNotifySecrets) return decrypt(value);
          if (req.context?.rawNotifySecrets) return value;
          return value ? SECRET_MASK : value;
        },
      ],
      beforeChange: [
        async ({ value, originalDoc, req }) => {
          let next = value;
          if (value === SECRET_MASK) {
            // previousValue is the masked read of the original doc, so fetch
            // the stored value raw instead.
            const current = originalDoc?.id
              ? await req.payload.findByID({
                  collection,
                  id: originalDoc.id,
                  depth: 0,
                  overrideAccess: true,
                  context: { rawNotifySecrets: true },
                })
              : null;
            next = current?.[name] ?? "";
          }
          return encrypt(next);
        },
      ],
    },
  };
}

const URL_TYPES = ["slack", "teams", "webhook"];

const channels = {
  slug: SLUGS.channels,
  labels: { singular: "Channel", plural: "Channels" },
  admin: {
    group: "Notifications",
    useAsTitle: "name",
    description:
      "Where team notifications are delivered: a Slack or Teams channel, a signed webhook, or an email list. Only Super Admins manage these because the URLs are credentials.",
  },
  access: {
    read: ({ req: { user } }) => isSuper(user),
    create: ({ req: { user } }) => isSuper(user),
    update: ({ req: { user } }) => isSuper(user),
    delete: ({ req: { user } }) => isSuper(user),
  },
  fields: [
    { name: "name", type: "text", required: true },
    {
      name: "type",
      type: "select",
      required: true,
      defaultValue: "slack",
      options: [
        { label: "Slack (incoming webhook)", value: "slack" },
        { label: "Microsoft Teams (Workflows webhook)", value: "teams" },
        { label: "Signed webhook (any URL)", value: "webhook" },
        { label: "Email list", value: "email" },
      ],
    },
    secretField({
      collection: SLUGS.channels,
      name: "url",
      label: "Webhook URL",
      description:
        "Write-only: once saved it displays as bullets. Leave the bullets to keep the current URL, or paste a new one to replace it.",
      condition: (_, siblingData) => URL_TYPES.includes(siblingData?.type),
      validate: (value, { siblingData }) => {
        if (!URL_TYPES.includes(siblingData?.type)) return true;
        return value ? true : "A webhook URL is required for this channel type.";
      },
      check: (value, siblingData) => {
        if (!URL_TYPES.includes(siblingData?.type)) return null;
        try {
          assertUrlAllowed(value);
          return null;
        } catch (err) {
          return `Webhook URL: ${err.message}`;
        }
      },
    }),
    secretField({
      collection: SLUGS.channels,
      name: "secret",
      label: "Signing secret (optional)",
      description:
        "Signed webhooks include an X-Polysite-Signature header (HMAC-SHA256 of the body) so the receiver can verify the sender. Write-only.",
      condition: (_, siblingData) => siblingData?.type === "webhook",
    }),
    {
      name: "recipients",
      type: "textarea",
      admin: {
        description: "One email address per line (or comma-separated). Sent through the Email plugin's SMTP settings.",
        condition: (_, siblingData) => siblingData?.type === "email",
      },
      validate: (value, { siblingData }) => {
        if (siblingData?.type !== "email") return true;
        const list = String(value ?? "")
          .split(/[\s,;]+/)
          .filter(Boolean);
        if (list.length === 0) return "Add at least one email address.";
        const bad = list.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        return bad ? `"${bad}" doesn't look like an email address.` : true;
      },
    },
    { name: "enabled", type: "checkbox", defaultValue: true, admin: { description: "Untick to pause every watch that delivers here." } },
  ],
};

function buildWatches(collectionOptions) {
  return {
    slug: SLUGS.watches,
    labels: { singular: "Watch", plural: "Watches" },
    admin: {
      group: "Notifications",
      defaultColumns: ["subscriberType", "user", "channel", "collection", "events"],
      description:
        "Who hears about what. Opt-in: nothing notifies until a watch exists. Most watches are created with the Watch button on a document's menu; a watch with no document ID covers every document in its collection.",
    },
    access: {
      read: ({ req: { user } }) => (isSuper(user) ? true : user ? { user: { equals: user.id } } : false),
      create: ({ req: { user } }) => Boolean(user),
      update: ({ req: { user } }) => (isSuper(user) ? true : user ? { user: { equals: user.id } } : false),
      delete: ({ req: { user } }) => (isSuper(user) ? true : user ? { user: { equals: user.id } } : false),
    },
    hooks: {
      beforeValidate: [
        ({ data, req }) => {
          if (!data) return data;
          const user = req.user;
          // Only a Super Admin can subscribe a team channel or someone else;
          // everyone else's watches are forced to be their own.
          if (!isSuper(user)) {
            data.subscriberType = "user";
            data.user = user?.id;
            data.channel = null;
          } else if ((data.subscriberType ?? "user") === "user" && !data.user) {
            data.user = user?.id;
          }
          data.docId = data.docId ? String(data.docId) : null;
          return data;
        },
      ],
      beforeChange: [
        async ({ data, originalDoc, operation, req }) => {
          const merged = { ...originalDoc, ...data };
          const docId = merged.docId || null;

          // Duplicate guard: one watch per subscriber per target.
          const where = {
            and: [
              { collection: { equals: merged.collection } },
              docId ? { docId: { equals: docId } } : { docId: { exists: false } },
              merged.subscriberType === "channel"
                ? { channel: { equals: typeof merged.channel === "object" ? merged.channel?.id : merged.channel } }
                : { user: { equals: typeof merged.user === "object" ? merged.user?.id : merged.user } },
              ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
            ],
          };
          const dupe = await req.payload.find({ collection: SLUGS.watches, where, limit: 1, depth: 0, overrideAccess: true, req });
          if (dupe.totalDocs > 0) throw clientError("That subscriber is already watching this.");

          // A watch must never become a way to learn about things the
          // subscriber couldn't open themselves. Ordinary users can only
          // watch what their own access lets them read.
          if (operation === "create" && !isSuper(req.user)) {
            try {
              if (docId) {
                await req.payload.findByID({ collection: merged.collection, id: docId, depth: 0, user: req.user, overrideAccess: false });
              } else {
                await req.payload.find({ collection: merged.collection, limit: 1, depth: 0, user: req.user, overrideAccess: false });
              }
            } catch {
              throw clientError("You don't have access to watch that.", 403);
            }
          }
          return data;
        },
      ],
    },
    fields: [
      {
        name: "subscriberType",
        type: "select",
        required: true,
        defaultValue: "user",
        options: [
          { label: "A person (their notification bell)", value: "user" },
          { label: "A team channel", value: "channel" },
        ],
        admin: { description: "Team channels can only be subscribed by a Super Admin." },
        access: { create: ({ req: { user } }) => isSuper(user), update: ({ req: { user } }) => isSuper(user) },
      },
      {
        name: "user",
        type: "relationship",
        relationTo: "users",
        admin: { condition: (data) => (data?.subscriberType ?? "user") === "user", description: "Defaults to you." },
        access: { create: ({ req: { user } }) => isSuper(user), update: ({ req: { user } }) => isSuper(user) },
      },
      {
        name: "channel",
        type: "relationship",
        relationTo: SLUGS.channels,
        admin: { condition: (data) => data?.subscriberType === "channel" },
        access: { create: ({ req: { user } }) => isSuper(user), update: ({ req: { user } }) => isSuper(user) },
      },
      {
        name: "collection",
        // Plain text, not a select: a select is a Postgres enum, and the list of watchable collections changes whenever another
        // plugin is installed or removed. The menu is the core's SingleSelect component; a watch whose collection has since gone stays.
        type: "text",
        required: true,
        validate: (value) => (typeof value === "string" && /^[a-z0-9-]+$/.test(value)) || "Choose a collection.",
        admin: { components: { Field: { path: "/components/SingleSelect#SingleSelect", clientProps: { options: collectionOptions } } } },
      },
      {
        name: "docId",
        type: "text",
        label: "Document ID",
        admin: { description: "Leave empty to watch every document in the collection (the only way to hear about newly created ones)." },
      },
      {
        name: "site",
        type: "relationship",
        relationTo: "sites",
        admin: {
          description: "Collection-wide watches only: limit to one site. Empty means all sites.",
          condition: (data) => !data?.docId,
        },
      },
      {
        name: "events",
        type: "select",
        hasMany: true,
        required: true,
        defaultValue: ["updated", "deleted", "published"],
        options: EVENTS,
        admin: { description: "'Created' only applies to collection-wide watches -- a document that doesn't exist yet can't be watched individually." },
      },
      {
        name: "alsoEmail",
        type: "checkbox",
        defaultValue: false,
        label: "Also email me",
        admin: { description: "People only: in addition to the bell, send an email to your account address.", condition: (data) => (data?.subscriberType ?? "user") === "user" },
      },
    ],
    endpoints: [
      {
        path: "/status",
        method: "get",
        handler: async (req) => {
          if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const url = new URL(req.url);
          const collection = url.searchParams.get("collection");
          const docId = url.searchParams.get("docId");
          if (!collection || !docId) return Response.json({ error: "collection and docId are required" }, { status: 400 });
          const found = await req.payload.find({
            collection: SLUGS.watches,
            where: { and: [{ collection: { equals: collection } }, { docId: { equals: docId } }, { user: { equals: req.user.id } }] },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          });
          return Response.json({ watching: found.totalDocs > 0 });
        },
      },
      {
        path: "/toggle",
        method: "post",
        handler: async (req) => {
          if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const body = await req.json?.();
          const collection = body?.collection;
          const docId = body?.docId ? String(body.docId) : null;
          if (!collection || !docId) return Response.json({ error: "collection and docId are required" }, { status: 400 });

          const existing = await req.payload.find({
            collection: SLUGS.watches,
            where: { and: [{ collection: { equals: collection } }, { docId: { equals: docId } }, { user: { equals: req.user.id } }] },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          });
          if (existing.docs[0]) {
            await req.payload.delete({ collection: SLUGS.watches, id: existing.docs[0].id, overrideAccess: true });
            return Response.json({ watching: false });
          }
          try {
            await req.payload.create({
              collection: SLUGS.watches,
              data: { subscriberType: "user", user: req.user.id, collection, docId, events: ["updated", "deleted", "published"] },
              user: req.user,
              overrideAccess: false,
            });
            return Response.json({ watching: true });
          } catch (err) {
            return Response.json({ error: err.message }, { status: err.status || 500 });
          }
        },
      },
    ],
  };
}

const deliveries = {
  slug: SLUGS.deliveries,
  labels: { singular: "Delivery", plural: "Deliveries" },
  admin: {
    group: "Notifications",
    defaultColumns: ["createdAt", "status", "subscriber", "event", "collection", "docTitle", "attempts"],
    description: "A log of every notification that was queued, and whether it was delivered. Read-only.",
  },
  access: {
    read: ({ req: { user } }) => isSuper(user),
    create: () => false,
    update: () => false,
    delete: ({ req: { user } }) => isSuper(user),
  },
  fields: [
    { name: "status", type: "select", defaultValue: "queued", options: ["queued", "sent", "failed", "skipped"] },
    { name: "subscriber", type: "text" },
    { name: "event", type: "text" },
    { name: "collection", type: "text" },
    { name: "docId", type: "text" },
    { name: "docTitle", type: "text" },
    { name: "attempts", type: "number", defaultValue: 0 },
    { name: "lastError", type: "textarea" },
    { name: "sentAt", type: "date" },
  ],
};

const inbox = {
  slug: SLUGS.inbox,
  labels: { singular: "Notification", plural: "Notifications" },
  admin: { group: "Notifications", useAsTitle: "title", defaultColumns: ["title", "readAt", "createdAt"], description: "Your notification inbox -- the same items as the bell in the header." },
  access: {
    read: ({ req: { user } }) => (user ? { user: { equals: user.id } } : false),
    create: () => false,
    update: ({ req: { user } }) => (user ? { user: { equals: user.id } } : false),
    delete: ({ req: { user } }) => (user ? { user: { equals: user.id } } : false),
  },
  fields: [
    // Everything except readAt is system-written; users can only mark items read.
    { name: "user", type: "relationship", relationTo: "users", required: true, index: true, access: { update: () => false } },
    { name: "title", type: "text", required: true, access: { update: () => false } },
    { name: "body", type: "textarea", access: { update: () => false } },
    { name: "link", type: "text", access: { update: () => false } },
    { name: "readAt", type: "date" },
  ],
  endpoints: [
    {
      path: "/mark-all-read",
      method: "post",
      handler: async (req) => {
        if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
        await req.payload.update({
          collection: SLUGS.inbox,
          where: { and: [{ user: { equals: req.user.id } }, { readAt: { exists: false } }] },
          data: { readAt: new Date().toISOString() },
          overrideAccess: true,
        });
        return Response.json({ ok: true });
      },
    },
  ],
};

export function buildCollections(collectionOptions) {
  return [channels, buildWatches(collectionOptions), deliveries, inbox];
}
