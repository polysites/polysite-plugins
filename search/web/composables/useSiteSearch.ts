import type { SearchOutcome, SearchResponse } from "../types/search";

// One search of the site whose domain matches the request, in the language of the address (the CMS applies the site's
// default as the fallback). The answer is an outcome rather than a thrown error: a busy or broken search is a state the page
// draws, not a failed page. Server-side the visitor's address is passed on, so the CMS's rate limit counts the visitor and
// not this web server.
export async function useSiteSearch(q: string, page: number) {
  const config = useRuntimeConfig();
  const base = import.meta.server ? config.apiBaseInternal : config.public.apiBase;
  const hostname = useRequestURL().hostname;
  const lang = useSiteLanguage();
  const forwarded = import.meta.server ? useRequestHeaders(["x-forwarded-for", "x-real-ip"]) : {};

  const { data } = await useAsyncData<SearchOutcome>(`site-search-${hostname}-${lang.code.value}-${page}-${q}`, async () => {
    try {
      const res = await $fetch<SearchResponse>(`${base}/site-search`, {
        query: { domain: hostname, q, lang: lang.code.value, page },
        headers: forwarded,
      });
      return { status: "ok", data: res };
    } catch (err) {
      const e = err as { statusCode?: number; status?: number; data?: { retryAfter?: number } };
      if ((e.statusCode ?? e.status) === 429) return { status: "limited", retryAfter: e.data?.retryAfter ?? 30 };
      return { status: "error" };
    }
  });
  return data;
}
