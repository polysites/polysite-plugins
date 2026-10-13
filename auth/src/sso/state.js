import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The little bit of state a single sign-on round trip needs to carry from "start" to "callback": a random `state` (so the
// callback is one this browser started), a `nonce` (so the ID token was issued for this request), the PKCE verifier, and
// where to go afterwards. It lives in a signed, short-lived, HttpOnly cookie. Signed means the browser can't alter it; it
// is not secret from the person who owns the browser, and nothing in it is.
export const COOKIE = "polysite-sso";
export const FLOW_MS = 10 * 60 * 1000;

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");

// Only paths inside the admin, never an address on another site (an open redirect would turn the sign-in into a phishing aid).
export function safeNext(next) {
  if (typeof next !== "string") return "/admin";
  if (!next.startsWith("/admin")) return "/admin";
  if (next.includes("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return "/admin";
  if (next.length > 300) return "/admin";
  return next;
}

export function newFlow({ slug, next, now = Date.now() }) {
  return {
    state: b64(randomBytes(24)),
    nonce: b64(randomBytes(24)),
    verifier: b64(randomBytes(32)),
    slug,
    next: safeNext(next),
    exp: now + FLOW_MS,
  };
}

export const challengeOf = (verifier) => createHash("sha256").update(verifier).digest("base64url");

const mac = (body, key) => createHmac("sha256", key).update(body).digest("base64url");

export function signFlow(flow, key) {
  const body = b64(JSON.stringify(flow));
  return `${body}.${mac(body, key)}`;
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Returns the flow, or null when the cookie is missing, altered or too old.
export function readFlow(value, key, now = Date.now()) {
  if (typeof value !== "string") return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!sameText(signature, mac(body, key))) return null;
  try {
    const flow = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!flow || typeof flow.exp !== "number" || flow.exp < now) return null;
    return flow;
  } catch {
    return null;
  }
}

export const sameState = sameText;

export function cookieValue(headerValue, name) {
  for (const part of String(headerValue ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
