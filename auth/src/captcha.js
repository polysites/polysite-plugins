import { SECRET_MASK, decrypt, encrypt, isEncrypted } from "./crypto.js";
import { publicError } from "./twofactor.js";

// A Cloudflare Turnstile check on the admin sign-in and forgot-password pages. The page shows the widget and sends the
// token it hands out in the header `x-polysite-captcha`; this file asks Cloudflare whether the token is genuine, before
// Payload looks at the password or sends the reset email.
//
// Where the keys come from (first match wins):
//   AUTH_CAPTCHA_OFF=1                                       the emergency switch: no check at all
//   AUTH_TURNSTILE_SITE_KEY + AUTH_TURNSTILE_SECRET_KEY      both set: the check is on, with these keys (a fresh install can be
//                                                            protected before anyone can sign in to change settings)
//   the "Sign-in protection" group of the auth settings      on only when its switch is on
//
// It fails closed: a missing, spent or refused token, or Cloudflare not answering, refuses the request. It is skipped for calls
// that carry no forwarded address (the stack talking to itself, tests inside it: the same rule as the per-address throttle) and
// for this plugin's own calls (`context.polysiteSkip2FA`).

export const HEADER = "x-polysite-captcha";
export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const SETTINGS = "auth-settings";
export const MAX_TOKEN = 4096;

const OPERATIONS = { login: "signIn", forgotPassword: "reset" };
const OFF_HINT = "Operators: set AUTH_CAPTCHA_OFF=1 on the CMS and restart it to switch the check off while this is fixed.";

const text = (value) => (typeof value === "string" ? value.trim() : "");
const truthy = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());

// --- settings ----------------------------------------------------------------------------------------------------------

// The settings group (a field of the `auth-settings` global). The secret is encrypted at rest, masked on every read, and the
// mask means "keep" on save: the same pattern as the single sign-on client secrets and the email password.
export const envKeys = (env = process.env) => ({ siteKey: text(env.AUTH_TURNSTILE_SITE_KEY), secret: text(env.AUTH_TURNSTILE_SECRET_KEY) });
const envHasKeys = (env = process.env) => Boolean(envKeys(env).siteKey && envKeys(env).secret);

// afterRead: masked for everyone, unless the caller opts in with a context flag (the sign-in check asks for the real value;
// the save below asks for the stored one untouched).
export const secretAfterRead = ({ value, req }) => {
  if (req?.context?.revealCaptchaSecret) return decrypt(value);
  if (req?.context?.rawCaptchaSecret) return value;
  return value ? SECRET_MASK : value;
};

// beforeChange: the admin form sends back what it displayed (the mask) on any save that did not touch the field.
export async function secretBeforeChange({ value, req }) {
  let next = value;
  if (value === SECRET_MASK) {
    const current = await req.payload.findGlobal({ slug: SETTINGS, overrideAccess: true, depth: 0, context: { rawCaptchaSecret: true } });
    next = current?.signInProtection?.turnstileSecretKey ?? "";
  }
  next = typeof next === "string" ? next.trim() : next;
  return isEncrypted(next) ? next : encrypt(next);
}

const needsKeys = (value, siblingData, env) => !siblingData?.captchaEnabled || Boolean(text(value)) || envHasKeys(env);

export const signInProtectionField = {
  name: "signInProtection",
  type: "group",
  label: "Sign-in protection",
  admin: {
    description:
      "A Cloudflare Turnstile check on the sign-in and forgot-password pages. Usually it needs no click. Create a free widget in the Cloudflare dashboard (Turnstile, Add widget, type Managed, your admin's address as the hostname) and paste its two keys here. If AUTH_TURNSTILE_SITE_KEY and AUTH_TURNSTILE_SECRET_KEY are set on the server they win over what is saved here, and the check is on. If Cloudflare is unreachable or the keys are wrong and nobody can sign in, set AUTH_CAPTCHA_OFF=1 on the server and restart the CMS.",
  },
  fields: [
    { name: "captchaEnabled", type: "checkbox", label: "Turn the check on", defaultValue: false },
    {
      name: "turnstileSiteKey",
      type: "text",
      label: "Turnstile site key",
      admin: { description: "The public key of the widget. It is sent to the sign-in page. Ignored while AUTH_TURNSTILE_SITE_KEY and AUTH_TURNSTILE_SECRET_KEY are set." },
      validate: (value, { siblingData }) => needsKeys(value, siblingData, process.env) || "Enter the site key, or turn the check off.",
    },
    {
      name: "turnstileSecretKey",
      type: "text",
      label: "Turnstile secret key",
      admin: { description: "Write-only: once saved it shows as bullets here and in the API. Leave the bullets to keep the saved key, type a new one to replace it." },
      validate: (value, { siblingData }) => needsKeys(value, siblingData, process.env) || "Enter the secret key, or turn the check off.",
      hooks: { afterRead: [secretAfterRead], beforeChange: [secretBeforeChange] },
    },
    { name: "captchaOnSignIn", type: "checkbox", label: "Applies to: sign-in", defaultValue: true },
    { name: "captchaOnReset", type: "checkbox", label: "Applies to: password reset", defaultValue: true },
  ],
};

// Turns the stored group and the environment into what the rest of the file needs. Pure, so it is tested without a server.
//   on        the check is required
//   signIn    / reset   which of the two requests it applies to
//   siteKey, secret     the keys in use
//   source    "off" | "env" | "settings" | "none"
export function resolveConfig(stored, env = process.env) {
  const group = stored && typeof stored === "object" ? stored : {};
  const base = { signIn: group.captchaOnSignIn !== false, reset: group.captchaOnReset !== false };
  if (truthy(env.AUTH_CAPTCHA_OFF)) return { ...base, on: false, source: "off", siteKey: "", secret: "" };
  const fromEnv = envKeys(env);
  if (fromEnv.siteKey && fromEnv.secret) return { ...base, on: true, source: "env", ...fromEnv };
  if (group.captchaEnabled === true) return { ...base, on: true, source: "settings", siteKey: text(group.turnstileSiteKey), secret: text(group.turnstileSecretKey) };
  return { ...base, on: false, source: "none", siteKey: "", secret: "" };
}

// The settings as the sign-in check needs them, secret included. An unreadable global (not migrated yet, a database
// hiccup) leaves only the environment in charge, the way the two-factor policy falls back to "off": the person's own password
// check still runs, and a database that cannot be read cannot sign anyone in anyway.
export async function loadConfig(payload, env = process.env) {
  let stored = null;
  try {
    const settings = await payload.findGlobal({ slug: SETTINGS, overrideAccess: true, depth: 0, context: { revealCaptchaSecret: true } });
    stored = settings?.signInProtection ?? null;
  } catch (err) {
    payload.logger?.warn?.(`[auth] could not read the sign-in protection settings: ${err?.message ?? err}`);
  }
  return resolveConfig(stored, env);
}

// What the sign-in page may know: whether to show the widget, and the public site key. Never the secret.
export function publicConfig(config) {
  if (!config.on) return { enabled: false, siteKey: "", signIn: false, reset: false };
  return { enabled: true, siteKey: config.siteKey, signIn: config.signIn, reset: config.reset };
}

// --- the request ---------------------------------------------------------------------------------------------------------

// The last entry of X-Forwarded-For (the one the proxy added), else X-Real-IP; "" for a call that did not come through the proxy.
export function clientAddress(headers) {
  const forwarded = headers?.get?.("x-forwarded-for");
  if (forwarded) {
    const last = forwarded.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return text(headers?.get?.("x-real-ip"));
}

export const tokenFromRequest = (req) => text(req?.headers?.get?.(HEADER));

// Asks Cloudflare whether a token is genuine, as a form post with the secret, the token and the visitor's address.
// Answers "ok", "failed" (the token is wrong, spent or expired), "misconfigured" (Cloudflare does not accept our secret)
// or "unavailable" (no answer in time, a reply we cannot read). Only the last two are not the visitor's doing.
export async function verifyTurnstile({ secret, token, address, fetchImpl = fetch, timeoutMs = 5000 }) {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (address) body.set("remoteip", address);
    const res = await fetchImpl(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return "unavailable";
    const answer = await res.json();
    if (answer?.success === true) return "ok";
    const codes = Array.isArray(answer?.["error-codes"]) ? answer["error-codes"] : [];
    if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) return "misconfigured";
    if (codes.includes("internal-error")) return "unavailable";
    return "failed";
  } catch {
    return "unavailable";
  }
}

// The decision for one request: nothing to do (null), or the refusal to send. Never includes a token or a key.
export async function decide({ operation, headers, context, config, fetchImpl = fetch, timeoutMs }) {
  const kind = OPERATIONS[operation];
  if (!kind) return null;
  if (context?.polysiteSkip2FA === true) return null;
  const address = clientAddress(headers);
  if (!address) return null;
  if (!config.on || !config[kind]) return null;

  const token = text(headers?.get?.(HEADER));
  if (!token || token.length > MAX_TOKEN) return { status: 400, message: "Please complete the check.", log: null };
  // The check is on but cannot work (no keys, or a stored secret that cannot be decrypted): refuse, and say why in the log.
  if (!config.secret) return { status: 503, message: "The check could not be completed, try again.", log: "the check is on but no secret key is available" };

  const result = await verifyTurnstile({ secret: config.secret, token, address, fetchImpl, timeoutMs });
  if (result === "ok") return null;
  if (result === "failed") return { status: 400, message: "Please complete the check.", log: null };
  return {
    status: 503,
    message: "The check could not be completed, try again.",
    log: result === "misconfigured" ? "Cloudflare refused the secret key" : "Cloudflare did not answer",
  };
}

// The users collection's `beforeOperation` hook. It is appended after the core's per-address throttle, so a flood is turned
// away before it costs a call to Cloudflare.
export async function captchaBeforeOperation({ operation, req }) {
  if (!OPERATIONS[operation] || req?.context?.polysiteSkip2FA === true) return;
  if (!clientAddress(req.headers)) return;
  const config = await loadConfig(req.payload);
  const refusal = await decide({ operation, headers: req.headers, context: req.context, config });
  if (!refusal) return;
  if (refusal.log) req.payload.logger.warn(`[auth] sign-in check refused a request: ${refusal.log}. ${OFF_HINT}`);
  throw publicError(refusal.message, refusal.status);
}

// GET /api/auth-captcha/config: no sign-in needed, because the sign-in page asks it.
export const captchaEndpoint = {
  path: "/auth-captcha/config",
  method: "get",
  handler: async (req) => {
    const config = await loadConfig(req.payload);
    return Response.json(publicConfig(config), { headers: { "Cache-Control": "no-store" } });
  },
};
