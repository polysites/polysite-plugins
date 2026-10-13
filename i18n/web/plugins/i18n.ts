import LanguageHead from "../components/LanguageHead.vue";
import LanguageSwitcher from "../components/LanguageSwitcher.vue";
import de from "../locales/de.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";

// Puts the i18n plugin's visible parts on the site: the head tags (once, for the whole app) and the language switcher, which a
// layout places with <SiteSlot name="language-switcher" />; and registers translations of the core's fixed words.
export default defineNuxtPlugin({
  name: "i18n-web",
  dependsOn: ["site-extensions", "strings"],
  setup(nuxtApp) {
    nuxtApp.$siteSlots.add("app", LanguageHead);
    nuxtApp.$siteSlots.add("language-switcher", LanguageSwitcher);
    nuxtApp.$strings.register("fr", fr);
    nuxtApp.$strings.register("es", es);
    nuxtApp.$strings.register("de", de);
  },
});
