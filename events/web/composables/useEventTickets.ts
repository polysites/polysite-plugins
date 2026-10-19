import type { EventAvailability } from "../types/events";
import { safeRedirect } from "../utils/eventFormat";

// The logic behind buying tickets, kept out of the visual component so a theme can style it however it likes and still get the same
// behaviour. See plugins/events/src/orderEndpoints.js for the other half.
//
// The steps: choose tickets, give details, pay. The server prices the order itself (this page only says which tickets and how many)
// and holds the places while the buyer pays. Paying happens on the payment provider's own page, shown in a frame: the card is typed
// there and never reaches Polysite. This page and that frame talk with window messages, and this page listens ONLY to the frame it
// opened, and only when the message comes from the origin the server named. When the frame says the payment went through, the server
// is told and asks the provider itself; this page never decides whether anyone has paid.

export interface TicketOffer {
  items: Array<{ code: string; label: string; description: string; priceCents: number; sponsorship: boolean; maxPerOrder: number }>;
  available: boolean;
  currency: string;
}

interface TicketDefinition {
  event: { id: number | string; title: string };
  availability: EventAvailability;
  form: { askPhone: boolean; phoneRequired: boolean; consentLabel: string | null; policyUrl: string };
  honeypot: string;
  token: string;
  tickets: TicketOffer | null;
}

export interface Checkout {
  checkoutUrl: string;
  origin: string;
  amount: string;
  autofill: Record<string, unknown>;
  messages: { autofill: string; submit: string; success: string; errors: string; resize: string };
}

type Step = "choose" | "details" | "pay" | "done" | "reported" | "problem";

export function formatMoney(cents: number, currency = "CAD", locale = "en-CA"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function useEventTickets(eventId: () => string | number, getFrame: () => HTMLIFrameElement | null | undefined) {
  const api = useRuntimeConfig().public.apiBase as string;
  const t = useT();

  const definition = shallowRef<TicketDefinition | null>(null);
  const quantities = reactive<Record<string, number>>({});
  const values = reactive({ name: "", email: "", phone: "" });
  const honeypot = ref("");
  const consent = ref(false);
  const errors = ref<Record<string, string>>({});
  const message = ref("");
  const loadFailed = ref(false);
  const step = ref<Step>("choose");
  const busy = ref(false);
  const order = shallowRef<{ reference: string; totalCents: number; currency: string; holdExpiresAt: string; checkout: Checkout } | null>(null);
  const resultMessage = ref("");
  const paying = ref(false);
  const frameHeight = ref(520);

  async function load() {
    try {
      definition.value = await $fetch<TicketDefinition>(`${api}/event-intake/${eventId()}`);
    } catch {
      loadFailed.value = true;
    }
  }
  onMounted(load);

  const offer = computed(() => definition.value?.tickets ?? null);
  const units = computed(() => Object.values(quantities).reduce((n, q) => n + (Number.isInteger(q) && q > 0 ? q : 0), 0));
  const totalCents = computed(() => (offer.value?.items ?? []).reduce((n, item) => n + item.priceCents * (quantities[item.code] > 0 ? quantities[item.code]! : 0), 0));
  const attendees = computed(() => (offer.value?.items ?? []).reduce((n, item) => n + (item.sponsorship ? 0 : quantities[item.code] > 0 ? quantities[item.code]! : 0), 0));
  const chosen = computed(() => (offer.value?.items ?? []).filter((item) => quantities[item.code]! > 0).map((item) => ({ ...item, quantity: quantities[item.code]!, lineCents: item.priceCents * quantities[item.code]! })));

  function setQuantity(code: string, max: number, quantity: number) {
    const n = Math.max(0, Math.min(Number.isFinite(quantity) ? Math.floor(quantity) : 0, max));
    quantities[code] = n;
  }

  function goToDetails() {
    errors.value = {};
    message.value = "";
    if (units.value < 1) {
      message.value = t("events.tickets.chooseOne", "Choose at least one ticket.");
      return;
    }
    if (attendees.value < 1) {
      message.value = t("events.tickets.needPerson", "Choose at least one ticket for a person who is coming.");
      return;
    }
    step.value = "details";
  }

  async function startOrder() {
    const def = definition.value;
    if (!def || busy.value) return;
    busy.value = true;
    errors.value = {};
    message.value = "";
    try {
      const res = await $fetch<{ reference: string; totalCents: number; currency: string; holdExpiresAt: string; checkout: Checkout }>(`${api}/event-order/${def.event.id}`, {
        method: "POST",
        body: {
          items: chosen.value.map((c) => ({ code: c.code, quantity: c.quantity })),
          data: { name: values.name, email: values.email, phone: values.phone, [def.honeypot]: honeypot.value },
          consent: consent.value,
          token: def.token,
        },
      });
      order.value = res;
      step.value = "pay";
    } catch (err) {
      const e = err as { data?: { message?: string; errors?: Record<string, string>; code?: string } };
      errors.value = e.data?.errors ?? {};
      message.value = e.data?.message ?? t("events.error", "Something went wrong. Please try again.");
      // Back to the tickets when the places went (sold out, a ticket removed); a refused token needs fresh settings.
      if (e.data?.code === "full" || e.data?.code === "closed") step.value = "choose";
      if (!e.data?.errors) await load();
    } finally {
      busy.value = false;
    }
  }

  function send(type: string, data: unknown) {
    const checkout = order.value?.checkout;
    const target = getFrame()?.contentWindow;
    // Always to the one origin the server named, never "*": the message holds the buyer's name and email.
    if (checkout && target) target.postMessage(JSON.stringify({ [type]: data }), checkout.origin);
  }

  /** Called when the frame has loaded: fill in the person and the amount. The frame's own script may start a moment after load. */
  function onFrameLoad() {
    const checkout = order.value?.checkout;
    if (!checkout) return;
    send(checkout.messages.autofill, checkout.autofill);
    setTimeout(() => send(checkout.messages.autofill, checkout.autofill), 600);
  }

  function pay() {
    const checkout = order.value?.checkout;
    if (!checkout || paying.value) return;
    paying.value = true;
    message.value = "";
    send(checkout.messages.submit, { verify_amount: checkout.amount });
  }

  async function complete(transaction: unknown) {
    const current = order.value;
    if (!current) return;
    try {
      const res = await $fetch<{ ok: boolean; status: string; message?: string; redirect?: string | null }>(`${api}/event-order-complete`, { method: "POST", body: { reference: current.reference, transaction } });
      resultMessage.value = res.message ?? "";
      step.value = res.status === "paid" ? "done" : "reported";
      if (res.status === "paid") {
        emitSiteEvent({ name: "event_ticket_purchase", eventId: eventId() });
        const target = safeRedirect(res.redirect);
        if (target) await navigateTo(target.to, { external: target.external });
      }
    } catch (err) {
      const e = err as { data?: { message?: string } };
      resultMessage.value = e.data?.message ?? t("events.tickets.problem", "We couldn't confirm your payment. Your places are held for now; please contact the organizers with your reference.");
      step.value = "problem";
    } finally {
      paying.value = false;
    }
  }


  function onMessage(event: MessageEvent) {
    const current = order.value;
    if (!current || step.value !== "pay") return;
    // Only the frame this page opened, and only from the origin the server named.
    if (event.origin !== current.checkout.origin || event.source !== getFrame()?.contentWindow) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    const { messages } = current.checkout;
    if (messages.resize in data) {
      const height = Number((data[messages.resize] as { height?: number })?.height);
      if (Number.isFinite(height)) frameHeight.value = Math.max(320, Math.min(Math.round(height) + 8, 1400));
    }
    if (messages.errors in data) {
      paying.value = false;
      message.value = t("events.tickets.declined", "The payment didn't go through. Please check the details and try again.");
    }
    if (messages.success in data) {
      const payload = data[messages.success] as { transaction_success_data?: unknown } | undefined;
      void complete(payload?.transaction_success_data ?? payload);
    }
  }
  onMounted(() => window.addEventListener("message", onMessage));
  onBeforeUnmount(() => window.removeEventListener("message", onMessage));

  function backToDetails() {
    step.value = "details";
    order.value = null;
    paying.value = false;
  }

  return reactive({ definition, offer, quantities, values, honeypot, consent, errors, message, loadFailed, step, busy, order, resultMessage, paying, frameHeight, units, totalCents, attendees, chosen, setQuantity, goToDetails, startOrder, onFrameLoad, pay, backToDetails });
}
