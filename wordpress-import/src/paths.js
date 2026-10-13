// Addresses, slugs and dates: how a WordPress item maps to a Polysite one. Pure functions, no database.

// The same rules the core applies to a page slug or a redirect's source (apps/cms/src/utils/slug.ts), copied because a
// plugin cannot import from the app. Keeps "/" for the home page, and nested paths like "about/team".
export function normalizeSlug(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "/") return "/";
  return trimmed
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter((s) => s !== "")
    .join("/");
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// One path segment: WordPress stores percent-encoded non-Latin slugs (%d0%bf...); decode them, drop accents, keep a-z0-9-.
export function slugify(value) {
  return safeDecode(String(value ?? ""))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The leaf slug for an item: its WordPress slug, else made from the title, else `wp-<id>`. Never empty. */
export function leafSlug(item) {
  return slugify(item.slug) || slugify(item.title) || `wp-${item.id}`;
}

/**
 * A page's address: its parents' slugs and its own ("about/team"). `byId` maps WordPress ids to items (all pages in the
 * export, selected or not, so a child of an unpublished parent still gets a stable address). Loops and runaway depth stop.
 */
export function pagePath(item, byId) {
  const parts = [leafSlug(item)];
  const seen = new Set([item.id]);
  let cursor = item;
  while (cursor.parent && parts.length < 8) {
    const parent = byId.get(cursor.parent);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    parts.unshift(leafSlug(parent));
    cursor = parent;
  }
  return parts.join("/");
}

/** The path part of a WordPress address, as a core-style slug ("2023/05/hello"); null if it is a "?p=12" style address. */
export function oldPathOf(link, { siteHost } = {}) {
  if (!link) return null;
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (siteHost && url.hostname.toLowerCase() !== siteHost.toLowerCase()) return null;
  if (url.search && /[?&](p|page_id|post|attachment_id)=/.test(url.search)) return null;
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return null;
  return normalizeSlug(safeDecode(path)) || null;
}

/**
 * The redirect an import should leave behind: from the old WordPress path to the new address, or null when they are the same
 * (or there is no old path). `newPath` is the item's address within the site, without a leading slash.
 */
export function redirectFor(oldPath, newPath) {
  if (!oldPath) return null;
  const from = normalizeSlug(oldPath);
  if (!from || from === "/") return null;
  const to = normalizeSlug(newPath);
  if (from === to) return null;
  return { fromPath: from, toPath: to };
}

const ZERO_DATE = /^0000-00-00/;

/** An ISO timestamp from WordPress's `post_date_gmt` (UTC), falling back to the RFC 2822 `pubDate`, then to the local `post_date`. */
export function isoDate({ dateGmt, pubDate, date }) {
  if (dateGmt && !ZERO_DATE.test(dateGmt)) {
    const d = new Date(`${dateGmt.replace(" ", "T")}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (pubDate) {
    const d = new Date(pubDate);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (date && !ZERO_DATE.test(date)) {
    const d = new Date(`${date.replace(" ", "T")}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** The host of the site the export came from, from the channel's address. */
export function siteHostOf(channel) {
  for (const candidate of [channel?.baseSiteUrl, channel?.link, channel?.baseBlogUrl]) {
    try {
      if (candidate) return new URL(candidate).hostname.toLowerCase();
    } catch {
      // try the next one
    }
  }
  return "";
}

/** The slug for a conflicting item when the choice is "rename": slug-2, slug-3, ... `taken` is a Set of used slugs. */
export function freeSlug(slug, taken) {
  if (!taken.has(slug)) return slug;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}
