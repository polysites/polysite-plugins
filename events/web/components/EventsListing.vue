<script setup lang="ts">
import type { PayloadEvent } from "../types/events";
import { availabilityText, formatEventShortDate, formatEventTimes } from "../utils/eventFormat";
import { eventHref, listHref } from "../utils/eventsRoute";

// A site's list of events: cards with the date, the place and the places left, a link between upcoming and past events, and page
// links. Plain by design: it carries `poly-events*` class names so a theme can restyle it.
const t = useT();
const localePath = useLocalePath();
const props = defineProps<{ heading: string; section: string; events: PayloadEvent[]; page: number; totalPages: number; past: boolean }>();

const place = (event: PayloadEvent) => [event.venueName, event.address].filter(Boolean).join(", ") || (event.onlineUrl ? t("events.online", "Online") : "");

const pageLinks = computed(() => {
  const shown = new Set([1, props.totalPages, props.page - 1, props.page, props.page + 1].filter((n) => n >= 1 && n <= props.totalPages));
  return [...shown].sort((a, b) => a - b);
});
</script>

<template>
  <section class="poly-events mx-auto max-w-5xl px-4 py-10 sm:px-8">
    <header class="poly-events-header mb-8 flex flex-wrap items-baseline justify-between gap-3">
      <h1 class="text-3xl font-bold">{{ heading }}</h1>
      <NuxtLink :to="localePath(listHref(section, 1, !past))" class="poly-events-switch text-sm underline">
        {{ past ? t("events.seeUpcoming", "See upcoming events") : t("events.seePast", "See past events") }}
      </NuxtLink>
    </header>

    <p v-if="!events.length" class="poly-events-empty text-neutral-600">
      {{ past ? t("events.noneYetPast", "There are no past events.") : t("events.none", "No events are coming up right now. Check back soon.") }}
    </p>

    <ul v-else class="poly-events-list grid gap-6 sm:grid-cols-2">
      <li v-for="event in events" :key="event.slug" class="poly-event-card flex gap-4 rounded-lg border border-neutral-200 p-4">
        <div class="poly-event-date flex w-14 shrink-0 flex-col items-center justify-start rounded bg-neutral-100 py-2 text-center" aria-hidden="true">
          <span class="text-xs font-semibold uppercase text-neutral-500">{{ formatEventShortDate(event.startsAt, event.timeZone).month }}</span>
          <span class="text-2xl font-bold leading-none">{{ formatEventShortDate(event.startsAt, event.timeZone).day }}</span>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h2 class="poly-event-card-title text-lg font-semibold leading-snug">
            <NuxtLink :to="localePath(eventHref(section, event.slug as string))" class="hover:underline">{{ event.title }}</NuxtLink>
          </h2>
          <p class="poly-event-card-when text-sm text-neutral-600">{{ formatEventTimes(event.startsAt, event.endsAt, event.timeZone) }}</p>
          <p v-if="place(event)" class="poly-event-card-where text-sm text-neutral-600">{{ place(event) }}</p>
          <p v-if="event.summary" class="poly-event-card-summary mt-1 text-neutral-700">{{ event.summary }}</p>
          <p v-if="!past && availabilityText(event.availability, t)" class="poly-event-card-places mt-1 text-sm font-medium">{{ availabilityText(event.availability, t) }}</p>
        </div>
      </li>
    </ul>

    <nav v-if="totalPages > 1" class="poly-pagination mt-10 flex flex-wrap items-center gap-2" :aria-label="t('events.more', 'More events')">
      <NuxtLink v-if="page > 1" :to="localePath(listHref(section, page - 1, past))" rel="prev" class="poly-pagination-prev rounded border border-neutral-300 px-3 py-1">{{ t("events.previous", "Previous") }}</NuxtLink>
      <NuxtLink
        v-for="n in pageLinks"
        :key="n"
        :to="localePath(listHref(section, n, past))"
        class="poly-pagination-page rounded border border-neutral-300 px-3 py-1"
        :class="{ 'bg-neutral-900 text-white': n === page }"
        :aria-current="n === page ? 'page' : undefined"
      >{{ n }}</NuxtLink>
      <NuxtLink v-if="page < totalPages" :to="localePath(listHref(section, page + 1, past))" rel="next" class="poly-pagination-next rounded border border-neutral-300 px-3 py-1">{{ t("events.next", "Next") }}</NuxtLink>
    </nav>
  </section>
</template>
