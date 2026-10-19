<script setup lang="ts">
import type { PayloadEvent } from "../types/events";
import { formatEventDay, formatEventTimes } from "../utils/eventFormat";
import { listHref } from "../utils/eventsRoute";

// One event: the details, the description and the RSVP form. Carries `poly-event*` class names so a theme can restyle it.
const t = useT();
const localePath = useLocalePath();
const props = defineProps<{ event: PayloadEvent; section: string; sectionLabel: string }>();

// A paid event sells tickets in place of taking RSVPs (the server decides too: the free form refuses a paid event).
const paid = computed(() => (props.event.tickets ?? []).some((ticket) => Number(ticket.price) > 0));
const place = computed(() => [props.event.venueName, props.event.address].filter(Boolean).join(", "));
</script>

<template>
  <article class="poly-event mx-auto max-w-3xl px-4 py-10 sm:px-8">
    <header class="poly-event-header mb-8">
      <h1 class="text-3xl font-bold leading-tight sm:text-4xl">{{ event.title }}</h1>
      <p v-if="event.summary" class="poly-event-summary mt-3 text-lg text-neutral-700">{{ event.summary }}</p>
    </header>

    <figure v-if="event.heroImage?.url" class="poly-event-hero mb-8">
      <img :src="event.heroImage.url" :alt="event.heroImage.alt || ''" class="w-full rounded-lg">
    </figure>

    <dl class="poly-event-facts mb-8 grid gap-4 rounded-lg border border-neutral-200 p-4 sm:grid-cols-2">
      <div>
        <dt class="text-sm font-semibold uppercase text-neutral-500">{{ t("events.when", "When") }}</dt>
        <dd class="poly-event-when mt-1">
          <time :datetime="event.startsAt">{{ formatEventDay(event.startsAt, event.timeZone) }}</time><br>
          {{ formatEventTimes(event.startsAt, event.endsAt, event.timeZone) }}
        </dd>
      </div>
      <div v-if="place || event.onlineUrl">
        <dt class="text-sm font-semibold uppercase text-neutral-500">{{ t("events.where", "Where") }}</dt>
        <dd class="poly-event-where mt-1">
          <span v-if="place">{{ place }}</span>
          <a v-if="event.onlineUrl" :href="event.onlineUrl" rel="noopener noreferrer" class="block underline">{{ t("events.joinOnline", "Join online") }}</a>
        </dd>
      </div>
    </dl>

    <EventRichText v-if="event.body" :data="event.body" class="poly-event-body text-lg leading-relaxed" />

    <EventTickets v-if="paid" :event-id="event.id" class="mt-10" />
    <EventRsvpForm v-else :event-id="event.id" class="mt-10" />

    <footer class="poly-event-footer mt-10 border-t border-neutral-200 pt-6">
      <NuxtLink :to="localePath(listHref(section))" class="underline"><span class="poly-arrow">&larr;</span> {{ sectionLabel }}</NuxtLink>
    </footer>
  </article>
</template>
