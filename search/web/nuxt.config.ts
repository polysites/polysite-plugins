// The web part of the search plugin, loaded as a Nuxt layer by apps/web (see discoverPluginLayerPaths in its nuxt.config.ts).
// It adds the search box (a slot a theme places), the results page at /search, and dictionaries for its fixed words.
export default defineNuxtConfig({
  routeRules: {
    // Results depend on the visitor's words, so they must be built per request: with the app's blanket cache rule every
    // distinct search would be kept for good.
    "/search": { isr: false },
    "/*/search": { isr: false },
  },
});
