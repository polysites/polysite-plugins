// The web part of the posts plugin, loaded as a Nuxt layer by apps/web (see discoverPluginLayerPaths in its nuxt.config.ts).
export default defineNuxtConfig({
  routeRules: {
    // The feed is built per site from the request's host, so it must not share one cached copy.
    "/feed.xml": { isr: false },
  },
});
