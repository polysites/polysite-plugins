import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// The same three cheap layers the core puts in front of its public form endpoint, for the RSVP endpoint (a plugin may not import
// core files, so the small helper is copied, not shared): a hidden honeypot field a person never sees, a signed token issued when
// the form is loaded that must be a moment old, and a rate limit per visitor address. A floor, not a guarantee.

export const HONEYPOT_FIELD = "website_url";
export const MIN_FILL_MS = 1500;
export const MAX_TOKEN_AGE_MS = 6 * 60 * 60 * 1000;

let cachedKey;
/** A key for this plugin only, derived from the server secret, so a token for one thing is no use for another. */
export function secretFor(label) {
  const master = process.env.PAYLOAD_SECRET;
  if (!master) throw new Error("[events] PAYLOAD_SECRET is not set");
  cachedKey ??= new Map();
  if (!cachedKey.has(label)) cachedKey.set(label, Buffer.from(hkdfSync("sha256", master, "polysite-plugin-events", label, 32)));
  return cachedKey.get(label);
}

const mac = (key, text) => createHmac("sha256", key).update(text).digest("base64url");

export function issueToken(eventId, now = Date.now()) {
  return `${now}.${mac(secretFor("form-token"), `${eventId}.${now}`)}`;
}

export function checkToken(eventId, token, now = Date.now()) {
  if (typeof token !== "string" || !token) return "missing";
  const [issued, signature, ...rest] = token.split(".");
  const issuedAt = Number(issued);
  if (rest.length > 0 || !signature || !Number.isFinite(issuedAt)) return "invalid";
  const expected = Buffer.from(mac(secretFor("form-token"), `${eventId}.${issuedAt}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  const age = now - issuedAt;
  if (age < MIN_FILL_MS) return "too-fast";
  if (age > MAX_TOKEN_AGE_MS) return "expired";
  return "ok";
}

/** A sliding-window limiter held in memory: right for one server process. */
export class RateLimiter {
  constructor(limits, clock = Date.now) {
    this.limits = limits;
    this.clock = clock;
    this.hits = new Map();
  }

  allow(key) {
    const now = this.clock();
    const longest = Math.max(...this.limits.map((l) => l.windowMs));
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < longest);
    const allowed = this.limits.every((l) => recent.filter((t) => now - t < l.windowMs).length < l.max);
    if (allowed) recent.push(now);
    if (recent.length > 0) this.hits.set(key, recent);
    else this.hits.delete(key);
    if (this.hits.size > 10_000) for (const [k, times] of this.hits) if (now - (times[times.length - 1] ?? 0) >= longest) this.hits.delete(k);
    return allowed;
  }
}

/** A small time-limited cache held in memory. */
export class TtlCache {
  constructor(ttlMs, clock = Date.now, maxEntries = 1000) {
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value) {
    if (this.entries.size >= this.maxEntries) {
      const now = this.clock();
      for (const [k, v] of this.entries) if (v.expires <= now) this.entries.delete(k);
      if (this.entries.size >= this.maxEntries) this.entries.clear();
    }
    this.entries.set(key, { value, expires: this.clock() + this.ttlMs });
  }

  delete(key) {
    this.entries.delete(key);
  }
}

/** The visitor's address as the reverse proxy reports it, or "unknown". */
export function clientAddress(headers) {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip") || "unknown";
}

/** An email address as the same person would type it twice. */
export const normalizeEmail = (raw) => String(raw ?? "").normalize("NFKC").trim().toLowerCase();

/** The key two RSVPs share when they are from the same person for the same event: a keyed hash, never the address itself. */
export const dedupeKey = (eventId, email) => createHmac("sha256", secretFor("dedupe")).update(`rsvp.${eventId}.${normalizeEmail(email)}`).digest("hex");

/** The link in a confirmation email that lets a person give their place back. Stateless: nothing is stored to check it. */
export const cancelToken = (rsvpId) => `${rsvpId}.${mac(secretFor("cancel"), `cancel.${rsvpId}`)}`;

export function readCancelToken(token) {
  if (typeof token !== "string") return null;
  const [id, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !id || !signature || !/^\d+$/.test(id)) return null;
  const expected = Buffer.from(mac(secretFor("cancel"), `cancel.${id}`));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}
