import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 seconds): what Google Authenticator, Microsoft
// Authenticator, Authy, 1Password and the rest all speak. Written on node:crypto so the plugin needs no dependency for it.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error("not valid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

// 160 random bits, the length RFC 4226 recommends.
export const generateSecret = () => base32Encode(randomBytes(20));

export function hotp(secret, counter, digits = 6) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hash[hash.length - 1] & 15;
  const number = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(number % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (now = Date.now(), period = 30) => Math.floor(now / 1000 / period);

export const totp = (secret, now = Date.now()) => hotp(secret, stepOf(now));

// People type "123 456" or "123-456".
export const normaliseCode = (input) => String(input ?? "").replace(/[\s-]/g, "");

function sameText(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Returns the time step the code belongs to, or null. A step at or before `lastStep` is refused, so a code that was
// already used (or an earlier one) can never be replayed. `window` accepts one step either side for clock drift.
export function verifyTotp(secret, input, { now = Date.now(), window = 1, lastStep = -1 } = {}) {
  const code = normaliseCode(input);
  if (!/^\d{6}$/.test(code) || !secret) return null;
  const current = stepOf(now);
  let match = null;
  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset;
    if (step <= lastStep) continue;
    if (sameText(hotp(secret, step), code) && (match === null || step > match)) match = step;
  }
  return match;
}

export function otpauthUri({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
