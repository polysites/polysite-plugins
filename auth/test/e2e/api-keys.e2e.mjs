// End-to-end check of API keys against a RUNNING stack. Needs AUTH_API_KEYS=true on the CMS; without it the script says so
// and stops (exit 0), because the feature is off by design.
//
//   BASE=http://cms:3001 ADMIN_EMAIL=... ADMIN_PASSWORD=... node test/e2e/api-keys.e2e.mjs
//
// It creates two throwaway users and removes them. Never run it against a real install.
const BASE = process.env.BASE;
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(cond);
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + extra}`);
};

async function api(method, path, { token, key, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `JWT ${token}` } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const denied = (r) => r.status === 401 || r.status === 403;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
ok("admin signs in", admin.status === 200 && admin.json?.token, JSON.stringify(admin.json)?.slice(0, 200));
const adminToken = admin.json.token;

const stamp = Date.now();
const password = "Api-Keys-Test-Password-4417";
const roles = await api("GET", "/api/roles?where[name][equals]=Site%20User&limit=1", { token: adminToken });
const made = async (name) => {
  const email = `${name}-${stamp}@example.test`;
  const created = await api("POST", "/api/users", { token: adminToken, body: { email, password, role: roles.json?.docs?.[0]?.id, assignedSites: [{ site: 1 }] } });
  const login = await api("POST", "/api/users/login", { body: { email, password } });
  return { email, id: created.json?.doc?.id, token: login.json?.token, status: created.status };
};
const alice = await made("keys-alice");
const bob = await made("keys-bob");
const created = [alice, bob];

try {
  ok("two throwaway users created", alice.status === 201 && bob.status === 201 && alice.token && bob.token, `${alice.status} ${bob.status}`);

  const probe = await api("GET", "/api/auth-keys/list", { token: alice.token });
  if (probe.status === 404 && /switched off/i.test(JSON.stringify(probe.json))) {
    console.log("skipped: API keys are switched off on this stack (set AUTH_API_KEYS=true to test them)");
    process.exit(0);
  }
  ok("a signed-in person can list their keys (none yet)", probe.status === 200 && probe.json?.keys?.length === 0, JSON.stringify(probe.json));
  ok("a visitor can't", denied(await api("GET", "/api/auth-keys/list")));

  // --- making keys
  ok("a key needs a label", (await api("POST", "/api/auth-keys/issue", { token: alice.token, body: { label: "  " } })).status === 400);
  ok("an odd expiry is refused, not turned into 'never'", (await api("POST", "/api/auth-keys/issue", { token: alice.token, body: { label: "x", expiresInDays: "soon" } })).status === 400);
  ok("a visitor can't make a key", denied(await api("POST", "/api/auth-keys/issue", { body: { label: "x" } })));
  const issued = await api("POST", "/api/auth-keys/issue", { token: alice.token, body: { label: "nightly export", expiresInDays: 30 } });
  const key = issued.json?.key;
  ok("a key is made and its text returned once", issued.status === 201 && /^psk_[0-9a-f]{8}_[A-Za-z0-9]{32}$/.test(key ?? ""), JSON.stringify(issued.json)?.slice(0, 200));
  ok("with an expiry about 30 days away", Math.abs(new Date(issued.json?.expiresAt).getTime() - (Date.now() + 30 * 86_400_000)) < 120_000, issued.json?.expiresAt);

  const listed = await api("GET", "/api/auth-keys/list", { token: alice.token });
  const flat = JSON.stringify(listed.json);
  ok("the list shows it by label and start only", listed.json?.keys?.length === 1 && listed.json.keys[0].label === "nightly export" && listed.json.keys[0].prefix === key?.slice(0, 12), flat.slice(0, 300));
  ok("the list never holds the key or its hash", !flat.includes(key?.slice(13) ?? "x") && !/keyHash|"key"/.test(flat), flat.slice(0, 300));
  const rest = await api("GET", "/api/auth-api-keys", { token: alice.token });
  ok("the REST collection shows the owner their own rows without the hash", rest.status === 200 && rest.json?.docs?.length === 1 && !/keyHash/.test(JSON.stringify(rest.json)) && !JSON.stringify(rest.json).includes(key.slice(13)), JSON.stringify(rest.json)?.slice(0, 300));
  const others = await api("GET", "/api/auth-api-keys", { token: bob.token });
  ok("another person sees none of them", others.status === 200 && others.json?.docs?.length === 0, JSON.stringify(others.json)?.slice(0, 200));
  const adminSees = await api("GET", "/api/auth-api-keys", { token: adminToken });
  ok("a Super Admin sees them, still without the hash", adminSees.status === 200 && adminSees.json?.docs?.some((d) => d.keyPrefix === key.slice(0, 12)) && !/keyHash/.test(JSON.stringify(adminSees.json)), JSON.stringify(adminSees.json)?.slice(0, 200));
  ok("a visitor sees none", denied(await api("GET", "/api/auth-api-keys")));
  ok("nobody can make a row directly (it would have no real hash)", denied(await api("POST", "/api/auth-api-keys", { token: adminToken, body: { user: alice.id, label: "forged", keyPrefix: "psk_00000000", keyHash: "0".repeat(64) } })));
  ok("nor edit one", denied(await api("PATCH", `/api/auth-api-keys/${issued.json.id}`, { token: adminToken, body: { label: "renamed" } })));
  const gql = await api("POST", "/api/graphql", { token: adminToken, body: { query: "{ AuthApiKeys { docs { id keyHash } } }" } });
  ok("GraphQL has no such collection", Boolean(gql.json?.errors?.length) && !gql.json?.data?.AuthApiKeys, JSON.stringify(gql.json)?.slice(0, 200));

  // --- signing in with it
  const me = await api("GET", "/api/users/me", { key });
  ok("the key signs in as its owner", me.status === 200 && me.json?.user?.email === alice.email, JSON.stringify(me.json)?.slice(0, 200));
  ok("the key gives no more than the owner has: not the user list", denied(await api("GET", "/api/users", { key })));
  ok("nor another person's record", denied(await api("GET", `/api/users/${bob.id}`, { key })));
  ok("nor Super Admin settings", denied(await api("GET", "/api/sso-providers", { key })));
  ok("nor other people's keys", (await api("GET", "/api/auth-api-keys", { key })).json?.docs?.length === 1);
  ok("what the owner may do, it may: their own record", (await api("GET", `/api/users/${alice.id}`, { key })).status === 200);

  const wrong = `${key.slice(0, 13)}${"a".repeat(32)}`;
  ok("a key with the right start and the wrong rest is nobody", (await api("GET", "/api/users/me", { key: wrong })).json?.user == null);
  ok("a made-up key is nobody", (await api("GET", "/api/users/me", { key: `psk_${"0".repeat(8)}_${"b".repeat(32)}` })).json?.user == null);
  ok("a key sent as a different scheme is not accepted", (await fetch(`${BASE}/api/users/me`, { headers: { Authorization: `JWT ${key}` } }).then((r) => r.json())).user == null);
  ok("a token still works beside keys", (await api("GET", "/api/users/me", { token: alice.token })).json?.user?.email === alice.email);

  // --- what a key may not do
  ok("a key can't make keys", (await api("POST", "/api/auth-keys/issue", { key, body: { label: "from a key" } })).status === 403);
  ok("a key can't list keys", (await api("GET", "/api/auth-keys/list", { key })).status === 403);
  ok("a key can't delete keys", (await api("POST", "/api/auth-keys/revoke", { key, body: { id: issued.json.id } })).status === 403);
  ok("a key can't start two-factor setup (it could lock the owner out)", (await api("POST", "/api/auth-2fa/setup", { key })).status === 403);
  ok("a key can't confirm, disable or reset two-factor either", (await Promise.all([
    api("POST", "/api/auth-2fa/confirm", { key, body: { code: "000000" } }),
    api("POST", "/api/auth-2fa/disable", { key, body: { code: "000000" } }),
    api("POST", "/api/auth-2fa/admin-reset", { key, body: { userId: bob.id } }),
  ])).every((r) => r.status === 403));
  ok("it may read the read-only two-factor status", (await api("GET", "/api/auth-2fa/status", { key })).status === 200);

  // --- last used
  await pause(1500);
  const used = await api("GET", "/api/auth-keys/list", { token: alice.token });
  ok("its last use is recorded", Boolean(used.json?.keys?.[0]?.lastUsedAt), JSON.stringify(used.json)?.slice(0, 300));

  ok("the owner is not locked out by any of this", (await api("POST", "/api/users/login", { body: { email: alice.email, password } })).status === 200);

  // --- limits and revoking
  const second = await api("POST", "/api/auth-keys/issue", { token: alice.token, body: { label: "second" } });
  ok("a key can have no expiry", second.status === 201 && second.json?.expiresAt === null, JSON.stringify(second.json)?.slice(0, 200));
  for (let i = 0; i < 8; i++) await api("POST", "/api/auth-keys/issue", { token: alice.token, body: { label: `filler ${i}` } });
  const eleventh = await api("POST", "/api/auth-keys/issue", { token: alice.token, body: { label: "one too many" } });
  ok("a person can hold ten keys, not eleven", eleventh.status === 409, `${eleventh.status} ${JSON.stringify(eleventh.json)?.slice(0, 120)}`);

  const bobTries = await api("POST", "/api/auth-keys/revoke", { token: bob.token, body: { id: issued.json.id } });
  ok("someone else can't delete it (and can't tell it exists)", bobTries.status === 404);
  ok("it still works", (await api("GET", "/api/users/me", { key })).json?.user?.email === alice.email);
  const revoked = await api("POST", "/api/auth-keys/revoke", { token: alice.token, body: { id: issued.json.id } });
  ok("the owner deletes it", revoked.status === 200, JSON.stringify(revoked.json));
  ok("and it stops working at once", (await api("GET", "/api/users/me", { key })).json?.user == null);
  ok("a Super Admin can revoke anyone's key", (await api("POST", "/api/auth-keys/revoke", { token: adminToken, body: { id: second.json.id } })).status === 200);
  ok("and that one stops working too", (await api("GET", "/api/users/me", { key: second.json.key })).json?.user == null);

  // --- deleting the person deletes their keys
  const bobKey = (await api("POST", "/api/auth-keys/issue", { token: bob.token, body: { label: "bob's" } })).json?.key;
  ok("another person's key works for them", (await api("GET", "/api/users/me", { key: bobKey })).json?.user?.email === bob.email);
  await api("DELETE", `/api/users/${bob.id}`, { token: adminToken });
  bob.id = undefined;
  ok("when a person is deleted their key stops working", (await api("GET", "/api/users/me", { key: bobKey })).json?.user == null);
  const leftover = await api("GET", `/api/auth-api-keys?where[label][equals]=bob's`, { token: adminToken });
  ok("and the key row is removed with them", leftover.status === 200 && leftover.json?.docs?.length === 0, JSON.stringify(leftover.json)?.slice(0, 200));
} finally {
  for (const person of created) if (person.id) await api("DELETE", `/api/users/${person.id}`, { token: adminToken });
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
