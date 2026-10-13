import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PAYLOAD_SECRET = "captcha-test-secret-captcha-test-secret";

const { SECRET_MASK, decrypt, encrypt } = await import("../src/crypto.js");
const {
  HEADER,
  SITEVERIFY,
  captchaBeforeOperation,
  clientAddress,
  decide,
  loadConfig,
  publicConfig,
  resolveConfig,
  secretAfterRead,
  secretBeforeChange,
  signInProtectionField,
  tokenFromRequest,
  verifyTurnstile,
} = await import("../src/captcha.js");

const PASS_SITE = "1x00000000000000000000AA";
const PASS_SECRET = "1x0000000000000000000000000000000AA";
const headers = (entries) => new Headers(entries);
const answering = (body, init = {}) => async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
const on = { on: true, signIn: true, reset: true, siteKey: PASS_SITE, secret: PASS_SECRET };

// --- the address and the header ----------------------------------------------------------------------------------------

test("the address is the last X-Forwarded-For entry, else X-Real-IP, else none", () => {
  assert.equal(clientAddress(headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" })), "203.0.113.9");
  assert.equal(clientAddress(headers({ "x-forwarded-for": " 203.0.113.9 " })), "203.0.113.9");
  assert.equal(clientAddress(headers({ "x-real-ip": "203.0.113.5" })), "203.0.113.5");
  assert.equal(clientAddress(headers({ "x-forwarded-for": " , " })), "");
  assert.equal(clientAddress(headers({})), "");
  assert.equal(clientAddress(undefined), "");
});

test("the token is read from the x-polysite-captcha header", () => {
  assert.equal(HEADER, "x-polysite-captcha");
  assert.equal(tokenFromRequest({ headers: headers({ [HEADER]: "  abc " }) }), "abc");
  assert.equal(tokenFromRequest({ headers: headers({}) }), "");
  assert.equal(tokenFromRequest({}), "");
});

// --- which keys are in charge --------------------------------------------------------------------------------------------

test("off by default; on only when the saved switch is on", () => {
  assert.equal(resolveConfig(null, {}).on, false);
  assert.equal(resolveConfig({ captchaEnabled: false, turnstileSiteKey: "a", turnstileSecretKey: "b" }, {}).on, false);
  const c = resolveConfig({ captchaEnabled: true, turnstileSiteKey: " site ", turnstileSecretKey: " secret " }, {});
  assert.deepEqual([c.on, c.source, c.siteKey, c.secret, c.signIn, c.reset], [true, "settings", "site", "secret", true, true]);
});

test("the two requests can be switched separately; both are on unless said otherwise", () => {
  const c = resolveConfig({ captchaEnabled: true, turnstileSiteKey: "a", turnstileSecretKey: "b", captchaOnSignIn: true, captchaOnReset: false }, {});
  assert.deepEqual([c.signIn, c.reset], [true, false]);
});

test("both environment keys switch the check on and win over the saved ones", () => {
  const env = { AUTH_TURNSTILE_SITE_KEY: "env-site", AUTH_TURNSTILE_SECRET_KEY: "env-secret" };
  const saved = { captchaEnabled: true, turnstileSiteKey: "saved-site", turnstileSecretKey: "saved-secret" };
  assert.deepEqual([resolveConfig(saved, env).siteKey, resolveConfig(saved, env).secret, resolveConfig(saved, env).source], ["env-site", "env-secret", "env"]);
  // on from the environment even when nothing is saved, so a fresh install is protected before anyone can open the settings
  assert.equal(resolveConfig(null, env).on, true);
  assert.equal(resolveConfig({ captchaEnabled: false }, env).on, true);
});

test("one environment key alone does nothing", () => {
  assert.equal(resolveConfig(null, { AUTH_TURNSTILE_SITE_KEY: "x" }).on, false);
  assert.equal(resolveConfig(null, { AUTH_TURNSTILE_SECRET_KEY: "x" }).on, false);
  const saved = { captchaEnabled: true, turnstileSiteKey: "saved-site", turnstileSecretKey: "saved-secret" };
  assert.equal(resolveConfig(saved, { AUTH_TURNSTILE_SITE_KEY: "x" }).siteKey, "saved-site");
});

test("AUTH_CAPTCHA_OFF beats everything", () => {
  const env = { AUTH_CAPTCHA_OFF: "1", AUTH_TURNSTILE_SITE_KEY: "env-site", AUTH_TURNSTILE_SECRET_KEY: "env-secret" };
  const saved = { captchaEnabled: true, turnstileSiteKey: "a", turnstileSecretKey: "b" };
  for (const value of ["1", "true", "TRUE", " yes ", "on"]) assert.equal(resolveConfig(saved, { ...env, AUTH_CAPTCHA_OFF: value }).on, false, value);
  for (const value of ["0", "", "false", "no"]) assert.equal(resolveConfig(saved, { AUTH_CAPTCHA_OFF: value }).on, true, value);
  assert.equal(resolveConfig(saved, env).source, "off");
});

// --- what the sign-in page may know --------------------------------------------------------------------------------------

test("the public configuration never contains the secret", () => {
  const shown = publicConfig({ ...on, source: "env" });
  assert.deepEqual(shown, { enabled: true, siteKey: PASS_SITE, signIn: true, reset: true });
  assert.ok(!JSON.stringify(shown).includes(PASS_SECRET));
  assert.deepEqual(publicConfig({ on: false, signIn: true, reset: true, siteKey: PASS_SITE, secret: PASS_SECRET }), { enabled: false, siteKey: "", signIn: false, reset: false });
});

test("loading the settings reads the real secret only for the check, and survives an unreadable global", async () => {
  const seen = [];
  const payload = {
    logger: { warn: (m) => seen.push(m) },
    findGlobal: async ({ context }) => ({ signInProtection: { captchaEnabled: true, turnstileSiteKey: "s", turnstileSecretKey: context.revealCaptchaSecret ? "real" : SECRET_MASK } }),
  };
  assert.equal((await loadConfig(payload, {})).secret, "real");
  const broken = { logger: { warn: (m) => seen.push(m) }, findGlobal: async () => { throw new Error("column missing"); } };
  assert.equal((await loadConfig(broken, {})).on, false);
  assert.equal((await loadConfig(broken, { AUTH_TURNSTILE_SITE_KEY: "a", AUTH_TURNSTILE_SECRET_KEY: "b" })).on, true);
  assert.ok(seen.some((m) => m.includes("column missing")));
});

// --- the secret at rest ----------------------------------------------------------------------------------------------------

test("the secret is encrypted when saved, masked when read, and the mask means keep", async () => {
  let stored = null;
  const payload = { findGlobal: async ({ context }) => ({ signInProtection: { turnstileSecretKey: context.rawCaptchaSecret ? stored : "should not be asked for" } }) };
  const req = { payload, context: {} };

  stored = await secretBeforeChange({ value: `  ${PASS_SECRET} `, req });
  assert.match(stored, /^enc:v1:/);
  assert.ok(!stored.includes(PASS_SECRET));
  assert.equal(decrypt(stored), PASS_SECRET);

  // read: bullets for everyone, the real value only for the check, the stored form only for the save
  assert.equal(secretAfterRead({ value: stored, req }), SECRET_MASK);
  assert.equal(secretAfterRead({ value: stored, req: { context: { revealCaptchaSecret: true } } }), PASS_SECRET);
  assert.equal(secretAfterRead({ value: stored, req: { context: { rawCaptchaSecret: true } } }), stored);
  assert.equal(secretAfterRead({ value: "", req }), "");
  assert.equal(secretAfterRead({ value: null, req }), null);

  // saving the bullets back keeps the saved secret, without encrypting it twice
  const kept = await secretBeforeChange({ value: SECRET_MASK, req });
  assert.equal(kept, stored);
  // a new value replaces it; clearing removes it; an already-encrypted value is left alone
  assert.equal(decrypt(await secretBeforeChange({ value: "new-secret", req })), "new-secret");
  assert.equal(await secretBeforeChange({ value: "", req }), "");
  const already = encrypt("x");
  assert.equal(await secretBeforeChange({ value: already, req }), already);
});

test("the settings group has the fields the admin shows, both scopes on, and no stored secret in a default", () => {
  const names = signInProtectionField.fields.map((f) => f.name);
  assert.deepEqual(names, ["captchaEnabled", "turnstileSiteKey", "turnstileSecretKey", "captchaOnSignIn", "captchaOnReset"]);
  const byName = Object.fromEntries(signInProtectionField.fields.map((f) => [f.name, f]));
  assert.equal(byName.captchaEnabled.defaultValue, false);
  assert.equal(byName.captchaOnSignIn.defaultValue, true);
  assert.equal(byName.captchaOnReset.defaultValue, true);
  assert.equal(byName.turnstileSecretKey.defaultValue, undefined);
  // keys are required only when the check is on (and the environment does not supply them)
  const required = byName.turnstileSiteKey.validate;
  assert.notEqual(required("", { siblingData: { captchaEnabled: true } }), true);
  assert.equal(required("", { siblingData: { captchaEnabled: false } }), true);
  assert.equal(required("x", { siblingData: { captchaEnabled: true } }), true);
  assert.notEqual(byName.turnstileSecretKey.validate("", { siblingData: { captchaEnabled: true } }), true);
});

// --- asking Cloudflare ---------------------------------------------------------------------------------------------------------

test("verification posts the secret, token and address as a form to the siteverify address", async () => {
  let call;
  const fetchImpl = async (url, init) => {
    call = { url, init };
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  assert.equal(await verifyTurnstile({ secret: "S", token: "T", address: "203.0.113.9", fetchImpl }), "ok");
  assert.equal(call.url, SITEVERIFY);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(call.init.body);
  assert.deepEqual([body.get("secret"), body.get("response"), body.get("remoteip")], ["S", "T", "203.0.113.9"]);
  assert.ok(call.init.signal instanceof AbortSignal);
});

test("verification results: ok, failed, misconfigured, unavailable", async () => {
  const verify = (fetchImpl) => verifyTurnstile({ secret: "S", token: "T", address: "1.2.3.4", fetchImpl });
  assert.equal(await verify(answering({ success: true })), "ok");
  assert.equal(await verify(answering({ success: false, "error-codes": ["invalid-input-response"] })), "failed");
  assert.equal(await verify(answering({ success: false, "error-codes": ["timeout-or-duplicate"] })), "failed");
  assert.equal(await verify(answering({ success: false })), "failed");
  assert.equal(await verify(answering({ success: "true" })), "failed");
  assert.equal(await verify(answering({ success: false, "error-codes": ["invalid-input-secret"] })), "misconfigured");
  assert.equal(await verify(answering({ success: false, "error-codes": ["internal-error"] })), "unavailable");
  assert.equal(await verify(answering({}, { status: 500 })), "unavailable");
  assert.equal(await verify(async () => new Response("<html>", { status: 200 })), "unavailable");
  assert.equal(await verify(async () => { throw new TypeError("fetch failed"); }), "unavailable");
});

test("a service that does not answer in time is unavailable, not a pass", async () => {
  const hangs = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const started = Date.now();
  const keepAlive = setTimeout(() => {}, 5000); // the abort timer does not keep a process alive on its own
  assert.equal(await verifyTurnstile({ secret: "S", token: "T", address: "1.2.3.4", fetchImpl: hangs, timeoutMs: 50 }), "unavailable");
  clearTimeout(keepAlive);
  assert.ok(Date.now() - started < 2000);
});

// --- the decision for a request --------------------------------------------------------------------------------------------------

const external = (extra = {}) => headers({ "x-forwarded-for": "203.0.113.9", ...extra });

test("a request through the proxy without a token is refused, and Cloudflare is not asked", async () => {
  let asked = false;
  const fetchImpl = async () => { asked = true; return new Response("{}"); };
  for (const operation of ["login", "forgotPassword"]) {
    const refusal = await decide({ operation, headers: external(), config: on, fetchImpl });
    assert.deepEqual([refusal.status, refusal.message], [400, "Please complete the check."]);
  }
  assert.equal(asked, false);
  const tooLong = await decide({ operation: "login", headers: external({ [HEADER]: "x".repeat(5000) }), config: on, fetchImpl });
  assert.equal(tooLong.status, 400);
  assert.equal(asked, false);
});

test("a good token passes; a bad one is refused; an unreachable service is refused with a different message", async () => {
  const withToken = external({ [HEADER]: "XXXX.DUMMY.TOKEN.XXXX" });
  assert.equal(await decide({ operation: "login", headers: withToken, config: on, fetchImpl: answering({ success: true }) }), null);
  const bad = await decide({ operation: "login", headers: withToken, config: on, fetchImpl: answering({ success: false, "error-codes": ["invalid-input-response"] }) });
  assert.deepEqual([bad.status, bad.message], [400, "Please complete the check."]);
  const down = await decide({ operation: "forgotPassword", headers: withToken, config: on, fetchImpl: async () => { throw new Error("offline"); } });
  assert.deepEqual([down.status, down.message], [503, "The check could not be completed, try again."]);
  assert.match(down.log, /did not answer/);
  const wrongKey = await decide({ operation: "login", headers: withToken, config: on, fetchImpl: answering({ success: false, "error-codes": ["invalid-input-secret"] }) });
  assert.deepEqual([wrongKey.status, wrongKey.message], [503, "The check could not be completed, try again."]);
  assert.match(wrongKey.log, /refused the secret/);
});

test("messages and logs never carry the token or a key", async () => {
  const token = "super-secret-token-value";
  const secret = "very-private-secret-key";
  const cases = [
    await decide({ operation: "login", headers: external({ [HEADER]: token }), config: { ...on, secret }, fetchImpl: answering({ success: false, "error-codes": ["invalid-input-secret"] }) }),
    await decide({ operation: "login", headers: external({ [HEADER]: token }), config: { ...on, secret }, fetchImpl: async () => { throw new Error(`boom ${token} ${secret}`); } }),
    await decide({ operation: "login", headers: external({ [HEADER]: token }), config: { ...on, secret: "" } }),
  ];
  for (const refusal of cases) assert.ok(!JSON.stringify(refusal).includes(token) && !JSON.stringify(refusal).includes(secret));
  assert.equal(cases[2].status, 503);
  assert.match(cases[2].log, /no secret key/);
});

test("nothing is checked for calls inside the stack, the plugin's own calls, other operations, or a request the check does not cover", async () => {
  const boom = async () => { throw new Error("must not be called"); };
  assert.equal(await decide({ operation: "login", headers: headers({}), config: on, fetchImpl: boom }), null);
  assert.equal(await decide({ operation: "login", headers: external(), context: { polysiteSkip2FA: true }, config: on, fetchImpl: boom }), null);
  assert.equal(await decide({ operation: "create", headers: external(), config: on, fetchImpl: boom }), null);
  assert.equal(await decide({ operation: "refresh", headers: external(), config: on, fetchImpl: boom }), null);
  assert.equal(await decide({ operation: "login", headers: external(), config: { ...on, on: false }, fetchImpl: boom }), null);
  assert.equal(await decide({ operation: "login", headers: external(), config: { ...on, signIn: false }, fetchImpl: boom }), null);
  assert.equal(await decide({ operation: "forgotPassword", headers: external(), config: { ...on, reset: false }, fetchImpl: boom }), null);
  // switched off for sign-in only: the reset still needs the check
  assert.equal((await decide({ operation: "forgotPassword", headers: external(), config: { ...on, signIn: false } })).status, 400);
});

test("the hook throws a public error the page can show, and stays out of the way when the check is off or the call is internal", async () => {
  const logs = [];
  const payload = (stored) => ({ logger: { warn: (m) => logs.push(m) }, findGlobal: async () => ({ signInProtection: stored }) });
  const saved = { captchaEnabled: true, turnstileSiteKey: PASS_SITE, turnstileSecretKey: PASS_SECRET };

  await assert.rejects(
    captchaBeforeOperation({ operation: "login", req: { headers: external(), context: {}, payload: payload(saved) } }),
    (err) => err.isPublic === true && err.status === 400 && err.message === "Please complete the check.",
  );
  await captchaBeforeOperation({ operation: "login", req: { headers: headers({}), context: {}, payload: payload(saved) } });
  await captchaBeforeOperation({ operation: "login", req: { headers: external(), context: { polysiteSkip2FA: true }, payload: payload(saved) } });
  await captchaBeforeOperation({ operation: "login", req: { headers: external(), context: {}, payload: payload({ captchaEnabled: false }) } });
  await captchaBeforeOperation({ operation: "update", req: { headers: external(), context: {}, payload: payload(saved) } });
  assert.deepEqual(logs, []);
});
