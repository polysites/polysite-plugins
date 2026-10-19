import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCollections } from "../src/collections.js";
import { buildIcs, calendarLinks } from "../src/ics.js";
import { buildMessage, formatWhen } from "../src/mail.js";
import { availability, fits, maxGuestsOf, redirectProblem, validateRsvp } from "../src/rsvp.js";
import eventsPlugin from "../src/index.js";
import { contribution, isDuplicateError } from "../src/service.js";
import { SLUGS } from "../src/slugs.js";
import { cancelToken, checkToken, dedupeKey, issueToken, normalizeEmail, RateLimiter, readCancelToken, TtlCache } from "../src/spam.js";
import { buildEventUrl, checkEventsPath, eventsPath } from "../src/urls.js";

process.env.PAYLOAD_SECRET = "test-secret-for-the-events-plugin";

const NOW = new Date("2026-11-01T12:00:00Z");
const event = (rsvp = {}, over = {}) => ({ id: 7, title: "Spring Rally", slug: "spring-rally", startsAt: "2026-11-14T23:30:00Z", endsAt: "2026-11-15T01:30:00Z", timeZone: "America/Toronto", rsvp, ...over });

// ---- how many can still come ---------------------------------------------------------------------------------------------

test("an event with room is open, and says how many places are left", () => {
  const a = availability(event({ capacity: 50 }), { confirmedGuests: 30 }, NOW);
  assert.equal(a.state, "open");
  assert.equal(a.spotsLeft, 20);
  assert.equal(a.capacity, 50);
});

test("no capacity means no limit", () => {
  const a = availability(event({}), { confirmedGuests: 5000 }, NOW);
  assert.equal(a.state, "open");
  assert.equal(a.spotsLeft, null);
  assert.equal(availability(event({ capacity: "" }), {}, NOW).capacity, null);
});

test("a full event is full, or waitlist when the waiting list is on", () => {
  assert.equal(availability(event({ capacity: 10 }), { confirmedGuests: 10 }, NOW).state, "full");
  assert.equal(availability(event({ capacity: 10, waitlist: true }), { confirmedGuests: 10 }, NOW).state, "waitlist");
  assert.equal(availability(event({ capacity: 10, waitlist: true }), { confirmedGuests: 12 }, NOW).spotsLeft, 0, "never negative");
});

test("RSVPs can be switched off, not open yet, past their close, or too late because the event is over", () => {
  assert.equal(availability(event({ open: false }), {}, NOW).state, "closed");
  assert.equal(availability(event({ opensAt: "2026-11-05T00:00:00Z" }), {}, NOW).state, "upcoming");
  assert.equal(availability(event({ closesAt: "2026-10-30T00:00:00Z" }), {}, NOW).state, "closed");
  assert.equal(availability(event({}), {}, new Date("2026-11-15T02:00:00Z")).state, "closed", "after it ended");
  assert.equal(availability(event({}, { endsAt: undefined }), {}, new Date("2026-11-15T00:45:00Z")).state, "closed", "an event with no end is taken to last an hour");
  assert.equal(availability(event({}), {}, new Date("2026-11-15T01:00:00Z")).state, "open", "still on");
});

test("whether a party fits", () => {
  assert.equal(fits(event({ capacity: 10 }), { confirmedGuests: 8 }, 2), true);
  assert.equal(fits(event({ capacity: 10 }), { confirmedGuests: 8 }, 3), false);
  assert.equal(fits(event({}), { confirmedGuests: 8 }, 100), true);
});

test("people per RSVP defaults to one and is capped", () => {
  assert.equal(maxGuestsOf(event({})), 1);
  assert.equal(maxGuestsOf(event({ maxGuests: 4 })), 4);
  assert.equal(maxGuestsOf(event({ maxGuests: 400 })), 10);
  assert.equal(maxGuestsOf(event({ maxGuests: 0 })), 1);
});

// ---- what a visitor submits ---------------------------------------------------------------------------------------------

test("a good RSVP is accepted and cleaned", () => {
  const out = validateRsvp({ name: "  Alex   Morgan ", email: " Alex@Example.COM ", guests: "1" }, event({}), {});
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, { name: "Alex Morgan", email: "Alex@Example.COM", phone: null, guests: 1, consent: false });
});

test("a bad RSVP says what to fix, in words a visitor can act on", () => {
  const out = validateRsvp({ name: "", email: "nope", guests: 0 }, event({}), {});
  assert.equal(out.ok, false);
  assert.match(out.errors.name, /name/i);
  assert.match(out.errors.email, /look right/i);
  assert.match(out.errors.guests, /how many/i);
});

test("the party size is limited by the event, with a message that says so", () => {
  assert.match(validateRsvp({ name: "A", email: "a@b.ca", guests: 2 }, event({ maxGuests: 1 }), {}).errors.guests, /one person/);
  assert.match(validateRsvp({ name: "A", email: "a@b.ca", guests: 6 }, event({ maxGuests: 5 }), {}).errors.guests, /up to 5/);
  assert.equal(validateRsvp({ name: "A", email: "a@b.ca", guests: 5 }, event({ maxGuests: 5 }), {}).ok, true);
  assert.equal(validateRsvp({ name: "A", email: "a@b.ca", guests: 1.5 }, event({ maxGuests: 5 }), {}).ok, false);
});

test("a phone number and a consent tick are required only when the event asks", () => {
  const withPhone = event({ askPhone: true, phoneRequired: true });
  assert.match(validateRsvp({ name: "A", email: "a@b.ca" }, withPhone, {}).errors.phone, /phone/i);
  assert.equal(validateRsvp({ name: "A", email: "a@b.ca", phone: "613 555 0100" }, withPhone, {}).ok, true);
  const withConsent = event({ consentLabel: "I agree to be contacted." });
  assert.match(validateRsvp({ name: "A", email: "a@b.ca" }, withConsent, {}).errors.consent, /tick/i);
  assert.equal(validateRsvp({ name: "A", email: "a@b.ca" }, withConsent, { consent: true }).ok, true);
});

test("control characters and very long text are stripped or cut", () => {
  const out = validateRsvp({ name: `A\u0000B\n${"x".repeat(500)}`, email: "a@b.ca" }, event({}), {});
  assert.equal(out.ok, true);
  assert.ok(out.value.name.length <= 120);
  assert.doesNotMatch(out.value.name, /[\u0000-\u001f]/);
});

test("where a person may be sent afterwards: this site or https, never a script or another scheme", () => {
  for (const ok of ["", "/thank-you", "/a/b?c=d", "https://example.com/thanks"]) assert.equal(redirectProblem(ok), null, ok);
  for (const bad of ["//evil.example", "http://example.com", "javascript:alert(1)", "https://user:pw@example.com", "ftp://x.test", "thank-you"]) assert.notEqual(redirectProblem(bad), null, bad);
});

// ---- the people behind the numbers ----------------------------------------------------------------------------------------

test("an RSVP counts for its guests, in the column its status says", () => {
  assert.deepEqual(contribution({ status: "confirmed", guests: 3 }), { confirmed: 3, waitlisted: 0 });
  assert.deepEqual(contribution({ status: "waitlisted", guests: 2 }), { confirmed: 0, waitlisted: 2 });
  assert.deepEqual(contribution({ status: "cancelled", guests: 5 }), { confirmed: 0, waitlisted: 0 });
  assert.deepEqual(contribution({ status: "confirmed" }), { confirmed: 1, waitlisted: 0 });
  assert.deepEqual(contribution(undefined), { confirmed: 0, waitlisted: 0 });
});

test("a duplicate is recognised by message, path or code, never by a class name", () => {
  assert.equal(isDuplicateError({ code: "23505" }), true);
  assert.equal(isDuplicateError(new Error('duplicate key value violates unique constraint "x"')), true);
  assert.equal(isDuplicateError({ name: "d", message: "The following field is invalid: event_id, dedupe_key" }), true);
  assert.equal(isDuplicateError({ message: "x", data: { errors: [{ path: "dedupeKey" }] } }), true);
  assert.equal(isDuplicateError({ message: "boom", cause: { code: "23505" } }), true);
  assert.equal(isDuplicateError(new Error("something else")), false);
});

test("the same address, however typed, is one person for one event, and another event is another key", () => {
  assert.equal(normalizeEmail("  Alex@Example.COM "), "alex@example.com");
  assert.equal(dedupeKey(1, "Alex@Example.com"), dedupeKey(1, " alex@example.COM"));
  assert.notEqual(dedupeKey(1, "alex@example.com"), dedupeKey(2, "alex@example.com"));
  assert.match(dedupeKey(1, "a@b.ca"), /^[0-9a-f]{64}$/);
  assert.doesNotMatch(dedupeKey(1, "alex@example.com"), /alex/, "the address is not in the key");
});

// ---- tokens ------------------------------------------------------------------------------------------------------------------

test("the form token must be a moment old, not forged, not for another event, and not stale", () => {
  const t0 = 1_800_000_000_000;
  const token = issueToken(7, t0);
  assert.equal(checkToken(7, token, t0 + 5000), "ok");
  assert.equal(checkToken(7, token, t0 + 100), "too-fast");
  assert.equal(checkToken(8, token, t0 + 5000), "invalid", "a token for another event");
  assert.equal(checkToken(7, `${t0}.forged`, t0 + 5000), "invalid");
  assert.equal(checkToken(7, undefined, t0), "missing");
  assert.equal(checkToken(7, token, t0 + 7 * 60 * 60 * 1000), "expired");
});

test("a cancel link works for its own RSVP only, and cannot be forged by guessing", () => {
  const token = cancelToken(42);
  assert.equal(readCancelToken(token), "42");
  assert.equal(readCancelToken(token.replace(/^42/, "43")), null);
  assert.equal(readCancelToken("42.nope"), null);
  assert.equal(readCancelToken(undefined), null);
  assert.equal(readCancelToken("abc.def"), null);
});

test("the rate limiter allows a burst and then says no, per address", () => {
  let now = 0;
  const limiter = new RateLimiter([{ windowMs: 1000, max: 2 }], () => now);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  assert.equal(limiter.allow("b"), true);
  now = 1500;
  assert.equal(limiter.allow("a"), true);
});

test("the small cache expires entries", () => {
  let now = 0;
  const cache = new TtlCache(1000, () => now);
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
  now = 1001;
  assert.equal(cache.get("a"), undefined);
});

// ---- the calendar file --------------------------------------------------------------------------------------------------------

test("the calendar file has the event in UTC, the place, a link, and CRLF lines", () => {
  const text = buildIcs({ ...event({}), venueName: "City Hall", address: "110 Laurier Ave", summary: "Join us, bring a friend" }, { url: "https://example.test/events/spring-rally", domain: "example.test", now: NOW });
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(text, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(text, /UID:event-7@example\.test/);
  assert.match(text, /DTSTART:20261114T233000Z/);
  assert.match(text, /DTEND:20261115T013000Z/);
  assert.match(text, /SUMMARY:Spring Rally/);
  assert.match(text, /LOCATION:City Hall\\, 110 Laurier Ave/);
  assert.match(text, /URL:https:\/\/example\.test\/events\/spring-rally/);
  assert.doesNotMatch(text, /[^\r]\n/, "every line ends with CRLF");
});

test("calendar text is escaped and long lines are folded at 75 bytes", () => {
  const text = buildIcs(event({}, { title: "A; B, C\nD", summary: "é".repeat(100) }), { now: NOW });
  assert.match(text, /SUMMARY:A\\; B\\, C\\nD/);
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
});

test("an event with no end lasts an hour, and one with no start has no calendar file", () => {
  assert.match(buildIcs(event({}, { endsAt: undefined }), { now: NOW }), /DTEND:20261115T003000Z/);
  assert.equal(buildIcs({ id: 1, title: "x" }), null);
  assert.deepEqual(calendarLinks({ id: 1, title: "x" }), {});
});

test("web calendar links carry the title and the time", () => {
  const links = calendarLinks(event({}), { url: "https://example.test/events/spring-rally" });
  assert.match(links.google, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(links.google, /dates=20261114T233000Z%2F20261115T013000Z/);
  assert.match(links.outlook, /subject=Spring\+Rally/);
});

// ---- the emails --------------------------------------------------------------------------------------------------------------

test("times are written in the event's own time zone", () => {
  assert.match(formatWhen(event({})), /November 14, 2026/);
  assert.match(formatWhen(event({})), /6:30/, "23:30 UTC is 6:30 pm in Toronto");
  assert.match(formatWhen(event({}, { timeZone: "Not/AZone" })), /11:30/, "a bad zone falls back to UTC rather than failing");
});

test("each email says the right thing and links where it should", () => {
  const rsvp = { name: "Alex", guests: 2 };
  const links = { event: "https://example.test/events/spring-rally", ics: "https://example.test/api/event-ics/7", cancel: "https://example.test/events/cancel?token=x" };
  const confirmed = buildMessage("confirmed", { rsvp, event: event({}), site: { name: "Example Party" }, links });
  assert.match(confirmed.subject, /registered: Spring Rally/);
  assert.match(confirmed.text, /for 2 people/);
  assert.match(confirmed.text, /Add to your calendar/);
  assert.match(confirmed.text, /Give your place back/);
  assert.match(confirmed.html, /<a href="https:\/\/example\.test\/events\/cancel\?token=x">/);
  const waiting = buildMessage("waitlisted", { rsvp, event: event({}), site: {}, links });
  assert.match(waiting.text, /waiting list/);
  assert.doesNotMatch(waiting.text, /Add to your calendar/, "no calendar entry for a place you may not get");
  const cancelled = buildMessage("cancelled", { rsvp, event: event({}), site: {}, links });
  assert.doesNotMatch(cancelled.text, /Give your place back/);
  assert.match(buildMessage("promoted", { rsvp, event: event({}), site: {}, links }).subject, /place opened up/);
  assert.match(buildMessage("reminder", { rsvp, event: event({}), site: {}, links }).subject, /Tomorrow/);
});

test("names and titles are escaped in the html part of an email", () => {
  const m = buildMessage("confirmed", { rsvp: { name: "<script>alert(1)</script>", guests: 1 }, event: event({}, { title: "<b>Rally</b> & more" }), site: {}, links: {} });
  assert.doesNotMatch(m.html, /<script>|<b>Rally/);
  assert.match(m.html, /&lt;script&gt;/);
});

// ---- addresses ---------------------------------------------------------------------------------------------------------------

test("a site's events section defaults to /events, and is checked like the news section", () => {
  assert.equal(eventsPath({}), "events");
  assert.equal(eventsPath({ extensions: { events: { path: "/whats-on/" } } }), "whats-on");
  assert.equal(checkEventsPath("whats-on"), null);
  for (const bad of ["Has Caps", "api", "admin", "-x", "x".repeat(41)]) assert.notEqual(checkEventsPath(bad), null, bad);
  assert.equal(buildEventUrl("example.test", "events", "spring-rally", "https"), "https://example.test/events/spring-rally");
});

// ---- the plugin --------------------------------------------------------------------------------------------------------------

const kit = {
  hasCapability: (user, mod, op) => user?.can?.includes(`${mod}:${op}`) === true,
  normalizeSlug: (s) => s,
  uniquePerSite: () => () => true,
  recordException: () => {},
  canManageSiteSettings: (user) => user?.manage === true,
  workflow: { publishRules: () => () => {}, publishAware: (_slug, fn) => fn, reviewFields: () => [], isDraftRequest: () => false, changesLiveSite: () => false },
  i18n: { localizeNamed: (fields) => fields },
};

test("the plugin adds events, RSVPs, counters and settings, and the public endpoints", () => {
  const out = eventsPlugin({ collections: [], endpoints: [{ path: "/x", method: "get" }] }, kit);
  const slugs = out.collections.map((c) => c.slug);
  for (const slug of [...Object.values(SLUGS)]) assert.ok(slugs.includes(slug), slug);
  const paths = out.endpoints.map((e) => `${e.method} ${e.path}`);
  for (const wanted of ["get /event-intake/:id", "post /event-intake/:id", "get /event-ics/:id", "post /event-cancel", "get /event-export/:id", "post /event-recount/:id"]) assert.ok(paths.includes(wanted), wanted);
  assert.ok(paths.includes("get /x"), "other endpoints are kept");
});

test("RSVPs are closed to the public, the counters to everyone, and events show only what is published to visitors", () => {
  const [events, rsvps, orders, stats] = buildCollections(kit);
  const visitor = { req: { user: null } };
  const editor = { req: { user: { can: ["events:read", "events:create", "events:update", "events:delete"] } } };
  assert.equal(rsvps.access.read(visitor), false);
  assert.equal(rsvps.access.create(visitor), false);
  assert.equal(rsvps.access.read(editor), true);
  for (const op of ["read", "create", "update", "delete"]) assert.equal(stats.access[op](editor), false, `counters ${op}`);
  assert.equal(orders.access.read(visitor), false, "orders are staff only");
  assert.equal(orders.access.create(editor), false, "orders are written by the plugin only");
  assert.equal(orders.access.update(editor), false);
  assert.deepEqual(events.access.read(visitor), { _status: { equals: "published" } });
  assert.equal(events.access.read(editor), true);
});

test("an RSVP is unique per event and person, and events and RSVPs share one role module", () => {
  const [events, rsvps] = buildCollections(kit);
  assert.deepEqual(rsvps.indexes, [{ fields: ["event", "dedupeKey"], unique: true }]);
  assert.equal(events.custom.polysite.module.value, "events");
  assert.equal(rsvps.custom.polysite.module.value, "events");
  assert.equal(events.custom.polysite.routable.docType, "event");
});

test("an event with RSVPs or orders cannot be deleted out from under them", () => {
  const [events] = buildCollections(kit);
  assert.equal(typeof events.hooks.beforeDelete[0], "function");
});

test("the availability is computed when an event is read, never stored", () => {
  const [events] = buildCollections(kit);
  const field = events.fields.find((f) => f.name === "availability");
  assert.equal(field.virtual, true);
  assert.equal(typeof field.hooks.afterRead[0], "function");
});

test("only people who may manage the site's settings can change the events settings", () => {
  const out = eventsPlugin({ collections: [] }, kit);
  const settings = out.collections.find((c) => c.slug === "event-settings");
  assert.equal(settings.access.update({ req: { user: { manage: true } } }), true);
  assert.equal(settings.access.update({ req: { user: { manage: false } } }), false);
  assert.equal(settings.custom.polysite.siteSettings.key, "events");
});
