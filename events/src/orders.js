import { applyDelta, claimConfirmed, readStats } from "./db.js";
import { buildMessage, sendMessage } from "./mail.js";
import { availability } from "./rsvp.js";
import { availabilityOf, forgetAvailability, linksFor, promoteWaitlist, settingsFor } from "./service.js";
import { dedupeKey } from "./spam.js";
import { holdExpiry, newReference, priceOrder, ticketCsv } from "./tickets.js";
import { SLUGS } from "./slugs.js";

// Paid tickets. The events plugin owns the tickets, the order and the places; WHO takes the money is another plugin's business. A
// payment provider (a separate plugin: none ships with this one) registers itself in `config.custom.polysitePayments[id]`, an object with
//
//   id, label, kind: "hosted-iframe"
//   begin({ payload, order, event, site, settings })   -> { checkoutUrl, origin, amount, autofill, customFields, messages? }
//   verify({ payload, order, transaction })            -> { status: "verified" | "unverified" | "mismatch", providerRef, detail }
//
// This plugin never sees a card number: the visitor pays on the provider's own page. And it never believes the browser about
// whether they paid: `verify` asks the provider's server. The places are held while the visitor pays and let go if they never do.

const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const MAX_PENDING_PER_EMAIL = 3;
const RETRY_MS = Number.parseInt(process.env.EVENTS_RETRY_MS ?? "", 10) || 60_000;

export const providersOf = (payload) => payload.config?.custom?.polysitePayments ?? {};

/** The provider that sells this site's tickets: the one the site's Event settings name, or the only one installed. */
export function providerFor(payload, settings) {
  const all = providersOf(payload);
  const named = settings?.paymentProvider?.trim();
  if (named) return all[named] ? all[named] : null;
  const ids = Object.keys(all);
  return ids.length === 1 ? all[ids[0]] : null;
}

const orderOf = async (payload, reference) => {
  if (typeof reference !== "string" || !/^[A-Z0-9]{12}$/.test(reference)) return null;
  const found = await payload.find({ collection: SLUGS.orders, where: { reference: { equals: reference } }, limit: 1, depth: 0, overrideAccess: true });
  return found.docs[0] ?? null;
};
export { orderOf };

/** Gives back the places an RSVP held. The RSVP's own save hook moves the waiting list up. */
async function releaseRsvp(payload, rsvpId, reason) {
  if (rsvpId == null) return;
  await payload.update({ collection: SLUGS.rsvps, id: rsvpId, data: { status: "cancelled", notes: reason }, overrideAccess: true }).catch((err) => console.error("[events] could not release an order's places:", err?.message ?? err));
}

/**
 * Starts an order: checks the event can sell, prices the tickets, holds the places, and asks the provider for its checkout.
 * Resolves { ok: true, order, checkout } or { ok: false, reason, message, status } with nothing held.
 */
export async function createOrder({ payload, event, site, requested, person, consentStatement, consent }) {
  const settings = await settingsFor(payload, idOf(event.site));
  const provider = providerFor(payload, settings);
  if (!provider) return { ok: false, reason: "no-payments", status: 503, message: "Ticket sales aren't available right now." };

  const priced = priceOrder(event, requested);
  if (!priced.ok) return { ok: false, reason: "invalid", status: 400, message: priced.error };
  const { items, totals } = priced;
  if (totals.attendeeUnits < 1) return { ok: false, reason: "invalid", status: 400, message: "Choose at least one ticket for a person who is coming." };
  if (totals.totalCents <= 0) return { ok: false, reason: "invalid", status: 400, message: "These tickets are free: use the RSVP form." };

  const state = availability(event, await readStats(payload, event.id));
  if (state.state === "closed" || state.state === "upcoming") return { ok: false, reason: "closed", status: 409, message: "Tickets for this event aren't on sale." };
  // A waiting list is for people who are not paying yet; a ticket is sold only while a place is free.
  if (state.spotsLeft !== null && totals.attendeeUnits > state.spotsLeft) {
    return { ok: false, reason: "full", status: 409, message: state.spotsLeft === 0 ? "Sorry, this event is sold out." : `Only ${state.spotsLeft} ${state.spotsLeft === 1 ? "place is" : "places are"} left.` };
  }

  const key = dedupeKey(event.id, person.email);
  const existing = await payload.find({ collection: SLUGS.rsvps, where: { and: [{ event: { equals: event.id } }, { dedupeKey: { equals: key } }] }, limit: 1, depth: 0, overrideAccess: true });
  const earlier = existing.docs[0];
  if (earlier && earlier.status !== "pending_payment") return { ok: false, reason: "already", status: 409, message: "This email address already has a place at this event." };
  if (earlier?.status === "pending_payment") {
    // They came back before the hold ran out: let the first attempt go and start again, so they never hold two sets of places.
    const pending = await payload.find({ collection: SLUGS.orders, where: { and: [{ rsvp: { equals: earlier.id } }, { status: { equals: "pending" } }] }, limit: 10, depth: 0, overrideAccess: true });
    if (pending.totalDocs >= MAX_PENDING_PER_EMAIL) return { ok: false, reason: "too-many", status: 429, message: "Please finish or wait for your earlier attempts to expire, then try again." };
    for (const o of pending.docs) await payload.update({ collection: SLUGS.orders, id: o.id, data: { status: "expired", note: "Replaced by a new attempt." }, overrideAccess: true });
    await releaseRsvp(payload, earlier.id, "Replaced by a new attempt.");
  }

  if (!(await claimConfirmed(payload, event.id, totals.attendeeUnits, state.capacity))) {
    return { ok: false, reason: "full", status: 409, message: "Sorry, those places were just taken." };
  }
  const release = () => applyDelta(payload, event.id, { confirmed: -totals.attendeeUnits });
  let rsvp;
  try {
    rsvp = await payload.create({
      collection: SLUGS.rsvps,
      data: { event: event.id, site: idOf(event.site), name: person.name, email: person.email, phone: person.phone, guests: totals.attendeeUnits, status: "pending_payment", dedupeKey: key, consent: { given: Boolean(consent), statement: consentStatement ?? null } },
      overrideAccess: true,
      context: { eventsClaimed: true },
    });
  } catch (err) {
    await release();
    return { ok: false, reason: "again", status: 409, message: "Something went wrong holding your places. Please try again." };
  }
  forgetAvailability(event.id);

  const reference = newReference();
  let order;
  try {
    order = await payload.create({
      collection: SLUGS.orders,
      data: {
        reference,
        status: "pending",
        event: event.id,
        rsvp: rsvp.id,
        site: idOf(event.site),
        name: person.name,
        email: person.email,
        phone: person.phone,
        provider: provider.id,
        items,
        totalCents: totals.totalCents,
        receiptableCents: totals.receiptableCents,
        nonReceiptableCents: totals.nonReceiptableCents,
        sponsorshipCents: totals.sponsorshipCents,
        attendeeUnits: totals.attendeeUnits,
        currency: settings?.currency || "CAD",
        holdExpiresAt: holdExpiry().toISOString(),
      },
      overrideAccess: true,
    });
    const checkout = await provider.begin({ payload, order: { ...order, ticketCsv: ticketCsv(items) }, event, site, settings });
    return { ok: true, order, checkout, provider: { id: provider.id, label: provider.label, kind: provider.kind } };
  } catch (err) {
    console.error("[events] could not start a payment:", err?.message ?? err);
    if (order) await payload.update({ collection: SLUGS.orders, id: order.id, data: { status: "expired", note: "The payment could not be started." }, overrideAccess: true }).catch(() => {});
    await releaseRsvp(payload, rsvp.id, "The payment could not be started.");
    return { ok: false, reason: "payments-unavailable", status: 503, message: "Payments aren't available right now. Please try again later." };
  }
}

const HOLD_AFTER_REPORT_MS = 24 * 60 * 60 * 1000;

/** The order is paid: the RSVP becomes a confirmed one (its places were already counted) and the buyer is told. */
export async function markPaid({ payload, order, providerRef, detail, by }) {
  const updated = await payload.update({ collection: SLUGS.orders, id: order.id, data: { status: "paid", paidAt: new Date().toISOString(), providerRef: providerRef ?? order.providerRef ?? null, note: [detail, by ? `Marked paid by ${by}.` : ""].filter(Boolean).join(" ") || null }, overrideAccess: true });
  if (order.rsvp != null) {
    const rsvp = await payload.update({ collection: SLUGS.rsvps, id: idOf(order.rsvp), data: { status: "confirmed" }, overrideAccess: true, context: { eventsClaimed: true } });
    const event = await payload.findByID({ collection: SLUGS.events, id: idOf(order.event), depth: 0, draft: false, overrideAccess: true }).catch(() => null);
    const site = event ? await payload.findByID({ collection: "sites", id: idOf(event.site), depth: 0, overrideAccess: true }).catch(() => null) : null;
    if (event) {
      const message = buildMessage("confirmed", { rsvp, event, site, links: linksFor({ site, event, rsvp: null }), order: updated });
      sendMessage(payload, { to: rsvp.email, message }).catch(() => {});
    }
  }
  forgetAvailability(idOf(order.event));
  return updated;
}

/**
 * The visitor's page says they paid. Ask the provider's server whether they did, and act on the answer:
 *   verified    paid: confirm the places, send the email
 *   unverified  could not be checked (the provider was unreachable, or did not answer in a way we understand): keep the places, keep
 *               trying, and show staff
 *   mismatch    the provider says it was not a completed payment of this amount for this order: keep the places for staff to look at
 */
export async function completeOrder({ payload, reference, transaction }) {
  const order = await orderOf(payload, reference);
  if (!order) return { ok: false, status: 404, message: "We couldn't find that order." };
  if (order.status === "paid") return { ok: true, status: "paid", order };
  if (order.status === "expired" || order.status === "refunded") {
    return { ok: false, status: 409, message: "This order has expired. If you were charged, please contact the organizers with your reference.", reference };
  }
  const event = await payload.findByID({ collection: SLUGS.events, id: idOf(order.event), depth: 1, draft: false, overrideAccess: true }).catch(() => null);
  const site = event?.site && typeof event.site === "object" ? event.site : null;
  const settings = event ? await settingsFor(payload, idOf(event.site)) : null;
  const provider = providersOf(payload)[order.provider] ?? providerFor(payload, settings);
  if (!provider) return { ok: false, status: 503, message: "We couldn't check your payment right now. Your places are held; please contact the organizers with your reference.", reference };

  let verdict;
  try {
    verdict = await provider.verify({ payload, order, transaction, event, site, settings });
  } catch (err) {
    verdict = { status: "unverified", detail: `The payment provider could not be reached: ${String(err?.message ?? err).slice(0, 200)}` };
  }
  if (verdict.status === "verified") {
    const paid = await markPaid({ payload, order, providerRef: verdict.providerRef, detail: verdict.detail });
    return { ok: true, status: "paid", order: paid };
  }
  const state = verdict.status === "mismatch" ? "payment_problem" : "payment_reported";
  await payload.update({
    collection: SLUGS.orders,
    id: order.id,
    data: { status: state, providerRef: verdict.providerRef ?? order.providerRef ?? null, note: String(verdict.detail ?? "").slice(0, 500), attempts: (order.attempts ?? 0) + 1, holdExpiresAt: new Date(Date.now() + HOLD_AFTER_REPORT_MS).toISOString(), nextCheckAt: state === "payment_reported" ? new Date(Date.now() + RETRY_MS).toISOString() : null, lastTransaction: sanitizeTransaction(transaction) },
    overrideAccess: true,
  });
  return state === "payment_problem"
    ? { ok: false, status: 402, message: "We couldn't confirm that payment. Your places are held for now; please contact the organizers with your reference.", reference }
    : { ok: true, status: "reported", message: "Thank you. We're confirming your payment; you'll get an email as soon as it is done.", reference };
}

// What the page reported, kept for staff: short plain values only (never anything that looks like a card number).
function sanitizeTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(transaction).slice(0, 20)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[String(k).slice(0, 60)] = String(v).replace(/\b(?:\d[ -]?){13,19}\b/g, "[removed]").slice(0, 200);
  return out;
}

/** Checks again the orders that were reported but could not be confirmed, every minute or so. */
export async function retryReported(payload, now = new Date()) {
  const due = await payload.find({ collection: SLUGS.orders, where: { and: [{ status: { equals: "payment_reported" } }, { nextCheckAt: { less_than: now.toISOString() } }, { attempts: { less_than: 30 } }] }, limit: 20, depth: 0, overrideAccess: true });
  let confirmed = 0;
  for (const order of due.docs) {
    const result = await completeOrder({ payload, reference: order.reference, transaction: order.lastTransaction });
    if (result.status === "paid") confirmed++;
  }
  return confirmed;
}

/** Lets go of the places of orders nobody finished paying for. */
export async function expireOrders(payload, now = new Date()) {
  const stale = await payload.find({ collection: SLUGS.orders, where: { and: [{ status: { in: ["pending", "payment_reported", "payment_problem"] } }, { holdExpiresAt: { less_than: now.toISOString() } }] }, limit: 100, depth: 0, overrideAccess: true });
  for (const order of stale.docs) {
    await payload.update({ collection: SLUGS.orders, id: order.id, data: { status: "expired", note: [order.note, "The hold ran out."].filter(Boolean).join(" ").slice(0, 500) }, overrideAccess: true });
    await releaseRsvp(payload, idOf(order.rsvp), "The payment was not completed in time.");
    await promoteWaitlist({ payload, eventId: idOf(order.event) }).catch(() => {});
  }
  return stale.docs.length;
}

/** For the event page and the form: what is on sale and whether it can be bought now. */
export async function ticketOffer({ payload, event }) {
  const settings = await settingsFor(payload, idOf(event.site));
  const provider = providerFor(payload, settings);
  const a = await availabilityOf(payload, event);
  return { available: Boolean(provider), provider: provider ? { id: provider.id, label: provider.label } : null, availability: a, currency: settings?.currency || "CAD" };
}
