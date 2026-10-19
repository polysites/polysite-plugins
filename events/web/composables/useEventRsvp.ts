import type { RsvpDefinition } from "../types/events";
import { canRegister, safeRedirect } from "../utils/eventFormat";

// The logic behind the RSVP form, kept out of the visual component so a theme can style it however it likes and still get the same
// behaviour: load the form's settings and the places left from the CMS, check the answers, send them, and show what the CMS says
// back. See plugins/events/src/endpoints.js for the other half.
//
// The form is fetched in the browser, after the page loads, not baked into the cached page: the places left are always current and
// the signed spam-protection token it comes with is only worth anything fresh.

type Done = { status: "confirmed" | "waitlisted"; message: string; duplicate: boolean; calendar: { google?: string; outlook?: string } | null; icsUrl: string | null };

export function useEventRsvp(eventId: () => string | number) {
  const api = useRuntimeConfig().public.apiBase as string;
  const t = useT();

  const definition = shallowRef<RsvpDefinition | null>(null);
  const values = reactive({ name: "", email: "", phone: "", guests: 1 });
  const honeypot = ref("");
  const consent = ref(false);
  const errors = ref<Record<string, string>>({});
  const message = ref("");
  const loadFailed = ref(false);
  const submitting = ref(false);
  const done = ref<Done | null>(null);

  async function load() {
    try {
      definition.value = await $fetch<RsvpDefinition>(`${api}/event-intake/${eventId()}`);
      if (values.guests > definition.value.form.maxGuests) values.guests = 1;
    } catch {
      loadFailed.value = true;
    }
  }

  // Browser only: during server rendering there is no form, just the event.
  onMounted(load);

  async function submit() {
    const def = definition.value;
    if (!def || submitting.value) return;
    submitting.value = true;
    errors.value = {};
    message.value = "";
    try {
      const res = await $fetch<{ ok: boolean; status: "confirmed" | "waitlisted"; message: string; duplicate: boolean; redirect: string | null; calendar: Done["calendar"]; icsUrl: string | null }>(`${api}/event-intake/${def.event.id}`, {
        method: "POST",
        body: { data: { name: values.name, email: values.email, phone: values.phone, guests: values.guests, [def.honeypot]: honeypot.value }, consent: consent.value, token: def.token },
      });
      // Tells any plugin that listens (analytics, say) that an RSVP was sent: the event's id only, never what was typed.
      emitSiteEvent({ name: "event_rsvp", eventId: def.event.id });
      const target = safeRedirect(res.redirect);
      if (target) {
        await navigateTo(target.to, { external: target.external });
        return;
      }
      done.value = { status: res.status, message: res.message, duplicate: res.duplicate, calendar: res.calendar, icsUrl: res.icsUrl };
      // The places left have changed: show the new number (the token is kept as it was; the form is done).
      void $fetch<RsvpDefinition>(`${api}/event-intake/${def.event.id}`).then((fresh) => (definition.value = { ...fresh, token: def.token })).catch(() => {});
    } catch (err) {
      const e = err as { data?: { message?: string; errors?: Record<string, string>; code?: string }; statusCode?: number };
      errors.value = e.data?.errors ?? {};
      message.value = e.data?.message ?? t("events.error", "Something went wrong. Please try again.");
      // A refused submission may have used up its token (too fast, expired), or the event filled up meanwhile: get fresh settings.
      if (!e.data?.errors) await load();
    } finally {
      submitting.value = false;
    }
  }

  const open = computed(() => canRegister(definition.value?.availability));
  // reactive(): a component receiving this as a prop reads plain values, no `.value`.
  return reactive({ definition, values, honeypot, consent, errors, message, loadFailed, submitting, done, open, submit });
}
