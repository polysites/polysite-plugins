import type { EventsSite, PayloadEvent, PayloadEventList } from "../types/events";
import { matchEventsRoute, sectionOf, type EventsRoute } from "../utils/eventsRoute";

// Puts the events addresses on a site. The core's catch-all page (apps/web/pages/[...slug].vue) asks every registered route in turn;
// this one owns <section>, <section>/page/N, <section>/past[/page/N], <section>/cancel and <section>/<event>, where <section> is the
// site's own setting (Event settings), and only for a site with the Events module on.
interface EventsMatch {
  route: EventsRoute;
  section: string;
}

export default defineNuxtPlugin({
  name: "events-routes",
  dependsOn: ["content-routes"],
  setup(nuxtApp) {
    nuxtApp.$contentRoutes.register({
      id: "events",
      module: "events",
      component: "EventsRoute",
      match(slug, { site }) {
        const section = sectionOf(site as EventsSite | undefined);
        const route = matchEventsRoute(slug, section);
        return route ? ({ route, section } satisfies EventsMatch) : null;
      },
      async load(rawMatch, { nuxtApp: app, site }) {
        const { route, section } = rawMatch as EventsMatch;
        const settings = (site as EventsSite | undefined)?.extensions?.events;
        const label = settings?.label || "Events";
        const perPage = settings?.perPage || 12;
        const siteName = (site as EventsSite | undefined)?.name || "Polysite";

        if (route.kind === "cancel") return { view: "cancel", section, label, siteName };

        // Every composable below runs through runWithContext: after the first await Nuxt's ambient context is gone.
        if (route.kind === "event") {
          const event = await app.runWithContext(() => useEventBySlug(route.slug));
          return event.value ? { view: "event", event: event.value, section, label, siteName } : null;
        }

        const list = (await app.runWithContext(() => useEventList({ page: route.page, perPage, past: route.past }))).value as PayloadEventList | null;
        // A page past the end is a 404, not an empty list.
        if (!list || (route.page > 1 && route.page > list.totalPages)) return null;
        return { view: "list", list, past: route.past, section, label, siteName };
      },
    });
  },
});

// Re-exported only so the shapes are visible next to the route that produces them.
export type { PayloadEvent };
