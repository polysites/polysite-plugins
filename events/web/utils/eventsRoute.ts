// Which events screen an address belongs to, for a site whose events section is at /<section> (Event settings). Pure, so it is
// tested without a server. The addresses:
//
//   /events                       the upcoming events, page 1
//   /events/page/2                page 2
//   /events/past                  past events, page 1
//   /events/past/page/2           past events, page 2
//   /events/cancel?token=...      the page a "give my place back" link opens
//   /events/spring-rally          one event
//
// "page", "past", "cancel" and "calendar" are reserved as event slugs (the plugin refuses them when an event is saved).

export type EventsRoute =
  | { kind: "list"; page: number; past: boolean }
  | { kind: "cancel" }
  | { kind: "event"; slug: string };

export const RESERVED_EVENT_SLUGS = ["page", "past", "cancel", "calendar"];

const MAX_PAGE = 1000;

function pageNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PAGE ? n : null;
}

/** `slug` is the request path without slashes at the ends, like "events/past/page/2". */
export function matchEventsRoute(slug: string, section: string): EventsRoute | null {
  const parts = slug.split("/").filter(Boolean);
  if (parts[0] !== section) return null;
  const rest = parts.slice(1);

  if (rest.length === 0) return { kind: "list", page: 1, past: false };
  if (rest[0] === "cancel") return rest.length === 1 ? { kind: "cancel" } : null;

  const tail = (from: number, past: boolean): EventsRoute | null => {
    const more = rest.slice(from);
    if (more.length === 0) return { kind: "list", page: 1, past };
    if (more[0] === "page" && more.length === 2) {
      const page = pageNumber(more[1]);
      // /events/page/1 is the same list as /events, so it is not a second address for it.
      return page && page > 1 ? { kind: "list", page, past } : null;
    }
    return null;
  };

  if (rest[0] === "page") return tail(0, false);
  if (rest[0] === "past") return tail(1, true);
  if (rest.length === 1) return { kind: "event", slug: rest[0]! };
  return null;
}

/** The section address of a site, "events" unless it chose another. */
export function sectionOf(site: { extensions?: { events?: { path?: string | null } | null } } | null | undefined): string {
  return site?.extensions?.events?.path?.trim().replace(/^\/+|\/+$/g, "") || "events";
}

export function listHref(section: string, page = 1, past = false): string {
  const base = past ? `/${section}/past` : `/${section}`;
  return page > 1 ? `${base}/page/${page}` : base;
}

export function eventHref(section: string, slug: string): string {
  return `/${section}/${slug}`;
}
