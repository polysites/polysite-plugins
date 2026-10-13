// The languages the page being viewed has text in, read from the CMS's URL index (kept up to date as content is saved). Null
// when the index doesn't know the page, or the site has one language. Follows the address as the visitor moves around.
export function usePageTranslations() {
  const config = useRuntimeConfig();
  const language = useSiteLanguage();
  const base = import.meta.server ? config.apiBaseInternal : config.public.apiBase;
  const hostname = useRequestURL().hostname;
  // The index holds the home page as "/" and every other address without slashes at the ends.
  const path = computed(() => language.path.value || "/");

  return useAsyncData<string[] | null>(
    () => `page-translations-${hostname}-${path.value}`,
    async () => {
      if (!language.multilingual.value) return null;
      const res = await $fetch<{ docs?: Array<{ languages?: string[] | null }> }>(`${base}/site-urls`, {
        query: {
          "where[site.domain][equals]": hostname,
          "where[path][equals]": path.value,
          "where[status][equals]": "published",
          depth: 0,
          limit: 1,
        },
      }).catch(() => null);
      const languages = res?.docs?.[0]?.languages;
      return Array.isArray(languages) ? languages : null;
    },
    { watch: [path], default: () => null },
  );
}
