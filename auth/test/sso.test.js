import assert from "node:assert/strict";
import { test } from "node:test";

import { ERRORS, domainAllowed, emailFromClaims, githubEmail, isTenantId, issuerOf } from "../src/sso/claims.js";
import { authorizeUrl, requireHttps } from "../src/sso/providers.js";
import { challengeOf, cookieValue, newFlow, readFlow, safeNext, sameState, signFlow } from "../src/sso/state.js";

const KEY = Buffer.alloc(32, 3);

test("the flow cookie round-trips, and any change, wrong key or age is refused", () => {
  const now = 1_700_000_000_000;
  const flow = newFlow({ slug: "google", next: "/admin/collections/pages", now });
  const cookie = signFlow(flow, KEY);
  assert.deepEqual(readFlow(cookie, KEY, now + 1000), flow);
  assert.equal(readFlow(cookie, Buffer.alloc(32, 4), now + 1000), null);
  assert.equal(readFlow(cookie, KEY, now + 11 * 60 * 1000), null);
  const [body, mac] = cookie.split(".");
  const tampered = Buffer.from(JSON.stringify({ ...flow, slug: "evil" })).toString("base64url");
  assert.equal(readFlow(`${tampered}.${mac}`, KEY, now), null);
  for (const bad of [undefined, null, "", "x", `${body}`, `${body}.${mac}.extra`, "a.b"]) assert.equal(readFlow(bad, KEY, now), null);
});

test("every flow has its own random state, nonce and verifier", () => {
  const a = newFlow({ slug: "google" });
  const b = newFlow({ slug: "google" });
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.verifier, b.verifier);
  assert.ok(a.verifier.length >= 43);
  assert.match(challengeOf(a.verifier), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sameState(a.state, a.state), true);
  assert.equal(sameState(a.state, b.state), false);
  assert.equal(sameState("", a.state), false);
});

test("PKCE challenge matches the RFC 7636 example", () => {
  assert.equal(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("after signing in, only a path inside the admin is followed", () => {
  assert.equal(safeNext("/admin"), "/admin");
  assert.equal(safeNext("/admin/collections/pages/3?x=1"), "/admin/collections/pages/3?x=1");
  for (const bad of ["https://evil.example/admin", "//evil.example", "/admin//evil.example", "/other", "/admin\\evil", "/admin\r\nSet-Cookie: a=b", undefined, 42, `/admin/${"a".repeat(400)}`]) {
    assert.equal(safeNext(bad), "/admin", String(bad).slice(0, 40));
  }
});

test("cookies are found by name", () => {
  assert.equal(cookieValue("a=1; polysite-sso=abc.def; b=2", "polysite-sso"), "abc.def");
  assert.equal(cookieValue("a=1", "polysite-sso"), undefined);
  assert.equal(cookieValue(undefined, "x"), undefined);
});

test("an email is trusted only when the provider says it checked it", () => {
  const google = { type: "google", slug: "google" };
  assert.deepEqual(emailFromClaims(google, { email: "Ada@Example.org", email_verified: true }), { email: "ada@example.org", reason: null });
  assert.deepEqual(emailFromClaims(google, { email: "ada@example.org", email_verified: "true" }).email, "ada@example.org");
  for (const claims of [{ email: "ada@example.org" }, { email: "ada@example.org", email_verified: false }, { email_verified: true }, {}, null]) {
    assert.deepEqual(emailFromClaims(google, claims), { email: null, reason: "sso_unverified" });
  }
});

test("Microsoft addresses count only from the directory the provider is bound to", () => {
  const tenant = "11111111-2222-3333-4444-555555555555";
  const ms = { type: "microsoft", slug: "microsoft", tenant };
  assert.equal(emailFromClaims(ms, { email: "Ada@Example.org", tid: tenant.toUpperCase() }).email, "ada@example.org");
  assert.equal(emailFromClaims(ms, { preferred_username: "ada@example.org", tid: tenant }).email, "ada@example.org");
  assert.equal(emailFromClaims(ms, { email: "ada@example.org", tid: "99999999-2222-3333-4444-555555555555" }).email, null);
  assert.equal(emailFromClaims(ms, { email: "ada@example.org" }).email, null);
  assert.equal(emailFromClaims({ ...ms, tenant: "common" }, { email: "ada@example.org", tid: "common" }).email, null);
  assert.equal(emailFromClaims(ms, { tid: tenant }).email, null);
  assert.equal(isTenantId(tenant), true);
  assert.equal(isTenantId("contoso.onmicrosoft.com"), false);
});

test("an allow-list of domains narrows who may sign in", () => {
  assert.equal(domainAllowed("a@example.org", ""), true);
  assert.equal(domainAllowed("a@example.org", undefined), true);
  assert.equal(domainAllowed("a@Example.org", "example.org, example.com"), true);
  assert.equal(domainAllowed("a@example.com", "@example.org; example.com"), true);
  assert.equal(domainAllowed("a@evil.example.org", "example.org"), false);
  assert.equal(domainAllowed("a@example.org.evil.com", "example.org"), false);
});

test("GitHub: only the primary, verified address is used", () => {
  assert.equal(githubEmail([{ email: "x@a.org", primary: false, verified: true }, { email: "Me@B.org", primary: true, verified: true }]), "me@b.org");
  assert.equal(githubEmail([{ email: "me@b.org", primary: true, verified: false }]), null);
  assert.equal(githubEmail([]), null);
  assert.equal(githubEmail(undefined), null);
});

test("each provider type has its own issuer", () => {
  assert.equal(issuerOf({ type: "google" }), "https://accounts.google.com");
  assert.equal(issuerOf({ type: "microsoft", tenant: "t" }), "https://login.microsoftonline.com/t/v2.0");
  assert.equal(issuerOf({ type: "oidc", issuer: "https://id.example.org/realms/main/" }), "https://id.example.org/realms/main");
});

test("the provider address must be https, apart from an explicit local-test switch", () => {
  assert.equal(requireHttps("https://id.example.org/x"), "https://id.example.org/x");
  assert.throws(() => requireHttps("http://id.example.org/x"));
  assert.throws(() => requireHttps("file:///etc/passwd"));
  process.env.AUTH_SSO_ALLOW_HTTP = "1";
  try {
    assert.equal(requireHttps("http://mock:9000/x"), "http://mock:9000/x");
    assert.throws(() => requireHttps("ftp://mock/x"));
  } finally {
    delete process.env.AUTH_SSO_ALLOW_HTTP;
  }
});

test("the sign-in address carries state, nonce and a PKCE challenge, and GitHub gets no nonce", () => {
  const flow = newFlow({ slug: "google" });
  const meta = { authorization_endpoint: "https://accounts.example.org/auth" };
  const url = new URL(authorizeUrl({ meta, provider: { type: "oidc", clientId: "abc" }, redirectUri: "https://cms.example.org/api/auth-sso/google/callback", flow }));
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "abc");
  assert.equal(url.searchParams.get("state"), flow.state);
  assert.equal(url.searchParams.get("nonce"), flow.nonce);
  assert.equal(url.searchParams.get("code_challenge"), challengeOf(flow.verifier));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  const github = new URL(authorizeUrl({ meta, provider: { type: "github", clientId: "abc" }, redirectUri: "https://cms.example.org/cb", flow }));
  assert.equal(github.searchParams.get("nonce"), null);
  assert.equal(github.searchParams.get("scope"), "read:user user:email");
});

test("every sign-in failure code has a sentence for the sign-in page", () => {
  for (const code of ["sso_unavailable", "sso_failed", "sso_expired", "sso_unverified", "sso_domain", "sso_no_account", "sso_locked", "sso_conflict", "sso_denied"]) {
    assert.ok(ERRORS[code] && ERRORS[code].length > 10, code);
  }
});
