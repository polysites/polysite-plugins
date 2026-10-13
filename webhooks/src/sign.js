import { createHmac, timingSafeEqual } from "node:crypto";

// Every delivery carries four headers a receiver can check:
//
//   X-Polysite-Event       the event type, e.g. page.published
//   X-Polysite-Event-Id    the event's id: the same on every retry and replay, so a receiver can ignore one it has seen
//   X-Polysite-Delivery    this delivery's id in the admin's delivery log
//   X-Polysite-Timestamp   when THIS attempt was signed (Unix seconds); a retry carries a fresh one
//   X-Polysite-Signature   sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>", keyed with the endpoint's secret>
//
// The timestamp is inside the signed text, so a captured request cannot be replayed later with a new timestamp, and a receiver
// that rejects timestamps older than five minutes is safe against replay; the event id lets it also drop duplicates inside
// the window. (The Notifications plugin's older webhook channel signs the body alone.)
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const signature = (secret, timestamp, body) => `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

export function signedHeaders({ secret, type, eventId, deliveryId, body, now = new Date() }) {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    "X-Polysite-Event": type,
    "X-Polysite-Event-Id": eventId,
    "X-Polysite-Delivery": String(deliveryId),
    "X-Polysite-Timestamp": timestamp,
    "X-Polysite-Signature": signature(secret, timestamp, body),
  };
}

// The check a receiver makes, kept here so the documented snippet is the tested behaviour.
export function verify({ secret, headers, body, now = new Date(), tolerance = SIGNATURE_TOLERANCE_SECONDS }) {
  const h = (name) => headers[name] ?? headers[name.toLowerCase()];
  const timestamp = h("X-Polysite-Timestamp");
  const given = h("X-Polysite-Signature");
  if (!timestamp || !given) return { ok: false, reason: "missing headers" };
  const age = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > tolerance) return { ok: false, reason: "timestamp outside the allowed window" };
  const expected = Buffer.from(signature(secret, timestamp, body));
  const got = Buffer.from(String(given));
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, reason: "signature does not match" };
  return { ok: true };
}
