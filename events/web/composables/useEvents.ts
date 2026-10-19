import type { PayloadEvent, PayloadEventList } from "../types/events";

// Reads a site's events from the CMS, scoped to the site whose domain matches the request, the same way the posts plugin and
// usePayloadPage do. Visitors only ever receive published events: the CMS enforces that, not this code. Each call has an explicit key
// built from the site and the arguments, because useFetch's default key is the URL alone and would reuse the first answer across
// client-side navigation.

function api() {
  const config = useRuntimeConfig();
  return import.meta.server ? config.apiBaseInternal : config.public.apiBase;
}

// Only what a card shows, so a long description is never sent just to draw a list.
const LIST_FIELDS = ["title", "slug", "summary", "startsAt", "endsAt", "timeZone", "venueName", "address", "onlineUrl", "heroImage", "rsvp", "availability"];

/** An event is "upcoming" until it ends (or, with no end, for an hour after it starts); "past" is everything else. */
function whenFilter(past: boolean, now: string): Record<string, string> {
  const side = past ? "less_than" : "greater_than_equal";
  return {
    [`where[and][2][or][0][endsAt][${side}]`]: now,
    "where[and][2][or][1][and][0][endsAt][exists]": "false",
    [`where[and][2][or][1][and][1][startsAt][${side}]`]: now,
  };
}

export async function useEventList(opts: { page: number; perPage: number; past: boolean }) {
  const hostname = useRequestURL().hostname;
  const lang = useSiteLanguage();
  // Rounded to the minute so the server and the browser ask the same thing and the cached answer is shared.
  const now = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const query: Record<string, string | number | boolean> = {
    "where[and][0][site.domain][equals]": hostname,
    "where[and][1][_status][equals]": "published",
    ...whenFilter(opts.past, now),
    sort: opts.past ? "-startsAt" : "startsAt",
    limit: opts.perPage,
    page: opts.page,
    depth: 1,
    ...lang.query(),
  };
  for (const field of LIST_FIELDS) query[`select[${field}]`] = true;

  const { data } = await useFetch<PayloadEventList>(`${api()}/events`, {
    key: `events-${hostname}-${lang.code.value}-${opts.past ? "past" : "upcoming"}-${opts.page}-${opts.perPage}`,
    query,
  });
  return data;
}

export async function useEventBySlug(slug: string) {
  const hostname = useRequestURL().hostname;
  const lang = useSiteLanguage();
  const { data } = await useFetch(`${api()}/events`, {
    key: `event-${hostname}-${lang.code.value}-${slug}`,
    query: {
      "where[and][0][slug][equals]": slug,
      "where[and][1][site.domain][equals]": hostname,
      depth: 1,
      limit: 1,
      ...lang.query(),
    },
    transform: (res: { docs?: PayloadEvent[] }) => res?.docs?.[0] ?? null,
  });
  return data;
}
