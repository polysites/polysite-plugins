import { applyDelta, claimConfirmed, readStats } from "./db.js";
import { buildMessage, sendMessage } from "./mail.js";
import { availability } from "./rsvp.js";
import { cancelToken, dedupeKey, TtlCache } from "./spam.js";
import { eventsPath } from "./urls.js";
import { SLUGS } from "./slugs.js";

const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const scheme = () => process.env.SITE_SCHEME || "http";

/** What an RSVP counts for in the numbers. */
// A place held for someone who is paying (pending_payment) counts as taken, so nobody else can buy it meanwhile.
export const contribution = (rsvp) => ({
  confirmed: rsvp?.status === "confirmed" || rsvp?.status === "pending_payment" ? Number(rsvp.guests ?? 1) : 0,
  waitlisted: rsvp?.status === "waitlisted" ? Number(rsvp.guests ?? 1) : 0,
});

const availabilityCache = new TtlCache(10_000);
/** The event's availability, with the database read at most every ten seconds per event. */
export async function availabilityOf(payload, event, { fresh = false } = {}) {
  const key = String(event.id);
  if (!fresh) {
    const cached = availabilityCache.get(key);
    if (cached) return availability(event, cached);
  }
  const stats = await readStats(payload, event.id);
  availabilityCache.set(key, stats);
  return availability(event, stats);
}
export const forgetAvailability = (eventId) => availabilityCache.delete(String(eventId));

/** The public addresses an email links to. */
export function linksFor({ site, event, rsvp }) {
  if (!site?.domain) return {};
  const origin = `${scheme()}://${site.domain}`;
  const section = eventsPath(site);
  return {
    event: `${origin}/${section}/${event.slug}`,
    ics: `${origin}/api/event-ics/${event.id}`,
    cancel: rsvp ? `${origin}/${section}/cancel?token=${encodeURIComponent(cancelToken(rsvp.id))}` : undefined,
  };
}

export async function notify(payload, kind, { rsvp, event, site }) {
  const settings = await settingsFor(payload, idOf(event.site));
  const message = buildMessage(kind, { rsvp, event, site, links: linksFor({ site, event, rsvp }) });
  const from = settings?.senderName && process.env.EMAIL_FROM_ADDRESS ? `${settings.senderName} <${process.env.EMAIL_FROM_ADDRESS}>` : undefined;
  return sendMessage(payload, { to: rsvp.email, message, from });
}

export async function settingsFor(payload, siteId) {
  if (siteId == null) return null;
  const found = await payload.find({ collection: SLUGS.settings, where: { site: { equals: siteId } }, limit: 1, depth: 0, overrideAccess: true }).catch(() => null);
  return found?.docs?.[0] ?? null;
}

/** True when a save failed because the unique index on (event, dedupe key) said this person already has an RSVP. */
export function isDuplicateError(err) {
  let current = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current.code === "23505") return true;
    if (typeof current.message === "string" && /duplicate key value|unique constraint/i.test(current.message)) return true;
    const named = [current.message, ...(current.data?.errors ?? []).map((x) => x.path)].filter((x) => typeof x === "string").join(" ");
    if (/is invalid/i.test(named) && /dedupe_?key/i.test(named)) return true;
    if ((current.data?.errors ?? []).some((x) => typeof x.path === "string" && /dedupe_?key/i.test(x.path))) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Registers one person. `value` is what validateRsvp accepted. Resolves
 *   { ok: true, status, rsvp, duplicate }   a place (confirmed) or a spot on the waiting list; duplicate when this email already had one
 *   { ok: false, reason: "full" | "closed" } nothing was stored
 * The places are taken with one atomic database statement before the RSVP is written, and given back if writing it fails.
 */
export async function register({ payload, req, event, site, value, consentStatement }) {
  const state = availability(event, await readStats(payload, event.id));
  if (state.state === "closed" || state.state === "upcoming") return { ok: false, reason: "closed" };

  const key = dedupeKey(event.id, value.email);
  const existing = await payload.find({ collection: SLUGS.rsvps, where: { and: [{ event: { equals: event.id } }, { dedupeKey: { equals: key } }] }, limit: 1, depth: 0, overrideAccess: true });
  if (existing.docs[0]) return { ok: true, status: existing.docs[0].status, rsvp: existing.docs[0], duplicate: true };

  const capacity = state.capacity;
  const tookPlaces = await claimConfirmed(payload, event.id, value.guests, capacity);
  let status = "confirmed";
  if (!tookPlaces) {
    if (!event.rsvp?.waitlist) return { ok: false, reason: "full" };
    status = "waitlisted";
    await applyDelta(payload, event.id, { waitlisted: value.guests });
  }

  const release = () => applyDelta(payload, event.id, status === "confirmed" ? { confirmed: -value.guests } : { waitlisted: -value.guests });
  try {
    const rsvp = await payload.create({
      collection: SLUGS.rsvps,
      data: {
        event: event.id,
        site: idOf(event.site),
        name: value.name,
        email: value.email,
        phone: value.phone,
        guests: value.guests,
        status,
        dedupeKey: key,
        consent: { given: value.consent, statement: consentStatement ?? null },
      },
      overrideAccess: true,
      req: undefined,
      context: { eventsClaimed: true },
    });
    forgetAvailability(event.id);
    // The visitor is answered first; the email follows and its failure never undoes the registration.
    notify(payload, status, { rsvp, event, site }).catch(() => {});
    return { ok: true, status, rsvp, duplicate: false };
  } catch (err) {
    await release();
    if (isDuplicateError(err)) {
      const again = await payload.find({ collection: SLUGS.rsvps, where: { and: [{ event: { equals: event.id } }, { dedupeKey: { equals: key } }] }, limit: 1, depth: 0, overrideAccess: true });
      if (again.docs[0]) return { ok: true, status: again.docs[0].status, rsvp: again.docs[0], duplicate: true };
    }
    throw err;
  }
}

/**
 * Moves people off the waiting list, oldest first, while the next one's party fits in the places left. Strict first-come order: a big
 * party at the head is not skipped for a smaller one behind it. Resolves the RSVPs it promoted.
 */
export async function promoteWaitlist({ payload, eventId, req }) {
  // Called from inside a save, `req` makes these reads see that save's own, not yet committed, changes (a capacity just raised, an
  // RSVP just cancelled) and the writes join its transaction.
  const tx = req ? { req } : {};
  const event = await payload.findByID({ collection: SLUGS.events, id: eventId, depth: 0, draft: false, overrideAccess: true, ...tx }).catch(() => null);
  if (!event || event._status === "draft") return [];
  const site = await payload.findByID({ collection: "sites", id: idOf(event.site), depth: 0, overrideAccess: true, ...tx }).catch(() => null);
  const promoted = [];
  for (let i = 0; i < 100; i++) {
    const state = availability(event, await readStats(payload, event.id));
    if (state.spotsLeft === 0) break;
    const next = await payload.find({ collection: SLUGS.rsvps, where: { and: [{ event: { equals: event.id } }, { status: { equals: "waitlisted" } }] }, sort: "createdAt", limit: 1, depth: 0, overrideAccess: true, ...tx });
    const head = next.docs[0];
    if (!head) break;
    if (!(await claimConfirmed(payload, event.id, head.guests ?? 1, state.capacity))) break;
    await applyDelta(payload, event.id, { waitlisted: -(head.guests ?? 1) });
    const updated = await payload.update({ collection: SLUGS.rsvps, id: head.id, data: { status: "confirmed" }, overrideAccess: true, context: { eventsClaimed: true }, ...tx });
    promoted.push(updated);
    notify(payload, "promoted", { rsvp: updated, event, site }).catch(() => {});
  }
  if (promoted.length) forgetAvailability(event.id);
  return promoted;
}

/** Gives a place back. Idempotent: an RSVP already cancelled stays cancelled. */
export async function cancelRsvp({ payload, rsvpId, notifyPerson = true }) {
  const rsvp = await payload.findByID({ collection: SLUGS.rsvps, id: rsvpId, depth: 0, overrideAccess: true }).catch(() => null);
  if (!rsvp) return { ok: false, reason: "not-found" };
  if (rsvp.status === "cancelled") return { ok: true, already: true, rsvp };
  const updated = await payload.update({ collection: SLUGS.rsvps, id: rsvp.id, data: { status: "cancelled", dedupeKey: null }, overrideAccess: true });
  forgetAvailability(idOf(rsvp.event));
  if (notifyPerson) {
    const event = await payload.findByID({ collection: SLUGS.events, id: idOf(rsvp.event), depth: 0, draft: false, overrideAccess: true }).catch(() => null);
    const site = event ? await payload.findByID({ collection: "sites", id: idOf(event.site), depth: 0, overrideAccess: true }).catch(() => null) : null;
    if (event) notify(payload, "cancelled", { rsvp: updated, event, site }).catch(() => {});
  }
  return { ok: true, already: false, rsvp: updated };
}
