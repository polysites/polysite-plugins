<script setup lang="ts">
import { useLivePreview } from "@payloadcms/live-preview-vue";

import type { PayloadEvent, PayloadEventList } from "../types/events";

// What the events route (plugins/events.ts) hands to the core's catch-all page to draw: the list (upcoming or past, any page), one
// event, or the page a "give my place back" link opens. It also owns the page's head tags and, for an event, the page's single Live
// Preview call (the live-preview package keeps one cache per page, so the core page doesn't make a second one when a plugin owns
// the address).
const props = defineProps<{
  view: "event" | "list" | "cancel";
  section: string;
  label: string;
  siteName: string;
  event?: PayloadEvent;
  list?: PayloadEventList;
  past?: boolean;
}>();

const t = useT();
const config = useRuntimeConfig();

const liveEvent =
  props.view === "event"
    ? useLivePreview<PayloadEvent>({ initialData: props.event ?? ({} as PayloadEvent), serverURL: config.public.cmsServerUrl, depth: 1 }).data
    : ref<PayloadEvent | undefined>();

if (props.view === "event") {
  useEventSeoMeta(liveEvent, { siteName: props.siteName, section: props.section });
} else if (props.view === "cancel") {
  useSeoMeta({ title: t("events.cancel.title", "Give your place back"), robots: "noindex" });
} else {
  const heading = props.past ? t("events.past", "Past events") : props.label;
  useSeoMeta({ title: heading, ogTitle: heading });
}
</script>

<template>
  <EventDetail v-if="view === 'event' && liveEvent?.title" :event="liveEvent" :section="section" :section-label="label" />
  <EventsListing v-else-if="view === 'list' && list" :heading="past ? t('events.past', 'Past events') : label" :section="section" :events="list.docs" :page="list.page" :total-pages="list.totalPages" :past="Boolean(past)" />
  <EventCancel v-else-if="view === 'cancel'" :section="section" :section-label="label" />
</template>
