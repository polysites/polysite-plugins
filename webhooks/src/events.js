// What happened, and the small JSON message that says so. Everything here is a pure function (no database, no network), so the
// rules are tested on their own.

export const SLUGS = { endpoints: "webhook-endpoints", deliveries: "webhook-deliveries" };
export const TASK_SLUG = "polysite-webhook-deliver";

export const EVENT_TYPES = [
  { label: "Page created", value: "page.created" },
  { label: "Page updated (live version changed)", value: "page.updated" },
  { label: "Page published", value: "page.published" },
  { label: "Page unpublished", value: "page.unpublished" },
  { label: "Page deleted", value: "page.deleted" },
  { label: "Post created", value: "post.created" },
  { label: "Post updated (live version changed)", value: "post.updated" },
  { label: "Post published", value: "post.published" },
  { label: "Post unpublished", value: "post.unpublished" },
  { label: "Post deleted", value: "post.deleted" },
  { label: "Form submitted", value: "form.submitted" },
  { label: "Media uploaded", value: "media.uploaded" },
];
export const TEST_EVENT = "webhook.test";
export const DEFAULT_EVENTS = ["page.published", "page.unpublished", "page.deleted", "post.published", "post.unpublished", "post.deleted"];

// The collections this plugin watches, and the word each goes by in an event type. A collection that is not installed (the
// posts plugin) is simply not instrumented.
export const WATCHED = { pages: "page", posts: "post", "form-submissions": "form", media: "media" };
const HAS_DRAFTS = new Set(["pages", "posts"]);

const statusOf = (doc) => doc?._status;

// Which events a save represents.
//
// Pages and posts have drafts, and visitors only see the live (published) version, so an event describes the live site:
//  - creating one is `created` (also `published` when it is created already published);
//  - a "Save draft" or an autosave changes nothing visitors see and sends nothing;
//  - publishing what was a draft is `published` (not also `updated`); taking a published one down is `unpublished`;
//  - saving a published one so that it stays published is `updated`; saving one that is not live is `updated` too.
// `liveStatus` is what the live version was before this save (the core records it on the request); without it the previous
// document's status is used.
export function eventTypesFor({ collection, operation, doc, previousDoc, isDraftSave = false, liveStatus }) {
  const kind = WATCHED[collection];
  if (!kind) return [];
  if (collection === "form-submissions") return operation === "create" ? ["form.submitted"] : [];
  if (collection === "media") return operation === "create" ? ["media.uploaded"] : [];
  if (!HAS_DRAFTS.has(collection)) return [];

  const now = statusOf(doc);
  if (operation === "create") return now === "published" ? [`${kind}.created`, `${kind}.published`] : [`${kind}.created`];
  if (isDraftSave) return [];
  const before = liveStatus ?? statusOf(previousDoc);
  if (now === "published" && before !== "published") return [`${kind}.published`];
  if (now !== "published" && before === "published") return [`${kind}.unpublished`];
  return [`${kind}.updated`];
}

export const typeForDelete = (collection) => (HAS_DRAFTS.has(collection) ? [`${WATCHED[collection]}.deleted`] : []);

const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null);

// The one and only place an event body is made. It is written field by field, never copied from the document, so nothing a
// document holds can slip in: no page body, no form answers, no email address, no user. Titles and ids are all it carries.
export function buildEvent({ eventId, type, collection, doc, site, adminOrigin = "", adminRoute = "/admin", now = new Date(), test = false }) {
  const base = `${adminOrigin}${adminRoute}/collections/${collection}`;
  const id = doc?.id == null ? null : String(doc.id);
  const data = test
    ? { collection: null, id: null, title: "Test event from Polysite", adminUrl: `${adminOrigin}${adminRoute}`, publicUrl: null }
    : collection === "form-submissions"
      ? // Only which form and which submission, so an automation can fetch it with its own sign-in. Never the answers.
        { collection, id, formId: idOf(doc?.form) == null ? null : String(idOf(doc.form)), adminUrl: id ? `${base}/${id}` : base, publicUrl: null }
      : {
          collection,
          id,
          title: text(doc?.title) ?? text(doc?.filename) ?? text(doc?.name) ?? (id ? `#${id}` : null),
          adminUrl: type.endsWith(".deleted") || !id ? base : `${base}/${id}`,
          publicUrl: null,
        };
  return {
    id: eventId,
    type,
    createdAt: now.toISOString(),
    site: site?.id == null ? null : { id: String(site.id), domain: text(site.domain) },
    data,
  };
}

// The keys an event may ever contain. A test asserts a built event stays inside this list.
export const EVENT_KEYS = ["id", "type", "createdAt", "site", "data"];
export const DATA_KEYS = ["collection", "id", "title", "formId", "adminUrl", "publicUrl"];

// Whether an endpoint should hear about an event: it is switched on, lists the type, and is for all sites or this one.
export function endpointWants(endpoint, { type, siteId }) {
  if (endpoint?.active === false) return false;
  if (!Array.isArray(endpoint?.events) || !endpoint.events.includes(type)) return false;
  const only = idOf(endpoint.site);
  if (only == null || only === "") return true;
  return siteId != null && String(only) === String(siteId);
}

// The database keeps an event as JSON, which does not keep the order of keys. A message should read the same every time, so it is
// put back in the documented order just before it is sent (and nothing outside the documented keys is ever sent).
export function canonicalEvent(event) {
  const pick = (source, keys) => Object.fromEntries(keys.filter((k) => source && k in source).map((k) => [k, source[k]]));
  const site = event.site && typeof event.site === "object" ? pick(event.site, ["id", "domain"]) : null;
  return { ...pick(event, EVENT_KEYS), site, data: pick(event.data, DATA_KEYS) };
}
