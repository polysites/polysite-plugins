import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Recovery codes: ten single-use codes shown once when two-factor is switched on, for the day the phone is lost. They
// are stored only as HMAC hashes, so reading the database does not reveal a usable code.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/i/l

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    let text = "";
    for (const byte of randomBytes(10)) text += ALPHABET[byte % ALPHABET.length];
    return `${text.slice(0, 5)}-${text.slice(5)}`;
  });
}

export const normaliseRecovery = (input) => String(input ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const looksLikeRecoveryCode = (input) => normaliseRecovery(input).length === 10;

export const hashRecoveryCode = (code, key) => createHmac("sha256", key).update(normaliseRecovery(code)).digest("hex");

// Returns { ok, remaining }: the hashes left after the code was used up.
export function consumeRecoveryCode(hashes, input, key) {
  const list = Array.isArray(hashes) ? hashes : [];
  if (!looksLikeRecoveryCode(input)) return { ok: false, remaining: list };
  const wanted = Buffer.from(hashRecoveryCode(input, key));
  let found = -1;
  list.forEach((hash, index) => {
    const candidate = Buffer.from(String(hash));
    if (candidate.length === wanted.length && timingSafeEqual(candidate, wanted)) found = index;
  });
  if (found < 0) return { ok: false, remaining: list };
  return { ok: true, remaining: list.filter((_, index) => index !== found) };
}
