<script setup lang="ts">
import { availabilityText } from "../utils/eventFormat";

// The RSVP form on an event page. All behaviour is in useEventRsvp; this only draws it. It carries `poly-event-rsvp*` class names so a
// theme can restyle it. The form appears after the page loads (it needs a fresh token and the places left), so server-rendered HTML
// holds only the heading.
const t = useT();
const props = defineProps<{ eventId: string | number }>();
const rsvp = useEventRsvp(() => props.eventId);
const guestOptions = computed(() => Array.from({ length: rsvp.definition?.form.maxGuests ?? 1 }, (_, i) => i + 1));
const fieldError = (name: string) => rsvp.errors[name];
const ids = { name: useId(), email: useId(), phone: useId(), guests: useId(), trap: useId(), consent: useId() };
</script>

<template>
  <section class="poly-event-rsvp rounded-lg border border-neutral-200 p-5" aria-labelledby="poly-event-rsvp-heading">
    <h2 id="poly-event-rsvp-heading" class="text-xl font-semibold">{{ t("events.rsvp.heading", "Register") }}</h2>

    <p v-if="rsvp.loadFailed" class="poly-event-rsvp-error mt-3 text-red-700" role="alert">{{ t("events.rsvp.loadFailed", "Registration isn't available right now. Please try again later.") }}</p>

    <template v-else-if="rsvp.definition">
      <p v-if="availabilityText(rsvp.definition.availability, t)" class="poly-event-rsvp-places mt-2 text-sm font-medium" aria-live="polite">{{ availabilityText(rsvp.definition.availability, t) }}</p>

      <div v-if="rsvp.done" class="poly-event-rsvp-done mt-4" role="status">
        <p class="text-lg font-semibold">{{ rsvp.done.status === "waitlisted" ? t("events.rsvp.onWaitlist", "You're on the waiting list") : t("events.rsvp.registered", "You're registered") }}</p>
        <p class="mt-1">{{ rsvp.done.message }}</p>
        <p v-if="rsvp.done.calendar" class="poly-event-rsvp-calendar mt-4 flex flex-wrap gap-3 text-sm">
          <a v-if="rsvp.done.icsUrl" :href="rsvp.done.icsUrl" class="underline">{{ t("events.rsvp.addCalendar", "Add to calendar") }}</a>
          <a v-if="rsvp.done.calendar.google" :href="rsvp.done.calendar.google" target="_blank" rel="noopener noreferrer" class="underline">Google</a>
          <a v-if="rsvp.done.calendar.outlook" :href="rsvp.done.calendar.outlook" target="_blank" rel="noopener noreferrer" class="underline">Outlook</a>
        </p>
      </div>

      <form v-else-if="rsvp.open" class="poly-event-rsvp-form mt-4 grid gap-4" novalidate @submit.prevent="rsvp.submit()">
        <div>
          <label :for="ids.name" class="block text-sm font-medium">
            {{ t("events.rsvp.name", "Your name") }}
            <input :id="ids.name" v-model="rsvp.values.name" type="text" autocomplete="name" required maxlength="120" class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 font-normal" :aria-invalid="Boolean(fieldError('name'))">
          </label>
          <p v-if="fieldError('name')" class="mt-1 text-sm text-red-700">{{ fieldError("name") }}</p>
        </div>
        <div>
          <label :for="ids.email" class="block text-sm font-medium">
            {{ t("events.rsvp.email", "Email") }}
            <input :id="ids.email" v-model="rsvp.values.email" type="email" autocomplete="email" required maxlength="254" class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 font-normal" :aria-invalid="Boolean(fieldError('email'))">
          </label>
          <p v-if="fieldError('email')" class="mt-1 text-sm text-red-700">{{ fieldError("email") }}</p>
        </div>
        <div v-if="rsvp.definition.form.askPhone">
          <label :for="ids.phone" class="block text-sm font-medium">
            {{ t("events.rsvp.phone", "Phone") }}<span v-if="!rsvp.definition.form.phoneRequired" class="font-normal text-neutral-500"> ({{ t("events.rsvp.optional", "optional") }})</span>
            <input :id="ids.phone" v-model="rsvp.values.phone" type="tel" autocomplete="tel" maxlength="40" class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 font-normal" :aria-invalid="Boolean(fieldError('phone'))">
          </label>
          <p v-if="fieldError('phone')" class="mt-1 text-sm text-red-700">{{ fieldError("phone") }}</p>
        </div>
        <div v-if="rsvp.definition.form.maxGuests > 1">
          <label :for="ids.guests" class="block text-sm font-medium">
            {{ t("events.rsvp.guests", "How many people (including you)") }}
            <select :id="ids.guests" v-model.number="rsvp.values.guests" class="mt-1 block rounded border border-neutral-300 px-3 py-2 font-normal">
              <option v-for="n in guestOptions" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
          <p v-if="fieldError('guests')" class="mt-1 text-sm text-red-700">{{ fieldError("guests") }}</p>
        </div>
        <!-- A trap for robots: a person never sees it. -->
        <div aria-hidden="true" style="position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden">
          <label :for="ids.trap">Leave this field empty<input :id="ids.trap" v-model="rsvp.honeypot" type="text" :name="rsvp.definition.honeypot" tabindex="-1" autocomplete="off"></label>
        </div>
        <div v-if="rsvp.definition.form.consentLabel">
          <label :for="ids.consent" class="flex items-start gap-2 text-sm">
            <input :id="ids.consent" v-model="rsvp.consent" type="checkbox" class="mt-1" :aria-invalid="Boolean(fieldError('consent'))">
            <span>{{ rsvp.definition.form.consentLabel }}<template v-if="rsvp.definition.form.policyUrl"> (<a :href="rsvp.definition.form.policyUrl" class="underline">{{ t("events.rsvp.privacy", "privacy policy") }}</a>)</template></span>
          </label>
          <p v-if="fieldError('consent')" class="mt-1 text-sm text-red-700">{{ fieldError("consent") }}</p>
        </div>
        <p v-if="rsvp.message" class="poly-event-rsvp-error text-red-700" role="alert">{{ rsvp.message }}</p>
        <div>
          <button type="submit" :disabled="rsvp.submitting" class="poly-event-rsvp-submit rounded bg-neutral-900 px-5 py-2 font-semibold text-white disabled:opacity-60">
            {{ rsvp.submitting ? t("events.rsvp.sending", "Sending...") : rsvp.definition.availability.state === "waitlist" ? t("events.rsvp.joinWaitlist", "Join the waiting list") : rsvp.definition.form.submitLabel }}
          </button>
        </div>
      </form>
    </template>
  </section>
</template>
