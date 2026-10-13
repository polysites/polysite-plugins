import type { SearchSite } from "../types/search";

// The small decisions the search box and results page make, as plain functions so each is tested without Nuxt.

/** The results page's address within a site. A page of the site with this slug is hidden by it. */
export const SEARCH_PATH = "search";

export const MIN_QUERY = 2;

/** Whether the site has switched search on (its row in Site search; the core hands it over as `site.extensions.search`). */
export const searchEnabled = (site: SearchSite | null | undefined): boolean => site?.extensions?.search?.enabled === true;

/** Whether an address (without its language, no slashes at the ends) is the results page. */
export const isSearchPath = (slug: string): boolean => slug.replace(/^\/+|\/+$/g, "") === SEARCH_PATH;

const first = (value: unknown): string => String(Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/** The search words from the address's query string: trimmed, one line, a sane length. */
export function queryFrom(raw: unknown): string {
  return first(raw).replace(/\s+/g, " ").trim().slice(0, 100);
}

/** A page number from the address: a whole number from 1 up. */
export function pageFrom(raw: unknown): number {
  const n = Number.parseInt(first(raw), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The query string for a results page: `?q=budget&page=2` (page 1 has no `page`). */
export function resultsQuery(q: string, page = 1): string {
  const params = new URLSearchParams();
  params.set("q", q);
  if (page > 1) params.set("page", String(page));
  return `?${params.toString()}`;
}

/** An item's address as a link: the home page is "/", everything else gets a leading slash. */
export function resultHref(path: string): string {
  const clean = path.replace(/^\/+/, "");
  return clean === "" ? "/" : `/${clean}`;
}

/** The words of a search, for marking them in the results. */
export const termsOf = (q: string): string[] => [...new Set(q.split(/\s+/).filter(Boolean))];

export interface Segment {
  text: string;
  hit: boolean;
}

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
const escapeRegExp = (s: string): string => s.replace(SPECIAL, "\\$&");

/**
 * Cuts text into pieces, marking those that are one of the search words (any case). Plain data rather than HTML, so the page
 * draws it with ordinary elements and nothing a visitor typed is ever treated as markup.
 */
export function highlight(text: string, terms: string[]): Segment[] {
  const words = terms.filter(Boolean);
  if (!text || words.length === 0) return text ? [{ text, hit: false }] : [];
  const escaped = words.map(escapeRegExp).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${escaped.join("|")})`, "giu");
  return text
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: words.some((w) => w.toLocaleLowerCase() === part.toLocaleLowerCase()) }));
}

/** A kind of item ("page", "post-event") as a fallback label when no dictionary has a word for it. */
export const typeFallback = (type: string): string => {
  const words = type.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : "";
};
