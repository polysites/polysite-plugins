// Where a site's events live. Each site chooses its own section address (Event settings, "events" by default), so an event's public
// address is <domain>/<section>/<slug>. The web part of this plugin reads the same setting to decide what to show.

export const DEFAULT_EVENTS_PATH = "events";
export const DEFAULT_EVENTS_LABEL = "Events";
export const DEFAULT_PER_PAGE = 12;

export const RESERVED_EVENTS_PATHS = new Set(["api", "admin", "_nuxt", "feed", "feed.xml", "sitemap", "sitemap.xml", "robots.txt", "__nuxt_error", "calendar.ics"]);
// Words used inside the section's own addresses, so an event cannot be named after them.
export const RESERVED_EVENT_SLUGS = ["page", "past", "cancel", "calendar"];

const PATH = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** An error message, or null when the section address is acceptable. */
export function checkEventsPath(value) {
  if (!value) return null;
  if (!PATH.test(value)) return "Use lower-case letters, digits and hyphens only, starting with a letter or digit (40 characters at most), like events or whats-on.";
  if (RESERVED_EVENTS_PATHS.has(value)) return `"${value}" is used by the site itself. Choose another.`;
  return null;
}

export function eventsPath(site) {
  const path = site?.extensions?.events?.path?.trim().replace(/^\/+|\/+$/g, "");
  return path || DEFAULT_EVENTS_PATH;
}

export function buildEventUrl(domain, section, slug, scheme = "http") {
  const base = `${scheme}://${domain}/${section}`;
  const path = typeof slug === "string" ? slug.replace(/^\/+/, "") : "";
  return path ? `${base}/${path}` : base;
}

export async function eventUrlFromDoc(doc, req) {
  const scheme = process.env.SITE_SCHEME || "http";
  const ref = doc?.site;
  const siteId = ref && typeof ref === "object" ? ref.id : ref;
  let domain = process.env.SITE_DOMAIN || "localhost";
  let section = DEFAULT_EVENTS_PATH;
  if (siteId && req?.payload) {
    const site = await req.payload.findByID({ collection: "sites", id: siteId, depth: 0, overrideAccess: true }).catch(() => null);
    if (site?.domain) domain = site.domain;
    section = eventsPath(site);
  }
  return buildEventUrl(domain, section, doc?.slug, scheme);
}
