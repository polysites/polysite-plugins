// Which posts screen an address belongs to, for a site whose news section is at /<section>
// (News settings). Pure, so it is tested without a server. The addresses:
//
//   /news                          the list, page 1
//   /news/page/2                   the list, page 2
//   /news/category/policy          one category, page 1
//   /news/category/policy/page/2   one category, page 2
//   /news/some-post                one post
//
// "page" and "category" are reserved as post slugs (apps/cms/src/collections/Posts.ts).

export type PostsRoute =
  | { kind: "list"; page: number }
  | { kind: "category"; category: string; page: number }
  | { kind: "post"; slug: string };

export const RESERVED_POST_SLUGS = ["page", "category"];

const MAX_PAGE = 1000;

function pageNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PAGE ? n : null;
}

/** `slug` is the request path without slashes at the ends, like "news/page/2". */
export function matchPostsRoute(slug: string, section: string): PostsRoute | null {
  const parts = slug.split("/").filter(Boolean);
  if (parts[0] !== section) return null;
  const rest = parts.slice(1);

  if (rest.length === 0) return { kind: "list", page: 1 };

  if (rest[0] === "page") {
    const page = rest.length === 2 ? pageNumber(rest[1]) : null;
    // /news/page/1 is the same list as /news, so it is not a second address for it.
    return page && page > 1 ? { kind: "list", page } : null;
  }

  if (rest[0] === "category") {
    const category = rest[1];
    if (!category) return null;
    if (rest.length === 2) return { kind: "category", category, page: 1 };
    if (rest.length === 4 && rest[2] === "page") {
      const page = pageNumber(rest[3]);
      return page && page > 1 ? { kind: "category", category, page } : null;
    }
    return null;
  }

  if (rest.length === 1) return { kind: "post", slug: rest[0]! };
  return null;
}

/** The section address of a site, "news" unless it chose another. */
export function sectionOf(site: { extensions?: { news?: { path?: string | null } | null } } | null | undefined): string {
  return site?.extensions?.news?.path?.trim().replace(/^\/+|\/+$/g, "") || "news";
}

export function listHref(section: string, page = 1, category?: string): string {
  const base = category ? `/${section}/category/${category}` : `/${section}`;
  return page > 1 ? `${base}/page/${page}` : base;
}

export function postHref(section: string, slug: string): string {
  return `/${section}/${slug}`;
}

/** "September 28, 2026", always in UTC so the server and the browser draw the same text. */
export function formatPostDate(iso: string | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
