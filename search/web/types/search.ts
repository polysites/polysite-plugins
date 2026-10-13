// What the search plugin adds to a site (its settings, as `extensions.search`) and what the search endpoint answers. The core's site type doesn't know
// about the plugin's fields.
export interface SearchSetting {
  enabled?: boolean | null;
  placeholder?: string | null;
  perPage?: number | null;
  collections?: string[] | null;
}

export interface SearchSite {
  extensions?: { search?: SearchSetting | null } | null;
}

export interface SearchResult {
  id: string | number;
  collection: string;
  /** What the URL manager calls it: "page", "post", ... */
  type: string;
  title: string;
  /** The item's address within the site, without a leading slash ("news/budget-day"; "/" is the home page). */
  path: string;
  snippet: string;
}

export interface SearchResponse {
  q: string;
  tooShort: boolean;
  minLength?: number;
  lang: string;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  results: SearchResult[];
}

/** One search, as the results page sees it: an answer, or the reason there isn't one. */
export type SearchOutcome =
  | { status: "ok"; data: SearchResponse }
  | { status: "limited"; retryAfter: number }
  | { status: "error" };
