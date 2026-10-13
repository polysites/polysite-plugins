// End-to-end check of single sign-on against a RUNNING dev stack and the mock provider (mock-oidc.mjs). Not part of CI.
//
//   BASE=http://cms:3001 MOCK=http://mock-oidc:9000 ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/e2e/sso.e2e.mjs
//
// The CMS must have AUTH_SSO_ALLOW_HTTP=1 (the mock speaks plain http). It creates a provider and a user and removes both.
// The script plays the browser: it follows the redirects itself and carries the cookies by hand.
const BASE = process.env.BASE;
const MOCK = process.env.MOCK;
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(cond);
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + extra}`);
};

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `JWT ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const control = (value) => fetch(`${MOCK}/control`, { method: "POST", body: JSON.stringify(value) });

// One pass through the whole flow, as a browser would make it. Returns where it ended and the cookies it was given.
async function signIn({ slug = "mock", next, cookieOverride, tamperState } = {}) {
  const jar = new Map();
  const keep = (res) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair.split("=");
      if (/Max-Age=0/i.test(line)) jar.delete(name);
      else jar.set(name, rest.join("="));
    }
  };
  const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  const start = await fetch(`${BASE}/api/auth-sso/${slug}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`, { redirect: "manual" });
  keep(start);
  const toProvider = start.headers.get("location") ?? "";
  if (!toProvider.startsWith(MOCK)) return { stage: "start", location: toProvider, jar, status: start.status };

  const authorize = await fetch(toProvider, { redirect: "manual" });
  let back = authorize.headers.get("location") ?? "";
  if (tamperState) back = back.replace(/state=[^&]*/, "state=forged");
  const callbackUrl = new URL(back);
  const callback = await fetch(`${BASE}${callbackUrl.pathname}${callbackUrl.search}`, {
    redirect: "manual",
    headers: { cookie: cookieOverride === undefined ? cookies() : cookieOverride },
  });
  keep(callback);
  return { stage: "callback", location: callback.headers.get("location") ?? "", jar, status: callback.status, authorizeUrl: new URL(toProvider) };
}

const errorOf = (r) => new URL(r.location, BASE).searchParams.get("sso_error");

const adminLogin = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
ok("admin signs in", adminLogin.status === 200 && adminLogin.json?.token, JSON.stringify(adminLogin.json)?.slice(0, 160));
const adminToken = adminLogin.json.token;

const email = `sso-test-${Date.now()}@example.test`;
let userId;
let providerId;
try {
  const roles = await api("GET", "/api/roles?where[name][equals]=Site%20User&limit=1", { token: adminToken });
  const created = await api("POST", "/api/users", { token: adminToken, body: { email, password: "Sso-Test-Password-7391", role: roles.json?.docs?.[0]?.id, assignedSites: [{ site: 1 }] } });
  userId = created.json?.doc?.id;
  ok("test user created", created.status === 201, JSON.stringify(created.json)?.slice(0, 200));

  const provider = await api("POST", "/api/sso-providers", {
    token: adminToken,
    body: { slug: "mock", label: "Continue with the mock", type: "oidc", issuer: MOCK, clientId: "mock-client", clientSecret: "mock-client-secret", enabled: true },
  });
  providerId = provider.json?.doc?.id;
  ok("a Super Admin can add a provider", provider.status === 201, JSON.stringify(provider.json)?.slice(0, 240));
  ok("its client secret is masked when read back", provider.json?.doc?.clientSecret === "••••••••", JSON.stringify(provider.json?.doc));
  const raw = await api("GET", `/api/sso-providers/${providerId}`, { token: adminToken });
  ok("and never returned in clear", !JSON.stringify(raw.json).includes("mock-client-secret"));

  const list = await (await fetch(`${BASE}/api/auth-sso/providers`)).json();
  ok("the sign-in page can list it (no secrets)", list.providers?.length === 1 && list.providers[0].slug === "mock" && !JSON.stringify(list).includes("secret"), JSON.stringify(list));

  const nobody = await fetch(`${BASE}/api/sso-providers`);
  ok("an anonymous visitor can't read provider settings", nobody.status === 403 || nobody.status === 401);

  // --- the good path
  await control({ sub: "mock-user-1", email: email.toUpperCase(), email_verified: true });
  const good = await signIn({ next: "/admin/collections/pages" });
  const cookie = good.jar.get("payload-token");
  ok("a person with an account signs in and lands where they were going", good.stage === "callback" && good.location.endsWith("/admin/collections/pages") && Boolean(cookie), `${good.stage} ${good.location} ${[...good.jar.keys()]}`);
  const me = await api("GET", "/api/users/me", { token: cookie });
  ok("the session is a real one", me.status === 200 && me.json?.user?.email === email, JSON.stringify(me.json)?.slice(0, 200));
  const sessionUser = await api("GET", `/api/users/${userId}`, { token: adminToken });
  ok("linked identities never appear on the user's record", !/ssoIdentities|mock-user-1/.test(JSON.stringify(sessionUser.json)), JSON.stringify(sessionUser.json)?.slice(0, 300));

  // The link is a row of the plugin's own collection: a Super Admin can see it and unlink it, nobody else can touch it.
  const denied = (r) => r.status === 401 || r.status === 403;
  const own = await api("POST", "/api/users/login", { body: { email, password: "Sso-Test-Password-7391" } });
  ok("the person can sign in with their password too", own.status === 200 && own.json?.token, JSON.stringify(own.json)?.slice(0, 160));
  const seen = await api("GET", `/api/sso-identities?where[user][equals]=${userId}`, { token: adminToken });
  const link = seen.json?.docs?.[0];
  ok("a Super Admin sees exactly one linked sign-in for them", seen.status === 200 && seen.json?.docs?.length === 1 && link.provider === "mock" && link.subject === "mock-user-1", JSON.stringify(seen.json)?.slice(0, 300));
  ok("the uniqueness keys are not exposed", !/identityKey|accountKey/.test(JSON.stringify(seen.json)));
  ok("the person can't read linked sign-ins", denied(await api("GET", "/api/sso-identities", { token: own.json.token })));
  ok("a visitor can't either", denied(await api("GET", "/api/sso-identities")));
  ok("nobody can make a link through the API, not even a Super Admin", denied(await api("POST", "/api/sso-identities", { token: adminToken, body: { user: userId, provider: "mock", subject: "forged" } })));
  ok("nor change one", denied(await api("PATCH", `/api/sso-identities/${link?.id}`, { token: adminToken, body: { subject: "forged" } })));
  ok("nor can the person unlink themselves", denied(await api("DELETE", `/api/sso-identities/${link?.id}`, { token: own.json.token })));
  const gql = await api("POST", "/api/graphql", { token: adminToken, body: { query: "{ SsoIdentities { docs { id subject } } }" } });
  ok("GraphQL has no such collection", Boolean(gql.json?.errors?.length) && !gql.json?.data?.SsoIdentities, JSON.stringify(gql.json)?.slice(0, 200));
  ok("the state cookie is cleared afterwards", !good.jar.has("polysite-sso"));

  const afterSso = await api("GET", `/api/users/${userId}`, { token: adminToken });
  ok("signing in leaves the person's assigned sites alone", afterSso.json?.assignedSites?.length === 1, JSON.stringify(afterSso.json?.assignedSites));

  const again = await signIn();
  ok("signing in a second time works", Boolean(again.jar.get("payload-token")) && again.location.endsWith("/admin"));

  // --- unlinking: a Super Admin deletes the link; the next sign-in links again, by the verified email
  const unlink = await api("DELETE", `/api/sso-identities/${link?.id}`, { token: adminToken });
  ok("a Super Admin can unlink an identity", unlink.status === 200, String(unlink.status));
  const gone = await api("GET", `/api/sso-identities?where[user][equals]=${userId}`, { token: adminToken });
  ok("and it is gone", gone.json?.docs?.length === 0, JSON.stringify(gone.json)?.slice(0, 200));
  const relinked = await signIn();
  ok("the next sign-in links it again", Boolean(relinked.jar.get("payload-token")), relinked.location);
  const afterRelink = await api("GET", `/api/sso-identities?where[user][equals]=${userId}`, { token: adminToken });
  ok("exactly one link again, not two", afterRelink.json?.docs?.length === 1 && afterRelink.json.docs[0].subject === "mock-user-1", JSON.stringify(afterRelink.json)?.slice(0, 200));

  // --- where it is allowed to go next
  const evil = await signIn({ next: "https://evil.example/steal" });
  ok("it won't redirect to another site afterwards", new URL(evil.location).pathname === "/admin" && new URL(evil.location).hostname !== "evil.example", evil.location);

  // --- refusals
  await control({ sub: "mock-user-1", email, email_verified: false });
  const unverified = await signIn();
  ok("an unverified email is refused", errorOf(unverified) === "sso_unverified" && !unverified.jar.get("payload-token"), unverified.location);

  await control({ sub: "someone-else", email: `nobody-${Date.now()}@example.test`, email_verified: true });
  const noAccount = await signIn();
  ok("a stranger with a verified email still has no account", errorOf(noAccount) === "sso_no_account" && !noAccount.jar.get("payload-token"), noAccount.location);

  await control({ sub: "a-different-subject", email, email_verified: true });
  const conflict = await signIn();
  ok("the same account can't be taken over by a different identity", errorOf(conflict) === "sso_conflict" && !conflict.jar.get("payload-token"), conflict.location);

  await control({ sub: "mock-user-1", email, email_verified: true, badNonce: true });
  ok("an ID token for another request is refused", errorOf(await signIn()) === "sso_failed");
  await control({ sub: "mock-user-1", email, email_verified: true, wrongAudience: true });
  ok("an ID token for another app is refused", errorOf(await signIn()) === "sso_failed");
  await control({ sub: "mock-user-1", email, email_verified: true, wrongIssuer: true });
  ok("an ID token from another issuer is refused", errorOf(await signIn()) === "sso_failed");
  await control({ sub: "mock-user-1", email, email_verified: true, expired: true });
  ok("an expired ID token is refused", errorOf(await signIn()) === "sso_failed");
  await control({ sub: "mock-user-1", email, email_verified: true, badSignature: true });
  ok("an ID token with a bad signature is refused", errorOf(await signIn()) === "sso_failed");

  await control({ sub: "mock-user-1", email, email_verified: true });
  const forged = await signIn({ tamperState: true });
  ok("a callback with the wrong state is refused", errorOf(forged) === "sso_expired" && !forged.jar.get("payload-token"), forged.location);
  const noCookie = await signIn({ cookieOverride: "" });
  ok("a callback from another browser (no cookie) is refused", errorOf(noCookie) === "sso_expired");
  const garbage = await signIn({ cookieOverride: "polysite-sso=abc.def" });
  ok("a made-up state cookie is refused", errorOf(garbage) === "sso_expired");

  await control({ deny: true });
  ok("cancelling at the provider is reported kindly", errorOf(await signIn()) === "sso_denied");
  await control({ sub: "mock-user-1", email, email_verified: true });

  const unknown = await signIn({ slug: "does-not-exist" });
  ok("an unknown provider is unavailable", errorOf(unknown) === "sso_unavailable");

  // --- domain allow-list, and switching it off
  await api("PATCH", `/api/sso-providers/${providerId}`, { token: adminToken, body: { allowedDomains: "other.example" } });
  ok("the domain allow-list applies", errorOf(await signIn()) === "sso_domain");
  await api("PATCH", `/api/sso-providers/${providerId}`, { token: adminToken, body: { allowedDomains: "", enabled: false } });
  ok("a provider that is switched off can't be used", errorOf(await signIn()) === "sso_unavailable");
  const off = await (await fetch(`${BASE}/api/auth-sso/providers`)).json();
  ok("and is not listed", off.providers?.length === 0);

  // --- the secret survives an unrelated edit (mask means keep)
  await api("PATCH", `/api/sso-providers/${providerId}`, { token: adminToken, body: { enabled: true, clientSecret: "••••••••", label: "Renamed" } });
  const stillWorks = await signIn();
  ok("saving with the masked secret keeps the real one", Boolean(stillWorks.jar.get("payload-token")), stillWorks.location);
  const final = await api("GET", `/api/users/${userId}`, { token: adminToken });
  ok("after all of that, the assigned sites are still there", final.json?.assignedSites?.length === 1, JSON.stringify(final.json?.assignedSites));
} finally {
  if (providerId) await api("DELETE", `/api/sso-providers/${providerId}`, { token: adminToken });
  if (userId) {
    await api("DELETE", `/api/users/${userId}`, { token: adminToken });
    const left = await api("GET", `/api/sso-identities?where[user][equals]=${userId}`, { token: adminToken });
    ok("deleting a person removes their linked sign-ins too", left.status === 200 && left.json?.docs?.length === 0, JSON.stringify(left.json)?.slice(0, 200));
  }
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
