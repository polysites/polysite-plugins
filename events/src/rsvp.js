// What an event can accept, and what a submitted RSVP has to look like. Pure functions of plain values, so every rule is tested on
// its own; the database work is in db.js and endpoints.js.

export const DEFAULT_MAX_GUESTS = 1;
export const HARD_MAX_GUESTS = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/**
 * Where an event stands for someone who wants to come.
 *   "upcoming"  RSVPs are not open yet
 *   "open"      places are free
 *   "waitlist"  full, but a waiting list is on
 *   "full"      full and no waiting list
 *   "closed"    RSVPs are switched off, closed, or the event is over
 * `stats` is { confirmedGuests, waitlistedGuests }; `capacity` empty means unlimited.
 */
export function availability(event, stats = {}, now = new Date()) {
  const rsvp = event?.rsvp ?? {};
  const confirmed = Number(stats.confirmedGuests ?? 0);
  const capacity = Number.isFinite(Number(rsvp.capacity)) && rsvp.capacity !== null && rsvp.capacity !== undefined && rsvp.capacity !== "" ? Number(rsvp.capacity) : null;
  const spotsLeft = capacity === null ? null : Math.max(0, capacity - confirmed);
  const start = asDate(event?.startsAt);
  const end = asDate(event?.endsAt) ?? (start ? new Date(start.getTime() + 60 * 60 * 1000) : null);
  const opens = asDate(rsvp.opensAt);
  const closes = asDate(rsvp.closesAt);

  let state;
  if (rsvp.open === false) state = "closed";
  else if (end && now > end) state = "closed";
  else if (closes && now > closes) state = "closed";
  else if (opens && now < opens) state = "upcoming";
  else if (spotsLeft === 0) state = rsvp.waitlist ? "waitlist" : "full";
  else state = "open";

  return { state, capacity, confirmedGuests: confirmed, spotsLeft, waitlist: Boolean(rsvp.waitlist), waitlistedGuests: Number(stats.waitlistedGuests ?? 0), maxGuests: maxGuestsOf(event) };
}

export function maxGuestsOf(event) {
  const n = Number(event?.rsvp?.maxGuests);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_GUESTS;
  return Math.min(Math.floor(n), HARD_MAX_GUESTS);
}

/** Whether this many guests can still be accepted as confirmed right now (the database claim is the real decision). */
export const fits = (event, stats, guests) => {
  const a = availability(event, stats);
  return a.spotsLeft === null || guests <= a.spotsLeft;
};

const clean = (value, max) => String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Checks what a visitor submitted. Returns { ok: true, value: { name, email, phone, guests, consent } } or
 * { ok: false, errors: { field: message } } with messages a visitor can act on.
 */
export function validateRsvp(data, event, { consent = false } = {}) {
  const errors = {};
  const name = clean(data?.name, 120);
  const email = clean(data?.email, 254);
  const phone = clean(data?.phone, 40);
  if (!name) errors.name = "Please enter your name.";
  if (!email) errors.email = "Please enter your email address.";
  else if (!EMAIL.test(email)) errors.email = "That email address doesn't look right.";

  const max = maxGuestsOf(event);
  const raw = data?.guests === undefined || data?.guests === "" ? 1 : Number(data.guests);
  if (!Number.isInteger(raw) || raw < 1) errors.guests = "Please enter how many people are coming.";
  else if (raw > max) errors.guests = max === 1 ? "This event takes one person per RSVP." : `You can bring up to ${max} people in one RSVP (yourself included).`;

  if (event?.rsvp?.askPhone && event.rsvp.phoneRequired && !phone) errors.phone = "Please enter a phone number.";
  const needsConsent = Boolean(event?.rsvp?.consentLabel);
  if (needsConsent && !consent) errors.consent = "Please tick the box to continue.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, phone: phone || null, guests: raw, consent: Boolean(consent) } };
}

/** A same-site path or an https address: where a person may be sent after registering. Returns the problem, or null. */
export function redirectProblem(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (text.startsWith("/") && !text.startsWith("//")) return null;
  try {
    const url = new URL(text);
    if (url.protocol === "https:" && !url.username && !url.password) return null;
  } catch {
    // fall through
  }
  return "Use a path on this site (like /thank-you) or a full https:// address.";
}
