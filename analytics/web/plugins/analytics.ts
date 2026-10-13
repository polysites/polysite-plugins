import TrackingConsent from "../components/TrackingConsent.vue";
import TrackingFooterLink from "../components/TrackingFooterLink.vue";
import { emitTracking } from "../utils/trackingClient";

// Puts the consent notice and the "Cookie settings" footer link on every site, and forwards the core's site events
// (a form was sent) to whichever tracking tools the visitor has allowed. With this plugin absent none of it exists.
export default defineNuxtPlugin({
  name: "analytics-tracking",
  dependsOn: ["site-extensions"],
  setup(nuxtApp) {
    nuxtApp.$siteSlots.add("app", TrackingConsent);
    nuxtApp.$siteSlots.add("footer-links", TrackingFooterLink);
    if (import.meta.client) onSiteEvent((event) => emitTracking(event));
  },
});
