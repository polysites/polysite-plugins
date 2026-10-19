import { recount } from "./db.js";
import { buildIcs, calendarLinks } from "./ics.js";
import { availability, validateRsvp } from "./rsvp.js";
import { availabilityOf, cancelRsvp, linksFor, promoteWaitlist, register, settingsFor } from "./service.js";
import { checkToken, clientAddress, HONEYPOT_FIELD, issueToken, RateLimiter, readCancelToken } from "./spam.js";
import { SLUGS } from "./slugs.js";
import { formatWhen } from "./mail.js";
import { providerFor } from "./orders.js";
import { isPaidEvent, publicTickets } from "./tickets.js";

// The public face of the events plugin: what a visitor's browser talks to. Everything a visitor can do goes through here, because the
// RSVP collection itself is closed to the public: the event must belong to the site the visitor is on, the data is checked, and the
// request has to pass the same spam checks the core's form endpoint uses.
//
//   GET  /api/event-intake/:id        the RSVP form's settings, the places left, and a signed token
//   POST /api/event-intake/:id        an RSVP
//   GET  /api/event-ics/:id           the event as a calendar file
//   GET  /api/event-cancel?token=     what a "give my place back" link is about
//   POST /api/event-cancel            gives the place back
//   POST /api/event-recount/:id       (staff) sets the counts again from the RSVPs
//   GET  /api/event-export/:id        (staff) the RSVPs as CSV

const MAX_BODY_BYTES = 8 * 1024;
const rsvpLimiter = new RateLimiter([{ windowMs: 60_000, max: 8 }, { windowMs: 60 * 60_000, max: 40 }]);
const cancelLimiter = new RateLimiter([{ windowMs: 60_000, max: 10 }, { windowMs: 60 * 60_000, max: 60 }]);
const readLimiter = new RateLimiter([{ windowMs: 60_000, max: 120 }]);

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const requestHost = (req) => ((req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0] ?? "").trim().toLowerCase().replace(/:\d+$/, "");

/** The published event for this request, or undefined when it doesn't exist, isn't live, or isn't this site's. */
async function loadEvent(req, id = req.routeParams?.id) {
  if (typeof id !== "string" || !/^\d+$/.test(id)) return undefined;
  const event = await req.payload.findByID({ collection: SLUGS.events, id, depth: 1, draft: false, overrideAccess: true }).catch(() => null);
  const site = event?.site;
  if (!event || event._status !== "published" || !site || typeof site !== "object" || !site.domain) return undefined;
  if (site.domain.toLowerCase() !== requestHost(req)) return undefined;
  return event;
}

const publicEvent = (event) => ({ id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt ?? null, timeZone: event.timeZone ?? null, venueName: event.venueName ?? null, address: event.address ?? null, onlineUrl: event.onlineUrl ?? null });

export const definitionEndpoint = {
  path: "/event-intake/:id",
  method: "get",
  handler: async (req) => {
    if (!readLimiter.allow(clientAddress(req.headers))) return json({ message: "Too many requests." }, 429);
    const event = await loadEvent(req);
    if (!event) return json({ message: "Event not found." }, 404);
    const rsvp = event.rsvp ?? {};
    const site = event.site;
    const paid = isPaidEvent(event);
    return json({
      event: publicEvent(event),
      availability: await availabilityOf(req.payload, event),
      form: {
        askPhone: Boolean(rsvp.askPhone),
        phoneRequired: Boolean(rsvp.askPhone && rsvp.phoneRequired),
        maxGuests: availability(event).maxGuests,
        consentLabel: rsvp.consentLabel?.trim() || null,
        policyUrl: site.privacyPolicyUrl || "",
        submitLabel: rsvp.submitLabel?.trim() || "Register",
      },
      calendar: calendarLinks(event, { url: linksFor({ site, event }).event }),
      icsUrl: linksFor({ site, event }).ics,
      honeypot: HONEYPOT_FIELD,
      token: issueToken(event.id),
      // A paid event sells tickets instead of taking RSVPs: the page shows the ticket form when this is present.
      tickets: paid ? { items: publicTickets(event), available: Boolean(providerFor(req.payload, await settingsFor(req.payload, idOf(event.site)))), currency: (await settingsFor(req.payload, idOf(event.site)))?.currency || "CAD" } : null,
    });
  },
};

export const submitEndpoint = {
  path: "/event-intake/:id",
  method: "post",
  handler: async (req) => {
    if (!rsvpLimiter.allow(clientAddress(req.headers))) return json({ message: "Too many attempts. Please wait a minute and try again." }, 429);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ message: "That request is too large." }, 413);
    let body;
    try {
      body = (await req.json?.()) ?? {};
    } catch {
      return json({ message: "That request couldn't be read." }, 400);
    }
    const event = await loadEvent(req);
    if (!event) return json({ message: "Event not found." }, 404);

    // A filled honeypot is a bot: answer as if it worked, store nothing.
    if (typeof body.data?.[HONEYPOT_FIELD] === "string" && body.data[HONEYPOT_FIELD].trim() !== "") return json({ ok: true, status: "confirmed", message: "Thank you." });
    const token = checkToken(event.id, body.token);
    if (token !== "ok") {
      const message = token === "too-fast" ? "That was quick. Please wait a moment and try again." : token === "expired" ? "This page has been open a long time. Please reload it and try again." : "Please reload the page and try again.";
      return json({ message, code: token }, 400);
    }

    // A paid event takes its RSVPs through the ticket form: this free form would be a way round paying.
    if (isPaidEvent(event)) return json({ message: "This event sells tickets. Please use the ticket form.", code: "paid" }, 409);

    const checked = validateRsvp(body.data ?? {}, event, { consent: body.consent === true });
    if (!checked.ok) return json({ message: "Please check the highlighted fields.", errors: checked.errors }, 400);

    const site = event.site;
    const consentStatement = event.rsvp?.consentLabel
      ? [`Checkbox: "${event.rsvp.consentLabel}"`, site.privacyPolicyUrl ? `Privacy policy: ${site.privacyPolicyUrl}` : ""].filter(Boolean).join(" ")
      : null;
    const result = await register({ payload: req.payload, req, event, site, value: checked.value, consentStatement });
    if (!result.ok) {
      return result.reason === "full"
        ? json({ message: "Sorry, this event is full.", code: "full", availability: await availabilityOf(req.payload, event, { fresh: true }) }, 409)
        : json({ message: "Registration for this event isn't open.", code: "closed" }, 409);
    }
    const waitlisted = result.status === "waitlisted";
    return json({
      ok: true,
      status: result.status,
      duplicate: result.duplicate,
      message: waitlisted ? "You're on the waiting list. We'll email you if a place opens up." : event.rsvp?.confirmationMessage?.trim() || "You're registered. A confirmation is on its way to your email.",
      redirect: waitlisted ? null : event.rsvp?.redirectUrl?.trim() || null,
      calendar: waitlisted ? null : calendarLinks(event, { url: linksFor({ site, event }).event }),
      icsUrl: waitlisted ? null : linksFor({ site, event }).ics,
    });
  },
};

export const icsEndpoint = {
  path: "/event-ics/:id",
  method: "get",
  handler: async (req) => {
    if (!readLimiter.allow(clientAddress(req.headers))) return json({ message: "Too many requests." }, 429);
    const event = await loadEvent(req);
    if (!event) return json({ message: "Event not found." }, 404);
    const links = linksFor({ site: event.site, event });
    const body = buildIcs(event, { url: links.event, domain: event.site.domain });
    if (!body) return json({ message: "This event has no start time." }, 404);
    return new Response(body, { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="event-${event.id}.ics"`, "Cache-Control": "public, max-age=300" } });
  },
};

// What a "give my place back" link is about, so the page can ask "cancel your place for <event>?" before doing it. It shows the event
// and the party size, never the name or email.
export const cancelInfoEndpoint = {
  path: "/event-cancel",
  method: "get",
  handler: async (req) => {
    if (!cancelLimiter.allow(clientAddress(req.headers))) return json({ message: "Too many requests." }, 429);
    const id = readCancelToken(new URL(req.url).searchParams.get("token"));
    if (!id) return json({ message: "This link isn't valid." }, 404);
    const rsvp = await req.payload.findByID({ collection: SLUGS.rsvps, id, depth: 0, overrideAccess: true }).catch(() => null);
    const event = rsvp ? await req.payload.findByID({ collection: SLUGS.events, id: idOf(rsvp.event), depth: 1, draft: false, overrideAccess: true }).catch(() => null) : null;
    if (!rsvp || !event?.site?.domain || event.site.domain.toLowerCase() !== requestHost(req)) return json({ message: "This link isn't valid." }, 404);
    return json({ status: rsvp.status, guests: rsvp.guests ?? 1, event: { title: event.title, when: formatWhen(event) } });
  },
};

export const cancelEndpoint = {
  path: "/event-cancel",
  method: "post",
  handler: async (req) => {
    if (!cancelLimiter.allow(clientAddress(req.headers))) return json({ message: "Too many attempts. Please wait a minute." }, 429);
    let body;
    try {
      body = (await req.json?.()) ?? {};
    } catch {
      return json({ message: "That request couldn't be read." }, 400);
    }
    const id = readCancelToken(body.token);
    if (!id) return json({ message: "This link isn't valid." }, 404);
    const rsvp = await req.payload.findByID({ collection: SLUGS.rsvps, id, depth: 0, overrideAccess: true }).catch(() => null);
    const event = rsvp ? await req.payload.findByID({ collection: SLUGS.events, id: idOf(rsvp.event), depth: 1, draft: false, overrideAccess: true }).catch(() => null) : null;
    if (!rsvp || !event?.site?.domain || event.site.domain.toLowerCase() !== requestHost(req)) return json({ message: "This link isn't valid." }, 404);
    // A place that was paid for is not given back with a link: the money would have to go back too, and that is a person's job.
    const paidOrder = await req.payload.find({ collection: SLUGS.orders, where: { and: [{ rsvp: { equals: id } }, { status: { in: ["paid", "payment_reported"] } }] }, limit: 1, depth: 0, overrideAccess: true });
    if (paidOrder.totalDocs > 0) return json({ message: "These tickets were paid for, so they can't be given back with this link. Please contact the organizers.", code: "paid" }, 409);
    const result = await cancelRsvp({ payload: req.payload, rsvpId: id });
    return json({ ok: result.ok, already: Boolean(result.already) });
  },
};

// Staff tools. They read the event with the signed-in person's own access, so a person who cannot see an event cannot touch its RSVPs.
async function staffEvent(req) {
  if (!req.user) return { error: json({ message: "Sign in first." }, 401) };
  const id = req.routeParams?.id;
  if (typeof id !== "string" || !/^\d+$/.test(id)) return { error: json({ message: "Not found." }, 404) };
  const event = await req.payload.findByID({ collection: SLUGS.events, id, depth: 0, user: req.user, overrideAccess: false, draft: true }).catch(() => null);
  if (!event) return { error: json({ message: "Not found." }, 404) };
  return { event };
}

export const recountEndpoint = {
  path: "/event-recount/:id",
  method: "post",
  handler: async (req) => {
    const { event, error } = await staffEvent(req);
    if (error) return error;
    // Count first so the room is judged on the truth, let the waiting list in, then count again for the numbers to show.
    await recount(req.payload, event.id);
    const promoted = await promoteWaitlist({ payload: req.payload, eventId: event.id });
    const counts = await recount(req.payload, event.id);
    return json({ ok: true, ...counts, promoted: promoted.length });
  },
};

export const summaryEndpoint = {
  path: "/event-summary/:id",
  method: "get",
  handler: async (req) => {
    const { event, error } = await staffEvent(req);
    if (error) return error;
    const a = await availabilityOf(req.payload, event, { fresh: true });
    return json({ capacity: a.capacity, confirmedGuests: a.confirmedGuests, waitlistedGuests: a.waitlistedGuests, spotsLeft: a.spotsLeft, state: a.state });
  },
};

const csvCell = (value) => {
  let text = String(value ?? "");
  // A cell that starts like a formula is read as one by spreadsheets: defuse it.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const exportEndpoint = {
  path: "/event-export/:id",
  method: "get",
  handler: async (req) => {
    const { event, error } = await staffEvent(req);
    if (error) return error;
    const rsvps = await req.payload.find({ collection: SLUGS.rsvps, where: { event: { equals: event.id } }, sort: "createdAt", limit: 10_000, pagination: false, depth: 0, user: req.user, overrideAccess: false });
    const rows = [["Name", "Email", "Phone", "Guests", "Status", "Registered"], ...rsvps.docs.map((r) => [r.name, r.email, r.phone ?? "", r.guests ?? 1, r.status, r.createdAt])];
    return new Response(`${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rsvps-event-${event.id}.csv"`, "Cache-Control": "no-store" },
    });
  },
};

export const endpoints = [definitionEndpoint, submitEndpoint, icsEndpoint, cancelInfoEndpoint, cancelEndpoint, recountEndpoint, summaryEndpoint, exportEndpoint];
