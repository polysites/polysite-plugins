<script setup lang="ts">
import { formatMoney } from "../composables/useEventTickets";
import { availabilityText } from "../utils/eventFormat";

// Buying tickets on an event page. All behaviour is in useEventTickets; this only draws it. It carries `poly-event-tickets*` class
// names so a theme can restyle it. The payment itself happens on the payment provider's own page, shown in a frame below: the card
// number is typed there and never reaches this site.
const t = useT();
const props = defineProps<{ eventId: string | number }>();
const frameEl = ref<HTMLIFrameElement | null>(null);
const tickets = useEventTickets(() => props.eventId, () => frameEl.value);
const money = (cents: number) => formatMoney(cents, tickets.offer?.currency ?? "CAD");
const ids = { name: useId(), email: useId(), phone: useId(), trap: useId(), consent: useId(), qty: useId() };
const fieldError = (name: string) => tickets.errors[name];
const steps = ["choose", "details", "pay"] as const;
const stepNumber = computed(() => steps.indexOf(tickets.step as (typeof steps)[number]) + 1);
</script>

<template>
  <section class="poly-event-tickets rounded-lg border border-neutral-200 p-5" aria-labelledby="poly-event-tickets-heading">
    <h2 id="poly-event-tickets-heading" class="text-xl font-semibold">{{ t("events.tickets.heading", "Tickets") }}</h2>

    <p v-if="tickets.loadFailed" class="mt-3 text-red-700" role="alert">{{ t("events.tickets.loadFailed", "Tickets aren't available right now. Please try again later.") }}</p>

    <template v-else-if="tickets.definition && tickets.offer">
      <p v-if="availabilityText(tickets.definition.availability, t)" class="mt-2 text-sm font-medium" aria-live="polite">{{ availabilityText(tickets.definition.availability, t) }}</p>
      <p v-if="!tickets.offer.available" class="mt-3 text-neutral-700" role="status">{{ t("events.tickets.unavailable", "Ticket sales aren't open yet. Please check back soon.") }}</p>
      <p v-else-if="tickets.definition.availability.state === 'closed' || tickets.definition.availability.state === 'upcoming'" class="mt-3 text-neutral-700" role="status">{{ availabilityText(tickets.definition.availability, t) }}</p>
      <p v-else-if="tickets.definition.availability.state === 'full' || tickets.definition.availability.state === 'waitlist'" class="mt-3 text-neutral-700" role="status">{{ t("events.tickets.soldOut", "Sorry, this event is sold out.") }}</p>

      <template v-else>
        <p v-if="['choose', 'details', 'pay'].includes(tickets.step)" class="poly-event-tickets-steps mt-1 text-sm text-neutral-500">{{ t("events.tickets.step", "Step {n} of 3", { n: stepNumber }) }}</p>

        <!-- 1: choose -->
        <form v-if="tickets.step === 'choose'" class="mt-4 grid gap-4" novalidate @submit.prevent="tickets.goToDetails()">
          <ul class="poly-event-tickets-list grid gap-3">
            <li v-for="item in tickets.offer.items" :key="item.code" class="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 p-3">
              <div class="min-w-0">
                <p class="font-medium">{{ item.label }}</p>
                <p v-if="item.description" class="text-sm text-neutral-600">{{ item.description }}</p>
                <p class="text-sm">{{ item.priceCents === 0 ? t("events.tickets.free", "Free") : money(item.priceCents) }}</p>
              </div>
              <label :for="`${ids.qty}-${item.code}`" class="flex items-center gap-2 text-sm">
                {{ t("events.tickets.quantity", "Quantity") }}
                <input :id="`${ids.qty}-${item.code}`" :value="tickets.quantities[item.code] ?? 0" type="number" min="0" :max="item.maxPerOrder" inputmode="numeric" class="w-20 rounded border border-neutral-300 px-2 py-1" @input="tickets.setQuantity(item.code, item.maxPerOrder, Number(($event.target as HTMLInputElement).value))">
              </label>
            </li>
          </ul>
          <p class="poly-event-tickets-total text-lg font-semibold" aria-live="polite">{{ t("events.tickets.total", "Total: {amount}", { amount: money(tickets.totalCents) }) }}</p>
          <p v-if="tickets.message" class="text-red-700" role="alert">{{ tickets.message }}</p>
          <div><button type="submit" class="poly-event-tickets-next rounded bg-neutral-900 px-5 py-2 font-semibold text-white">{{ t("events.tickets.continue", "Continue") }}</button></div>
        </form>

        <!-- 2: details -->
        <form v-else-if="tickets.step === 'details'" class="mt-4 grid gap-4" novalidate @submit.prevent="tickets.startOrder()">
          <ul class="poly-event-tickets-summary rounded bg-neutral-50 p-3 text-sm">
            <li v-for="c in tickets.chosen" :key="c.code" class="flex justify-between gap-3"><span>{{ c.quantity }} &times; {{ c.label }}</span><span>{{ money(c.lineCents) }}</span></li>
            <li class="mt-1 flex justify-between gap-3 font-semibold"><span>{{ t("events.tickets.totalLabel", "Total") }}</span><span>{{ money(tickets.totalCents) }}</span></li>
          </ul>
          <div>
            <label :for="ids.name" class="block text-sm font-medium">
              {{ t("events.rsvp.name", "Your name") }}
              <input :id="ids.name" v-model="tickets.values.name" type="text" autocomplete="name" required maxlength="120" class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 font-normal" :aria-invalid="Boolean(fieldError('name'))">
            </label>
            <p v-if="fieldError('name')" class="mt-1 text-sm text-red-700">{{ fieldError("name") }}</p>
          </div>
          <div>
            <label :for="ids.email" class="block text-sm font-medium">
              {{ t("events.rsvp.email", "Email") }}
              <input :id="ids.email" v-model="tickets.values.email" type="email" autocomplete="email" required maxlength="254" class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 font-normal" :aria-invalid="Boolean(fieldError('email'))">
            </label>
            <p v-if="fieldError('email')" class="mt-1 text-sm text-red-700">{{ fieldError("email") }}</p>
          </div>
          <div v-if="tickets.definition.form.askPhone">
            <label :for="ids.phone" class="block text-sm font-medium">
              {{ t("events.rsvp.phone", "Phone") }}<span v-if="!tickets.definition.form.phoneRequired" class="font-normal text-neutral-500"> ({{ t("events.rsvp.optional", "optional") }})</span>
              <input :id="ids.phone" v-model="tickets.values.phone" type="tel" autocomplete="tel" maxlength="40" class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 font-normal" :aria-invalid="Boolean(fieldError('phone'))">
            </label>
            <p v-if="fieldError('phone')" class="mt-1 text-sm text-red-700">{{ fieldError("phone") }}</p>
          </div>
          <!-- A trap for robots: a person never sees it. -->
          <div aria-hidden="true" style="position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden">
            <label :for="ids.trap">Leave this field empty<input :id="ids.trap" v-model="tickets.honeypot" type="text" :name="tickets.definition.honeypot" tabindex="-1" autocomplete="off"></label>
          </div>
          <div v-if="tickets.definition.form.consentLabel">
            <label :for="ids.consent" class="flex items-start gap-2 text-sm">
              <input :id="ids.consent" v-model="tickets.consent" type="checkbox" class="mt-1" :aria-invalid="Boolean(fieldError('consent'))">
              <span>{{ tickets.definition.form.consentLabel }}<template v-if="tickets.definition.form.policyUrl"> (<a :href="tickets.definition.form.policyUrl" class="underline">{{ t("events.rsvp.privacy", "privacy policy") }}</a>)</template></span>
            </label>
            <p v-if="fieldError('consent')" class="mt-1 text-sm text-red-700">{{ fieldError("consent") }}</p>
          </div>
          <p v-if="tickets.message" class="text-red-700" role="alert">{{ tickets.message }}</p>
          <div class="flex flex-wrap gap-3">
            <button type="button" class="rounded border border-neutral-300 px-4 py-2" @click="tickets.step = 'choose'">{{ t("events.tickets.back", "Back") }}</button>
            <button type="submit" :disabled="tickets.busy" class="poly-event-tickets-next rounded bg-neutral-900 px-5 py-2 font-semibold text-white disabled:opacity-60">{{ tickets.busy ? t("events.rsvp.sending", "Sending...") : t("events.tickets.toPayment", "Continue to payment") }}</button>
          </div>
        </form>

        <!-- 3: pay, on the provider's own page -->
        <div v-else-if="tickets.step === 'pay' && tickets.order" class="mt-4 grid gap-4">
          <p class="text-sm">{{ t("events.tickets.holding", "Your places are held while you pay. Total: {amount}.", { amount: money(tickets.order.totalCents) }) }}</p>
          <iframe
            ref="frameEl"
            :src="tickets.order.checkout.checkoutUrl"
            :title="t('events.tickets.paymentFrame', 'Secure payment')"
            class="poly-event-tickets-frame w-full rounded border border-neutral-200"
            :style="{ height: `${tickets.frameHeight}px` }"
            referrerpolicy="strict-origin"
            @load="tickets.onFrameLoad()"
          />
          <p v-if="tickets.message" class="text-red-700" role="alert">{{ tickets.message }}</p>
          <div class="flex flex-wrap gap-3">
            <button type="button" class="rounded border border-neutral-300 px-4 py-2" :disabled="tickets.paying" @click="tickets.backToDetails()">{{ t("events.tickets.back", "Back") }}</button>
            <button type="button" :disabled="tickets.paying" class="poly-event-tickets-pay rounded bg-neutral-900 px-5 py-2 font-semibold text-white disabled:opacity-60" @click="tickets.pay()">
              {{ tickets.paying ? t("events.tickets.paying", "Paying...") : t("events.tickets.pay", "Pay {amount}", { amount: money(tickets.order.totalCents) }) }}
            </button>
          </div>
          <p class="text-xs text-neutral-500">{{ t("events.tickets.secure", "Your card details are typed on the payment provider's page. This site never sees them.") }}</p>
        </div>

        <!-- done -->
        <div v-else-if="tickets.step === 'done'" class="poly-event-tickets-done mt-4" role="status">
          <p class="text-lg font-semibold">{{ t("events.tickets.thanks", "Thank you. You're going!") }}</p>
          <p class="mt-1">{{ t("events.tickets.emailSent", "A confirmation with your tickets is on its way to your email.") }}</p>
          <p v-if="tickets.order" class="mt-1 text-sm text-neutral-600">{{ t("events.tickets.reference", "Your reference: {reference}", { reference: tickets.order.reference }) }}</p>
        </div>

        <!-- reported / problem -->
        <div v-else class="mt-4" :role="tickets.step === 'problem' ? 'alert' : 'status'">
          <p :class="tickets.step === 'problem' ? 'text-red-700' : ''">{{ tickets.resultMessage }}</p>
          <p v-if="tickets.order" class="mt-1 text-sm text-neutral-600">{{ t("events.tickets.reference", "Your reference: {reference}", { reference: tickets.order.reference }) }}</p>
        </div>
      </template>
    </template>
  </section>
</template>
