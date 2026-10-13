// End-to-end check of the sign-in check (Cloudflare Turnstile) against a RUNNING stack. Never run it against a real install.
//
//   CAPTCHA_PHASE=settings BASE=http://cms:3001 ADMIN_EMAIL=<a Super Admin> ADMIN_PASSWORD=<its password> node test/e2e/captcha.e2e.mjs
//
// It uses Cloudflare's published TEST keys (always pass: site 1x00000000000000000000AA, secret 1x0000000000000000000000000000000AA;
// always fail: secret 2x0000000000000000000000000000000AA), which accept the dummy token XXXX.DUMMY.TOKEN.XXXX. The check really asks
// challenges.cloudflare.com, so the machine running it needs outbound internet; without it the check SKIPS (exit 0) and says why.
//
// Three phases, because the last two need the CMS started with different environment variables (tests/e2e shows how: recreate the cms
// service with them, wait until it is healthy, run the next phase):
//   settings   keys saved in the admin settings (no environment variable set). Ends with the check ON and the always-fail secret and a
//              different site key saved, so the next phase proves the environment wins.
//   env        CMS started with AUTH_TURNSTILE_SITE_KEY=<the always-pass site key> and AUTH_TURNSTILE_SECRET_KEY=<the always-pass secret>.
//   off        CMS started with AUTH_CAPTCHA_OFF=1 (and the keys of the previous phase still set). Ends by clearing the saved settings.
//
// Every call through the CMS port counts as "from outside" (the app adds a forwarded address itself); only the plugin's own local calls
// carry none. Those are covered by the setup-from-the-sign-in-page call below, which signs in internally.
const BASE = process.env.BASE;
const PHASE = process.env.CAPTCHA_PHASE || "settings";
const PASS_SITE = "1x00000000000000000000AA";
const PASS_SECRET = "1x0000000000000000000000000000000AA";
const FAIL_SECRET = "2x0000000000000000000000000000000AA";
const DUMMY = "XXXX.DUMMY.TOKEN.XXXX";
const MASK = "••••••••";
const FORWARDED = { "X-Forwarded-For": "203.0.113.50" };

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

const message = (r) => r.json?.errors?.[0]?.message ?? r.json?.message ?? "";
// "from outside": a forwarded address, and the token the widget would send (or none)
const login = (email, password, token) => api("POST", "/api/users/login", { body: { email, password }, headers: { ...FORWARDED, ...(token ? { "x-polysite-captcha": token } : {}) } });
const forgot = (email, token) => api("POST", "/api/users/forgot-password", { body: { email }, headers: { ...FORWARDED, ...(token ? { "x-polysite-captcha": token } : {}) } });
const config = () => api("GET", "/api/auth-captcha/config");

// Without internet there is nothing to check against: say so and stop, without failing.
async function reachable() {
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: PASS_SECRET, response: DUMMY }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    return (await res.json())?.success === true;
  } catch {
    return false;
  }
}

if (!(await reachable())) {
  console.log("SKIP captcha e2e: challenges.cloudflare.com cannot be reached from here (needs outbound internet), so the sign-in check cannot be exercised. Nothing was changed.");
  process.exit(0);
}

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
// In the "env" phase the check is already on when we start, so even the first sign-in needs the (always-pass) token.
const first = await login(email, password, DUMMY);
ok("the Super Admin signs in", first.status === 200 && first.json?.token, `${first.status} ${JSON.stringify(first.json)?.slice(0, 200)}`);
const token = first.json?.token;
const settings = (signInProtection) => api("POST", "/api/globals/auth-settings", { token, body: { signInProtection } });

try {
  if (PHASE === "settings") {
    const before = await config();
    ok("by default the check is off and the page is told so", before.status === 200 && before.json.enabled === false && before.json.siteKey === "", JSON.stringify(before.json));
    const noToken = await login(email, password);
    ok("so a sign-in needs no token", noToken.status === 200, `${noToken.status} ${message(noToken)}`);

    const saved = await settings({ captchaEnabled: true, turnstileSiteKey: PASS_SITE, turnstileSecretKey: PASS_SECRET, captchaOnSignIn: true, captchaOnReset: true });
    ok("a Super Admin saves the keys and switches it on", saved.status === 200, `${saved.status} ${message(saved)}`);
    ok("the answer shows the secret as bullets", saved.json?.result?.signInProtection?.turnstileSecretKey === MASK && !JSON.stringify(saved.json).includes(PASS_SECRET), JSON.stringify(saved.json)?.slice(0, 300));
    const read = await api("GET", "/api/globals/auth-settings", { token });
    ok("and so does a later read", read.json?.signInProtection?.turnstileSecretKey === MASK && !JSON.stringify(read.json).includes(PASS_SECRET));

    const pub = await config();
    const pubText = JSON.stringify(pub.json);
    ok("the sign-in page is told to show the widget, with the public key and never the secret", pub.json?.enabled === true && pub.json.siteKey === PASS_SITE && pub.json.signIn === true && pub.json.reset === true && !pubText.includes(PASS_SECRET) && !/secret/i.test(pubText), pubText);

    const missing = await login(email, password);
    ok("a sign-in from outside without a token is refused", missing.status === 400 && message(missing) === "Please complete the check.", `${missing.status} ${message(missing)}`);
    const garbage = await login(email, password, "x".repeat(5000));
    ok("a token that is far too long is refused too", garbage.status === 400, String(garbage.status));
    const good = await login(email, password, DUMMY);
    ok("with a token Cloudflare accepts, it signs in", good.status === 200 && good.json?.token, `${good.status} ${message(good)}`);
    const wrong = await login(email, "not-the-password-at-all", DUMMY);
    ok("a wrong password is still a wrong password (the check is only the first gate)", wrong.status === 401, String(wrong.status));

    const forgotNo = await forgot("nobody-here@example.test");
    ok("a password-reset request without a token is refused", forgotNo.status === 400 && message(forgotNo) === "Please complete the check.", `${forgotNo.status} ${message(forgotNo)}`);
    const forgotYes = await forgot("nobody-here@example.test", DUMMY);
    ok("with a token it goes through", forgotYes.status === 200, `${forgotYes.status} ${message(forgotYes)}`);

    // The plugin's own sign-in calls (setting up two-factor from the sign-in page) are not a person at the form: they carry no token and
    // must keep working while the check is on.
    const roles = await api("GET", "/api/roles?where[name][equals]=Site%20User&limit=1", { token });
    const throwaway = `captcha-test-${Date.now()}@example.test`;
    const throwawayPassword = "Captcha-Test-Password-4471";
    const made = await api("POST", "/api/users", { token, body: { email: throwaway, password: throwawayPassword, role: roles.json?.docs?.[0]?.id, assignedSites: [{ site: 1 }] } });
    ok("a throwaway user is created", made.status === 201, `${made.status} ${message(made)}`);
    try {
      const start = await api("POST", "/api/auth-2fa/enroll/start", { body: { email: throwaway, password: throwawayPassword }, headers: FORWARDED });
      ok("setting up two-factor from the sign-in page (an internal sign-in) is not asked for a token", start.status === 200 && start.json?.secret, `${start.status} ${message(start)}`);
    } finally {
      if (made.json?.doc?.id) await api("DELETE", `/api/users/${made.json.doc.id}`, { token });
    }

    // Saving the screen again with the bullets in the secret field keeps the saved secret (it must still pass).
    const kept = await settings({ captchaEnabled: true, turnstileSecretKey: MASK });
    ok("saving with the bullets untouched keeps the secret", kept.status === 200 && (await login(email, password, DUMMY)).status === 200);

    const failing = await settings({ turnstileSecretKey: FAIL_SECRET });
    ok("a Super Admin replaces the secret with one that always fails", failing.status === 200, `${failing.status} ${message(failing)}`);
    const refused = await login(email, password, DUMMY);
    ok("then even a well-formed token is refused", refused.status === 400 && message(refused) === "Please complete the check.", `${refused.status} ${message(refused)}`);
    const refusedReset = await forgot("nobody-here@example.test", DUMMY);
    ok("and so is a reset request", refusedReset.status === 400, String(refusedReset.status));

    const signInOff = await settings({ captchaOnSignIn: false });
    ok("sign-in can be left out of the check while reset keeps it", signInOff.status === 200 && (await login(email, password)).status === 200 && (await forgot("nobody-here@example.test")).status === 400, "");
    await settings({ captchaOnSignIn: true });

    // Leave the always-fail secret and another site key saved, so the next phase shows that the environment wins over them.
    await settings({ captchaEnabled: true, turnstileSiteKey: "saved-site-key-the-environment-must-win-over" });
  } else if (PHASE === "env") {
    const pub = await config();
    ok("the check is on from the environment alone, with the environment's site key and not the saved one", pub.json?.enabled === true && pub.json.siteKey === PASS_SITE, JSON.stringify(pub.json));
    const missing = await login(email, password);
    ok("a sign-in from outside without a token is refused", missing.status === 400 && message(missing) === "Please complete the check.", `${missing.status} ${message(missing)}`);
    const good = await login(email, password, DUMMY);
    ok("with a token, the environment's secret decides (the saved one would refuse it)", good.status === 200, `${good.status} ${message(good)}`);
  } else if (PHASE === "off") {
    const pub = await config();
    ok("AUTH_CAPTCHA_OFF=1 switches it off whatever else is set", pub.json?.enabled === false && pub.json.siteKey === "", JSON.stringify(pub.json));
    const free = await login(email, password);
    ok("a sign-in without a token works again", free.status === 200 && free.json?.token, `${free.status} ${message(free)}`);
    const reset = await forgot("nobody-here@example.test");
    ok("and so does a reset request", reset.status === 200, `${reset.status} ${message(reset)}`);
    // Clean up what the first phase left saved.
    const cleared = await api("POST", "/api/globals/auth-settings", { token: free.json?.token ?? token, body: { signInProtection: { captchaEnabled: false, turnstileSiteKey: "", turnstileSecretKey: "", captchaOnSignIn: true, captchaOnReset: true } } });
    ok("the saved settings are cleared", cleared.status === 200, `${cleared.status} ${message(cleared)}`);
  } else {
    ok(`known phase (settings, env, off), got ${PHASE}`, false);
  }
} finally {
  if (PHASE === "settings") {
    // A failed run must not leave the stack refusing sign-ins.
    if (results.includes(false)) await settings({ captchaEnabled: false, turnstileSiteKey: "", turnstileSecretKey: "", captchaOnSignIn: true, captchaOnReset: true });
  }
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
