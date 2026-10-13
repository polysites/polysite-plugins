import { buildCollections, SLUGS } from "./collections.js";
import { notifyTask } from "./deliver.js";
import { attachEventHooks } from "./events.js";

// Admin component paths are relative to apps/cms/src (the import map's
// baseDir). apps/cms/next.config.mjs widens Turbopack's root to the repo
// root so these files, which live outside the app, can be bundled.
const BELL = "../../../plugins/notifications/src/admin/NotificationBell#NotificationBell";
const WATCH = "../../../plugins/notifications/src/admin/WatchToggle#WatchToggle";

const OWN = new Set(Object.values(SLUGS));

const labelOf = (collection) => (typeof collection.labels?.plural === "string" ? collection.labels.plural : collection.slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()));

const isSuper = ({ req: { user } }) => user?.isSuperAdmin === true;

// Opt-in per item, for any collection: every collection gets the capture
// hooks and a "Watch" menu entry, but nothing notifies until a watch exists
// (see events.js). Applied last, like every plugin, so collections other
// plugins generated (form-submissions, site-urls) are covered too.
export default function notificationsPlugin(incomingConfig) {
  const existing = incomingConfig.collections ?? [];
  // A collection hidden from the admin (another plugin's internal table) has no screen to watch it from.
  const isInternal = (c) => OWN.has(c.slug) || c.admin?.hidden === true;
  const watchable = existing.filter((c) => !isInternal(c));
  const options = watchable.map((c) => ({ label: labelOf(c), value: c.slug }));

  const instrumented = existing.map((collection) => {
    if (isInternal(collection)) return collection;
    const withHooks = attachEventHooks(collection);
    const edit = withHooks.admin?.components?.edit ?? {};
    return {
      ...withHooks,
      admin: {
        ...withHooks.admin,
        components: {
          ...withHooks.admin?.components,
          edit: { ...edit, editMenuItems: [...(edit.editMenuItems ?? []), WATCH] },
        },
      },
    };
  });

  const jobs = incomingConfig.jobs ?? {};
  const autoRun = Array.isArray(jobs.autoRun) ? jobs.autoRun : [];

  return {
    ...incomingConfig,
    admin: {
      ...incomingConfig.admin,
      components: {
        ...incomingConfig.admin?.components,
        actions: [...(incomingConfig.admin?.components?.actions ?? []), BELL],
      },
    },
    collections: [...instrumented, ...buildCollections(options)],
    jobs: {
      ...jobs,
      tasks: [...(jobs.tasks ?? []), notifyTask],
      // Retry/backoff backstop; the hook also triggers a run directly
      // (events.js scheduleRun) because this cron only starts once an admin
      // page has rendered.
      autoRun: [...autoRun, { cron: "*/10 * * * * *", limit: 25 }],
      // Queueing/running/cancelling jobs over REST is for Super Admins only;
      // the local API (what this plugin uses) isn't affected.
      access: { queue: isSuper, run: isSuper, cancel: isSuper, ...jobs.access },
    },
  };
}
