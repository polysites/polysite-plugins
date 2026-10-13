import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { DEFAULT_OPTIONS } from "./options.js";
import { scheduleRun, TASK_SLUG, filePathOf, uploadDir } from "./task.js";
import { COLLECTIONS } from "./store.js";

// The plugin's three collections, all its own tables:
//   wordpress-imports     one row per import: the settings, the file, the status, the dry-run result, the final report
//   wordpress-import-map  which WordPress item became which Polysite document (what makes a re-run update instead of duplicate)
//   wordpress-import-log  what happened to each item: skipped, dropped, failed
// Nothing is added to any core collection.

const MODULE = { label: "WordPress import", value: "wordpress-import" };
const ICON = { paths: ["M12 3v12", "M7 10l5 5 5-5", "M4 19h16"] };
const PANEL = "../../../plugins/wordpress-import/src/admin/ImportPanel#ImportPanel";

const RUNNING = new Set(["queued", "analysing", "running"]);
// A job whose progress has not moved for this long is treated as dead (the server restarted under it), so it can be started again.
const STALE_MS = 10 * 60 * 1000;

export const maxUploadBytes = () => (Number(process.env.WORDPRESS_IMPORT_MAX_MB) > 0 ? Number(process.env.WORDPRESS_IMPORT_MAX_MB) : 512) * 1024 * 1024;

const json = (body, status = 200) => Response.json(body, { status });
const idOf = (v) => (v && typeof v === "object" ? v.id : v);

export function buildCollections(kit) {
  const manager = ({ req: { user } }) => Boolean(user) && kit.canManageSiteSettings(user);
  const hiddenFromOthers = ({ user }) => !kit.canManageSiteSettings(user);
  const noOne = () => false;
  const systemField = { create: noOne, update: noOne };

  // Whether this person may import into this site: a site-settings permission, for a site they are assigned to (Super Admins: any).
  const mayUse = (user, siteId) => Boolean(user) && kit.canManageSiteSettings(user) && (kit.isSuperAdmin(user) || kit.userSiteIds(user).includes(String(siteId)));

  const check = (name, label, description, extra = {}) => ({ name, type: "checkbox", label, admin: { description }, ...extra });

  const optionFields = [
    { name: "targetStatus", type: "select", label: "Publish as", defaultValue: DEFAULT_OPTIONS.targetStatus, options: [{ label: "Draft (review first)", value: "draft" }, { label: "Published (what is live on WordPress goes live here)", value: "published" }], admin: { description: "Items that were not published on WordPress always arrive as drafts." } },
    check("importPages", "Import pages", "", { defaultValue: true }),
    check("importPosts", "Import posts", "Needs the posts plugin; without it posts are skipped and the log says so.", { defaultValue: true }),
    check("importTags", "File posts under their tags too", "Tags become post categories, like WordPress categories do.", { defaultValue: true }),
    check("importMedia", "Download images and files", "Featured images and images inside the text are fetched from the old site into the media library.", { defaultValue: true }),
    check("includeDrafts", "Include drafts, pending and scheduled items", "Always imported as drafts.", { defaultValue: false }),
    check("includePrivate", "Include private items", "Always imported as drafts.", { defaultValue: false }),
    check("includeTrashed", "Include trashed items", "Always imported as drafts.", { defaultValue: false }),
    check("overwrite", "Overwrite changes made here", "Off: anything edited in Polysite since the last import is left alone (and listed in the log). On: it is replaced by the WordPress version.", { defaultValue: false }),
    { name: "onSlugConflict", type: "select", label: "When an address is already taken", defaultValue: DEFAULT_OPTIONS.onSlugConflict, options: [{ label: "Skip the item and say so", value: "skip" }, { label: "Import it with a number added (about-2)", value: "rename" }] },
    check("createRedirects", "Redirect old addresses", "Where the new address differs from the WordPress one, a 301 redirect is added.", { defaultValue: true }),
    { name: "bylineMode", type: "select", label: "Post byline", defaultValue: DEFAULT_OPTIONS.bylineMode, options: [{ label: "The WordPress author's name", value: "author" }, { label: "One fixed name", value: "fixed" }, { label: "None", value: "none" }] },
    { name: "bylineText", type: "text", label: "Fixed byline", admin: { description: "Used when the byline is one fixed name, like The Editorial Team.", condition: (_d, sibling) => sibling?.bylineMode === "fixed" } },
    { name: "authorMap", type: "textarea", label: "Author names", admin: { description: "Optional. One per line, login = name shown, like sam = Sam Rivera. Anyone not listed uses their WordPress display name.", condition: (_d, sibling) => sibling?.bylineMode === "author" } },
    { name: "allowedMediaHosts", type: "textarea", label: "Also download images from", admin: { description: "Images are only fetched from the old site's own address. List other hosts (one per line) that may be fetched too, like cdn.example.com." } },
    { name: "mediaMaxMb", type: "number", label: "Largest file (MB)", defaultValue: DEFAULT_OPTIONS.mediaMaxMb, min: 1, max: 100 },
    check("allowHttpMedia", "Allow plain http for images", "Secure (https) is always tried first. Turn this off to refuse files that can only be fetched over http.", { defaultValue: true }),
    { name: "menuMode", type: "select", label: "WordPress menu", defaultValue: DEFAULT_OPTIONS.menuMode, options: [{ label: "Add its links to the header menu", value: "append" }, { label: "Replace the header menu", value: "replace" }, { label: "Do not import a menu", value: "none" }], admin: { description: "Only the top level is imported: the header menu has one level." } },
    { name: "menuName", type: "text", label: "Which menu", admin: { description: "The menu's name from WordPress. Leave empty to use the main one.", condition: (_d, sibling) => sibling?.menuMode !== "none" } },
  ];

  // ---- the endpoints --------------------------------------------------------------------------------------------

  const loadForUser = async (req, id) => {
    if (!req.user || !kit.canManageSiteSettings(req.user)) return { error: json({ error: "You do not have permission to import." }, 403) };
    const doc = await req.payload.findByID({ collection: COLLECTIONS.imports, id, depth: 0, overrideAccess: true, disableErrors: true });
    if (!doc || !mayUse(req.user, idOf(doc.site))) return { error: json({ error: "Not found." }, 404) };
    return { doc };
  };

  const isBusy = (doc) => RUNNING.has(doc.status) && Date.now() - Number(doc.progress?.at ?? Date.parse(doc.updatedAt)) < STALE_MS;

  // POST /api/wordpress-imports/:id/file  -- the raw XML as the request body, streamed to disk (never held in memory).
  const uploadEndpoint = {
    path: "/:id/file",
    method: "post",
    handler: async (req) => {
      const { doc, error } = await loadForUser(req, req.routeParams?.id);
      if (error) return error;
      if (isBusy(doc)) return json({ error: "This import is running; wait for it to finish." }, 409);
      const max = maxUploadBytes();
      const declared = Number(req.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > max) return json({ error: `The file is over the ${Math.round(max / 1048576)} MB limit.` }, 413);
      if (!req.body) return json({ error: "Send the export file as the request body." }, 400);

      fs.mkdirSync(uploadDir(), { recursive: true });
      const fileName = `${randomBytes(12).toString("hex")}.xml`;
      const target = filePathOf(fileName);
      let size = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length;
          if (size > max) return cb(Object.assign(new Error("too big"), { tooBig: true }));
          cb(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(req.body), counter, fs.createWriteStream(target));
      } catch (err) {
        fs.rmSync(target, { force: true });
        if (err?.tooBig) return json({ error: `The file is over the ${Math.round(max / 1048576)} MB limit.` }, 413);
        return json({ error: "The upload did not finish." }, 400);
      }
      // Must look like a WordPress export (XML with an <rss> root); anything else is thrown away.
      const head = Buffer.alloc(8192);
      const fd = fs.openSync(target, "r");
      const n = fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
      const start = head.subarray(0, n).toString("utf8");
      if (size === 0 || !/<\?xml|<rss/i.test(start) || !/<rss|<channel/i.test(start)) {
        fs.rmSync(target, { force: true });
        return json({ error: "That does not look like a WordPress export (XML). Use Tools > Export > All content." }, 400);
      }
      const original = String(new URL(req.url).searchParams.get("name") ?? "export.xml").replace(/[^\w .()-]+/g, "_").slice(0, 120);
      if (doc.fileName) fs.rmSync(filePathOf(doc.fileName), { force: true });
      await req.payload.update({
        collection: COLLECTIONS.imports,
        id: doc.id,
        data: { fileName, originalName: original, fileSize: size, status: "uploaded", analysis: null, result: null, error: null, progress: null, requestedBy: req.user.id },
        depth: 0,
        overrideAccess: true,
      });
      return json({ ok: true, fileName: original, size });
    },
  };

  // POST /api/wordpress-imports/:id/start   { phase: "analyse" | "import" }
  const startEndpoint = {
    path: "/:id/start",
    method: "post",
    handler: async (req) => {
      const { doc, error } = await loadForUser(req, req.routeParams?.id);
      if (error) return error;
      let body = {};
      try {
        body = await req.json();
      } catch {
        // an empty body is a bad request below
      }
      const phase = body?.phase;
      if (phase !== "analyse" && phase !== "import") return json({ error: 'phase must be "analyse" or "import".' }, 400);
      if (!doc.fileName || !fs.existsSync(filePathOf(doc.fileName))) return json({ error: "Upload the export file first." }, 400);
      if (isBusy(doc)) return json({ error: "This import is already running." }, 409);
      if (phase === "import" && !doc.analysis) return json({ error: "Run the dry run first, so you can see what will happen." }, 409);
      await req.payload.update({
        collection: COLLECTIONS.imports,
        id: doc.id,
        data: { status: "queued", error: null, progress: { phase: "queued", done: 0, total: 0, message: "Waiting to start", at: Date.now() }, requestedBy: req.user.id },
        depth: 0,
        overrideAccess: true,
      });
      await req.payload.jobs.queue({ task: TASK_SLUG, input: { importId: String(doc.id), phase } });
      scheduleRun(req.payload);
      return json({ ok: true, phase });
    },
  };

  // ---- collections ---------------------------------------------------------------------------------------------

  const imports = {
    slug: COLLECTIONS.imports,
    labels: { singular: "WordPress import", plural: "WordPress imports" },
    custom: { polysite: { module: MODULE, icon: ICON } },
    admin: {
      useAsTitle: "title",
      defaultColumns: ["title", "status", "originalName", "updatedAt"],
      group: "Administration",
      description: "Bring a WordPress site's pages, posts, images and menu into this site. Create an import, upload the export file, read the dry run, then import.",
      hidden: hiddenFromOthers,
      custom: { navSubgroup: "Site features" },
    },
    access: { read: manager, create: manager, update: manager, delete: manager },
    endpoints: [uploadEndpoint, startEndpoint],
    hooks: {
      // The log rows point at the import (a required link), so they go first.
      beforeDelete: [
        async ({ id, req }) => {
          await req.payload.delete({ collection: COLLECTIONS.log, where: { job: { equals: id } }, overrideAccess: true });
        },
      ],
      // The uploaded file is private data (drafts and private posts are in it): deleting the import deletes it too.
      afterDelete: [
        async ({ doc }) => {
          if (doc?.fileName) fs.rmSync(filePathOf(doc.fileName), { force: true });
        },
      ],
    },
    fields: [
      { name: "title", type: "text", required: true, label: "Name", defaultValue: "WordPress import", admin: { description: "Only for you, like Old site, March." } },
      { name: "panel", type: "ui", admin: { components: { Field: PANEL } } },
      { name: "options", type: "group", label: "Settings", fields: optionFields },
      { name: "status", type: "select", defaultValue: "new", access: systemField, admin: { readOnly: true, position: "sidebar" }, options: ["new", "uploaded", "queued", "analysing", "analysed", "running", "done", "failed"] },
      { name: "fileName", type: "text", access: systemField, admin: { hidden: true } },
      { name: "originalName", type: "text", access: systemField, admin: { readOnly: true, position: "sidebar" } },
      { name: "fileSize", type: "number", access: systemField, admin: { readOnly: true, position: "sidebar" } },
      { name: "requestedBy", type: "relationship", relationTo: "users", access: systemField, admin: { readOnly: true, position: "sidebar" } },
      { name: "startedAt", type: "date", access: systemField, admin: { hidden: true } },
      { name: "finishedAt", type: "date", access: systemField, admin: { hidden: true } },
      { name: "progress", type: "json", access: systemField, admin: { hidden: true } },
      { name: "analysis", type: "json", access: systemField, admin: { hidden: true } },
      { name: "result", type: "json", access: systemField, admin: { hidden: true } },
      { name: "error", type: "textarea", access: systemField, admin: { hidden: true } },
    ],
  };

  const map = {
    slug: COLLECTIONS.map,
    labels: { singular: "WordPress import record", plural: "WordPress import records" },
    custom: { polysite: { module: MODULE } },
    admin: { hidden: true, useAsTitle: "key", description: "Which WordPress item became which document. Lets a second import update instead of duplicating." },
    access: { read: manager, create: noOne, update: noOne, delete: manager },
    fields: [
      { name: "kind", type: "text", required: true, index: true },
      { name: "key", type: "text", required: true, index: true },
      { name: "collection", type: "text", required: true },
      { name: "docId", type: "text", required: true },
      { name: "writtenAt", type: "number", admin: { description: "When the import last wrote the document (ms). A later edit here means someone changed it." } },
      { name: "hash", type: "text" },
    ],
  };

  const log = {
    slug: COLLECTIONS.log,
    labels: { singular: "WordPress import log entry", plural: "WordPress import log" },
    custom: { polysite: { module: MODULE } },
    admin: {
      useAsTitle: "message",
      defaultColumns: ["level", "code", "title", "message", "job"],
      group: "Administration",
      description: "What happened to each item of a WordPress import: skipped, changed or failed.",
      hidden: hiddenFromOthers,
      custom: { navSubgroup: "Site features" },
    },
    defaultSort: "-createdAt",
    access: { read: manager, create: noOne, update: noOne, delete: manager },
    fields: [
      { name: "job", type: "relationship", relationTo: COLLECTIONS.imports, required: true, index: true },
      { name: "level", type: "select", required: true, options: ["info", "warn", "error"], index: true },
      { name: "code", type: "text", index: true },
      { name: "wpType", type: "text", label: "Type" },
      { name: "wpId", type: "text", label: "WordPress id" },
      { name: "title", type: "text" },
      { name: "message", type: "textarea", required: true },
    ],
  };

  return [imports, map, log];
}
