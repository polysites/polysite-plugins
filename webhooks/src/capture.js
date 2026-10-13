import { queueDelivery, scheduleRun } from "./deliver.js";
import { buildEvent, endpointWants, eventTypesFor, SLUGS, typeForDelete, WATCHED } from "./events.js";
import { randomUUID } from "node:crypto";

const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const isDraftQuery = (query) => query?.draft === true || query?.draft === "true";

async function fanOut({ collection, doc, types, req }) {
  if (types.length === 0 || req.context?.skipWebhooks) return;
  const { payload } = req;

  // A handful of endpoints at most, and content saves are low-volume, so one lookup per save needs no cache.
  const found = await payload.find({ collection: SLUGS.endpoints, where: { active: { equals: true } }, limit: 200, pagination: false, depth: 0, overrideAccess: true, req });
  if (found.docs.length === 0) return;

  const siteId = idOf(doc.site) ?? null;
  const wanted = types.flatMap((type) => {
    const endpoints = found.docs.filter((endpoint) => endpointWants(endpoint, { type, siteId }));
    return endpoints.length ? [{ type, endpoints }] : [];
  });
  if (wanted.length === 0) return;

  const site = siteId == null ? null : await payload.findByID({ collection: "sites", id: siteId, depth: 0, overrideAccess: true, req }).catch(() => null);
  const adminOrigin = payload.config.serverURL || "";
  const adminRoute = payload.config.routes?.admin || "/admin";

  for (const { type, endpoints } of wanted) {
    const event = buildEvent({ eventId: `evt_${randomUUID()}`, type, collection, doc, site, adminOrigin, adminRoute });
    for (const endpoint of endpoints) await queueDelivery({ payload, req, endpoint, event });
  }
  scheduleRun(payload);
}

// Appends the capture hooks to a collection without disturbing its own. Never throws into the save: a webhook problem must not
// fail an edit.
export function attachCaptureHooks(collection, kit) {
  const slug = collection.slug;
  if (!WATCHED[slug]) return collection;
  const safe = (label, fn) => async (args) => {
    try {
      await fn(args);
    } catch (err) {
      console.error(`[webhooks] ${label} on ${slug} failed:`, err?.message ?? err);
    }
    return args.doc;
  };

  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [
        ...(collection.hooks?.afterChange ?? []),
        safe("afterChange", ({ doc, previousDoc, operation, req }) => {
          const isDraftSave = kit?.workflow?.isDraftRequest ? kit.workflow.isDraftRequest(req.query) : isDraftQuery(req.query);
          const liveStatus = kit?.workflow?.liveBefore?.(req)?.status;
          return fanOut({ collection: slug, doc, types: eventTypesFor({ collection: slug, operation, doc, previousDoc, isDraftSave, liveStatus }), req });
        }),
      ],
      afterDelete: [
        ...(collection.hooks?.afterDelete ?? []),
        safe("afterDelete", ({ doc, req }) => fanOut({ collection: slug, doc, types: typeForDelete(slug), req })),
      ],
    },
  };
}
