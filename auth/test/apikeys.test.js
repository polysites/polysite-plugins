import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanLabel, expiryFromDays, generateKey, hashKey, isExpired, keyFromHeader, looksLikeKey } from "../src/apikeys/keys.js";
import { ssoIdentities } from "../src/sso/identities.js";
import { userStateCollection } from "../src/userState.js";
import { apiKeys } from "../src/apikeys/collection.js";

const HMAC = Buffer.alloc(32, 9);

test("a key has the psk_ shape, is different every time, and shows only its first part", () => {
  const a = generateKey();
  const b = generateKey();
  assert.match(a.key, /^psk_[0-9a-f]{8}_[A-Za-z0-9]{32}$/);
  assert.ok(looksLikeKey(a.key));
  assert.notEqual(a.key, b.key);
  assert.equal(a.prefix, a.key.slice(0, 12));
  assert.ok(!a.key.slice(13).includes(a.prefix));
});

test("only a Bearer header holding a real-looking key is taken as a key", () => {
  const { key } = generateKey();
  assert.equal(keyFromHeader(`Bearer ${key}`), key);
  assert.equal(keyFromHeader(`bearer   ${key} `), key);
  for (const bad of [undefined, null, "", `JWT ${key}`, `Bearer`, `Bearer abc`, `Bearer ${key}x`, `Bearer ${key.slice(1)}`, `Bearer ${key} extra`, `users API-Key ${key}`, 42]) {
    assert.equal(keyFromHeader(bad), null, String(bad));
  }
});

test("a key is stored as a keyed hash: the same key and secret agree, anything else does not", () => {
  const { key } = generateKey();
  assert.match(hashKey(key, HMAC), /^[0-9a-f]{64}$/);
  assert.equal(hashKey(key, HMAC), hashKey(key, HMAC));
  assert.notEqual(hashKey(key, HMAC), hashKey(key, Buffer.alloc(32, 8)));
  assert.notEqual(hashKey(key, HMAC), hashKey(`${key}0`, HMAC));
  assert.ok(!hashKey(key, HMAC).includes(key.slice(13)));
});

test("a key expires on its date, and never when it has none", () => {
  const now = 1_700_000_000_000;
  assert.equal(isExpired({ expiresAt: null }, now), false);
  assert.equal(isExpired({}, now), false);
  assert.equal(isExpired({ expiresAt: new Date(now + 1000).toISOString() }, now), false);
  assert.equal(isExpired({ expiresAt: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(isExpired({ expiresAt: new Date(now).toISOString() }, now), true);
});

test("expiry in days: whole numbers from 1 to 3650, empty for none, anything else refused", () => {
  const now = 1_700_000_000_000;
  assert.equal(expiryFromDays(undefined, now), null);
  assert.equal(expiryFromDays(null, now), null);
  assert.equal(expiryFromDays("", now), null);
  assert.equal(expiryFromDays(30, now), new Date(now + 30 * 86_400_000).toISOString());
  assert.equal(expiryFromDays("7", now), new Date(now + 7 * 86_400_000).toISOString());
  for (const bad of [0, -1, 1.5, 3651, "soon", NaN]) assert.equal(expiryFromDays(bad, now), undefined, String(bad));
});

test("a label is short, plain text", () => {
  assert.equal(cleanLabel("  nightly   export "), "nightly export");
  assert.equal(cleanLabel(""), null);
  assert.equal(cleanLabel("   "), null);
  assert.equal(cleanLabel(undefined), null);
  assert.equal(cleanLabel("x".repeat(81)), null);
  assert.equal(cleanLabel("x".repeat(80)), "x".repeat(80));
});

const anonymous = { req: { user: null } };
const normal = { req: { user: { id: 3 } } };
const superAdmin = { req: { user: { id: 1, isSuperAdmin: true } } };

test("the two-factor row can't be read, made, changed or removed through the API, by anyone", () => {
  for (const op of ["read", "create", "update", "delete"]) {
    for (const who of [anonymous, normal, superAdmin]) assert.equal(userStateCollection.access[op](who), false, op);
  }
  assert.equal(userStateCollection.graphQL, false);
  for (const name of ["totpSecret", "totpPendingSecret", "totpLastStep", "recoveryCodeHashes", "totpEnabled"]) {
    const field = userStateCollection.fields.find((f) => f.name === name);
    assert.ok(field, name);
    assert.equal(field.access.read(superAdmin), false, name);
  }
});

test("linked sign-ins: a Super Admin may see and unlink them; nobody can make or edit one through the API", () => {
  assert.equal(ssoIdentities.access.read(superAdmin), true);
  assert.equal(ssoIdentities.access.read(normal), false);
  assert.equal(ssoIdentities.access.read(anonymous), false);
  assert.equal(ssoIdentities.access.delete(superAdmin), true);
  assert.equal(ssoIdentities.access.delete(normal), false);
  for (const who of [anonymous, normal, superAdmin]) {
    assert.equal(ssoIdentities.access.create(who), false);
    assert.equal(ssoIdentities.access.update(who), false);
  }
});

test("linked sign-ins keep two uniqueness keys, filled in from the row", () => {
  const [hook] = ssoIdentities.hooks.beforeValidate;
  assert.deepEqual(hook({ data: { user: 7, provider: "google", subject: "abc" }, originalDoc: undefined }), {
    user: 7,
    provider: "google",
    subject: "abc",
    identityKey: "google:abc",
    accountKey: "google:7",
  });
  assert.equal(hook({ data: { user: { id: 7 }, provider: "g", subject: "s" } }).accountKey, "g:7");
});

test("API keys: a person sees and deletes only their own, nobody makes or edits one through the API, the hash is never readable", () => {
  assert.equal(apiKeys.access.read(anonymous), false);
  assert.deepEqual(apiKeys.access.read(normal), { user: { equals: 3 } });
  assert.equal(apiKeys.access.read(superAdmin), true);
  assert.deepEqual(apiKeys.access.delete(normal), { user: { equals: 3 } });
  for (const who of [anonymous, normal, superAdmin]) {
    assert.equal(apiKeys.access.create(who), false);
    assert.equal(apiKeys.access.update(who), false);
  }
  const hash = apiKeys.fields.find((f) => f.name === "keyHash");
  assert.equal(hash.hidden, true);
  assert.equal(hash.access.read(superAdmin), false);
});

test("the 'me' answer for a key-signed request skips token details; other requests are left to Payload", async () => {
  const { meForKeys } = await import("../src/apikeys/strategy.js");
  const person = { id: 3, email: "a@example.test" };
  assert.deepEqual(meForKeys({ args: { req: { user: { _strategy: "polysite-api-key" } } }, user: person }), { user: person, exp: undefined });
  assert.equal(meForKeys({ args: { req: { user: { _strategy: "local-jwt" } } }, user: person }), undefined);
  assert.equal(meForKeys({ args: { req: {} }, user: person }), undefined);
  assert.equal(meForKeys({ user: person }), undefined);
});
