// Ticket types, prices and what an order adds up to. Pure functions of plain values (no database, no network), so every rule about
// money is tested on its own. Money is whole cents everywhere except what an editor types (dollars with two decimals).
//
// The browser only ever says WHICH tickets and HOW MANY. What they cost, what part of the price is eligible for a charity receipt and
// what the total is are worked out here, on the server, from the event's own ticket list, never taken from the page.

export const MAX_UNITS_PER_ORDER = 20;
// How long unpaid places are held. The environment override exists so the end-to-end check can watch a hold run out in seconds.
export const holdSeconds = () => Number.parseInt(process.env.EVENTS_HOLD_SECONDS ?? "", 10) || 20 * 60;

const cents = (dollars) => Math.round(Number(dollars) * 100);

/** The ticket types an event sells, as the server understands them. Skips anything unusable (no code, no price). */
export function ticketTypes(event) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(event?.tickets) ? event.tickets : []) {
    const code = String(t?.code ?? "").trim();
    const price = Number(t?.price);
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code) || seen.has(code) || !Number.isFinite(price) || price < 0) continue;
    seen.add(code);
    const unitCents = cents(price);
    const nonReceiptable = Math.min(unitCents, Math.max(0, Number.isFinite(Number(t?.nonReceiptable)) ? cents(t.nonReceiptable) : 0));
    out.push({
      code,
      label: String(t.label ?? code).trim() || code,
      description: t.description ? String(t.description) : "",
      unitCents,
      nonReceiptableCents: nonReceiptable,
      sponsorship: Boolean(t.sponsorship),
      maxPerOrder: Number.isInteger(Number(t?.maxPerOrder)) && Number(t.maxPerOrder) > 0 ? Math.min(Number(t.maxPerOrder), MAX_UNITS_PER_ORDER) : MAX_UNITS_PER_ORDER,
    });
  }
  return out;
}

/** Whether an event is sold with tickets (some type costs something) rather than taking free RSVPs. */
export const isPaidEvent = (event) => ticketTypes(event).some((t) => t.unitCents > 0);

/**
 * Turns what the visitor asked for ([{ code, quantity }]) into an order's lines and totals, or says what is wrong.
 * Returns { ok: true, items, totals } or { ok: false, error }.
 *   items   [{ code, label, units, unitCents, totalCents, nonReceiptableCents, sponsorship }]
 *   totals  { totalCents, nonReceiptableCents, sponsorshipCents, receiptableCents, attendeeUnits }
 * A sponsorship line is a contribution, not a person: it adds to the total but not to the places taken.
 */
export function priceOrder(event, requested, { maxUnits = MAX_UNITS_PER_ORDER } = {}) {
  const types = new Map(ticketTypes(event).map((t) => [t.code, t]));
  if (types.size === 0) return { ok: false, error: "This event has no tickets on sale." };
  const lines = new Map();
  for (const row of Array.isArray(requested) ? requested : []) {
    const type = types.get(String(row?.code ?? ""));
    if (!type) return { ok: false, error: "One of those tickets isn't on sale." };
    const quantity = Number(row?.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) return { ok: false, error: "Please enter whole numbers of tickets." };
    if (quantity === 0) continue;
    const units = (lines.get(type.code)?.units ?? 0) + quantity;
    if (units > type.maxPerOrder) return { ok: false, error: `You can buy up to ${type.maxPerOrder} "${type.label}" tickets in one order.` };
    lines.set(type.code, { type, units });
  }
  if (lines.size === 0) return { ok: false, error: "Choose at least one ticket." };

  const items = [];
  let totalUnits = 0;
  let totalCents = 0;
  let nonReceiptableCents = 0;
  let sponsorshipCents = 0;
  let attendeeUnits = 0;
  for (const { type, units } of lines.values()) {
    const lineTotal = type.unitCents * units;
    totalUnits += units;
    totalCents += lineTotal;
    nonReceiptableCents += type.nonReceiptableCents * units;
    if (type.sponsorship) sponsorshipCents += lineTotal;
    else attendeeUnits += units;
    items.push({ code: type.code, label: type.label, units, unitCents: type.unitCents, totalCents: lineTotal, nonReceiptableCents: type.nonReceiptableCents * units, sponsorship: type.sponsorship });
  }
  if (totalUnits > maxUnits) return { ok: false, error: `You can buy up to ${maxUnits} tickets in one order.` };
  // The part of the price that may be receipted: what is left after the non-receiptable part and any sponsorship.
  const receiptableCents = Math.max(0, totalCents - nonReceiptableCents - sponsorshipCents);
  return { ok: true, items, totals: { totalCents, nonReceiptableCents, sponsorshipCents, receiptableCents, attendeeUnits } };
}

/** "25.00" for 2500. */
export const dollars = (c) => (Number(c) / 100).toFixed(2);

/** The ticket lines in a compact text form a payment provider can store with the payment: "code,units,unit_amount,total_amount;..." with a header row. */
export function ticketCsv(items) {
  return ["code,units,unit_amount,total_amount", ...items.map((i) => `${i.code},${i.units},${dollars(i.unitCents)},${dollars(i.totalCents)}`)].join(";");
}

/** A short reference for an order that is safe to put in a form field and to quote on a phone call: letters and digits, hard to guess. */
export function newReference(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  return Array.from(random(12), (b) => alphabet[b % alphabet.length]).join("");
}

/** What a visitor is shown: the ticket types, in dollars, never the internal accounting. */
export const publicTickets = (event) => ticketTypes(event).map((t) => ({ code: t.code, label: t.label, description: t.description, priceCents: t.unitCents, sponsorship: t.sponsorship, maxPerOrder: t.maxPerOrder }));

/** When an unpaid order stops holding its places. */
export const holdExpiry = (now = new Date(), seconds = holdSeconds()) => new Date(now.getTime() + seconds * 1000);
