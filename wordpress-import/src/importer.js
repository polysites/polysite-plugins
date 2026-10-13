import { createHash } from "node:crypto";

import { createReport, detectPageBuilder, htmlToText, imageKey, lexicalOfText, parseContent, toLexical } from "./html.js";
import { downloadMedia, parseAllowList, refusal } from "./media.js";
import { freeSlug, isoDate, leafSlug, normalizeSlug, oldPathOf, pagePath, redirectFor, siteHostOf } from "./paths.js";
import { readWxr } from "./wxr.js";

// The import itself, written against a small "store" so the logic can be tested without a database. The CMS supplies a
// store over Payload's local API (store.js); the unit tests supply one in memory (test/memoryStore.js).
//
//   store.site                         { id, domain }
//   store.hasPosts                     true when the posts plugin is installed
//   store.newsPath()                   the site's news section address ("news"), without slashes
//   store.existingSlugs(collection)    Set of the slugs already on this site
//   store.findMap(kind, key)           { docId, collection, writtenAt } | null     what an earlier import created
//   store.saveMap(kind, key, row)
//   store.getDoc(collection, id)       the document or null if it is gone
//   store.lastTouched(collection, id)  ms timestamp of the latest edit, drafts included
//   store.findDocBySlug(collection, slug)
//   store.create(collection, data, { draft })  /  store.update(collection, id, data, { draft })   -> document
//   store.createMedia({ buffer, mimetype, filename, alt }) -> id      store.mediaExists(id)
//   store.findRedirect(fromPath) / store.saveRedirect(id | null, data)
//   store.getNav() / store.setNav(items)
//   store.log(rows)                    store.setProgress(patch)
//
// Options (all from the import's own settings; see collections.js for the labels):
//   targetStatus draft|published, importPages, importPosts, importTags, importMedia, includeDrafts, includePrivate, includeTrashed,
//   overwrite, onSlugConflict skip|rename, bylineMode none|author|fixed, bylineText, authorMap, allowedMediaHosts, mediaMaxMb,
//   allowHttpMedia, createRedirects, menuMode none|append|replace, menuName

import { DEFAULT_OPTIONS } from "./options.js";

export { DEFAULT_OPTIONS };

const RESERVED_POST_SLUGS = new Set(["page", "category"]);
const MAX_SAMPLES = 40;
const MAX_LOG_ROWS = 4000;

const cleanText = (s) => htmlToText(s);
const bool = (v, d) => (v === undefined || v === null ? d : Boolean(v));

export function withDefaults(options) {
  const o = { ...DEFAULT_OPTIONS };
  for (const key of Object.keys(DEFAULT_OPTIONS)) if (options?.[key] !== undefined && options?.[key] !== null) o[key] = options[key];
  o.mediaMaxMb = Number(o.mediaMaxMb) > 0 ? Number(o.mediaMaxMb) : DEFAULT_OPTIONS.mediaMaxMb;
  for (const k of ["importPages", "importPosts", "importTags", "importMedia", "includeDrafts", "includePrivate", "includeTrashed", "overwrite", "allowHttpMedia", "createRedirects"]) o[k] = bool(o[k], DEFAULT_OPTIONS[k]);
  return o;
}

/** "login = Display name" lines. */
export function parseAuthorMap(text) {
  const map = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*([^=#]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) map.set(m[1].toLowerCase(), m[2]);
  }
  return map;
}

// ---- pass 1: the index ---------------------------------------------------------------------------------------------

/**
 * Reads the whole export once and keeps only small things: the channel, terms, attachments, menus and a stub per page and
 * post (no body). Everything big is read again, one item at a time, by the import.
 */
export async function buildIndex(stream, { onWarning } = {}) {
  const index = {
    channel: null,
    siteHost: "",
    authors: new Map(),
    terms: new Map(), // `${taxonomy}:${slug}` -> term
    attachments: new Map(),
    attachmentsByKey: new Map(),
    pages: new Map(),
    posts: new Map(),
    menus: new Map(), // slug -> { slug, name, items: [] }
    menuItems: new Map(),
    other: new Map(), // post type -> count
    statusCounts: { page: {}, post: {} },
    warnings: [],
  };
  const bump = (obj, k) => (obj[k] = (obj[k] ?? 0) + 1);

  for await (const part of readWxr(stream, { onWarning: (w) => { if (index.warnings.length < 20) index.warnings.push(w); onWarning?.(w); } })) {
    if (part.kind === "channel") {
      index.channel = part.channel;
      index.siteHost = siteHostOf(part.channel);
    } else if (part.kind === "author") {
      index.authors.set(part.author.login.toLowerCase(), part.author.displayName || part.author.login);
    } else if (part.kind === "term") {
      index.terms.set(`${part.term.taxonomy}:${part.term.slug}`, part.term);
      if (part.term.taxonomy === "nav_menu") index.menus.set(part.term.slug, { slug: part.term.slug, name: cleanText(part.term.name), items: [] });
    } else if (part.kind === "item") {
      const item = part.item;
      if (item.type === "attachment") {
        const url = item.attachmentUrl || item.guid;
        if (url && item.id !== null) {
          const att = { id: item.id, url, title: cleanText(item.title), alt: cleanText(item.meta._wp_attachment_image_alt ?? ""), parent: item.parent };
          index.attachments.set(item.id, att);
          index.attachmentsByKey.set(imageKey(url), att);
        }
      } else if (item.type === "page" || item.type === "post") {
        const kind = item.type;
        bump(index.statusCounts[kind], item.status || "unknown");
        const builder = detectPageBuilder({ meta: item.meta, html: item.content });
        const stub = {
          id: item.id, type: kind, status: item.status, title: cleanText(item.title), slug: item.slug, link: item.link, parent: item.parent,
          dateGmt: item.dateGmt, date: item.date, pubDate: item.pubDate, creator: item.creator, password: item.password,
          thumbnailId: Number(item.meta._thumbnail_id) || null, builder, categories: item.categories, hasContent: item.content.trim().length > 0,
        };
        (kind === "page" ? index.pages : index.posts).set(item.id, stub);
      } else if (item.type === "nav_menu_item") {
        const menuSlug = item.categories.find((c) => c.domain === "nav_menu")?.nicename;
        if (menuSlug) {
          if (!index.menus.has(menuSlug)) index.menus.set(menuSlug, { slug: menuSlug, name: menuSlug, items: [] });
          index.menus.get(menuSlug).items.push({
            id: item.id, title: cleanText(item.title), order: item.menuOrder, status: item.status,
            type: item.meta._menu_item_type ?? "custom", object: item.meta._menu_item_object ?? "", objectId: Number(item.meta._menu_item_object_id) || null,
            url: (item.meta._menu_item_url ?? "").trim(), parent: Number(item.meta._menu_item_menu_item_parent) || 0,
          });
        }
      } else if (item.type && !["revision", "customize_changeset", "oembed_cache", "wp_global_styles", "wp_navigation", "wp_template", "wp_template_part", "custom_css", "user_request", "nav_menu_item"].includes(item.type)) {
        index.other.set(item.type, (index.other.get(item.type) ?? 0) + 1);
      }
    }
  }
  return index;
}

// ---- selecting and planning ----------------------------------------------------------------------------------------

const DRAFTISH = new Set(["draft", "pending", "future"]);

/** Why a page or post is not imported with these settings, or null if it is. */
export function skipReason(stub, o) {
  if (stub.password) return { code: "password", message: "Password-protected content is never imported (it would become public)." };
  if (stub.status === "publish") return null;
  if (DRAFTISH.has(stub.status)) return o.includeDrafts ? null : { code: "status-draft", message: `Status "${stub.status}": drafts, pending and scheduled items are not imported unless chosen.` };
  if (stub.status === "private") return o.includePrivate ? null : { code: "status-private", message: "Private items are not imported unless chosen." };
  if (stub.status === "trash") return o.includeTrashed ? null : { code: "status-trash", message: "Trashed items are not imported unless chosen." };
  return { code: "status-other", message: `Status "${stub.status}" is not imported.` };
}

/** What status the imported item gets: only what is live on WordPress can go live here; everything else arrives as a draft. */
export const statusFor = (stub, o) => (stub.status === "publish" && o.targetStatus === "published" ? "published" : "draft");

/**
 * Works out every page and post that will be imported, its address and what it will meet: the plan, shared by the dry run and the import.
 */
export function makePlan(index, o, store, { existingPages = new Set(), existingPosts = new Set(), mapped = new Map() } = {}) {
  const plan = { pages: [], posts: [], skipped: [], conflicts: [], postsMissing: false };
  const news = store?.newsPath?.() ?? "news";

  const claimed = { pages: new Set(), posts: new Set() };
  const place = (kind, stub, rawPath) => {
    const existing = kind === "page" ? existingPages : existingPosts;
    const taken = claimed[kind === "page" ? "pages" : "posts"];
    let path = rawPath;
    const wasMapped = mapped.has(`${index.siteHost || "unknown"}|${kind}:${stub.id}`);
    const reserved = kind === "post" && RESERVED_POST_SLUGS.has(path);
    const clash = reserved || taken.has(path) || (!wasMapped && existing.has(path));
    let conflict = null;
    if (clash) {
      conflict = reserved ? "reserved" : taken.has(path) ? "twice-in-export" : "exists";
      if (o.onSlugConflict === "rename") {
        const all = new Set([...existing, ...taken, ...RESERVED_POST_SLUGS]);
        path = freeSlug(path, all);
        if (kind === "page" && path.includes("/")) path = freeSlug(path, all);
      }
    }
    return { path, conflict, renamed: conflict && o.onSlugConflict === "rename" };
  };

  const pagesById = index.pages;
  for (const stub of index.pages.values()) {
    if (!o.importPages) { plan.skipped.push({ stub, code: "type-off", message: "Pages are switched off for this import." }); continue; }
    const why = skipReason(stub, o);
    if (why) { plan.skipped.push({ stub, ...why }); continue; }
    const wanted = pagePath(stub, pagesById);
    const placed = place("page", stub, wanted);
    const entry = { kind: "page", stub, wanted, path: placed.path, conflict: placed.conflict, renamed: placed.renamed, status: statusFor(stub, o) };
    if (placed.conflict && !placed.renamed) { plan.conflicts.push(entry); plan.skipped.push({ stub, code: "conflict", message: conflictMessage(placed.conflict, wanted) }); continue; }
    if (placed.conflict) plan.conflicts.push(entry);
    claimed.pages.add(entry.path);
    plan.pages.push(entry);
  }
  for (const stub of index.posts.values()) {
    if (!o.importPosts) { plan.skipped.push({ stub, code: "type-off", message: "Posts are switched off for this import." }); continue; }
    if (!store?.hasPosts) { plan.skipped.push({ stub, code: "no-posts-plugin", message: "The posts plugin is not installed, so posts cannot be imported." }); plan.postsMissing = true; continue; }
    const why = skipReason(stub, o);
    if (why) { plan.skipped.push({ stub, ...why }); continue; }
    const wanted = leafSlug(stub);
    const placed = place("post", stub, wanted);
    const entry = { kind: "post", stub, wanted, path: placed.path, conflict: placed.conflict, renamed: placed.renamed, status: statusFor(stub, o), address: `${news}/${placed.path}` };
    if (placed.conflict && !placed.renamed) { plan.conflicts.push(entry); plan.skipped.push({ stub, code: "conflict", message: conflictMessage(placed.conflict, wanted) }); continue; }
    if (placed.conflict) plan.conflicts.push(entry);
    claimed.posts.add(entry.path);
    plan.posts.push(entry);
  }
  return plan;
}

function conflictMessage(kind, slug) {
  if (kind === "reserved") return `"${slug}" is part of the news addresses (/news/page/2, /news/category/...), so no post can use it.`;
  if (kind === "twice-in-export") return `Another item in this export already takes the address "${slug}".`;
  return `The site already has content at "${slug}", not created by an earlier import.`;
}

// ---- the dry run ---------------------------------------------------------------------------------------------------

/**
 * Counts what an import with these settings would do, without touching anything. Streams the file twice: once for the index,
 * once for the bodies (to find shortcodes, page-builder markup and images).
 */
export async function analyse({ openStream, options, store, onProgress }) {
  const o = withDefaults(options);
  onProgress?.({ phase: "reading", message: "Reading the export" });
  const index = await buildIndex(openStream());
  const existingPages = await store.existingSlugs("pages");
  const existingPosts = store.hasPosts ? await store.existingSlugs("posts") : new Set();
  const mapped = await store.allMapKeys?.() ?? new Map();
  const plan = makePlan(index, o, store, { existingPages, existingPosts, mapped });

  const selected = new Set([...plan.pages, ...plan.posts].map((e) => e.stub.id));
  const allow = parseAllowList(o.allowedMediaHosts, index.siteHost);
  const constructs = new Map();
  const imageSrcs = new Map(); // key -> src
  const builders = new Map();
  const report = createReport();
  const attachmentsById = new Map([...index.attachments].map(([id, a]) => [id, a]));
  let bodies = 0;

  onProgress?.({ phase: "inspecting", message: "Looking through the content" });
  for await (const part of readWxr(openStream())) {
    if (part.kind !== "item" || !selected.has(part.item.id) || (part.item.type !== "page" && part.item.type !== "post")) continue;
    const item = part.item;
    const parsed = parseContent(item.content, { attachmentsById });
    toLexical(parsed, { report: parsed.report }); // also notes tables, frames and players
    report.merge(parsed.report.entries().filter((e) => e.code !== "image-link"));
    for (const img of parsed.images) imageSrcs.set(imageKey(img.src), img.src);
    if (item.meta._thumbnail_id && attachmentsById.has(Number(item.meta._thumbnail_id))) {
      const a = attachmentsById.get(Number(item.meta._thumbnail_id));
      imageSrcs.set(imageKey(a.url), a.url);
    }
    const builder = detectPageBuilder({ meta: item.meta, html: item.content });
    if (builder) builders.set(builder, (builders.get(builder) ?? 0) + 1);
    bodies++;
  }
  for (const e of report.entries()) constructs.set(e.code, e);

  // Which images can be fetched, and which hosts are in the way.
  let fetchable = 0;
  const blockedHosts = {};
  for (const src of imageSrcs.values()) {
    const why = refusal(src, allow);
    if (!why) fetchable++;
    else {
      try {
        const h = new URL(src).hostname.toLowerCase();
        blockedHosts[h] = (blockedHosts[h] ?? 0) + 1;
      } catch {
        blockedHosts["(invalid address)"] = (blockedHosts["(invalid address)"] ?? 0) + 1;
      }
    }
  }

  const unsupported = [];
  for (const s of plan.skipped) if (s.code === "password" || s.code === "conflict" || s.code === "no-posts-plugin") unsupported.push({ code: s.code, wpType: s.stub.type, wpId: s.stub.id, title: s.stub.title, message: s.message });
  for (const [type, count] of index.other) unsupported.push({ code: "post-type", wpType: type, wpId: null, title: type, message: `${count} item(s) of the type "${type}" (not pages or posts) cannot be imported.` });
  for (const [name, count] of builders) unsupported.push({ code: "page-builder", wpType: "page", wpId: null, title: name, message: `${count} page(s) or post(s) were built with ${name}: their text is imported, their layout is not.` });
  if (plan.postsMissing) unsupported.push({ code: "no-posts-plugin", wpType: "post", wpId: null, title: "Posts", message: "The posts plugin is not installed: posts are skipped. Install it to import them." });

  const menus = [...index.menus.values()].map((m) => ({ slug: m.slug, name: m.name, items: m.items.filter((i) => i.status === "publish").length }));
  const pickedMenu = pickMenu(index, o);
  const redirects = o.createRedirects
    ? [...plan.pages, ...plan.posts].filter((e) => redirectFor(oldPathOf(e.stub.link, { siteHost: index.siteHost }), e.kind === "page" ? e.path : e.address)).length
    : 0;
  const usedTerms = termsUsed(index, plan.posts, o);

  const byStatus = (kind) => Object.fromEntries(Object.entries(index.statusCounts[kind]).sort());
  return {
    source: { title: cleanText(index.channel?.title ?? ""), url: index.channel?.baseSiteUrl || index.channel?.link || "", host: index.siteHost, wxrVersion: index.channel?.wxrVersion ?? "" },
    totals: {
      pages: index.pages.size, posts: index.posts.size, categories: [...index.terms.values()].filter((t) => t.taxonomy === "category").length,
      tags: [...index.terms.values()].filter((t) => t.taxonomy === "post_tag").length, media: index.attachments.size, menus: index.menus.size,
      menuItems: [...index.menus.values()].reduce((n, m) => n + m.items.length, 0), authors: index.authors.size,
    },
    byStatus: { pages: byStatus("page"), posts: byStatus("post") },
    willImport: { pages: plan.pages.length, posts: plan.posts.length, categories: usedTerms.categories.length, tags: usedTerms.tags.length, redirects, bodies },
    skipped: summariseSkips(plan.skipped),
    media: { referenced: imageSrcs.size, fetchable, blockedHosts, attachmentsInExport: index.attachments.size },
    menus,
    chosenMenu: pickedMenu ? { slug: pickedMenu.slug, name: pickedMenu.name } : null,
    constructs: [...constructs.values()].map((e) => ({ code: e.code, message: e.message, count: e.count, samples: e.samples })),
    unsupported: unsupported.slice(0, 200),
    conflicts: plan.conflicts.slice(0, 100).map((c) => ({ wpType: c.kind, wpId: c.stub.id, title: c.stub.title, wanted: c.wanted, reason: c.conflict, renamedTo: c.renamed ? c.path : null })),
    samples: {
      pages: plan.pages.slice(0, MAX_SAMPLES).map((e) => ({ title: e.stub.title, from: oldPathOf(e.stub.link, { siteHost: index.siteHost }), to: e.path, status: e.status })),
      posts: plan.posts.slice(0, MAX_SAMPLES).map((e) => ({ title: e.stub.title, from: oldPathOf(e.stub.link, { siteHost: index.siteHost }), to: e.address, status: e.status })),
    },
    authors: [...index.authors].map(([login, name]) => ({ login, name })),
    postsPluginInstalled: Boolean(store.hasPosts),
    warnings: index.warnings,
  };
}

function summariseSkips(skipped) {
  const out = {};
  for (const s of skipped) out[s.code] = (out[s.code] ?? 0) + 1;
  return out;
}

function termsUsed(index, postEntries, o) {
  const categories = new Set();
  const tags = new Set();
  for (const e of postEntries) {
    for (const c of e.stub.categories) {
      if (c.domain === "category" && c.nicename !== "uncategorized") categories.add(c.nicename);
      if (c.domain === "post_tag" && o.importTags) tags.add(c.nicename);
    }
  }
  return { categories: [...categories], tags: [...tags] };
}

export function pickMenu(index, o) {
  const menus = [...index.menus.values()].filter((m) => m.items.length > 0);
  if (!menus.length) return null;
  const want = String(o.menuName ?? "").trim().toLowerCase();
  if (want) return menus.find((m) => m.slug.toLowerCase() === want || m.name.toLowerCase() === want) ?? null;
  return menus.find((m) => /main|primary|header|top/i.test(`${m.slug} ${m.name}`)) ?? menus[0];
}

// ---- the import ----------------------------------------------------------------------------------------------------

function createLog(store) {
  const rows = [];
  let total = 0;
  let dropped = 0;
  const counts = { info: 0, warn: 0, error: 0 };
  return {
    counts,
    add(level, code, message, extra = {}) {
      counts[level]++;
      total++;
      if (rows.length >= MAX_LOG_ROWS) { dropped++; return; }
      rows.push({ level, code, message: String(message).slice(0, 1000), ...extra });
    },
    async flush() {
      if (!rows.length) return;
      const batch = rows.splice(0, rows.length);
      await store.log(batch);
    },
    get dropped() { return dropped; },
    get total() { return total; },
  };
}

const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/**
 * Runs the import. Returns a summary: { created, updated, skipped, failed, media, redirects, menu, log counts }.
 * Re-running it with the same export updates what it made and leaves anything edited in Polysite alone (unless `overwrite`).
 */
export async function runImport({ openStream, options, store, onProgress, shouldStop }) {
  const o = withDefaults(options);
  const log = createLog(store);
  const summary = { created: { pages: 0, posts: 0, categories: 0, media: 0, redirects: 0 }, updated: { pages: 0, posts: 0, categories: 0, redirects: 0 }, unchanged: 0, skipped: { edited: 0, deleted: 0, conflict: 0, other: 0 }, failed: 0, mediaFailed: 0, menu: null };

  let lastProgress = 0;
  let done = 0;
  let total = 0;
  const progress = async (phase, message, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgress < 1000) return;
    lastProgress = now;
    await log.flush();
    await onProgress?.({ phase, done, total, message });
  };

  await progress("reading", "Reading the export", true);
  const index = await buildIndex(openStream());
  if (!index.channel) throw new Error("This does not look like a WordPress export.");
  const sourceHost = index.siteHost || "unknown";
  const existingPages = await store.existingSlugs("pages");
  const existingPosts = store.hasPosts ? await store.existingSlugs("posts") : new Set();
  const mapped = await store.allMapKeys?.() ?? new Map();
  const plan = makePlan(index, o, store, { existingPages, existingPosts, mapped });
  const news = store.newsPath();

  for (const s of plan.skipped) {
    if (s.code === "type-off") continue;
    summary.skipped[s.code === "conflict" ? "conflict" : "other"]++;
    log.add(s.code === "conflict" || s.code === "password" ? "warn" : "info", s.code, s.message, { wpType: s.stub.type, wpId: String(s.stub.id), title: s.stub.title });
  }
  for (const c of plan.conflicts) if (c.renamed) log.add("warn", "renamed", `"${c.wanted}" was taken, so this item was imported as "${c.path}".`, { wpType: c.kind, wpId: String(c.stub.id), title: c.stub.title });
  if (plan.postsMissing) log.add("warn", "no-posts-plugin", "The posts plugin is not installed, so the posts in this export were skipped.");

  const entries = new Map([...plan.pages, ...plan.posts].map((e) => [e.stub.id, e]));
  total = entries.size;

  // Old addresses of imported items, so a link inside the old site can point at the new place.
  const addressOf = new Map(); // wp id -> new href
  const oldToNew = new Map(); // old path -> new href
  for (const e of entries.values()) {
    const href = `/${e.kind === "page" ? e.path : `${news}/${e.path}`}`;
    addressOf.set(e.stub.id, href);
    const old = oldPathOf(e.stub.link, { siteHost: index.siteHost });
    if (old) oldToNew.set(old, href);
  }
  const rewriteLink = (href) => {
    try {
      const u = new URL(href);
      if (u.hostname.toLowerCase() !== index.siteHost) return undefined;
      const p = oldPathOf(href);
      const hit = p ? oldToNew.get(p) : undefined;
      return hit ? `${hit}${u.hash}` : undefined;
    } catch {
      return undefined;
    }
  };

  // Media ------------------------------------------------------------------
  const allow = parseAllowList(o.allowedMediaHosts, index.siteHost);
  const mediaCache = new Map(); // imageKey -> { id } | { error }
  const attachmentsById = index.attachments;
  async function ensureMedia(src, altHint) {
    const key = imageKey(src);
    if (mediaCache.has(key)) return mediaCache.get(key);
    const att = index.attachmentsByKey.get(key);
    const mapKey = att ? `att:${att.id}` : `url:${key}`;
    let result;
    try {
      const row = await store.findMap("media", `${sourceHost}|${mapKey}`);
      if (row && (await store.mediaExists(row.docId))) {
        result = { id: row.docId };
      } else {
        const stripped = src.replace(/-\d{2,4}x\d{2,4}(\.[a-z0-9]+)(\?.*)?$/i, "$1");
        const candidates = att ? [att.url] : stripped !== src ? [stripped, src] : [src];
        let got = null;
        let lastErr;
        for (const url of candidates) {
          try {
            got = await downloadMedia(url, allow, { maxBytes: o.mediaMaxMb * 1048576, httpFallback: o.allowHttpMedia });
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!got) throw lastErr ?? new Error("Could not be fetched.");
        const alt = (att?.alt || altHint || att?.title || got.filename.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ")).slice(0, 200) || "Image";
        const id = await store.createMedia({ buffer: got.buffer, mimetype: got.mimetype, filename: got.filename, alt });
        await store.saveMap("media", `${sourceHost}|${mapKey}`, { collection: "media", docId: String(id), writtenAt: Date.now() });
        summary.created.media++;
        result = { id };
      }
    } catch (err) {
      summary.mediaFailed++;
      log.add("warn", "media-failed", `${src} was not imported: ${err.message}`, { wpType: "attachment", wpId: att ? String(att.id) : "" });
      result = { error: err.message };
    }
    mediaCache.set(key, result);
    return result;
  }

  // Categories and tags -----------------------------------------------------
  const termIds = new Map(); // slug -> post-categories id
  if (store.hasPosts && o.importPosts) {
    const used = termsUsed(index, plan.posts, o);
    const wanted = [...used.categories.map((s) => ["category", s]), ...used.tags.map((s) => ["post_tag", s])];
    for (const [taxonomy, slugRaw] of wanted) {
      const slug = normalizeSlug(slugRaw);
      if (!slug || termIds.has(slug)) continue;
      const term = index.terms.get(`${taxonomy}:${slugRaw}`);
      const name = term ? cleanText(term.name) : slugRaw;
      try {
        const row = await store.findMap("term", `${sourceHost}|${slug}`);
        let doc = row ? await store.getDoc("post-categories", row.docId) : null;
        if (!doc) doc = await store.findDocBySlug("post-categories", slug);
        if (doc) {
          termIds.set(slug, doc.id);
          if (!row) await store.saveMap("term", `${sourceHost}|${slug}`, { collection: "post-categories", docId: String(doc.id), writtenAt: Date.now() });
          continue;
        }
        const created = await store.create("post-categories", { name: name || slug, slug, description: term?.description ? cleanText(term.description).slice(0, 500) : undefined }, {});
        termIds.set(slug, created.id);
        summary.created.categories++;
        await store.saveMap("term", `${sourceHost}|${slug}`, { collection: "post-categories", docId: String(created.id), writtenAt: Date.now() });
      } catch (err) {
        log.add("error", "category-failed", `The ${taxonomy === "post_tag" ? "tag" : "category"} "${name}" could not be created: ${err.message}`, { wpType: taxonomy });
      }
    }
  }

  const authorMap = parseAuthorMap(o.authorMap);
  const bylineOf = (creator) => {
    if (o.bylineMode === "none") return "";
    if (o.bylineMode === "fixed") return o.bylineText.trim();
    const key = String(creator ?? "").toLowerCase();
    return authorMap.get(key) ?? index.authors.get(key) ?? creator ?? "";
  };

  // The bodies --------------------------------------------------------------
  const redirectNew = [];
  async function processItem(item, entry) {
    const { kind, stub } = entry;
    const collection = kind === "page" ? "pages" : "posts";
    const label = { wpType: kind, wpId: String(item.id), title: stub.title };
    const mapKey = `${sourceHost}|${kind}:${item.id}`;
    const row = await store.findMap("item", mapKey);
    let existing = row ? await store.getDoc(row.collection, row.docId) : null;

    if (row && !existing && !o.overwrite) {
      summary.skipped.deleted++;
      log.add("info", "deleted-here", "This item was deleted in Polysite after the last import, so it was not brought back (tick Overwrite to recreate it).", label);
      return;
    }
    if (row && existing && !o.overwrite) {
      const touched = await store.lastTouched(row.collection, row.docId);
      if (touched > Number(row.writtenAt) + 1) {
        summary.skipped.edited++;
        log.add("warn", "edited-here", "Edited in Polysite since the last import, so it was left alone (tick Overwrite to replace it).", label);
        return;
      }
    }

    // Body
    const report = createReport();
    const parsed = parseContent(item.content, { attachmentsById, report });
    const images = new Map();
    if (o.importMedia) {
      for (const img of parsed.images) {
        const res = await ensureMedia(img.src, img.alt);
        if (res.id !== undefined) images.set(imageKey(img.src), { id: res.id });
      }
    }
    const { lexical, empty } = toLexical(parsed, { images, rewriteLink, report });
    const builder = detectPageBuilder({ meta: item.meta, html: item.content });
    if (builder) report.note("page-builder", `Built with ${builder}: the text was imported, the layout was not.`, stub.title);
    for (const e of report.entries()) {
      const level = ["table", "gallery", "iframe", "image-link", "media"].includes(e.code) ? "info" : "warn";
      log.add(level, e.code, `${e.message}${e.count > 1 ? ` (${e.count} times)` : ""}${e.samples.length ? ` e.g. ${e.samples[0]}` : ""}`, label);
    }

    const iso = isoDate({ dateGmt: item.dateGmt, pubDate: item.pubDate, date: item.date });
    const draft = entry.status === "draft";
    let data;
    if (kind === "page") {
      data = {
        title: stub.title || entry.path,
        slug: entry.path,
        _status: entry.status,
        content: empty ? [] : [{ blockType: "textBlock", heading: "", body: lexical }],
      };
      if (iso) data.createdAt = iso;
      if (empty) log.add("warn", "empty-body", "The page has no text content; it was imported empty.", label);
    } else {
      const heroId = o.importMedia && stub.thumbnailId && attachmentsById.has(stub.thumbnailId) ? (await ensureMedia(attachmentsById.get(stub.thumbnailId).url)).id : undefined;
      const excerptText = item.excerpt ? htmlToText(item.excerpt) : "";
      const ids = [];
      for (const c of item.categories) {
        if (c.domain !== "category" && !(c.domain === "post_tag" && o.importTags)) continue;
        const id = termIds.get(normalizeSlug(c.nicename));
        if (id !== undefined && !ids.includes(id)) ids.push(id);
      }
      data = {
        title: stub.title || entry.path,
        slug: entry.path,
        _status: entry.status,
        categories: ids,
        body: empty ? lexicalOfText(excerptText || stub.title || entry.path) : lexical,
      };
      if (iso) data.publishedAt = iso;
      const byline = bylineOf(item.creator);
      if (byline) data.byline = byline;
      if (excerptText) data.excerpt = excerptText.slice(0, 400);
      if (heroId !== undefined) data.heroImage = heroId;
      if (empty) log.add("warn", "empty-body", "The post has no text content; its excerpt or title was used as the body.", label);
    }

    let doc;
    if (existing) {
      doc = await store.update(row.collection, row.docId, data, { draft });
      summary.updated[collection]++;
    } else {
      doc = await store.create(collection, data, { draft });
      summary.created[collection]++;
    }
    const writtenAt = await store.lastTouched(collection, doc.id);
    await store.saveMap("item", mapKey, { collection, docId: String(doc.id), writtenAt, hash: sha(JSON.stringify(data)) });

    // The old address
    if (o.createRedirects) {
      const from = redirectFor(oldPathOf(stub.link, { siteHost: index.siteHost }), kind === "page" ? entry.path : `${news}/${entry.path}`);
      if (from) redirectNew.push({ from: from.fromPath, kind, docId: doc.id, to: kind === "page" ? null : `/${news}/${entry.path}`, label });
    }
  }

  await progress("importing", "Importing pages and posts", true);
  for await (const part of readWxr(openStream())) {
    if (part.kind !== "item") continue;
    const entry = entries.get(part.item.id);
    if (!entry || part.item.type !== entry.kind) continue;
    if (shouldStop && (await shouldStop())) throw new Error("The import was cancelled.");
    try {
      await processItem(part.item, entry);
    } catch (err) {
      summary.failed++;
      log.add("error", "item-failed", `Could not be imported: ${err.message}`, { wpType: entry.kind, wpId: String(part.item.id), title: entry.stub.title });
    }
    done++;
    await progress("importing", `Imported ${done} of ${total}`);
  }

  // Redirects (after all items, so an address one item now owns is not also a redirect) ---------------------
  if (o.createRedirects) {
    await progress("redirects", "Leaving redirects from the old addresses", true);
    const owned = new Set([...entries.values()].map((e) => (e.kind === "page" ? e.path : `${news}/${e.path}`)));
    for (const r of redirectNew) {
      try {
        if (owned.has(r.from) || existingPages.has(r.from)) {
          log.add("info", "redirect-skipped", `No redirect from "${r.from}": that address is a page here.`, r.label);
          continue;
        }
        const row = await store.findMap("redirect", `${sourceHost}|${r.from}`);
        const found = await store.findRedirect(r.from);
        if (found && !row) {
          log.add("info", "redirect-exists", `A redirect from "${r.from}" already exists, so none was added.`, r.label);
          continue;
        }
        const data = r.kind === "page"
          ? { fromPath: r.from, redirectType: "internal", toTarget: { relationTo: "pages", value: r.docId }, statusCode: "301", enabled: true, notes: "Created by the WordPress import." }
          : { fromPath: r.from, redirectType: "external", toUrl: r.to, statusCode: "301", enabled: true, notes: "Created by the WordPress import." };
        const saved = await store.saveRedirect(found?.id ?? null, data);
        await store.saveMap("redirect", `${sourceHost}|${r.from}`, { collection: "redirects", docId: String(saved.id), writtenAt: Date.now() });
        summary.created.redirects += found ? 0 : 1;
        summary.updated.redirects += found ? 1 : 0;
      } catch (err) {
        log.add("warn", "redirect-failed", `The redirect from "${r.from}" could not be saved: ${err.message}`, r.label);
      }
    }
  }

  // Menu ------------------------------------------------------------------
  if (o.menuMode !== "none") {
    await progress("menu", "Adding the menu to the header", true);
    try {
      summary.menu = await importMenu({ index, o, store, entries, addressOf, news, log, oldToNew });
    } catch (err) {
      log.add("error", "menu-failed", `The menu could not be saved: ${err.message}`);
    }
  }

  await log.flush();
  summary.log = { ...log.counts, droppedFromList: log.dropped };
  done = total;
  await progress("done", "Finished", true);
  return summary;
}

async function importMenu({ index, o, store, entries, addressOf, news, log, oldToNew }) {
  const menu = pickMenu(index, o);
  if (!menu) {
    if (o.menuName) log.add("warn", "menu-missing", `No menu called "${o.menuName}" was found in the export.`);
    return null;
  }
  const items = menu.items.filter((i) => i.status === "publish").sort((a, b) => a.order - b.order);
  const top = items.filter((i) => !i.parent);
  const nested = items.length - top.length;
  if (nested) log.add("info", "menu-nested", `${nested} sub-menu item(s) were not imported: the header menu has one level.`, { title: menu.name });
  const out = [];
  for (const it of top) {
    let href = null;
    let label = it.title;
    if (it.type === "post_type" && it.objectId) {
      href = addressOf.get(it.objectId) ?? null;
      const stub = index.pages.get(it.objectId) ?? index.posts.get(it.objectId);
      label = label || stub?.title || "";
      if (!href) { log.add("warn", "menu-item-skipped", `"${label || it.id}" links to content that was not imported, so it was left out of the menu.`, { title: menu.name }); continue; }
    } else if (it.type === "custom" && it.url) {
      try {
        const u = new URL(it.url, `https://${index.siteHost || "invalid.example"}`);
        if (index.siteHost && u.hostname.toLowerCase() === index.siteHost) {
          const p = oldPathOf(u.toString());
          href = p ? (oldToNew.get(p) ?? `/${p}`) : "/";
        } else href = it.url;
      } catch {
        href = null;
      }
    } else if (it.type === "taxonomy" && it.object === "category" && store.hasPosts) {
      const term = [...index.terms.values()].find((t) => t.taxonomy === "category" && (t.id === it.objectId));
      href = term ? `/${news}/category/${normalizeSlug(term.slug)}` : null;
      label = label || (term ? cleanText(term.name) : "");
    }
    if (!href || !label) { log.add("warn", "menu-item-skipped", `A menu item ("${label || it.id}") could not be turned into a link and was left out.`, { title: menu.name }); continue; }
    if (!/^(\/|https?:\/\/|mailto:|tel:)/i.test(href)) { log.add("warn", "menu-item-skipped", `The menu item "${label}" has an unsafe address and was left out.`, { title: menu.name }); continue; }
    out.push({ label: label.slice(0, 120), href });
  }
  const current = await store.getNav();
  let next;
  if (o.menuMode === "replace") next = out;
  else {
    const have = new Set(current.map((c) => c.href));
    next = [...current, ...out.filter((i) => !have.has(i.href))];
  }
  const changed = JSON.stringify(next.map((n) => [n.label, n.href])) !== JSON.stringify(current.map((n) => [n.label, n.href]));
  if (changed) await store.setNav(next);
  return { name: menu.name, items: out.length, added: next.length - current.length, mode: o.menuMode, changed };
}
