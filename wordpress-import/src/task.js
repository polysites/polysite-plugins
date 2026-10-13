import fs from "node:fs";
import path from "node:path";

import { COLLECTIONS, createStore } from "./store.js";

export const TASK_SLUG = "wordpress-import";

// Where uploaded exports are kept: under the media folder (a volume in production, so it survives a restart and is backed up
// with it), in a sub-folder of its own. Files here are private: nothing serves this folder, only the endpoints in endpoints.js read it.
export const uploadDir = () => path.resolve(process.cwd(), "media", "wordpress-imports");
export const filePathOf = (fileName) => path.join(uploadDir(), path.basename(String(fileName)));

const idOf = (v) => (v && typeof v === "object" ? v.id : v);

// One timer for the process: after a request is queued, kick the job runner once. Payload's own scheduler starts only when an
// admin page renders and the core's runs every 30 seconds, so an import would otherwise wait up to half a minute to begin.
let runTimer = null;
export function scheduleRun(payload) {
  if (runTimer) return;
  runTimer = setTimeout(() => {
    runTimer = null;
    payload.jobs.run({ limit: 5 }).catch((err) => console.error("[wordpress-import] job run failed:", err?.message ?? err));
  }, 200);
}

export function buildTask() {
  return {
    slug: TASK_SLUG,
    // Never retried by the queue: a half-done import is simply run again by a person, and it is safe to (it updates, it does not duplicate).
    retries: 0,
    inputSchema: [
      { name: "importId", type: "text", required: true },
      { name: "phase", type: "text", required: true },
    ],
    handler: async ({ input, req }) => {
      const { payload } = req;
      const doc = await payload.findByID({ collection: COLLECTIONS.imports, id: input.importId, depth: 0, overrideAccess: true, disableErrors: true });
      if (!doc) return { output: {} };
      const patch = (data) => payload.update({ collection: COLLECTIONS.imports, id: doc.id, data, depth: 0, overrideAccess: true });
      const analysing = input.phase === "analyse";
      try {
        await patch({
          status: analysing ? "analysing" : "running",
          error: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          progress: { phase: "starting", done: 0, total: 0, message: "Starting", at: Date.now() },
          ...(analysing ? { analysis: null } : { result: null }),
        });
        // Loaded here, not at the top: the XML and HTML libraries are needed only when an import actually runs.
        const { analyse, runImport } = await import("./importer.js");
        const file = filePathOf(doc.fileName);
        if (!doc.fileName || !fs.existsSync(file)) throw new Error("The export file is missing. Upload it again.");
        const store = await createStore(payload, { siteId: idOf(doc.site), importId: doc.id });
        const openStream = () => fs.createReadStream(file, { highWaterMark: 256 * 1024 });
        const onProgress = (p) => patch({ progress: { ...p, at: Date.now() } });
        if (analysing) {
          const analysis = await analyse({ openStream, options: doc.options ?? {}, store, onProgress });
          await patch({ status: "analysed", analysis, progress: { phase: "done", done: 1, total: 1, message: "Dry run finished", at: Date.now() }, finishedAt: new Date().toISOString() });
        } else {
          const result = await runImport({ openStream, options: doc.options ?? {}, store, onProgress });
          await patch({ status: "done", result, progress: { phase: "done", done: result ? 1 : 0, total: 1, message: "Finished", at: Date.now() }, finishedAt: new Date().toISOString() });
        }
      } catch (err) {
        console.error("[wordpress-import] failed:", err?.message ?? err);
        await patch({ status: "failed", error: String(err?.message ?? err).slice(0, 1000), finishedAt: new Date().toISOString() }).catch(() => {});
      }
      return { output: {} };
    },
  };
}
