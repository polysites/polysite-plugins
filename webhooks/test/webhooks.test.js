import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";

import { attachCaptureHooks } from "../src/capture.js";
import { buildCollections } from "../src/collections.js";
import { decrypt, encrypt, isEncrypted } from "../src/crypto.js";
import { buildEvent, canonicalEvent, DATA_KEYS, EVENT_KEYS, EVENT_TYPES, endpointWants, eventTypesFor, typeForDelete } from "../src/events.js";
import webhooksPlugin from "../src/index.js";
import { backoffMs, cutoffDate, decideAfterFailure, isRetryable } from "../src/policy.js";
import { assertUrlAllowed, DeliveryError, isPrivateAddress, postJson } from "../src/request.js";
import { signature, signedHeaders, verify } from "../src/sign.js";

process.env.PAYLOAD_SECRET = "test-secret-for-the-webhooks-plugin";
const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

// ---- signing ------------------------------------------------------------------------------------------------------

test("the signature is HMAC-SHA256 over '<timestamp>.<body>' and has the documented form", () => {
  const sig = signature("s3cret-s3cret-s3cret", "1700000000", '{"a":1}');
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(sig, signature("s3cret-s3cret-s3cret", "1700000000", '{"a":1}'));
  assert.notEqual(sig, signature("s3cret-s3cret-s3cret", "1700000001", '{"a":1}'), "the timestamp is part of what is signed");
  assert.notEqual(sig, signature("another-secret-here", "1700000000", '{"a":1}'));
});

test("signed headers carry event, event id, delivery id, timestamp and signature", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const h = signedHeaders({ secret: "s3cret-s3cret-s3cret", type: "page.published", eventId: "evt_1", deliveryId: 7, body: "{}", now });
  assert.deepEqual(Object.keys(h).sort(), ["X-Polysite-Delivery", "X-Polysite-Event", "X-Polysite-Event-Id", "X-Polysite-Signature", "X-Polysite-Timestamp"]);
  assert.equal(h["X-Polysite-Timestamp"], String(now.getTime() / 1000));
  assert.equal(h["X-Polysite-Delivery"], "7");
});

test("a receiver accepts a fresh, untampered request and rejects tampering, a wrong secret and a replay outside the window", () => {
  const secret = "s3cret-s3cret-s3cret";
  const body = JSON.stringify({ id: "evt_1" });
  const t0 = new Date("2026-10-10T12:00:00Z");
  const headers = signedHeaders({ secret, type: "page.created", eventId: "evt_1", deliveryId: 1, body, now: t0 });
  assert.deepEqual(verify({ secret, headers, body, now: new Date(t0.getTime() + 60_000) }), { ok: true });
  assert.equal(verify({ secret, headers, body: body + " ", now: t0 }).ok, false, "a changed body");
  assert.equal(verify({ secret: "another-secret-here", headers, body, now: t0 }).ok, false, "a wrong secret");
  assert.match(verify({ secret, headers, body, now: new Date(t0.getTime() + 6 * 60_000) }).reason, /window/, "a replay six minutes later");
  assert.match(verify({ secret, headers, body, now: new Date(t0.getTime() - 6 * 60_000) }).reason, /window/, "a timestamp from the future");
  // Re-stamping a captured request does not help: the timestamp is inside the signature.
  assert.equal(verify({ secret, headers: { ...headers, "X-Polysite-Timestamp": String(t0.getTime() / 1000 + 600) }, body, now: new Date(t0.getTime() + 600_000) }).ok, false);
  assert.equal(verify({ secret, headers: {}, body, now: t0 }).ok, false);
});

test("a retry is signed afresh (new timestamp) but keeps the event id", () => {
  const first = signedHeaders({ secret: "s3cret-s3cret-s3cret", type: "page.created", eventId: "evt_9", deliveryId: 3, body: "{}", now: new Date(1_000_000) });
  const retry = signedHeaders({ secret: "s3cret-s3cret-s3cret", type: "page.created", eventId: "evt_9", deliveryId: 3, body: "{}", now: new Date(1_030_000) });
  assert.equal(first["X-Polysite-Event-Id"], retry["X-Polysite-Event-Id"]);
  assert.notEqual(first["X-Polysite-Signature"], retry["X-Polysite-Signature"]);
});

// ---- addresses (server-side request forgery) ----------------------------------------------------------------------

test("private, loopback, link-local and reserved addresses are refused, public ones are not", () => {
  for (const bad of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.2.5"]) {
    assert.equal(isPrivateAddress(bad), true, bad);
  }
  for (const good of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "93.184.216.34", "100.63.255.255"]) assert.equal(isPrivateAddress(good), false, good);
});

test("IPv6 loopback, unique-local, link-local, multicast and IPv4-embedded private addresses are refused", () => {
  for (const bad of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "0:0:0:0:0:ffff:a00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "::127.0.0.1"]) {
    assert.equal(isPrivateAddress(bad), true, bad);
  }
  for (const good of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) assert.equal(isPrivateAddress(good), false, good);
});

test("a destination URL is checked: scheme, credentials, literal addresses, https in production", () => {
  assert.doesNotThrow(() => assertUrlAllowed("https://hooks.zapier.com/hooks/catch/1/abc"));
  assert.throws(() => assertUrlAllowed("not a url"), /valid URL/);
  assert.throws(() => assertUrlAllowed("ftp://example.com/x"), /http/);
  assert.throws(() => assertUrlAllowed("https://user:pass@example.com/x"), /credentials/);
  for (const literal of ["https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/x", "https://[::ffff:7f00:1]/x", "https://[fe80::1]/x"]) {
    assert.throws(() => assertUrlAllowed(literal), /private or reserved/, literal);
  }
  process.env.NODE_ENV = "production";
  assert.throws(() => assertUrlAllowed("http://example.com/x"), /https is required/);
  assert.doesNotThrow(() => assertUrlAllowed("https://example.com/x"));
  process.env.WEBHOOKS_ALLOW_PRIVATE_HOSTS = "1";
  assert.doesNotThrow(() => assertUrlAllowed("http://10.0.0.5:8080/x"), "the test-only switch lifts both");
});

// ---- the request itself -------------------------------------------------------------------------------------------

function receiver(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ headers: req.headers, body, url: req.url });
        handler(req, res);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/hook` }));
  });
}

test("postJson refuses a loopback receiver unless the test-only switch is set", async () => {
  const r = await receiver((req, res) => res.end("ok"));
  try {
    await assert.rejects(postJson(r.url, { body: "{}" }), (e) => e instanceof DeliveryError && e.kind === "blocked");
    assert.equal(r.seen.length, 0, "nothing was sent");
    // A name that resolves to loopback is caught by the connection's own lookup.
    await assert.rejects(postJson(r.url.replace("127.0.0.1", "localhost"), { body: "{}" }), (e) => e.kind === "blocked" || e.kind === "invalid");
    assert.equal(r.seen.length, 0);
    process.env.WEBHOOKS_ALLOW_PRIVATE_HOSTS = "1";
    const ok = await postJson(r.url, { headers: { "X-Test": "1" }, body: '{"a":1}' });
    assert.equal(ok.status, 200);
    assert.equal(r.seen[0].body, '{"a":1}');
    assert.equal(r.seen[0].headers["x-test"], "1");
  } finally {
    r.server.close();
  }
});

test("postJson never follows a redirect and classifies the answers", async () => {
  process.env.WEBHOOKS_ALLOW_PRIVATE_HOSTS = "1";
  const target = await receiver((req, res) => res.end("internal"));
  const r = await receiver((req, res) => {
    if (req.url === "/hook") {
      res.writeHead(302, { Location: target.url });
      return res.end();
    }
    res.writeHead(500);
    res.end("secret detail the log must not keep");
  });
  try {
    await assert.rejects(postJson(r.url, { body: "{}" }), (e) => e.kind === "redirect" && e.status === 302);
    assert.equal(target.seen.length, 0, "the redirect target was never contacted");
    await assert.rejects(postJson(r.url.replace("/hook", "/x"), { body: "{}" }), (e) => {
      assert.equal(e.kind, "http");
      assert.equal(e.status, 500);
      assert.ok(!e.message.includes("secret detail"), "the receiver's reply is not kept in the error");
      return true;
    });
  } finally {
    r.server.close();
    target.server.close();
  }
});

test("postJson gives up on a receiver that never answers", async () => {
  process.env.WEBHOOKS_ALLOW_PRIVATE_HOSTS = "1";
  process.env.WEBHOOKS_TIMEOUT_MS = "300";
  const r = await receiver(() => {});
  try {
    await assert.rejects(postJson(r.url, { body: "{}" }), (e) => e.kind === "timeout");
  } finally {
    r.server.closeAllConnections?.();
    r.server.close();
  }
});

// ---- events -------------------------------------------------------------------------------------------------------

const page = (status, extra = {}) => ({ id: 12, title: "About us", _status: status, site: 1, ...extra });

test("a new page is 'created', and also 'published' when it is created already published", () => {
  assert.deepEqual(eventTypesFor({ collection: "pages", operation: "create", doc: page("draft") }), ["page.created"]);
  assert.deepEqual(eventTypesFor({ collection: "pages", operation: "create", doc: page("published") }), ["page.created", "page.published"]);
  assert.deepEqual(eventTypesFor({ collection: "posts", operation: "create", doc: page("draft") }), ["post.created"]);
});

test("events describe the live site: drafts send nothing, a transition is only the transition", () => {
  const e = (args) => eventTypesFor({ collection: "pages", operation: "update", ...args });
  assert.deepEqual(e({ doc: page("draft"), previousDoc: page("published"), isDraftSave: true }), [], "saving a draft (or an autosave) of a live page");
  assert.deepEqual(e({ doc: page("published"), previousDoc: page("draft"), liveStatus: "draft" }), ["page.published"]);
  assert.deepEqual(e({ doc: page("draft"), previousDoc: page("published"), liveStatus: "published" }), ["page.unpublished"]);
  assert.deepEqual(e({ doc: page("published"), previousDoc: page("published"), liveStatus: "published" }), ["page.updated"]);
  assert.deepEqual(e({ doc: page("draft"), previousDoc: page("draft"), liveStatus: "draft" }), ["page.updated"], "a page that isn't live");
  // The status the core records at the start of a save wins over the previous document (which may be a newer draft).
  assert.deepEqual(e({ doc: page("published"), previousDoc: page("published"), liveStatus: "draft" }), ["page.published"]);
  assert.deepEqual(typeForDelete("pages"), ["page.deleted"]);
  assert.deepEqual(typeForDelete("posts"), ["post.deleted"]);
  assert.deepEqual(typeForDelete("media"), []);
});

test("a form submission is 'submitted' once and media is 'uploaded' once; edits are not events", () => {
  assert.deepEqual(eventTypesFor({ collection: "form-submissions", operation: "create", doc: { id: 1 } }), ["form.submitted"]);
  assert.deepEqual(eventTypesFor({ collection: "form-submissions", operation: "update", doc: { id: 1 } }), []);
  assert.deepEqual(eventTypesFor({ collection: "media", operation: "create", doc: { id: 1 } }), ["media.uploaded"]);
  assert.deepEqual(eventTypesFor({ collection: "media", operation: "update", doc: { id: 1 } }), []);
  assert.deepEqual(eventTypesFor({ collection: "redirects", operation: "create", doc: { id: 1 } }), []);
});

test("every event type the hooks can produce is one an admin can choose", () => {
  const choosable = new Set(EVENT_TYPES.map((t) => t.value));
  const produced = [
    ...eventTypesFor({ collection: "pages", operation: "create", doc: page("published") }),
    ...eventTypesFor({ collection: "posts", operation: "create", doc: page("published") }),
    ...["pages", "posts"].flatMap((collection) => [
      ...eventTypesFor({ collection, operation: "update", doc: page("published"), liveStatus: "draft" }),
      ...eventTypesFor({ collection, operation: "update", doc: page("draft"), liveStatus: "published" }),
      ...eventTypesFor({ collection, operation: "update", doc: page("published"), liveStatus: "published" }),
      ...typeForDelete(collection),
    ]),
    ...eventTypesFor({ collection: "form-submissions", operation: "create", doc: {} }),
    ...eventTypesFor({ collection: "media", operation: "create", doc: {} }),
  ];
  for (const type of produced) assert.ok(choosable.has(type), type);
  assert.equal(new Set(produced).size, EVENT_TYPES.length, "and every choice is produced by something");
});

test("an event is built field by field: ids, titles and links, nothing else", () => {
  const doc = {
    id: 12,
    title: "About us",
    slug: "about",
    site: 1,
    content: [{ blockType: "hero", heading: "Secret draft text" }],
    createdBy: { email: "editor@example.com", name: "Alex" },
    email: "visitor@example.com",
    password: "hunter2",
  };
  const event = buildEvent({ eventId: "evt_1", type: "page.published", collection: "pages", doc, site: { id: 1, domain: "example.com", name: "Example" }, adminOrigin: "https://cms.example.com", now: new Date("2026-10-10T10:00:00Z") });
  assert.deepEqual(event, {
    id: "evt_1",
    type: "page.published",
    createdAt: "2026-10-10T10:00:00.000Z",
    site: { id: "1", domain: "example.com" },
    data: { collection: "pages", id: "12", title: "About us", adminUrl: "https://cms.example.com/admin/collections/pages/12", publicUrl: null },
  });
  const json = JSON.stringify(event);
  for (const leak of ["Secret draft text", "editor@example.com", "visitor@example.com", "hunter2", "Alex", "content", "password"]) assert.ok(!json.includes(leak), leak);
  assert.deepEqual(Object.keys(event), EVENT_KEYS);
  for (const key of Object.keys(event.data)) assert.ok(DATA_KEYS.includes(key), key);
});

test("a form submission event carries the ids and never what was submitted", () => {
  const submission = {
    id: 55,
    form: { id: 3, title: "Contact us", fields: [{ name: "email" }] },
    site: 1,
    submissionData: [{ field: "email", value: "jane.doe@example.com" }, { field: "message", value: "my medical history" }],
    consent: { given: true, statement: "I agree" },
    title: "jane.doe@example.com",
  };
  const event = buildEvent({ eventId: "evt_2", type: "form.submitted", collection: "form-submissions", doc: submission, site: { id: 1, domain: "example.com" } });
  assert.deepEqual(event.data, { collection: "form-submissions", id: "55", formId: "3", adminUrl: "/admin/collections/form-submissions/55", publicUrl: null });
  const json = JSON.stringify(event);
  for (const leak of ["jane.doe", "medical", "Contact us", "I agree", "submissionData", "consent"]) assert.ok(!json.includes(leak), leak);
  // The form given as a bare id works the same.
  assert.equal(buildEvent({ eventId: "e", type: "form.submitted", collection: "form-submissions", doc: { id: 1, form: 9 }, site: null }).data.formId, "9");
});

test("a deleted page links to the list, not to a document that is gone", () => {
  const event = buildEvent({ eventId: "e", type: "page.deleted", collection: "pages", doc: page("published"), site: { id: 1, domain: "example.com" } });
  assert.equal(event.data.adminUrl, "/admin/collections/pages");
});

test("which endpoints hear about which events", () => {
  const all = { active: true, events: ["page.published", "form.submitted"], site: null };
  const one = { active: true, events: ["page.published"], site: { id: 2 } };
  assert.equal(endpointWants(all, { type: "page.published", siteId: 1 }), true);
  assert.equal(endpointWants(all, { type: "page.deleted", siteId: 1 }), false, "an event it didn't ask for");
  assert.equal(endpointWants({ ...all, active: false }, { type: "page.published", siteId: 1 }), false, "switched off");
  assert.equal(endpointWants(one, { type: "page.published", siteId: 2 }), true);
  assert.equal(endpointWants(one, { type: "page.published", siteId: "2" }), true, "ids compare as text");
  assert.equal(endpointWants(one, { type: "page.published", siteId: 1 }), false, "another site's event");
  assert.equal(endpointWants(one, { type: "page.published", siteId: null }), false);
  assert.equal(endpointWants({ active: true, events: [], site: null }, { type: "page.published", siteId: 1 }), false);
});

// ---- retries ------------------------------------------------------------------------------------------------------

test("backoff doubles from the base and is capped", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => backoffMs(n, 30_000)), [30_000, 60_000, 120_000, 240_000, 480_000]);
  assert.equal(backoffMs(40, 30_000), 6 * 60 * 60 * 1000);
});

test("what is worth retrying", () => {
  for (const r of [{ kind: "network" }, { kind: "timeout" }, { kind: "http", status: 500 }, { kind: "http", status: 503 }, { kind: "http", status: 429 }, { kind: "http", status: 408 }]) assert.equal(isRetryable(r), true, JSON.stringify(r));
  for (const r of [{ kind: "http", status: 400 }, { kind: "http", status: 404 }, { kind: "http", status: 410 }, { kind: "redirect", status: 301 }, { kind: "blocked" }, { kind: "invalid" }]) assert.equal(isRetryable(r), false, JSON.stringify(r));
});

test("after a failure: retry with a wait, give up after the last attempt, or switch the endpoint off", () => {
  const d = (over) => decideAfterFailure({ attempt: 1, maxAttempts: 6, retryable: true, consecutiveFailures: 1, disableAfter: 10, ...over });
  assert.deepEqual(d({}), { disable: false, retry: true, status: "retrying", waitMs: backoffMs(1) });
  assert.equal(d({ attempt: 5 }).retry, true);
  assert.deepEqual(d({ attempt: 6 }), { disable: false, retry: false, status: "failed" }, "the last attempt");
  assert.deepEqual(d({ retryable: false }), { disable: false, retry: false, status: "failed" }, "a refusal isn't retried");
  assert.deepEqual(d({ consecutiveFailures: 10 }), { disable: true, retry: false, status: "failed" }, "the tenth failure in a row switches it off and stops retrying");
  assert.equal(d({ consecutiveFailures: 9 }).disable, false);
});

test("the delivery log is pruned by age", () => {
  assert.equal(cutoffDate(new Date("2026-10-31T00:00:00Z"), 30).toISOString(), "2026-10-01T00:00:00.000Z");
});

// ---- secrets ------------------------------------------------------------------------------------------------------

test("secrets are encrypted at rest and come back out", () => {
  const stored = encrypt("https://hooks.example.com/abc");
  assert.ok(isEncrypted(stored));
  assert.ok(!stored.includes("hooks.example.com"));
  assert.equal(decrypt(stored), "https://hooks.example.com/abc");
  assert.equal(encrypt(stored), stored, "already encrypted values aren't encrypted twice");
  assert.notEqual(encrypt("x".repeat(20)), encrypt("x".repeat(20)), "a fresh nonce each time");
});

test("the URL and secret fields are masked on read unless a caller asks for them", async () => {
  const [endpoints] = buildCollections();
  const field = (name) => endpoints.fields.find((f) => f.name === name);
  const stored = encrypt("super-long-signing-secret");
  for (const name of ["url", "secret"]) {
    const [afterRead] = field(name).hooks.afterRead;
    assert.equal(afterRead({ value: stored, req: { context: {} } }), "••••••••");
    assert.equal(afterRead({ value: stored, req: { context: { revealWebhookSecrets: true } } }), "super-long-signing-secret");
    assert.equal(afterRead({ value: stored, req: { context: { rawWebhookSecrets: true } } }), stored);
  }
  // "Mask means keep": saving the bullets back leaves the stored value as it was.
  const [beforeChange] = field("secret").hooks.beforeChange;
  const req = { payload: { findByID: async () => ({ secret: stored }) } };
  assert.equal(await beforeChange({ value: "••••••••", originalDoc: { id: 1 }, req }), stored);
  assert.ok(isEncrypted(await beforeChange({ value: "a-brand-new-secret-value", originalDoc: { id: 1 }, req })));
  assert.equal(await beforeChange({ value: undefined, originalDoc: { id: 1 }, req }), undefined, "a save that doesn't touch the field");
});

test("a signing secret needs 16 characters and the destination is checked as it is typed", async () => {
  const [endpoints] = buildCollections();
  const [secretCheck] = endpoints.fields.find((f) => f.name === "secret").hooks.beforeValidate;
  await assert.rejects(secretCheck({ value: "short", siblingData: {} }), /16 characters/);
  await assert.doesNotReject(secretCheck({ value: "a-long-enough-secret", siblingData: {} }));
  const [urlCheck] = endpoints.fields.find((f) => f.name === "url").hooks.beforeValidate;
  await assert.rejects(urlCheck({ value: "https://169.254.169.254/latest", siblingData: {} }), /private or reserved/);
  const sibling = {};
  process.env.WEBHOOKS_ALLOW_PRIVATE_HOSTS = "1";
  await urlCheck({ value: "http://10.1.2.3:9000/hook", siblingData: sibling });
  assert.equal(sibling.host, "10.1.2.3", "only the host is kept in the clear");
});

// ---- the plugin ---------------------------------------------------------------------------------------------------

test("the plugin adds no field, column or enum to any collection that isn't its own", () => {
  const pages = { slug: "pages", fields: [{ name: "title", type: "text" }], hooks: { afterChange: [() => {}] } };
  const media = { slug: "media", fields: [{ name: "alt", type: "text" }] };
  const users = { slug: "users", fields: [{ name: "email", type: "email" }] };
  const config = webhooksPlugin({ collections: [pages, media, users], jobs: { tasks: [{ slug: "other" }] } }, undefined);
  for (const original of [pages, media, users]) {
    const after = config.collections.find((c) => c.slug === original.slug);
    assert.deepEqual(after.fields, original.fields, `${original.slug} fields are unchanged`);
  }
  assert.deepEqual(config.collections.filter((c) => !["pages", "media", "users"].includes(c.slug)).map((c) => c.slug).sort(), ["webhook-deliveries", "webhook-endpoints"]);
  assert.equal(config.collections.find((c) => c.slug === "users").hooks, undefined, "collections it doesn't watch get no hooks");
  assert.equal(config.collections.find((c) => c.slug === "pages").hooks.afterChange.length, 2, "the page's own hook is kept and ours is appended");
  assert.equal(config.collections.find((c) => c.slug === "media").hooks.afterChange.length, 1);
  assert.deepEqual(config.jobs.tasks.map((t) => t.slug), ["other", "polysite-webhook-deliver"]);
});

test("the plugin's collections are for Super Admins only and the log can't be written by hand", async () => {
  const [endpoints, deliveries] = buildCollections();
  const asAdmin = { req: { user: { isSuperAdmin: true } } };
  const asEditor = { req: { user: { isSuperAdmin: false } } };
  for (const op of ["read", "create", "update", "delete"]) {
    assert.equal(endpoints.access[op](asAdmin), true, `endpoints ${op}`);
    assert.equal(endpoints.access[op](asEditor), false, `endpoints ${op} for an editor`);
  }
  assert.equal(deliveries.access.read(asAdmin), true);
  assert.equal(deliveries.access.read(asEditor), false);
  assert.equal(deliveries.access.create(asAdmin), false);
  assert.equal(deliveries.access.update(asAdmin), false);
  // The REST routes behind the buttons check it again themselves.
  const res = await endpoints.endpoints[0].handler({ user: { isSuperAdmin: false }, payload: {}, routeParams: { id: "1" } });
  assert.equal(res.status, 403);
  const res2 = await deliveries.endpoints[0].handler({ user: null, payload: {}, routeParams: { id: "1" } });
  assert.equal(res2.status, 403);
});

test("saving a draft sends nothing, publishing queues a delivery per interested endpoint (hooks, with a stub of Payload)", async () => {
  const kit = {
    workflow: {
      isDraftRequest: (q) => q?.draft === true || q?.draft === "true",
      liveBefore: (req) => req.context.polysiteLiveBefore,
    },
  };
  const queued = [];
  const created = [];
  const payload = {
    config: { serverURL: "https://cms.example.com", routes: { admin: "/admin" } },
    find: async () => ({
      docs: [
        { id: 1, name: "mirror", active: true, events: ["page.published"], site: null },
        { id: 2, name: "other site", active: true, events: ["page.published"], site: 99 },
        { id: 3, name: "forms only", active: true, events: ["form.submitted"], site: null },
      ],
    }),
    findByID: async () => ({ id: 1, domain: "example.com" }),
    create: async ({ data }) => {
      created.push(data);
      return { id: created.length, ...data };
    },
    jobs: { queue: async (job) => queued.push(job), run: async () => {} },
  };
  const collection = attachCaptureHooks({ slug: "pages", fields: [] }, kit);
  const [afterChange] = collection.hooks.afterChange;
  const req = (query, live) => ({ payload, query, context: { polysiteLiveBefore: { status: live } } });

  await afterChange({ doc: { id: 5, title: "T", _status: "draft", site: 1 }, previousDoc: { _status: "published" }, operation: "update", req: req({ draft: "true" }, "published") });
  assert.equal(created.length, 0, "a draft save");

  await afterChange({ doc: { id: 5, title: "T", _status: "published", site: 1 }, previousDoc: { _status: "draft" }, operation: "update", req: req({}, "draft") });
  assert.equal(created.length, 1, "only the endpoint for this site and this event");
  assert.equal(created[0].endpoint, 1);
  assert.equal(created[0].event.type, "page.published");
  assert.equal(created[0].event.site.domain, "example.com");
  assert.equal(queued.length, 1);
  assert.deepEqual(Object.keys(queued[0].input).sort(), ["deliveryId", "endpointId"], "the job carries ids, never a secret or the event");

  const skip = { ...req({}, "draft"), context: { skipWebhooks: true } };
  await afterChange({ doc: { id: 6, title: "T", _status: "published", site: 1 }, previousDoc: {}, operation: "create", req: skip });
  assert.equal(created.length, 1, "writes marked skipWebhooks (imports) send nothing");
});

test("an event is sent in its documented key order, whatever order the database returns it in", () => {
  const scrambled = { site: { domain: "example.com", id: "1" }, data: { publicUrl: null, adminUrl: "/a", id: "3", title: "T", collection: "pages", extra: "dropped" }, createdAt: "x", type: "page.created", id: "evt_1", leak: "dropped" };
  const sent = canonicalEvent(scrambled);
  assert.deepEqual(Object.keys(sent), EVENT_KEYS);
  assert.deepEqual(Object.keys(sent.data), ["collection", "id", "title", "adminUrl", "publicUrl"]);
  assert.deepEqual(Object.keys(sent.site), ["id", "domain"]);
  assert.ok(!JSON.stringify(sent).includes("dropped"), "nothing outside the documented keys is ever sent");
  assert.equal(canonicalEvent({ ...scrambled, site: null }).site, null);
});
