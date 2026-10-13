import ShareButtons from "../components/ShareButtons.vue";
import ShareFloating from "../components/ShareFloating.vue";
import de from "../locales/de.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";

// Puts the share buttons on the site and registers translations of their fixed words. A theme places them with
// <SiteSlot name="share" /> (or <ShareButtons />), and the floating copy goes in the core's `app` slot. With no site switched on
// both draw nothing.
export default defineNuxtPlugin({
  name: "share-web",
  dependsOn: ["site-extensions", "strings", "content-routes"],
  setup(nuxtApp) {
    nuxtApp.$siteSlots.add("share", ShareButtons);
    nuxtApp.$siteSlots.add("app", ShareFloating);
    nuxtApp.$strings.register("fr", fr);
    nuxtApp.$strings.register("es", es);
    nuxtApp.$strings.register("de", de);
  },
});
