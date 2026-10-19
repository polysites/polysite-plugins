// End-to-end check of the Events plugin against a RUNNING stack.
//
//   BASE=http://cms:3001 ADMIN_EMAIL=... ADMIN_PASSWORD=... SITE_ID=1 SITE_HOST=voidslate.localhost OTHER_HOST=second.localhost \
//     PAYLOAD_SECRET=... node plugins/events/test/e2e/events.e2e.mjs
//
// It checks: an event is invisible until published; the RSVP endpoint refuses what it should (wrong site, bad data, a robot, a
// closed or past event, too many people); a duplicate email is one person; the places left are counted exactly, with parties of
// different sizes; the waiting list fills in order and moves up on its own when a place is given back (by staff, and by the person's
// own link); and, the point of the whole design, that twenty people pressing the button in the same instant for five places get
// five places. It also checks the calendar file, the spreadsheet export and the staff-only parts. It leaves its events, RSVPs and
// counters behind (run it on a throwaway stack: tests/e2e/run-with-plugins.sh does).
const BASE = process.env.BASE;
const SITE_ID = Number(process.env.SITE_ID ?? 1);
const SITE_HOST = process.env.SITE_HOST ?? "voidslate.localhost";
const OTHER_HOST = process.env.OTHER_HOST ?? "second.localhost";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(Boolean(cond));
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + String(extra).slice(0, 500)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body, headers, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `JWT ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "" };
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const login = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
const admin = login.json?.token;
ok("admin signs in", Boolean(admin));

const stamp = Date.now().toString(36);
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
let address = 20;
const visitor = (host = SITE_HOST) => ({ "X-Forwarded-Host": host, "X-Forwarded-For": `203.0.113.${address++ % 250}` });

async function createEvent(over = {}) {
  const res = await api("POST", "/api/events", {
    token: admin,
    body: { title: `Rally ${stamp} ${address}`, slug: `rally-${stamp}-${address}`, site: SITE_ID, startsAt: iso(10 * DAY), endsAt: iso(10 * DAY + 2 * 60 * 60 * 1000), timeZone: "America/Toronto", _status: "published", ...over },
  });
  return { ...res, id: res.json?.doc?.id };
}
const rsvpsOf = async (eventId) => (await api("GET", `/api/event-rsvps?where[event][equals]=${eventId}&sort=id&limit=100&depth=0`, { token: admin })).json?.docs ?? [];
const summary = async (eventId) => (await api("GET", `/api/event-summary/${eventId}`, { token: admin })).json;

// A visitor on the page: loads the form (and its token), waits like a person would, submits.
async function rsvp(eventId, data, { host, consent, wait = 1700, token } = {}) {
  const headers = visitor(host);
  const def = token ? { json: { token } } : await api("GET", `/api/event-intake/${eventId}`, { headers });
  await sleep(wait);
  return api("POST", `/api/event-intake/${eventId}`, { headers, body: { data, token: def.json?.token, consent } });
}
const person = (n, extra = {}) => ({ name: `Guest ${n}`, email: `guest${n}.${stamp}@example.test`, guests: 1, ...extra });

// ---- visibility -----------------------------------------------------------------------------------------------------------
const draft = await createEvent({ _status: "draft", title: `Draft ${stamp}`, slug: `draft-${stamp}` });
ok("a draft event is saved", draft.status === 201, JSON.stringify(draft.json)?.slice(0, 300));
const draftDef = await api("GET", `/api/event-intake/${draft.id}`, { headers: visitor() });
ok("a draft event is invisible to visitors (no form, no RSVP)", draftDef.status === 404, draftDef.status);
const publicList = await api("GET", `/api/events?where[site.domain][equals]=${SITE_HOST}&limit=100`);
ok("the public list shows published events only", publicList.status === 200 && !publicList.json.docs.some((e) => e.id === draft.id), publicList.status);

// ---- one event, step by step -------------------------------------------------------------------------------------------------
const e1 = await createEvent({ rsvp: { open: true, capacity: 3, maxGuests: 2, waitlist: true, askPhone: true, consentLabel: "I agree to be contacted about this event.", redirectUrl: "/thank-you", confirmationMessage: "See you there." } });
ok("a published event with capacity 3 is saved", e1.status === 201, JSON.stringify(e1.json)?.slice(0, 300));
const def = await api("GET", `/api/event-intake/${e1.id}`, { headers: visitor() });
ok("a visitor gets the form's settings, the places left and a token", def.status === 200 && def.json.availability.spotsLeft === 3 && def.json.availability.state === "open" && def.json.form.maxGuests === 2 && def.json.form.askPhone === true && typeof def.json.token === "string" && def.json.honeypot, JSON.stringify(def.json)?.slice(0, 400));
ok("and the calendar links", def.json?.calendar?.google?.startsWith("https://calendar.google.com/") && def.json?.icsUrl?.endsWith(`/api/event-ics/${e1.id}`), JSON.stringify(def.json?.calendar));
const publicRead = (await api("GET", `/api/events/${e1.id}`)).json;
ok("the public event carries the computed availability (never stored on the event)", publicRead?.availability?.capacity === 3, JSON.stringify(publicRead?.availability));

const wrongHost = await api("GET", `/api/event-intake/${e1.id}`, { headers: visitor(OTHER_HOST) });
ok("another site's visitor cannot see this site's event", wrongHost.status === 404, wrongHost.status);

const early = await api("POST", `/api/event-intake/${e1.id}`, { headers: visitor(), body: { data: person(0), token: def.json.token, consent: true } });
ok("a submission faster than a person could type is refused", early.status === 400 && early.json?.code === "too-fast", JSON.stringify(early.json));
const noToken = await api("POST", `/api/event-intake/${e1.id}`, { headers: visitor(), body: { data: person(0), consent: true } });
ok("a submission without the page's token is refused", noToken.status === 400, noToken.status);
const robot = await rsvp(e1.id, { ...person(1), website_url: "http://spam.example" }, { consent: true });
ok("a filled honeypot looks like success but stores nothing", robot.status === 200 && robot.json?.ok === true && (await rsvpsOf(e1.id)).length === 0, `${robot.status} ${JSON.stringify(robot.json)}`);
const bad = await rsvp(e1.id, { name: "", email: "nope", guests: 9 }, { consent: true });
ok("bad data comes back as messages per field", bad.status === 400 && bad.json?.errors?.name && bad.json.errors.email && bad.json.errors.guests, JSON.stringify(bad.json));
const noConsent = await rsvp(e1.id, person(1), { consent: false });
ok("the consent box is required when the event has one", noConsent.status === 400 && Boolean(noConsent.json?.errors?.consent), JSON.stringify(noConsent.json));
ok("nothing was stored by any of those", (await rsvpsOf(e1.id)).length === 0);

const a = await rsvp(e1.id, person(1, { guests: 2 }), { consent: true });
ok("a party of two registers", a.status === 200 && a.json?.status === "confirmed" && a.json.redirect === "/thank-you" && a.json.message === "See you there.", JSON.stringify(a.json));
ok("the confirmation carries calendar links", Boolean(a.json?.calendar?.google) && Boolean(a.json?.icsUrl));
let s = await summary(e1.id);
ok("two places are taken, one is left", s?.confirmedGuests === 2 && s.spotsLeft === 1, JSON.stringify(s));
const aDup = await rsvp(e1.id, person(1, { email: ` GUEST1.${stamp}@Example.TEST `, guests: 1 }), { consent: true });
ok("the same address typed differently is the same person, not a second place", aDup.status === 200 && aDup.json?.duplicate === true, JSON.stringify(aDup.json));
s = await summary(e1.id);
ok("and the count did not move", s?.confirmedGuests === 2, JSON.stringify(s));
const stored = (await rsvpsOf(e1.id))[0];
ok("the RSVP record has consent and a key, not the address twice", stored?.consent?.given === true && /consent|agree/i.test(stored.consent.statement ?? "") && /^[0-9a-f]{64}$/.test(stored?.dedupeKey ?? ""), JSON.stringify(stored));

const b = await rsvp(e1.id, person(2, { guests: 2 }), { consent: true });
ok("a second party of two does not fit in one place: it goes on the waiting list", b.status === 200 && b.json?.status === "waitlisted" && b.json.redirect === null, JSON.stringify(b.json));
const c = await rsvp(e1.id, person(3), { consent: true });
ok("a party of one still fits", c.json?.status === "confirmed", JSON.stringify(c.json));
const d = await rsvp(e1.id, person(4), { consent: true });
ok("then the event is full and the next person waits", d.json?.status === "waitlisted", JSON.stringify(d.json));
s = await summary(e1.id);
ok("3 confirmed, 3 waiting", s?.confirmedGuests === 3 && s.waitlistedGuests === 3 && s.spotsLeft === 0 && s.state === "waitlist", JSON.stringify(s));

// Staff cancel the first party: the head of the waiting list (a party of two) fits and moves up on its own.
const all1 = await rsvpsOf(e1.id);
const rsvpA = all1.find((r) => r.email.startsWith("guest1."));
const cancelled = await api("PATCH", `/api/event-rsvps/${rsvpA.id}`, { token: admin, body: { status: "cancelled" } });
ok("staff cancel the first party", cancelled.status === 200, JSON.stringify(cancelled.json)?.slice(0, 200));
await sleep(1500);
const after1 = await rsvpsOf(e1.id);
const byEmail = (n) => after1.find((r) => r.email.startsWith(`guest${n}.`));
ok("the first waiting party moved up by itself, in order", byEmail(2)?.status === "confirmed" && byEmail(4)?.status === "waitlisted" && byEmail(1)?.status === "cancelled", after1.map((r) => `${r.email.split(".")[0]}:${r.status}`).join(" "));
s = await summary(e1.id);
ok("the numbers followed: 3 confirmed, 1 waiting", s?.confirmedGuests === 3 && s.waitlistedGuests === 1, JSON.stringify(s));
const reRegister = await rsvp(e1.id, person(1), { consent: true });
ok("someone who gave their place back can register again", reRegister.status === 200 && reRegister.json?.duplicate === false, JSON.stringify(reRegister.json));

// The person's own link.
if (process.env.PAYLOAD_SECRET) {
  const { cancelToken } = await import("../../src/spam.js");
  const own = byEmail(3);
  const token = cancelToken(own.id);
  const info = await api("GET", `/api/event-cancel?token=${encodeURIComponent(token)}`, { headers: visitor() });
  ok("a cancel link says which event it is for, and nothing about the person", info.status === 200 && info.json?.event?.title?.startsWith("Rally") && !JSON.stringify(info.json).includes("guest3"), JSON.stringify(info.json));
  const forged = await api("POST", "/api/event-cancel", { headers: visitor(), body: { token: `${own.id}.forged` } });
  ok("a forged cancel link is refused", forged.status === 404, forged.status);
  const elsewhere = await api("POST", "/api/event-cancel", { headers: visitor(OTHER_HOST), body: { token } });
  ok("a cancel link only works on its own site", elsewhere.status === 404, elsewhere.status);
  const done = await api("POST", "/api/event-cancel", { headers: visitor(), body: { token } });
  ok("the person gives their place back with their own link", done.status === 200 && done.json?.ok === true, JSON.stringify(done.json));
  const again = await api("POST", "/api/event-cancel", { headers: visitor(), body: { token } });
  ok("doing it twice is harmless", again.json?.ok === true && again.json?.already === true, JSON.stringify(again.json));
  await sleep(1500);
  s = await summary(e1.id);
  ok("and the next waiting person moved up (4 confirmed would be over; the waiting party of one fits in the place freed)", s?.confirmedGuests === 3 && s.waitlistedGuests === 1, JSON.stringify(s));
} else {
  console.log("skip the cancel-link checks (set PAYLOAD_SECRET to the stack's secret)");
}

// ---- no waiting list, and closed events -----------------------------------------------------------------------------------------
const e2 = await createEvent({ rsvp: { open: true, capacity: 1, maxGuests: 1, waitlist: false } });
const first = await rsvp(e2.id, person(10));
const second = await rsvp(e2.id, person(11));
ok("with no waiting list, the second person is told the event is full", first.json?.status === "confirmed" && second.status === 409 && second.json?.code === "full", `${second.status} ${JSON.stringify(second.json)}`);
ok("and nothing was stored for them", (await rsvpsOf(e2.id)).length === 1);
const e3 = await createEvent({ rsvp: { open: false } });
const closed = await rsvp(e3.id, person(12));
ok("an event with RSVPs switched off is closed", closed.status === 409 && closed.json?.code === "closed", JSON.stringify(closed.json));
const e4 = await createEvent({ startsAt: iso(-3 * DAY), endsAt: iso(-3 * DAY + 3600_000) });
const past = await rsvp(e4.id, person(13));
ok("an event that is over is closed", past.status === 409 && past.json?.code === "closed", JSON.stringify(past.json));
const e5 = await createEvent({ rsvp: { open: true, opensAt: iso(2 * DAY) } });
ok("an event whose RSVPs have not opened yet is closed, and says so", (await rsvp(e5.id, person(14))).status === 409 && (await api("GET", `/api/event-intake/${e5.id}`, { headers: visitor() })).json?.availability?.state === "upcoming");
const e6 = await api("POST", "/api/events", { token: admin, body: { title: "x", slug: `x-${stamp}`, site: SITE_ID, startsAt: iso(DAY), _status: "published", rsvp: { redirectUrl: "javascript:alert(1)" } } });
ok("a redirect to a script is refused when the event is saved", e6.status === 400, e6.status);
const e7 = await api("POST", "/api/events", { token: admin, body: { title: "y", slug: "page", site: SITE_ID, startsAt: iso(DAY), _status: "published" } });
ok("a slug that is part of the events addresses is refused", e7.status === 400, e7.status);

// ---- twenty at once -----------------------------------------------------------------------------------------------------------------
const e8 = await createEvent({ rsvp: { open: true, capacity: 5, maxGuests: 1, waitlist: false } });
const d8 = await api("GET", `/api/event-intake/${e8.id}`, { headers: visitor() });
await sleep(1800);
const burst = await Promise.all(
  Array.from({ length: 20 }, (_, i) => api("POST", `/api/event-intake/${e8.id}`, { headers: visitor(), body: { data: person(100 + i), token: d8.json.token } })),
);
const won = burst.filter((r) => r.status === 200 && r.json?.status === "confirmed").length;
const turnedAway = burst.filter((r) => r.status === 409 && r.json?.code === "full").length;
ok("twenty people press the button at the same instant for five places: exactly five get one", won === 5 && turnedAway === 15, `won ${won}, turned away ${turnedAway}, others ${burst.map((r) => r.status).join(",")}`);
s = await summary(e8.id);
ok("the count says five, the records say five", s?.confirmedGuests === 5 && (await rsvpsOf(e8.id)).filter((r) => r.status === "confirmed").length === 5, JSON.stringify(s));

const e9 = await createEvent({ rsvp: { open: true, capacity: 5, maxGuests: 3, waitlist: true } });
const d9 = await api("GET", `/api/event-intake/${e9.id}`, { headers: visitor() });
await sleep(1800);
const mixed = await Promise.all(Array.from({ length: 12 }, (_, i) => api("POST", `/api/event-intake/${e9.id}`, { headers: visitor(), body: { data: person(200 + i, { guests: (i % 3) + 1 }), token: d9.json.token } })));
const rows9 = await rsvpsOf(e9.id);
const sumBy = (status) => rows9.filter((r) => r.status === status).reduce((n, r) => n + r.guests, 0);
ok("parties of one, two and three racing for five places: never more than five confirmed", mixed.every((r) => r.status === 200) && sumBy("confirmed") <= 5 && sumBy("confirmed") >= 3, `confirmed ${sumBy("confirmed")}, waiting ${sumBy("waitlisted")}`);
s = await summary(e9.id);
ok("and the counters match the records exactly", s?.confirmedGuests === sumBy("confirmed") && s.waitlistedGuests === sumBy("waitlisted"), `${JSON.stringify(s)} vs ${sumBy("confirmed")}/${sumBy("waitlisted")}`);

// A larger capacity lets the waiting list in.
const raised = await api("PATCH", `/api/events/${e9.id}`, { token: admin, body: { rsvp: { open: true, capacity: 100, maxGuests: 3, waitlist: true }, _status: "published" } });
await sleep(2500);
s = await summary(e9.id);
const total9 = (await rsvpsOf(e9.id)).filter((r) => r.status !== "cancelled").reduce((n, r) => n + r.guests, 0);
ok("raising the capacity lets the whole waiting list in", raised.status === 200 && s?.waitlistedGuests === 0 && s.confirmedGuests === total9, `${JSON.stringify(s)} total ${total9}`);

// ---- the counters repair themselves -----------------------------------------------------------------------------------------------------
const recount = await api("POST", `/api/event-recount/${e9.id}`, { token: admin });
ok("the recount tool agrees with the records", recount.json?.ok === true && recount.json.confirmedGuests === (await rsvpsOf(e9.id)).filter((r) => r.status === "confirmed").reduce((n, r) => n + r.guests, 0), JSON.stringify(recount.json));

// ---- calendar, export, staff-only ---------------------------------------------------------------------------------------------------------
const ics = await api("GET", `/api/event-ics/${e1.id}`, { headers: visitor(), raw: true });
ok("the calendar file is a calendar file with the event in it", ics.status === 200 && ics.type.startsWith("text/calendar") && ics.text.includes("BEGIN:VEVENT") && ics.text.includes("SUMMARY:Rally") && ics.text.includes("\r\n"), `${ics.status} ${ics.type} ${ics.text.slice(0, 120)}`);
ok("and it is not available for a draft", (await api("GET", `/api/event-ics/${draft.id}`, { headers: visitor(), raw: true })).status === 404);

const e10 = await createEvent({ rsvp: { open: true, maxGuests: 1 } });
const evil = await rsvp(e10.id, { name: "=HYPERLINK(\"http://evil.example\")", email: `evil.${stamp}@example.test`, guests: 1 });
const evilEvent = (await api("GET", `/api/event-rsvps?where[email][equals]=evil.${stamp}@example.test&depth=0`, { token: admin })).json?.docs?.[0];
const csv = evilEvent ? await api("GET", `/api/event-export/${typeof evilEvent.event === "object" ? evilEvent.event.id : evilEvent.event}`, { token: admin, raw: true }) : null;
ok("the spreadsheet export defuses a name that starts like a formula", evil.status === 200 && csv?.status === 200 && csv.type.startsWith("text/csv") && csv.text.includes("'=HYPERLINK") && csv.text.startsWith("Name,Email,Phone,Guests,Status,Registered"), `${csv?.status} ${csv?.text?.slice(0, 200)}`);
const csv1 = await api("GET", `/api/event-export/${e1.id}`, { token: admin, raw: true });
ok("the export lists the event's people", csv1.status === 200 && csv1.text.split("\r\n").length >= 5 && csv1.disposition.includes(`rsvps-event-${e1.id}`), csv1.text?.slice(0, 200));

for (const [what, res] of [
  ["the export", await api("GET", `/api/event-export/${e1.id}`, { raw: true })],
  ["the summary", await api("GET", `/api/event-summary/${e1.id}`)],
  ["the recount", await api("POST", `/api/event-recount/${e1.id}`)],
]) ok(`${what} needs a signed-in member of staff`, res.status === 401, res.status);
const anonRsvps = await api("GET", `/api/event-rsvps`);
ok("RSVPs (names and emails) are closed to the public", anonRsvps.status === 401 || anonRsvps.status === 403, anonRsvps.status);
const anonCreate = await api("POST", "/api/event-rsvps", { body: { event: e1.id, name: "x", email: "x@example.test", status: "confirmed" } });
ok("and nobody can add one without the endpoint's checks", anonCreate.status === 401 || anonCreate.status === 403, anonCreate.status);
const anonStats = await api("GET", "/api/event-stats");
ok("the counters are closed to everyone", anonStats.status === 401 || anonStats.status === 403, anonStats.status);
const adminStats = await api("GET", "/api/event-stats", { token: admin });
ok("even to an administrator, through the API", adminStats.status === 401 || adminStats.status === 403, adminStats.status);


// ---- deleting an event ---------------------------------------------------------------------------------------------------------------
const delWithRsvps = await api("DELETE", `/api/events/${e2.id}`, { token: admin });
ok("an event with RSVPs is not deleted out from under them, and staff are told what to do", delWithRsvps.status === 409 && /RSVP/.test(JSON.stringify(delWithRsvps.json)), `${delWithRsvps.status} ${JSON.stringify(delWithRsvps.json)}`);
for (const r of await rsvpsOf(e2.id)) await api("DELETE", `/api/event-rsvps/${r.id}`, { token: admin });
const delEmpty = await api("DELETE", `/api/events/${e2.id}`, { token: admin });
ok("once its RSVPs are deleted, the event (and its counter) goes", delEmpty.status === 200, `${delEmpty.status} ${JSON.stringify(delEmpty.json)}`);
const delDraft = await api("DELETE", `/api/events/${draft.id}`, { token: admin });
ok("an event nobody registered for can be deleted", delDraft.status === 200, delDraft.status);

const failures = results.filter((r) => !r).length;
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
