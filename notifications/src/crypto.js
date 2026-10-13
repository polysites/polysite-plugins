import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Channel URLs (a Slack/Teams webhook URL *is* a credential) and webhook
// signing secrets are encrypted at rest with AES-256-GCM, keyed from
// PAYLOAD_SECRET through HKDF with a label specific to this plugin. Same
// scheme and stored form as the Email plugin's SMTP password
// ("enc:v1:" + base64(iv|tag|ciphertext)); the helper is deliberately
// copied, not shared, so each plugin stays independently distributable.
// Values without the prefix are legacy plaintext: read as-is, encrypted on
// their next save. A changed PAYLOAD_SECRET makes a stored value
// undecryptable -- decrypt() returns "" and logs, and re-entering fixes it.
const ENC_PREFIX = "enc:v1:";
export const SECRET_MASK = "••••••••";
let cachedKey;

function secretKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.PAYLOAD_SECRET;
  if (!secret) throw new Error("[notifications] PAYLOAD_SECRET is not set -- cannot encrypt channel secrets");
  cachedKey = Buffer.from(hkdfSync("sha256", secret, "polysite-plugin-notifications", "channel-secret-v1", 32));
  return cachedKey;
}

export const isEncrypted = (value) => typeof value === "string" && value.startsWith(ENC_PREFIX);

export function encrypt(plain) {
  if (!plain || plain.startsWith(ENC_PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decrypt(stored) {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored;
  try {
    const raw = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    console.error("[notifications] could not decrypt a stored channel secret (was PAYLOAD_SECRET changed?) -- re-enter it on the channel");
    return "";
  }
}
