import { SLUGS } from "./collections.js";
import { TASK_SLUG } from "./deliver.js";

// One timer for the whole process: after a burst of saves, kick the job
// runner once. Needed because Payload's Next integration only starts its
// autoRun cron when an admin page renders -- API-only traffic (or the first
// minutes after a restart) would otherwise leave queued notifications
// waiting. autoRun (index.js) remains the backstop for retries.
let runTimer = null;
function scheduleRun(payload) {
  if (runTimer) return;
  runTimer = setTimeout(() => {
    runTimer = null;
    payload.jobs.run({ limit: 25 }).catch((err) => console.error("[notifications] job run failed:", err?.message ?? err));
  }, 300);
}

const siteIdOf = (collection, doc) => {
  if (collection === "sites") return doc.id ?? null;
  const site = doc.site;
  return site && typeof site === "object" ? site.id : (site ?? null);
};

const titleOf = (doc) => doc.title || doc.name || doc.slug || doc.fromPath || doc.email || `#${doc.id}`;

// Which events a save represents. "published" is a status transition, not a
// separate operation, so it can ride along with created/updated.
function eventsFor(operation, doc, previousDoc) {
  const events = [operation === "create" ? "created" : "updated"];
  // `_status` is Payload's draft field (pages and posts); other collections that have their own `status` are unaffected.
  const status = (d) => d?._status ?? d?.status;
  if (status(doc) === "published" && status(previousDoc) !== "published") events.push("published");
  return events;
}

async function fanOut({ collection, doc, events, req }) {
  const { payload } = req;
  if (req.context?.skipNotify) return;

  const docId = String(doc.id);
  // One indexed lookup per content save. Content writes are low-volume, so
  // unlike the per-request RBAC checks (rbac/permissionCache.ts) this needs
  // no cache.
  const watches = await payload.find({
    collection: SLUGS.watches,
    where: {
      and: [
        { collection: { equals: collection } },
        { or: [{ docId: { equals: docId } }, { docId: { exists: false } }, { docId: { equals: "" } }] },
      ],
    },
    depth: 0,
    limit: 500,
    pagination: false,
    overrideAccess: true,
    req,
  });
  if (watches.docs.length === 0) return;

  const site = siteIdOf(collection, doc);
  const base = { collection, docId, title: titleOf(doc), site, actor: req.user?.email ?? null, at: new Date().toISOString() };
  let queued = 0;

  for (const watch of watches.docs) {
    const itemScope = Boolean(watch.docId);
    // Collection-wide watches may be limited to one site.
    if (!itemScope && watch.site) {
      const watchSite = typeof watch.site === "object" ? watch.site.id : watch.site;
      if (String(watchSite) !== String(site)) continue;
    }

    for (const name of events) {
      if (!watch.events?.includes(name)) continue;
      // "created" can't apply to an item-scoped watch (the item already existed).
      if (itemScope && name === "created") continue;

      const event = { ...base, event: name };
      const delivery = await payload.create({
        collection: SLUGS.deliveries,
        data: {
          status: "queued",
          subscriber: watch.subscriberType === "channel" ? `channel:${typeof watch.channel === "object" ? watch.channel?.id : watch.channel}` : `user:${typeof watch.user === "object" ? watch.user?.id : watch.user}`,
          event: name,
          collection,
          docId,
          docTitle: base.title,
          attempts: 0,
        },
        overrideAccess: true,
        req,
        context: { skipNotify: true },
      });
      // `req` joins the job to this save's transaction: if the save rolls back,
      // so does the notification, and sharing the connection avoids the
      // cross-connection lock stall documented in apps/cms/src/utils/uniquePerSite.ts.
      await payload.jobs.queue({
        task: TASK_SLUG,
        input: { deliveryId: String(delivery.id), watchId: String(watch.id), event },
        req,
      });
      queued++;
    }
  }

  if (queued > 0) scheduleRun(payload);
}

// Appends the capture hooks to a collection without disturbing its own.
// Never throws into the save: a notification problem must not fail an edit.
export function attachEventHooks(collection) {
  const safe = (label, fn) => async (args) => {
    try {
      await fn(args);
    } catch (err) {
      console.error(`[notifications] ${label} on ${collection.slug} failed:`, err?.message ?? err);
    }
    return args.doc;
  };

  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [
        ...(collection.hooks?.afterChange ?? []),
        safe("afterChange", ({ doc, previousDoc, operation, req }) =>
          fanOut({ collection: collection.slug, doc, events: eventsFor(operation, doc, previousDoc), req }),
        ),
      ],
      afterDelete: [
        ...(collection.hooks?.afterDelete ?? []),
        safe("afterDelete", ({ doc, req }) => fanOut({ collection: collection.slug, doc, events: ["deleted"], req })),
      ],
    },
  };
}
