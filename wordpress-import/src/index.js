import { buildCollections } from "./collections.js";
import { buildTask } from "./task.js";

// Imports a WordPress site (a WXR export file) into one Polysite site: pages, posts (with the posts plugin), categories and
// tags, images, the header menu, and redirects from the old addresses. Everything it keeps lives in its own collections
// (wordpress-imports, wordpress-import-map, wordpress-import-log); nothing is added to any core collection.
//
// The work runs as a background job (Payload's jobs queue) and streams the file, so a large export does not need much memory.
// Applied before the core plugins (the manifest says "kind": "content-type"), which then scope the collections to a site.
// Removing the plugin deletes nothing: the tables stay in the database.
export default function wordpressImportPlugin(incomingConfig, kit) {
  const jobs = incomingConfig.jobs ?? {};
  return {
    ...incomingConfig,
    collections: [...(incomingConfig.collections ?? []), ...buildCollections(kit)],
    jobs: { ...jobs, tasks: [...(jobs.tasks ?? []), buildTask()] },
  };
}
