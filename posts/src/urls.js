// Where a site's posts live. Each site chooses its own section address (News settings, "news" by default),
// so a post's public URL is <domain>/<section>/<slug>. The web part of this plugin reads the same setting
// (web/utils/postsRoute.ts) to decide what to show.

export const DEFAULT_NEWS_PATH = "news";
export const DEFAULT_NEWS_LABEL = "News";
export const DEFAULT_PER_PAGE = 10;

// Paths the site already uses for something else.
export const RESERVED_NEWS_PATHS = new Set(["api", "admin", "_nuxt", "feed", "feed.xml", "sitemap", "sitemap.xml", "robots.txt", "__nuxt_error"]);

const NEWS_PATH = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** An error message, or null when the section address is acceptable. */
export function checkNewsPath(value) {
  if (!value) return null; // empty falls back to the default
  if (!NEWS_PATH.test(value)) return "Use lower-case letters, digits and hyphens only, starting with a letter or digit (40 characters at most), like news or updates.";
  if (RESERVED_NEWS_PATHS.has(value)) return `"${value}" is used by the site itself. Choose another.`;
  return null;
}

export function newsPath(site) {
  const path = site?.extensions?.news?.path?.trim().replace(/^\/+|\/+$/g, "");
  return path || DEFAULT_NEWS_PATH;
}

export function buildPostUrl(domain, section, slug, scheme = "http") {
  const base = `${scheme}://${domain}/${section}`;
  const path = typeof slug === "string" ? slug.replace(/^\/+/, "") : "";
  return path ? `${base}/${path}` : base;
}

export async function postUrlFromDoc(doc, req) {
  const scheme = process.env.SITE_SCHEME || "http";
  const ref = doc?.site;
  const siteId = ref && typeof ref === "object" ? ref.id : ref;

  let domain = process.env.SITE_DOMAIN || "localhost";
  let section = DEFAULT_NEWS_PATH;
  if (siteId && req?.payload) {
    const site = await req.payload.findByID({ collection: "sites", id: siteId, depth: 0, overrideAccess: true }).catch(() => null);
    if (site?.domain) domain = site.domain;
    section = newsPath(site);
  }
  return buildPostUrl(domain, section, doc?.slug, scheme);
}
