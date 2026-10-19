import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMessage } from "../src/mail.js";
import { providerFor, providersOf } from "../src/orders.js";
import { contribution } from "../src/service.js";
import { dollars, holdExpiry, isPaidEvent, newReference, priceOrder, publicTickets, ticketCsv, ticketTypes } from "../src/tickets.js";

process.env.PAYLOAD_SECRET = "test-secret-for-the-events-plugin";

const event = (tickets) => ({ id: 7, title: "Gala", tickets });
const GALA = [
  { code: "general", label: "General admission", price: 25, nonReceiptable: 10 },
  { code: "student", label: "Student", price: 12.5 },
  { code: "sponsor", label: "Sponsor a seat", price: 100, sponsorship: true },
  { code: "free", label: "Volunteer", price: 0 },
];

// ---- what is on sale ---------------------------------------------------------------------------------------------------------

test("an event with a priced ticket sells tickets; one with none, or only free ones, takes RSVPs", () => {
  assert.equal(isPaidEvent(event(GALA)), true);
  assert.equal(isPaidEvent(event([])), false);
  assert.equal(isPaidEvent(event(undefined)), false);
  assert.equal(isPaidEvent(event([{ code: "free", label: "Free", price: 0 }])), false);
});

test("ticket prices become whole cents, and a non-receiptable part can never exceed the price", () => {
  const types = ticketTypes(event([...GALA, { code: "odd", label: "Odd", price: 10, nonReceiptable: 99 }]));
  assert.equal(types.find((t) => t.code === "general").unitCents, 2500);
  assert.equal(types.find((t) => t.code === "student").unitCents, 1250);
  assert.equal(types.find((t) => t.code === "general").nonReceiptableCents, 1000);
  assert.equal(types.find((t) => t.code === "odd").nonReceiptableCents, 1000, "capped at the price");
  assert.equal(ticketTypes(event([{ code: "x", label: "x", price: 19.99 }]))[0].unitCents, 1999, "no floating point drift");
  assert.equal(ticketTypes(event([{ code: "x", label: "x", price: 0.1 + 0.2 }]))[0].unitCents, 30);
});

test("an unusable ticket is dropped, not guessed at", () => {
  const types = ticketTypes(event([{ code: "Bad Code", label: "x", price: 5 }, { code: "ok", label: "x", price: -1 }, { code: "dup", label: "a", price: 5 }, { code: "dup", label: "b", price: 6 }, { label: "no code", price: 5 }, { code: "nan", label: "x", price: "abc" }]));
  assert.deepEqual(types.map((t) => t.code), ["dup"]);
  assert.equal(types[0].label, "a", "the first of two with one code wins");
});

test("visitors are shown prices in cents and labels, never the receipt accounting", () => {
  const shown = publicTickets(event(GALA));
  assert.deepEqual(shown.find((t) => t.code === "general"), { code: "general", label: "General admission", description: "", priceCents: 2500, sponsorship: false, maxPerOrder: 20 });
  assert.equal(JSON.stringify(shown).includes("nonReceiptable"), false);
});

// ---- what an order comes to ---------------------------------------------------------------------------------------------------

test("an order is priced on the server from the event's own tickets", () => {
  const out = priceOrder(event(GALA), [{ code: "general", quantity: 2 }, { code: "student", quantity: 1 }]);
  assert.equal(out.ok, true);
  assert.equal(out.totals.totalCents, 6250);
  assert.equal(out.totals.nonReceiptableCents, 2000);
  assert.equal(out.totals.receiptableCents, 4250);
  assert.equal(out.totals.sponsorshipCents, 0);
  assert.equal(out.totals.attendeeUnits, 3);
  assert.deepEqual(out.items.map((i) => [i.code, i.units, i.unitCents, i.totalCents]), [["general", 2, 2500, 5000], ["student", 1, 1250, 1250]]);
});

test("a sponsorship adds to the total and to nothing else: no seat, no receipt", () => {
  const out = priceOrder(event(GALA), [{ code: "general", quantity: 1 }, { code: "sponsor", quantity: 2 }]);
  assert.equal(out.totals.totalCents, 22500);
  assert.equal(out.totals.sponsorshipCents, 20000);
  assert.equal(out.totals.attendeeUnits, 1, "a sponsorship is not a person");
  assert.equal(out.totals.receiptableCents, 22500 - 1000 - 20000);
});

test("the same ticket asked for twice is one line", () => {
  const out = priceOrder(event(GALA), [{ code: "general", quantity: 1 }, { code: "general", quantity: 2 }]);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].units, 3);
});

test("the browser cannot choose a price, a ticket that does not exist, or a nonsense amount", () => {
  assert.equal(priceOrder(event(GALA), [{ code: "vip", quantity: 1 }]).ok, false);
  assert.equal(priceOrder(event(GALA), [{ code: "general", quantity: -1 }]).ok, false);
  assert.equal(priceOrder(event(GALA), [{ code: "general", quantity: 1.5 }]).ok, false);
  assert.equal(priceOrder(event(GALA), [{ code: "general", quantity: "2; DROP TABLE" }]).ok, false);
  assert.equal(priceOrder(event(GALA), []).ok, false);
  assert.equal(priceOrder(event(GALA), [{ code: "general", quantity: 0 }]).ok, false, "nothing chosen");
  assert.equal(priceOrder(event(GALA), [{ code: "general", quantity: 1, price: 0.01, unitCents: 1 }]).totals.totalCents, 2500, "a price sent by the page is ignored");
  assert.equal(priceOrder(event([]), [{ code: "general", quantity: 1 }]).ok, false);
});

test("an order is limited in size, per ticket and in all", () => {
  assert.equal(priceOrder(event(GALA), [{ code: "general", quantity: 21 }]).ok, false);
  assert.equal(priceOrder(event([{ code: "g", label: "G", price: 5, maxPerOrder: 2 }]), [{ code: "g", quantity: 3 }]).ok, false);
  assert.equal(priceOrder(event([{ code: "g", label: "G", price: 5, maxPerOrder: 2 }]), [{ code: "g", quantity: 2 }]).ok, true);
  assert.equal(priceOrder(event(GALA), [{ code: "general", quantity: 15 }, { code: "student", quantity: 10 }]).ok, false, "25 tickets in all");
});

test("money is shown as dollars and written in a compact ticket form for a payment provider", () => {
  assert.equal(dollars(2500), "25.00");
  assert.equal(dollars(1999), "19.99");
  const out = priceOrder(event(GALA), [{ code: "general", quantity: 2 }, { code: "student", quantity: 1 }]);
  assert.equal(ticketCsv(out.items), "code,units,unit_amount,total_amount;general,2,25.00,50.00;student,1,12.50,12.50");
});

test("a reference is twelve characters, safe to read aloud, and never repeats in practice", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const ref = newReference();
    assert.match(ref, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
    seen.add(ref);
  }
  assert.equal(seen.size, 500);
});

test("unpaid places are held for twenty minutes", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  assert.equal(holdExpiry(now).toISOString(), "2026-11-01T12:20:00.000Z");
});

test("a place held for someone who is paying counts as taken", () => {
  assert.deepEqual(contribution({ status: "pending_payment", guests: 3 }), { confirmed: 3, waitlisted: 0 });
});

// ---- the payment provider ---------------------------------------------------------------------------------------------------------

const payloadWith = (providers) => ({ config: { custom: { polysitePayments: providers } } });

test("the provider is the one the site names, or the only one installed, and otherwise there is none", () => {
  const a = { id: "alpha" };
  const b = { id: "other" };
  assert.equal(providerFor(payloadWith({ alpha: a }), null), a);
  assert.equal(providerFor(payloadWith({ alpha: a, other: b }), null), null, "two installed and none chosen");
  assert.equal(providerFor(payloadWith({ alpha: a, other: b }), { paymentProvider: "other" }), b);
  assert.equal(providerFor(payloadWith({ alpha: a }), { paymentProvider: "nope" }), null, "a named one that is not installed");
  assert.equal(providerFor(payloadWith({}), null), null);
  assert.deepEqual(providersOf({ config: {} }), {});
});

// ---- the email --------------------------------------------------------------------------------------------------------------------

test("the confirmation for a paid order lists the tickets, the total and the reference", () => {
  const order = { reference: "ABCDEFGH2345", currency: "CAD", totalCents: 6250, items: [{ label: "General admission", units: 2, totalCents: 5000 }, { label: "Student", units: 1, totalCents: 1250 }] };
  const m = buildMessage("confirmed", { rsvp: { name: "Alex", guests: 3 }, event: { title: "Gala", startsAt: "2026-11-14T23:30:00Z" }, site: { name: "Example" }, links: {}, order });
  assert.match(m.text, /2 x General admission: 50\.00 CAD/);
  assert.match(m.text, /Total paid: 62\.50 CAD/);
  assert.match(m.text, /Your reference: ABCDEFGH2345/);
  assert.match(m.html, /Total paid: 62\.50 CAD/);
});
