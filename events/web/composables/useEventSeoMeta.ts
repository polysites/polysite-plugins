import type { Ref } from "vue";
import type { PayloadEvent } from "../types/events";
import { eventJsonLd } from "../utils/eventFormat";
import { eventHref } from "../utils/eventsRoute";

// Head tags for an event. The SEO plugin's own title, description and image first, then the event's title, summary and picture, the
// same chain pages and posts use; search engines also get structured data (an Event), which is what puts the date and place in results.
export function useEventSeoMeta(event: Ref<PayloadEvent | undefined>, ctx: { siteName: string; section: string }) {
  const url = useRequestURL();
  const absolute = (path?: string) => (path ? (path.startsWith("http") ? path : `${url.origin}${path}`) : undefined);
  const title = () => event.value?.meta?.title || event.value?.title || "";
  const description = () => event.value?.meta?.description || event.value?.summary || undefined;
  const image = () => absolute(event.value?.meta?.image?.url || event.value?.heroImage?.url);

  useSeoMeta({
    title,
    description,
    ogTitle: title,
    ogDescription: description,
    ogImage: image,
    ogType: "website",
    twitterCard: () => (image() ? "summary_large_image" : "summary"),
  });

  useHead({
    script: computed(() => {
      const e = event.value;
      if (!e?.title || !e.slug || !e.startsAt) return [];
      const online = Boolean(e.onlineUrl);
      const physical = Boolean(e.venueName || e.address);
      const location = [
        ...(physical ? [{ "@type": "Place", name: e.venueName || undefined, address: e.address || undefined }] : []),
        ...(online ? [{ "@type": "VirtualLocation", url: e.onlineUrl }] : []),
      ];
      const availability = e.availability?.state;
      return [
        {
          type: "application/ld+json",
          innerHTML: eventJsonLd({
            "@context": "https://schema.org",
            "@type": "Event",
            name: title(),
            description: description(),
            startDate: e.startsAt,
            endDate: e.endsAt || undefined,
            eventStatus: "https://schema.org/EventScheduled",
            eventAttendanceMode: online && physical ? "https://schema.org/MixedEventAttendanceMode" : online ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
            location: location.length === 1 ? location[0] : location.length ? location : undefined,
            image: image(),
            organizer: { "@type": "Organization", name: ctx.siteName },
            offers: { "@type": "Offer", price: 0, priceCurrency: "CAD", url: absolute(eventHref(ctx.section, e.slug)), availability: availability === "full" || availability === "closed" ? "https://schema.org/SoldOut" : "https://schema.org/InStock" },
          }),
        },
      ];
    }),
  });
}
