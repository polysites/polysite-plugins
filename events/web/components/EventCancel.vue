<script setup lang="ts">
import { listHref } from "../utils/eventsRoute";

// The page a "give my place back" link in a confirmation email opens. It says which event the link is for and asks first, because an
// email scanner that opens links must not cancel anyone's place. It shows the event and the size of the party, never a name or address.
const t = useT();
const localePath = useLocalePath();
const route = useRoute();
const api = useRuntimeConfig().public.apiBase as string;
const props = defineProps<{ section: string; sectionLabel: string }>();

const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const info = ref<{ status: string; guests: number; event: { title: string; when: string } } | null>(null);
const state = ref<"loading" | "ask" | "done" | "invalid" | "failed">("loading");
const busy = ref(false);

onMounted(async () => {
  if (!token.value) {
    state.value = "invalid";
    return;
  }
  try {
    info.value = await $fetch(`${api}/event-cancel`, { query: { token: token.value } });
    state.value = info.value?.status === "cancelled" ? "done" : "ask";
  } catch {
    state.value = "invalid";
  }
});

async function cancel() {
  busy.value = true;
  try {
    await $fetch(`${api}/event-cancel`, { method: "POST", body: { token: token.value } });
    state.value = "done";
  } catch {
    state.value = "failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="poly-event-cancel mx-auto max-w-xl px-4 py-12 sm:px-8">
    <h1 class="text-2xl font-bold">{{ t("events.cancel.title", "Give your place back") }}</h1>

    <p v-if="state === 'loading'" class="mt-4 text-neutral-600">{{ t("events.cancel.loading", "One moment...") }}</p>

    <div v-else-if="state === 'ask' && info" class="mt-4">
      <p>{{ t("events.cancel.ask", "Do you want to give up your place at {title}?", { title: info.event.title }) }}</p>
      <p v-if="info.event.when" class="mt-1 text-neutral-600">{{ info.event.when }}</p>
      <p v-if="info.guests > 1" class="mt-1 text-neutral-600">{{ t("events.cancel.party", "This is for {count} people.", { count: info.guests }) }}</p>
      <button type="button" :disabled="busy" class="poly-event-cancel-button mt-5 rounded bg-neutral-900 px-5 py-2 font-semibold text-white disabled:opacity-60" @click="cancel">
        {{ busy ? t("events.cancel.working", "Working...") : t("events.cancel.confirm", "Yes, give my place back") }}
      </button>
    </div>

    <p v-else-if="state === 'done'" class="mt-4" role="status">{{ t("events.cancel.done", "Your place has been given back. Thank you for letting us know.") }}</p>
    <p v-else-if="state === 'failed'" class="mt-4 text-red-700" role="alert">{{ t("events.cancel.failed", "Something went wrong. Please try again.") }}</p>
    <p v-else class="mt-4 text-red-700" role="alert">{{ t("events.cancel.invalid", "This link isn't valid any more.") }}</p>

    <p class="mt-8"><NuxtLink :to="localePath(listHref(props.section))" class="underline">&larr; {{ sectionLabel }}</NuxtLink></p>
  </section>
</template>
