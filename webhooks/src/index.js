import { attachCaptureHooks } from "./capture.js";
import { buildCollections } from "./collections.js";
import { deliverTask, pruneDeliveries } from "./deliver.js";
import { SLUGS } from "./events.js";
import { allowPrivate } from "./request.js";

// Outbound webhooks. Admins define endpoints (a URL, a secret, one site or all, which events); when content changes, Polysite
// POSTs a small signed JSON message to each endpoint that wants it.
//
//  - capture: after-save and after-delete hooks on pages, posts, form submissions and media (capture.js). Pure rules about what
//    counts as an event live in events.js; the message carries ids, titles and links, never a document's content;
//  - delivery: Payload's jobs queue, one job per attempt, exponential backoff, a delivery log, automatic switch-off after
//    repeated failures (deliver.js, policy.js); requests are signed (sign.js) and SSRF-guarded (request.js);
//  - admin: two collections of its own (collections.js) plus a few small components (admin/). Nothing is added to any core table.
//
// Removing the plugin deletes nothing: its tables stay in the database.
const BANNER = "../../../plugins/webhooks/src/admin/DisabledBanner#DisabledBanner";
const OWN = new Set(Object.values(SLUGS));
const isSuper = ({ req: { user } }) => user?.isSuperAdmin === true;

export default function webhooksPlugin(incomingConfig, kit) {
  const jobs = incomingConfig.jobs ?? {};
  const autoRun = Array.isArray(jobs.autoRun) ? jobs.autoRun : [];
  const instrumented = (incomingConfig.collections ?? []).map((collection) => (OWN.has(collection.slug) ? collection : attachCaptureHooks(collection, kit)));

  if (allowPrivate() && process.env.NODE_ENV === "production") {
    console.warn("[webhooks] WEBHOOKS_ALLOW_PRIVATE_HOSTS=1: private addresses and plain http are allowed. This is for tests only; never set it on a real install.");
  }

  return {
    ...incomingConfig,
    admin: {
      ...incomingConfig.admin,
      components: { ...incomingConfig.admin?.components, beforeDashboard: [...(incomingConfig.admin?.components?.beforeDashboard ?? []), BANNER] },
    },
    collections: [...instrumented, ...buildCollections()],
    jobs: {
      ...jobs,
      tasks: [...(jobs.tasks ?? []), deliverTask],
      // Backstop for deliveries whose timer was lost (a restart); the capture hook and each retry also trigger a run themselves.
      autoRun: [...autoRun, { cron: "*/10 * * * * *", limit: 25 }],
      access: { queue: isSuper, run: isSuper, cancel: isSuper, ...jobs.access },
    },
    onInit: async (payload) => {
      await incomingConfig.onInit?.(payload);
      pruneDeliveries(payload);
      setInterval(() => pruneDeliveries(payload), 6 * 60 * 60 * 1000).unref?.();
    },
  };
}
