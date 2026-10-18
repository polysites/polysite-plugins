// What the CMS's URL index knows about the page being viewed: which languages it has text in, its shared address, and its address in each
// language (a page can have its own, /fr/a-propos). Null when the index doesn't know the page, or the site has one language. Follows the
// address as the visitor moves around.
export interface PageIndexEntry {
  languages: string[];
  /** The shared address (the default language's), with a leading slash; "/" for the home page. */
  path: string;
  /** The address in each language, as the index keeps it. */
  localized: Record<string, string | null> | null;
}

interface IndexDoc {
  languages?: string[] | null;
  path?: string | null;
  localizedPath?: Record<string, string | null> | string | null;
}

export function usePageTranslations() {
  const config = useRuntimeConfig();
  const language = useSiteLanguage();
  const base = import.meta.server ? config.apiBaseInternal : config.public.apiBase;
  const hostname = useRequestURL().hostname;
  // The address as the visitor typed it, without the language: the index holds the home page as "/" and every other address without slashes
  // at the ends. In a language other than the default it is that language's own address when the page has one.
  const path = computed(() => language.path.value || "/");
  const code = computed(() => language.code.value);

  return useAsyncData<PageIndexEntry | null>(
    () => `page-translations-${hostname}-${code.value}-${path.value}`,
    async () => {
      if (!language.multilingual.value) return null;
      const res = await $fetch<{ docs?: IndexDoc[] }>(`${base}/site-urls`, {
        query: {
          "where[site.domain][equals]": hostname,
          // The address is either the shared one or this language's own.
          "where[and][0][or][0][path][equals]": path.value,
          ...(code.value !== language.defaultCode.value ? { "where[and][0][or][1][localizedPath][equals]": path.value } : {}),
          "where[status][equals]": "published",
          // Every language's address in one answer (fields without a language are returned as they are).
          locale: "all",
          depth: 0,
          limit: 1,
        },
      }).catch(() => null);
      const doc = res?.docs?.[0];
      if (!doc || !Array.isArray(doc.languages)) return null;
      const localized = doc.localizedPath && typeof doc.localizedPath === "object" ? doc.localizedPath : null;
      return { languages: doc.languages, path: doc.path ?? path.value, localized };
    },
    { watch: [path, code], default: () => null },
  );
}
