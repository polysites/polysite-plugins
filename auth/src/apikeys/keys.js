import { createHmac, randomBytes } from "node:crypto";

// API keys look like `psk_<8 hex>_<32 letters and digits>`. The first part is shown in lists so a person can tell keys
// apart; the whole text is the secret, shown once when the key is made and stored only as a keyed hash.
export const KEY_PREFIX = "psk_";
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHAPE = /^psk_[0-9a-f]{8}_[A-Za-z0-9]{32}$/;

export function generateKey() {
  const id = randomBytes(4).toString("hex");
  let secret = "";
  // 32 characters from a 57-letter alphabet is about 187 bits; the modulo bias is far below anything that matters here.
  for (const byte of randomBytes(32)) secret += ALPHABET[byte % ALPHABET.length];
  const key = `${KEY_PREFIX}${id}_${secret}`;
  return { key, prefix: `${KEY_PREFIX}${id}` };
}

export const looksLikeKey = (text) => typeof text === "string" && SHAPE.test(text);

// The key out of `Authorization: Bearer <key>`, or null when the header is anything else (a JWT, another scheme, nothing).
export function keyFromHeader(header) {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match && looksLikeKey(match[1]) ? match[1] : null;
}

export const hashKey = (key, hmacKey) => createHmac("sha256", hmacKey).update(key).digest("hex");

export const isExpired = (row, now = Date.now()) => Boolean(row?.expiresAt) && new Date(row.expiresAt).getTime() <= now;

// The same label rules for every caller: a short, plain name that says what the key is for.
export function cleanLabel(input) {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  return text.length >= 1 && text.length <= 80 ? text : null;
}

// Days until a key stops working, as a date; null means it never expires. Anything that isn't a whole number of days
// from 1 to 3650 is refused (undefined), so a typo never silently makes a key that lives forever.
export function expiryFromDays(days, now = Date.now()) {
  if (days === undefined || days === null || days === "") return null;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 3650) return undefined;
  return new Date(now + n * 86_400_000).toISOString();
}

// Off unless an administrator switches it on: a key is a long-lived credential that signs in as its owner.
export const apiKeysEnabled = () => process.env.AUTH_API_KEYS === "true";
