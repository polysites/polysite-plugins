// Verifying a Polysite webhook in Node (no dependencies). `rawBody` must be the request body exactly as received, before any JSON parsing.
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyPolysite({ secret, rawBody, headers, toleranceSeconds = 300 }) {
  const timestamp = headers["x-polysite-timestamp"];
  const signature = headers["x-polysite-signature"];
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false; // too old (or from the future): a replay
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Self-check used by the plugin's tests: node verify.mjs <secret> <timestamp> <body> <signature>
if (process.argv[2]) {
  const [, , secret, timestamp, body, signature] = process.argv;
  const realNow = Date.now;
  Date.now = () => Number(timestamp) * 1000 + 5000; // pretend it is five seconds after the message was signed
  console.log(verifyPolysite({ secret, rawBody: body, headers: { "x-polysite-timestamp": timestamp, "x-polysite-signature": signature } }) ? "ok" : "fail");
  console.log(verifyPolysite({ secret, rawBody: body + " ", headers: { "x-polysite-timestamp": timestamp, "x-polysite-signature": signature } }) ? "BAD" : "tamper-rejected");
  Date.now = () => Number(timestamp) * 1000 + 3600_000;
  console.log(verifyPolysite({ secret, rawBody: body, headers: { "x-polysite-timestamp": timestamp, "x-polysite-signature": signature } }) ? "BAD" : "replay-rejected");
  Date.now = realNow;
}
