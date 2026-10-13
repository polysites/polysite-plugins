import SearchBox from "../components/SearchBox.vue";
import de from "../locales/de.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import type { SearchOutcome, SearchSite } from "../types/search";
import { isSearchPath, MIN_QUERY, pageFrom, queryFrom, searchEnabled } from "../utils/search";

// Puts search on a site that has switched it on (Administration -> Site features -> Site search):
//  - the search box, which a layout places with <SiteSlot name="search" />;
//  - the results page at /search (and /fr/search, ...), through the core's content routes, so the catch-all page needs no change;
//  - dictionaries for the fixed words in French, Spanish and German.
// The results page needs the Pages module on for the site; a page whose slug is "search" is hidden by it.
export default defineNuxtPlugin({
  name: "search-web",
  dependsOn: ["site-extensions", "strings", "content-routes"],
  setup(nuxtApp) {
    nuxtApp.$siteSlots.add("search", SearchBox);
    nuxtApp.$strings.register("fr", fr);
    nuxtApp.$strings.register("es", es);
    nuxtApp.$strings.register("de", de);

    nuxtApp.$contentRoutes.register({
      id: "search",
      module: "pages",
      component: "SearchRoute",
      match: (slug, { site }) => (isSearchPath(slug) && searchEnabled(site as SearchSite | null | undefined) ? {} : null),
      async load(_match, { nuxtApp: app, site }) {
        // Composables run through runWithContext: after the first await Nuxt's ambient context is gone.
        const { query } = (app as unknown as { $router: { currentRoute: { value: { query: Record<string, unknown> } } } }).$router.currentRoute.value;
        const q = queryFrom(query.q);
        const page = pageFrom(query.page);
        // Too short to search: no request, the page says so.
        let outcome: SearchOutcome | null = null;
        if (q.length >= MIN_QUERY) outcome = (await app.runWithContext(() => useSiteSearch(q, page))).value ?? null;
        return { q, page, outcome, placeholder: (site as SearchSite | null | undefined)?.extensions?.search?.placeholder ?? null };
      },
    });
  },
});
