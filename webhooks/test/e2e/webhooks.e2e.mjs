// End-to-end check of the Webhooks plugin against a RUNNING stack and a RUNNING test receiver (plugins/webhooks/test/receiver.mjs).
//
//   RECEIVER=http://webhook-receiver:9100 BASE=http://cms:3001 ADMIN_EMAIL=... ADMIN_PASSWORD=... SITE_ID=1 SITE_HOST=voidslate.localhost \
//     OTHER_SITE_ID=2 node plugins/webhooks/test/e2e/webhooks.e2e.mjs
//
// The CMS must run with WEBHOOKS_ALLOW_PRIVATE_HOSTS=1 (the receiver is on a private network, and plain http), and with short
// retries so this finishes in about a minute: WEBHOOKS_RETRY_DELAY_MS=1000 WEBHOOKS_MAX_ATTEMPTS=3 WEBHOOKS_DISABLE_AFTER=5.
// It checks: what is sent for each kind of change and that it carries no content or personal data; the signature, the replay
// window and the event id as a receiver sees them; a site-scoped endpoint hears only its site; failure, retries with backoff and
// success; switching an endpoint off after repeated failures, and replaying what was missed; the test event; that secrets are
// masked and never reach the delivery log. It puts everything back, except the form it submits to (Polysite does not let a form with
// submissions be deleted by hand), so run it on a throwaway stack (tests/e2e/run-with-plugins.sh does not run it yet).
const BASE = process.env.BASE;
const RECEIVER = process.env.RECEIVER;
const SITE_ID = Number(process.env.SITE_ID ?? 1);
const SITE_HOST = process.env.SITE_HOST ?? "voidslate.localhost";
const OTHER_SITE_ID = Number(process.env.OTHER_SITE_ID ?? 2);
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(Boolean(cond));
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + String(extra).slice(0, 500)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body, headers, form } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(form ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `JWT ${token}` } : {}), ...headers },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const rx = async (method, path, body) => {
  const res = await fetch(RECEIVER + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json();
};
const received = (name) => rx("GET", `/_log?name=${name}`);
const waitFor = async (what, check, ms = 30_000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last) return last;
    await sleep(250);
  }
  ok(`(timed out waiting for ${what})`, false);
  return null;
};
const waitCount = (name, n, ms) => waitFor(`${n} request(s) at "${name}"`, async () => ((await received(name)).length >= n ? await received(name) : null), ms);
// Anything that was going to arrive has arrived by now.
const settle = () => sleep(2500);

const lexical = (text) => ({ root: { type: "root", format: "", indent: 0, version: 1, direction: null, children: [{ type: "paragraph", format: "", indent: 0, version: 1, direction: null, children: [{ type: "text", text, version: 1, format: 0, mode: "normal", style: "", detail: 0 }] }] } });
const hero = (heading) => [{ blockType: "hero", heading, subheading: "" }];

const login = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
const admin = login.json?.token;
ok("admin signs in", Boolean(admin));

const stamp = Date.now().toString(36);
const SECRET = `e2e-signing-secret-${stamp}-0123456789`;
const SECRET_OTHER = `e2e-other-secret-${stamp}-0123456789`;
const URL_OF = (name) => `${RECEIVER}/hook/${name}`;
const BODY_MARKER = `BODY-MARKER-${stamp}`;
const EMAIL_MARKER = `jane.privacy.${stamp}`;
const REPLY_MARKER = `REPLY-MARKER-${stamp}`;
const made = []; // [collection, id], removed at the end
const create = async (collection, body, extra = {}) => {
  const res = await api("POST", `/api/${collection}`, { token: admin, body, ...extra });
  const id = res.json?.doc?.id;
  if (id) made.push([collection, id]);
  return { ...res, id };
};
const endpoint = (name, over = {}) =>
  create("webhook-endpoints", { name, url: URL_OF(name), secret: SECRET, events: ["page.published"], active: true, ...over });
const deliveriesOf = async (endpointId) => (await api("GET", `/api/webhook-deliveries?where[endpoint][equals]=${endpointId}&sort=id&depth=0&limit=50`, { token: admin })).json?.docs ?? [];
const get = async (collection, id) => (await api("GET", `/api/${collection}/${id}?depth=0`, { token: admin })).json;

await rx("POST", "/_reset");

try {
  // ---- who may manage them, and what is refused ----------------------------------------------------------------------
  const anon = await api("GET", "/api/webhook-endpoints");
  ok("webhooks can't be read without signing in", anon.status === 401 || anon.status === 403, `${anon.status}`);
  const anonTest = await api("POST", "/api/webhook-endpoints/1/test");
  ok("the test button's route needs a Super Admin", anonTest.status === 401 || anonTest.status === 403, `${anonTest.status}`);

  const base = { name: "bad", events: ["page.published"], secret: SECRET };
  const ftp = await api("POST", "/api/webhook-endpoints", { token: admin, body: { ...base, url: "ftp://example.com/x" } });
  ok("a destination that isn't http(s) is refused", ftp.status === 400, `${ftp.status} ${JSON.stringify(ftp.json)}`);
  const noHost = await api("POST", "/api/webhook-endpoints", { token: admin, body: { ...base, url: "https://no-such-host.invalid/x" } });
  ok("a host name that doesn't exist is refused", noHost.status === 400, `${noHost.status} ${JSON.stringify(noHost.json)}`);
  const creds = await api("POST", "/api/webhook-endpoints", { token: admin, body: { ...base, url: "https://user:pw@example.com/x" } });
  ok("credentials in the URL are refused", creds.status === 400, `${creds.status}`);
  const shortSecret = await api("POST", "/api/webhook-endpoints", { token: admin, body: { ...base, url: URL_OF("bad"), secret: "short" } });
  ok("a short signing secret is refused", shortSecret.status === 400, `${shortSecret.status}`);
  const noSecret = await api("POST", "/api/webhook-endpoints", { token: admin, body: { name: "bad", url: URL_OF("bad"), events: ["page.published"] } });
  ok("a webhook needs a signing secret", noSecret.status === 400, `${noSecret.status}`);
  const noEvents = await api("POST", "/api/webhook-endpoints", { token: admin, body: { ...base, url: URL_OF("bad"), events: [] } });
  ok("a webhook needs at least one event", noEvents.status === 400, `${noEvents.status}`);

  // ---- the endpoints --------------------------------------------------------------------------------------------------
  const ALL = ["page.created", "page.updated", "page.published", "page.unpublished", "page.deleted", "post.created", "post.updated", "post.published", "post.unpublished", "post.deleted", "form.submitted", "media.uploaded"];
  await rx("POST", "/_config/a", { secret: SECRET });
  await rx("POST", "/_config/b", { secret: SECRET_OTHER });
  const a = await endpoint("a", { events: ALL });
  const b = await endpoint("b", { secret: SECRET_OTHER, events: ["page.created", "page.published"], site: OTHER_SITE_ID });
  ok("endpoints are created", a.status === 201 && b.status === 201, `${a.status} ${b.status} ${JSON.stringify(a.json)}`);

  const readBack = await get("webhook-endpoints", a.id);
  ok("the URL and the secret are masked when read back", readBack.url === "••••••••" && readBack.secret === "••••••••", JSON.stringify(readBack));
  ok("only the host name is shown", readBack.host === new URL(RECEIVER).hostname, readBack.host);
  ok("neither the secret nor the URL path appears anywhere in what the API returns", !JSON.stringify(readBack).includes(SECRET) && !JSON.stringify(readBack).includes("/hook/a"));
  const list = await api("GET", "/api/webhook-endpoints?depth=0&limit=50", { token: admin });
  ok("nor in the list", !JSON.stringify(list.json).includes(SECRET) && !JSON.stringify(list.json).includes("/hook/a"));
  // The admin form sends the bullets back when you only rename: the stored values must survive.
  const renamed = await api("PATCH", `/api/webhook-endpoints/${a.id}`, { token: admin, body: { name: "a (renamed)", url: "••••••••", secret: "••••••••" } });
  ok("saving with the bullets keeps the stored URL and secret", renamed.status === 200, `${renamed.status} ${JSON.stringify(renamed.json)}`);

  // ---- the test event -------------------------------------------------------------------------------------------------
  const test = await api("POST", `/api/webhook-endpoints/${a.id}/test`, { token: admin });
  ok("'send test event' reports the receiver's answer", test.status === 200 && test.json?.ok === true && test.json?.status === 200, JSON.stringify(test.json));
  const testLog = (await waitCount("a", 1))?.[0];
  ok("the receiver verified the test event", testLog?.verified === true && testLog?.event === "webhook.test" && testLog?.body?.type === "webhook.test", JSON.stringify(testLog)?.slice(0, 300));
  const testDeliveries = await deliveriesOf(a.id);
  ok("the test is in the delivery log, marked as a test", testDeliveries.length === 1 && testDeliveries[0].isTest === true && testDeliveries[0].status === "sent", JSON.stringify(testDeliveries));

  // ---- pages: created, draft, published, updated, unpublished, deleted ---------------------------------------------------
  const slug = `wh-${stamp}`;
  const draftTitle = `Webhook page ${stamp}`;
  const lastEvent = async (n) => {
    const log = await waitCount("a", 1 + n);
    return log?.[log.length - 1];
  };
  let expected = 0; // events other than the test event, seen at "a"
  const step = async () => lastEvent(++expected);

  const page = await create("pages", { title: draftTitle, slug, site: SITE_ID, _status: "draft", content: hero(BODY_MARKER) });
  ok("a page is written", page.status === 201, JSON.stringify(page.json)?.slice(0, 300));
  const created = await step();
  ok("a new page sends page.created", created?.event === "page.created" && created?.body?.data?.id === String(page.id), JSON.stringify(created)?.slice(0, 300));

  await api("PATCH", `/api/pages/${page.id}?draft=true`, { token: admin, body: { title: `${draftTitle} (draft edit)`, _status: "draft" } });
  await settle();
  ok("saving a draft sends nothing", (await received("a")).length === 1 + expected, `${(await received("a")).length}`);

  await api("PATCH", `/api/pages/${page.id}`, { token: admin, body: { _status: "published" } });
  const published = await step();
  ok("publishing sends page.published", published?.event === "page.published", JSON.stringify(published)?.slice(0, 300));
  ok("with a public address once the page has one", typeof published?.body?.data?.publicUrl === "string" && published.body.data.publicUrl.endsWith(`/${slug}`), `${published?.body?.data?.publicUrl}`);

  await api("PATCH", `/api/pages/${page.id}`, { token: admin, body: { title: `${draftTitle} (live edit)`, _status: "published" } });
  const updated = await step();
  ok("changing a live page sends page.updated", updated?.event === "page.updated" && updated?.body?.data?.title === `${draftTitle} (live edit)`, JSON.stringify(updated)?.slice(0, 300));

  await api("PATCH", `/api/pages/${page.id}`, { token: admin, body: { _status: "draft" } });
  const unpublished = await step();
  ok("unpublishing sends page.unpublished", unpublished?.event === "page.unpublished", JSON.stringify(unpublished)?.slice(0, 300));

  const del = await api("DELETE", `/api/pages/${page.id}`, { token: admin });
  const deleted = await step();
  ok("deleting sends page.deleted", del.status === 200 && deleted?.event === "page.deleted" && deleted?.body?.data?.adminUrl?.endsWith("/admin/collections/pages"), `${del.status} ${JSON.stringify(deleted)?.slice(0, 300)}`);

  // ---- what every message looked like -------------------------------------------------------------------------------------
  const seen = (await received("a")).slice(1);
  ok("every message carried a good signature, inside the replay window", seen.length === 5 && seen.every((e) => e.verified === true && e.answered === 200), JSON.stringify(seen.map((e) => [e.event, e.verified, e.reason])));
  ok("the headers are the documented ones", seen.every((e) => /^sha256=[0-9a-f]{64}$/.test(e.signature) && /^evt_/.test(e.eventId) && /^\d{10}$/.test(e.timestamp) && e.deliveryId && e.userAgent?.startsWith("Polysite-Webhooks/")), JSON.stringify(seen[0]));
  ok("each event has its own id and the timestamp is current", new Set(seen.map((e) => e.eventId)).size === 5 && seen.every((e) => Math.abs(Date.now() / 1000 - Number(e.timestamp)) < 120));
  ok("the body is the small documented shape", seen.every((e) => JSON.stringify(Object.keys(e.body)) === JSON.stringify(["id", "type", "createdAt", "site", "data"]) && e.body.site?.id === String(SITE_ID) && e.body.site?.domain === SITE_HOST), JSON.stringify(seen[0]?.body));
  ok("no page content, draft text or user details in any message", seen.every((e) => !e.raw.includes(BODY_MARKER) && !e.raw.includes("@") && !/content|password|email/i.test(e.raw)), seen.find((e) => /content|password|email|@/i.test(e.raw))?.raw);
  ok("the admin link points at the document", seen[0].body.data.adminUrl.includes(`/admin/collections/pages/${page.id}`), seen[0].body.data.adminUrl);

  // ---- the receiver's side of replay protection -------------------------------------------------------------------------
  const captured = seen[1];
  const resend = (name, over = {}) =>
    fetch(`${RECEIVER}/hook/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Polysite-Event": captured.event, "X-Polysite-Event-Id": captured.eventId, "X-Polysite-Timestamp": captured.timestamp, "X-Polysite-Signature": captured.signature, ...over.headers },
      body: over.body ?? captured.raw,
    });
  await rx("POST", "/_config/strict", { secret: SECRET, toleranceSeconds: 1 });
  await rx("POST", "/_config/forge", { secret: SECRET });
  const tampered = await resend("forge", { body: captured.raw.replace("page", "pagE") });
  ok("a receiver rejects a body that was changed in transit", tampered.status === 401, `${tampered.status}`);
  const replayed = await resend("strict");
  ok("and a signed message that is replayed outside its window", replayed.status === 409, `${replayed.status}`);
  const restamped = await resend("forge", { headers: { "X-Polysite-Timestamp": String(Math.floor(Date.now() / 1000)) } });
  ok("re-stamping a captured message does not help: the timestamp is part of the signature", restamped.status === 401, `${restamped.status}`);

  // ---- other kinds of events -----------------------------------------------------------------------------------------
  const form = await create("forms", {
    title: `Contact ${stamp}`,
    site: SITE_ID,
    fields: [{ blockType: "email", name: "email", label: "Email", required: true }],
    submitButtonLabel: "Send",
    confirmationType: "message",
    confirmationMessage: lexical("Thanks"),
  });
  ok("a form is written", form.status === 201, JSON.stringify(form.json)?.slice(0, 200));
  const intake = { "X-Forwarded-Host": SITE_HOST, "X-Forwarded-For": "198.51.100.77" };
  const def = await api("GET", `/api/form-intake/${form.id}`, { headers: intake });
  await sleep(2500); // the form refuses a submission made faster than a person could type it
  const submitted = await api("POST", `/api/form-intake/${form.id}`, { headers: intake, body: { data: { email: `${EMAIL_MARKER}@example.test` }, token: def.json?.token, consent: true } });
  ok("a visitor submits the form", submitted.status === 200 && submitted.json?.ok === true, `${submitted.status} ${JSON.stringify(submitted.json)}`);
  expected++;
  const formEvent = await lastEvent(expected);
  const submissionId = (await api("GET", `/api/form-submissions?where[form][equals]=${form.id}&depth=0&limit=1`, { token: admin })).json?.docs?.[0]?.id;
  if (submissionId) made.push(["form-submissions", submissionId]);
  ok("a submission sends form.submitted with the form and submission ids", formEvent?.event === "form.submitted" && formEvent?.body?.data?.formId === String(form.id) && formEvent?.body?.data?.id === String(submissionId), JSON.stringify(formEvent)?.slice(0, 400));
  ok("and nothing the visitor typed (no answer, no email, no consent text, no form title)", !formEvent.raw.includes(EMAIL_MARKER) && !formEvent.raw.includes("example.test") && !/email|consent|submissionData|Contact /i.test(formEvent.raw), formEvent?.raw);
  ok("the submission's own data never reached the delivery log either", !JSON.stringify(await deliveriesOf(a.id)).includes(EMAIL_MARKER));

  // A 1x1 PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), `wh-${stamp}.png`);
  fd.append("_payload", JSON.stringify({ alt: "A test pixel", site: SITE_ID }));
  const media = await api("POST", "/api/media", { token: admin, form: fd });
  if (media.json?.doc?.id) made.push(["media", media.json.doc.id]);
  ok("an image is uploaded", media.status === 201, `${media.status} ${JSON.stringify(media.json)?.slice(0, 200)}`);
  expected++;
  const mediaEvent = await lastEvent(expected);
  ok("an upload sends media.uploaded", mediaEvent?.event === "media.uploaded" && mediaEvent?.body?.data?.id === String(media.json?.doc?.id), JSON.stringify(mediaEvent)?.slice(0, 300));

  // ---- one site, or all of them ------------------------------------------------------------------------------------------
  const before = (await received("a")).length;
  const bBefore = (await received("b")).length;
  const here = await create("pages", { title: `Here ${stamp}`, slug: `${slug}-here`, site: SITE_ID, _status: "published", content: hero("x") });
  const there = await create("pages", { title: `There ${stamp}`, slug: `${slug}-there`, site: OTHER_SITE_ID, _status: "published", content: hero("x") });
  ok("pages are written on both sites", here.status === 201 && there.status === 201);
  await waitCount("a", before + 3); // created + published for each... here: 2, there: 2 -> 4; at least three have arrived
  await waitCount("b", bBefore + 2);
  await settle();
  const aNew = (await received("a")).slice(before);
  const bNew = (await received("b")).slice(bBefore);
  ok("an endpoint for all sites hears about both sites", aNew.filter((e) => e.event === "page.published").map((e) => e.body.site.id).sort().join() === [SITE_ID, OTHER_SITE_ID].sort().join(), JSON.stringify(aNew.map((e) => [e.event, e.body.site])));
  ok("an endpoint for one site hears only about that site", bNew.length === 2 && bNew.every((e) => e.body.site.id === String(OTHER_SITE_ID) && e.verified), JSON.stringify(bNew.map((e) => [e.event, e.body.site, e.verified])));
  ok("and only the events it asked for", bNew.map((e) => e.event).sort().join() === "page.created,page.published", JSON.stringify(bNew.map((e) => e.event)));
  const bDeliveries = await deliveriesOf(b.id);
  ok("the other site's endpoint has no deliveries for this site's events", bDeliveries.every((d) => d.event?.site?.id === String(OTHER_SITE_ID)), JSON.stringify(bDeliveries.map((d) => d.event?.site)));
  ok("the receiver verified the other secret separately", bNew.every((e) => e.verified));

  // ---- failure, retries, success -----------------------------------------------------------------------------------------
  await rx("POST", "/_config/retry", { secret: SECRET, status: 500, failNext: 2, replyBody: JSON.stringify({ error: REPLY_MARKER }) });
  const r = await endpoint("retry");
  const rp = await create("pages", { title: `Retry ${stamp}`, slug: `${slug}-retry`, site: SITE_ID, _status: "published", content: hero("x") });
  ok("a page is published to a receiver that is failing", r.status === 201 && rp.status === 201);
  const first = await waitCount("retry", 1);
  let sawRetrying = null;
  if (first) sawRetrying = await waitFor("a delivery waiting for its retry", async () => (await deliveriesOf(r.id)).find((d) => d.status === "retrying"), 3000);
  ok("a failed delivery says it will retry, with the error and the response code", sawRetrying?.responseCode === 500 && sawRetrying?.attempts === 1 && Boolean(sawRetrying?.nextAttemptAt) && /500/.test(sawRetrying?.lastError ?? ""), JSON.stringify(sawRetrying));
  const tries = await waitCount("retry", 3);
  await settle();
  const retryLog = await received("retry");
  ok("it was tried three times, the third succeeded", retryLog.length === 3 && retryLog.map((e) => e.answered).join() === "500,500,200", JSON.stringify(retryLog.map((e) => [e.answered, e.reason])));
  ok("every attempt carried the same event id and a valid signature", new Set(retryLog.map((e) => e.eventId)).size === 1 && retryLog.every((e) => e.reason === "told to fail" || e.verified), JSON.stringify(retryLog.map((e) => [e.eventId, e.verified])));
  ok("each attempt was signed afresh and the waits grow (backoff)", new Set(retryLog.map((e) => e.signature)).size === 3 && Date.parse(retryLog[1].at) - Date.parse(retryLog[0].at) >= 900 && Date.parse(retryLog[2].at) - Date.parse(retryLog[1].at) >= 1800, JSON.stringify(retryLog.map((e) => e.at)));
  const rd = (await deliveriesOf(r.id)).find((d) => d.eventType === "page.published");
  ok("the log ends as sent after 3 attempts, response 200, no error", rd?.status === "sent" && rd?.attempts === 3 && rd?.responseCode === 200 && !rd?.lastError, JSON.stringify(rd));
  ok("a success sets the failure count back to zero", (await get("webhook-endpoints", r.id)).consecutiveFailures === 0);
  ok("the receiver's reply text was never kept", !JSON.stringify(await deliveriesOf(r.id)).includes(REPLY_MARKER));

  // ---- switching off after repeated failures, and replay -----------------------------------------------------------------
  await rx("POST", "/_config/dead", { secret: SECRET, status: 500, failNext: 999, replyBody: JSON.stringify({ error: REPLY_MARKER }) });
  const d = await endpoint("dead");
  const publish = (n) => create("pages", { title: `Dead ${n} ${stamp}`, slug: `${slug}-dead-${n}`, site: SITE_ID, _status: "published", content: hero("x") });
  await publish(1);
  await waitCount("dead", 3);
  await waitFor("the first delivery to give up", async () => (await deliveriesOf(d.id)).find((x) => x.status === "failed"), 15_000);
  const afterOne = await get("webhook-endpoints", d.id);
  ok("after the last attempt the delivery is failed, and the endpoint is still on", afterOne.active === true && afterOne.consecutiveFailures === 3, JSON.stringify(afterOne));
  await publish(2);
  await waitFor("the endpoint to be switched off", async () => (await get("webhook-endpoints", d.id)).active === false, 15_000);
  await settle();
  const off = await get("webhook-endpoints", d.id);
  ok("five failures in a row switch the endpoint off, with a reason and a time", off.active === false && off.consecutiveFailures === 5 && /5 failed attempts/.test(off.disabledReason ?? "") && Boolean(off.disabledAt), JSON.stringify(off));
  const deadLog = await received("dead");
  ok("and the receiver saw exactly five attempts", deadLog.length === 5, `${deadLog.length}`);
  const failed = (await deliveriesOf(d.id)).filter((x) => x.status === "failed");
  ok("both deliveries are failed, the second says why it stopped", failed.length === 2 && failed.some((x) => /switched off/.test(x.lastError ?? "")) && failed.every((x) => x.responseCode === 500), JSON.stringify(failed));
  await publish(3);
  await settle();
  ok("a switched-off endpoint is sent nothing more", (await received("dead")).length === 5 && (await deliveriesOf(d.id)).length === 2);
  const dashboard = await api("GET", "/api/webhook-endpoints?where[active][equals]=false&where[disabledReason][exists]=true&depth=0", { token: admin });
  ok("the admin can find switched-off endpoints (the dashboard notice reads this)", dashboard.json?.docs?.some((x) => x.id === d.id), JSON.stringify(dashboard.json)?.slice(0, 200));

  const blocked = await api("POST", `/api/webhook-deliveries/${failed[0].id}/replay`, { token: admin });
  ok("a delivery can't be replayed while its endpoint is off", blocked.status === 409, `${blocked.status} ${JSON.stringify(blocked.json)}`);
  await rx("POST", "/_config/dead", { failNext: 0, replyBody: "" });
  const testWhileOff = await api("POST", `/api/webhook-endpoints/${d.id}/test`, { token: admin });
  ok("the test event still works on a switched-off endpoint, and doesn't touch the failure count", testWhileOff.json?.ok === true && (await get("webhook-endpoints", d.id)).consecutiveFailures === 5, JSON.stringify(testWhileOff.json));
  const on = await api("PATCH", `/api/webhook-endpoints/${d.id}`, { token: admin, body: { active: true } });
  const reenabled = on.json?.doc;
  ok("switching it on again starts from a clean slate", on.status === 200 && reenabled?.active === true && reenabled?.consecutiveFailures === 0 && !reenabled?.disabledReason, JSON.stringify(on.json)?.slice(0, 300));
  const toReplay = failed.find((x) => x.eventType === "page.published");
  const before2 = (await received("dead")).length;
  const replay = await api("POST", `/api/webhook-deliveries/${toReplay.id}/replay`, { token: admin });
  ok("a failed delivery is replayed", replay.status === 200 && replay.json?.ok === true, `${replay.status} ${JSON.stringify(replay.json)}`);
  await waitFor("the replayed delivery to be sent", async () => (await get("webhook-deliveries", toReplay.id)).status === "sent", 20_000);
  const replayed2 = (await received("dead")).slice(before2);
  const row = await get("webhook-deliveries", toReplay.id);
  ok("the replay sends the same event again (same id), signed afresh, and the receiver accepts it", replayed2.length === 1 && replayed2[0].verified && replayed2[0].eventId === toReplay.eventId && row.replays === 1 && row.status === "sent" && row.attempts === 1, JSON.stringify([replayed2.length, row.replays, row.status, row.attempts]));
  const sentAgain = await api("POST", `/api/webhook-deliveries/${toReplay.id}/replay`, { token: admin });
  ok("a delivery that was sent can't be replayed", sentAgain.status === 409, `${sentAgain.status}`);

  // ---- secrets and the log ---------------------------------------------------------------------------------------------------
  const everything = JSON.stringify((await api("GET", "/api/webhook-deliveries?depth=1&limit=200", { token: admin })).json) + JSON.stringify((await api("GET", "/api/webhook-endpoints?depth=0&limit=50", { token: admin })).json);
  ok("no signing secret, destination URL or reply text anywhere in the log or the endpoint list", ![SECRET, SECRET_OTHER, "/hook/", REPLY_MARKER].some((s) => everything.includes(s)), [SECRET, SECRET_OTHER, "/hook/", REPLY_MARKER].filter((s) => everything.includes(s)).join());
  const stored = await api("GET", `/api/webhook-endpoints/${a.id}?depth=0`, { token: admin });
  ok("the stored endpoint still delivers after being renamed with the bullets (earlier steps were verified with the original secret)", seen.every((e) => e.verified) && stored.json?.name === "a (renamed)");
} catch (err) {
  ok(`the run completed (${err.message})`, false, err.stack);
} finally {
  // Put everything back: the endpoints first (so removing the rest raises no more events), then what the run made.
  const endpoints = made.filter(([c]) => c === "webhook-endpoints").map(([, id]) => id);
  for (const id of endpoints) {
    for (const d of await deliveriesOf(id)) await api("DELETE", `/api/webhook-deliveries/${d.id}`, { token: admin }).catch(() => {});
    await api("DELETE", `/api/webhook-endpoints/${id}`, { token: admin }).catch(() => {});
  }
  for (const [collection, id] of [...made].reverse()) {
    if (collection !== "webhook-endpoints") await api("DELETE", `/api/${collection}/${id}`, { token: admin }).catch(() => {});
  }
}

const failures = results.filter((r) => !r).length;
console.log(`${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
