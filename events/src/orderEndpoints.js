import { completeOrder, createOrder, markPaid, orderOf } from "./orders.js";
import { validateRsvp } from "./rsvp.js";
import { checkToken, clientAddress, HONEYPOT_FIELD, RateLimiter } from "./spam.js";
import { SLUGS } from "./slugs.js";
import { isPaidEvent } from "./tickets.js";

// The ticket endpoints. Same rules as the RSVP endpoints (endpoints.js): the event must belong to the site the visitor is on, the
// spam checks apply, and the browser only says WHICH tickets and HOW MANY; prices and totals are worked out on the server.
//
//   POST /api/event-order/:id                     start an order: holds the places and returns the payment provider's checkout
//   POST /api/event-order-complete                the visitor's page says they paid; the provider's server is asked whether they did
//   GET  /api/event-order-status?reference=       where an order stands
//   POST /api/event-order-admin/:id/:action       (staff) verify | mark-paid | release

const MAX_BODY_BYTES = 8 * 1024;
const orderLimiter = new RateLimiter([{ windowMs: 60_000, max: 6 }, { windowMs: 60 * 60_000, max: 30 }]);
const completeLimiter = new RateLimiter([{ windowMs: 60_000, max: 20 }, { windowMs: 60 * 60_000, max: 120 }]);

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const requestHost = (req) => ((req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0] ?? "").trim().toLowerCase().replace(/:\d+$/, "");

async function loadEvent(req, id = req.routeParams?.id) {
  if (typeof id !== "string" || !/^\d+$/.test(id)) return undefined;
  const event = await req.payload.findByID({ collection: SLUGS.events, id, depth: 1, draft: false, overrideAccess: true }).catch(() => null);
  const site = event?.site;
  if (!event || event._status !== "published" || !site || typeof site !== "object" || !site.domain) return undefined;
  if (site.domain.toLowerCase() !== requestHost(req)) return undefined;
  return event;
}

async function readBody(req) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return { error: json({ message: "That request is too large." }, 413) };
  try {
    return { body: (await req.json?.()) ?? {} };
  } catch {
    return { error: json({ message: "That request couldn't be read." }, 400) };
  }
}

export const orderCreateEndpoint = {
  path: "/event-order/:id",
  method: "post",
  handler: async (req) => {
    if (!orderLimiter.allow(clientAddress(req.headers))) return json({ message: "Too many attempts. Please wait a minute and try again." }, 429);
    const { body, error } = await readBody(req);
    if (error) return error;
    const event = await loadEvent(req);
    if (!event) return json({ message: "Event not found." }, 404);
    if (!isPaidEvent(event)) return json({ message: "This event has no tickets on sale. Use the RSVP form.", code: "free" }, 409);
    if (typeof body.data?.[HONEYPOT_FIELD] === "string" && body.data[HONEYPOT_FIELD].trim() !== "") return json({ message: "Thank you." }, 400);
    const token = checkToken(event.id, body.token);
    if (token !== "ok") return json({ message: token === "too-fast" ? "That was quick. Please wait a moment and try again." : "Please reload the page and try again.", code: token }, 400);

    // The person's details are checked like an RSVP's; the party size comes from the tickets, not from a field.
    const checked = validateRsvp({ ...(body.data ?? {}), guests: 1 }, { ...event, rsvp: { ...event.rsvp, maxGuests: 1 } }, { consent: body.consent === true });
    if (!checked.ok) return json({ message: "Please check the highlighted fields.", errors: checked.errors }, 400);

    const site = event.site;
    const consentStatement = event.rsvp?.consentLabel ? [`Checkbox: "${event.rsvp.consentLabel}"`, site.privacyPolicyUrl ? `Privacy policy: ${site.privacyPolicyUrl}` : ""].filter(Boolean).join(" ") : null;
    const result = await createOrder({ payload: req.payload, event, site, requested: Array.isArray(body.items) ? body.items.slice(0, 20) : [], person: checked.value, consent: body.consent === true, consentStatement });
    if (!result.ok) return json({ message: result.message, code: result.reason }, result.status);
    return json({
      ok: true,
      reference: result.order.reference,
      totalCents: result.order.totalCents,
      currency: result.order.currency,
      items: result.order.items,
      holdExpiresAt: result.order.holdExpiresAt,
      provider: result.provider,
      checkout: result.checkout,
    });
  },
};

export const orderCompleteEndpoint = {
  path: "/event-order-complete",
  method: "post",
  handler: async (req) => {
    if (!completeLimiter.allow(clientAddress(req.headers))) return json({ message: "Too many attempts. Please wait a minute." }, 429);
    const { body, error } = await readBody(req);
    if (error) return error;
    const order = await orderOf(req.payload, body.reference);
    const event = order ? await req.payload.findByID({ collection: SLUGS.events, id: idOf(order.event), depth: 1, draft: false, overrideAccess: true }).catch(() => null) : null;
    // An order is only ever completed from the site it was started on.
    if (!order || !event?.site?.domain || event.site.domain.toLowerCase() !== requestHost(req)) return json({ message: "We couldn't find that order." }, 404);
    const result = await completeOrder({ payload: req.payload, reference: order.reference, transaction: body.transaction });
    return json(
      { ok: result.ok, status: result.status, message: result.message, reference: order.reference, redirect: result.status === "paid" ? event.rsvp?.redirectUrl?.trim() || null : null },
      result.ok ? 200 : result.status === 402 ? 402 : result.status === 404 ? 404 : 409,
    );
  },
};

export const orderStatusEndpoint = {
  path: "/event-order-status",
  method: "get",
  handler: async (req) => {
    if (!completeLimiter.allow(clientAddress(req.headers))) return json({ message: "Too many requests." }, 429);
    const order = await orderOf(req.payload, new URL(req.url).searchParams.get("reference"));
    if (!order) return json({ message: "We couldn't find that order." }, 404);
    return json({ status: order.status, reference: order.reference });
  },
};

// Staff: check a stuck payment again, settle it by hand (the money was confirmed outside Polysite), or let its places go. Changing money
// is a change to the event, so it needs the permission to change events, not just to see them.
export const buildOrderAdminEndpoint = (kit) => ({
  path: "/event-order-admin/:id/:action",
  method: "post",
  handler: async (req) => {
    if (!req.user) return json({ message: "Sign in first." }, 401);
    const id = req.routeParams?.id;
    const action = req.routeParams?.action;
    if (typeof id !== "string" || !/^\d+$/.test(id)) return json({ message: "Not found." }, 404);
    const order = await req.payload.findByID({ collection: SLUGS.orders, id, depth: 0, user: req.user, overrideAccess: false }).catch(() => null);
    if (!order) return json({ message: "Not found." }, 404);
    const event = await req.payload.findByID({ collection: SLUGS.events, id: idOf(order.event), depth: 0, user: req.user, overrideAccess: false, draft: true }).catch(() => null);
    if (!event) return json({ message: "Not found." }, 404);
    const canChange = kit.hasCapability(req.user, "events", "update");
    if (!canChange) return json({ message: "You don't have permission to change this event's orders." }, 403);

    if (action === "verify") {
      const result = await completeOrder({ payload: req.payload, reference: order.reference, transaction: order.lastTransaction });
      return json({ ok: result.status === "paid", status: result.status, message: result.message ?? (result.status === "paid" ? "Confirmed." : "Not confirmed yet.") });
    }
    if (action === "mark-paid") {
      if (order.status === "paid") return json({ ok: true, status: "paid" });
      if (order.status === "expired" || order.status === "refunded") return json({ message: "That order has expired. Add an RSVP by hand if they should come." }, 409);
      await markPaid({ payload: req.payload, order, detail: "Settled by hand.", by: req.user.email });
      return json({ ok: true, status: "paid" });
    }
    if (action === "release") {
      if (order.status === "paid") return json({ message: "A paid order can't be released here." }, 409);
      await req.payload.update({ collection: SLUGS.orders, id, data: { status: "expired", note: `Released by ${req.user.email}.` }, overrideAccess: true });
      if (order.rsvp != null) await req.payload.update({ collection: SLUGS.rsvps, id: idOf(order.rsvp), data: { status: "cancelled", notes: "Order released by staff." }, overrideAccess: true }).catch(() => {});
      return json({ ok: true, status: "expired" });
    }
    return json({ message: "Unknown action." }, 404);
  },
});

export const buildOrderEndpoints = (kit) => [orderCreateEndpoint, orderCompleteEndpoint, orderStatusEndpoint, buildOrderAdminEndpoint(kit)];
