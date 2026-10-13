// End-to-end check of two-factor sign-in against a RUNNING dev stack (not part of CI: it needs the whole app up).
//
//   BASE=http://localhost:3001 ADMIN_EMAIL=<a Super Admin> ADMIN_PASSWORD=<its password> node test/e2e/two-factor.e2e.mjs
//
// It creates a throwaway user and removes it, and sets the policy back to "off" at the end. It also checks that the two-factor state
// (kept in the plugin's own auth-user-state collection) can't be read or written through the API by anyone. Never run it against a real install.
import { totp } from "../../src/totp.js";

const BASE = process.env.BASE;
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(cond);
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + extra}`);
};

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `JWT ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const login = (email, password, code) => api("POST", "/api/users/login", { body: { email, password }, headers: code ? { "x-polysite-totp": code } : {} });

const admin = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
ok("admin signs in", admin.status === 200 && admin.json?.token, JSON.stringify(admin.json)?.slice(0, 200));
const adminToken = admin.json.token;

const email = `twofa-test-${Date.now()}@example.test`;
const password = "Twofa-Test-Password-9137";
const roles = await api("GET", "/api/roles?where[name][equals]=Site%20User&limit=1", { token: adminToken });
const created = await api("POST", "/api/users", { token: adminToken, body: { email, password, role: roles.json?.docs?.[0]?.id, assignedSites: [{ site: 1 }] } });
ok("throwaway user created", created.status === 201, JSON.stringify(created.json)?.slice(0, 300));
const userId = created.json?.doc?.id;

try {
  const first = await login(email, password);
  ok("without two-factor, sign-in works as before", first.status === 200 && first.json.token, JSON.stringify(first.json)?.slice(0, 200));
  const token = first.json.token;

  let status = await api("GET", "/api/auth-2fa/status", { token });
  ok("status: off", status.status === 200 && status.json.enabled === false);

  const setup = await api("POST", "/api/auth-2fa/setup", { token });
  ok("setup returns a secret, link and picture", setup.status === 200 && /^[A-Z2-7]{32}$/.test(setup.json?.secret) && setup.json.uri?.startsWith("otpauth://totp/") && (setup.json.qr ?? "").includes("<svg"), JSON.stringify(setup.json)?.slice(0, 200));
  const secret = setup.json.secret;

  const badConfirm = await api("POST", "/api/auth-2fa/confirm", { token, body: { code: "000000" } });
  ok("a wrong code does not turn it on", badConfirm.status === 400);

  const confirm = await api("POST", "/api/auth-2fa/confirm", { token, body: { code: totp(secret) } });
  const recovery = confirm.json?.recoveryCodes ?? [];
  ok("the right code turns it on and gives 10 recovery codes", confirm.status === 200 && recovery.length === 10, JSON.stringify(confirm.json)?.slice(0, 200));

  status = await api("GET", "/api/auth-2fa/status", { token });
  ok("status: on, 10 recovery codes left", status.json.enabled === true && status.json.recoveryCodesLeft === 10);

  // The state lives in the plugin's own collection, which nobody reads through the API (not even a Super Admin).
  const me = await api("GET", `/api/users/${userId}`, { token: adminToken });
  const flat = JSON.stringify(me.json);
  ok("the user's own record carries no two-factor fields", !/totp|recoveryCode|ssoIdentities/i.test(flat), flat.slice(0, 300));
  const self = await api("GET", "/api/users/me", { token });
  ok("neither does the signed-in user's own view", !/totp|recoveryCode/i.test(JSON.stringify(self.json)), JSON.stringify(self.json)?.slice(0, 300));
  const denied = (r) => r.status === 401 || r.status === 403;
  const asAdmin = await api("GET", "/api/auth-user-state", { token: adminToken });
  ok("a Super Admin can't list the two-factor rows", denied(asAdmin) && !/totpSecret|recoveryCodeHashes/.test(JSON.stringify(asAdmin.json)), `${asAdmin.status} ${JSON.stringify(asAdmin.json)?.slice(0, 200)}`);
  const asUser = await api("GET", "/api/auth-user-state", { token });
  ok("the person can't list them either", denied(asUser), String(asUser.status));
  const anon = await api("GET", "/api/auth-user-state");
  ok("nor can a visitor", denied(anon), String(anon.status));
  const byId = await Promise.all([1, 2, 3].map((id) => api("GET", `/api/auth-user-state/${id}`, { token: adminToken })));
  ok("nor can any row be fetched by id", byId.every((r) => r.status !== 200), byId.map((r) => r.status).join(","));
  const made = await api("POST", "/api/auth-user-state", { token: adminToken, body: { user: userId, totpEnabled: true, totpSecret: "x" } });
  ok("a Super Admin can't write a row (only reset one)", denied(made), String(made.status));
  const own = await api("POST", "/api/auth-user-state", { token, body: { user: userId, totpEnabled: false } });
  ok("and the person can't switch their own off through the API", denied(own), String(own.status));
  const graphql = await api("POST", "/api/graphql", { token: adminToken, body: { query: "{ AuthUserStates { docs { id totpSecret } } }" } });
  ok("GraphQL has no such collection", Boolean(graphql.json?.errors?.length) && !graphql.json?.data?.AuthUserStates, JSON.stringify(graphql.json)?.slice(0, 200));
  const stillOn = await api("GET", "/api/auth-2fa/status", { token });
  ok("and none of that changed anything", stillOn.json?.enabled === true && stillOn.json?.recoveryCodesLeft === 10, JSON.stringify(stillOn.json));

  const noCode = await login(email, password);
  ok("password alone is refused, with a clear message", noCode.status === 401 && /6-digit code/.test(JSON.stringify(noCode.json)), JSON.stringify(noCode.json)?.slice(0, 200));
  const wrong = await login(email, password, "123456");
  ok("a wrong code is refused", wrong.status === 401);

  const next = totp(secret, Date.now() + 30_000);
  const good = await login(email, password, next);
  ok("password plus a valid code signs in", good.status === 200 && good.json.token, JSON.stringify(good.json)?.slice(0, 200));
  const replay = await login(email, password, next);
  ok("the same code can't be used twice", replay.status === 401);

  const viaRecovery = await login(email, password, recovery[0]);
  ok("a recovery code signs in", viaRecovery.status === 200);
  const again = await login(email, password, recovery[0]);
  ok("and works only once", again.status === 401);

  // guessing: five wrong codes lock it (the earlier wrong tries count too)
  for (let i = 0; i < 5; i++) await login(email, password, "111111");
  const locked = await login(email, password, totp(secret, Date.now() + 60_000));
  ok("repeated wrong codes lock it, even for a right code", locked.status === 429 && /Too many/.test(JSON.stringify(locked.json)), JSON.stringify(locked.json)?.slice(0, 200));

  // a Super Admin resets it (also clears the lock)
  const noRights = await api("POST", "/api/auth-2fa/admin-reset", { token, body: { userId } });
  ok("a normal user can't reset two-factor", noRights.status === 403);
  const reset = await api("POST", "/api/auth-2fa/admin-reset", { token: adminToken, body: { userId } });
  ok("a Super Admin can reset it", reset.status === 200);
  const afterReset = await login(email, password);
  const kept = await api("GET", `/api/users/${userId}`, { token: adminToken });
  ok("resetting two-factor leaves the person's assigned sites alone", kept.json?.assignedSites?.length === 1, JSON.stringify(kept.json?.assignedSites));
  ok("after a reset, the password is enough again", afterReset.status === 200);
  const statusAfterReset = await api("GET", "/api/auth-2fa/status", { token: afterReset.json?.token });
  ok("and the stored state is gone: off, no recovery codes", statusAfterReset.json?.enabled === false && statusAfterReset.json?.recoveryCodesLeft === 0, JSON.stringify(statusAfterReset.json));
  const unknownUser = await api("POST", "/api/auth-2fa/admin-reset", { token: adminToken, body: { userId: 987654321 } });
  ok("resetting someone who doesn't exist is a clear 404", unknownUser.status === 404, `${unknownUser.status} ${JSON.stringify(unknownUser.json)?.slice(0, 120)}`);

  // policy: everyone must use it
  const set = (value) => api("POST", "/api/globals/auth-settings", { token: adminToken, body: { twoFactorPolicy: value } });
  ok("a Super Admin can set the policy", (await set("everyone")).status === 200);
  const blocked = await login(email, password);
  ok("when required, an un-enrolled user can't sign in", blocked.status === 403 && /required/.test(JSON.stringify(blocked.json)), JSON.stringify(blocked.json)?.slice(0, 200));

  const wrongPw = await api("POST", "/api/auth-2fa/enroll/start", { body: { email, password: "nope-nope-nope" } });
  ok("setting up from the sign-in page needs the right password", wrongPw.status === 401);
  const start = await api("POST", "/api/auth-2fa/enroll/start", { body: { email, password } });
  ok("setting up from the sign-in page works with it", start.status === 200 && start.json.secret, JSON.stringify(start.json)?.slice(0, 200));
  const done = await api("POST", "/api/auth-2fa/enroll/confirm", { body: { email, password, code: totp(start.json.secret) } });
  ok("and finishes with recovery codes", done.status === 200 && done.json.recoveryCodes?.length === 10, JSON.stringify(done.json)?.slice(0, 200));
  const inAgain = await login(email, password, totp(start.json.secret, Date.now() + 30_000));
  ok("then signing in with a code works", inAgain.status === 200, JSON.stringify(inAgain.json)?.slice(0, 200));
  const tok = inAgain.json.token;
  const cantDisable = await api("POST", "/api/auth-2fa/disable", { token: tok, body: { code: done.json.recoveryCodes[0] } });
  ok("while it is required, it can't be turned off", cantDisable.status === 403);
  await set("off");
  const disable = await api("POST", "/api/auth-2fa/disable", { token: tok, body: { code: done.json.recoveryCodes[1] } });
  ok("when optional, a person can turn it off with a code", disable.status === 200);
  const finalLogin = await login(email, password);
  ok("and the password is enough again", finalLogin.status === 200);
} finally {
  await api("POST", "/api/globals/auth-settings", { token: adminToken, body: { twoFactorPolicy: "off" } });
  if (userId) await api("DELETE", `/api/users/${userId}`, { token: adminToken });
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
