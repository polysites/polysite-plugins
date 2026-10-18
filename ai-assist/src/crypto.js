import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
// The provider API key is encrypted at rest with AES-256-GCM, keyed from PAYLOAD_SECRET through HKDF with a label specific to this plugin. Same scheme and
// stored form as the Email, Notifications and Webhooks plugins ("enc:v1:" + base64(iv|tag|ciphertext)); the helper is copied, not shared, so each plugin
// stays independently distributable. A value without the prefix is plaintext: read as it is, encrypted on its next save.
// A changed PAYLOAD_SECRET makes a stored value undecryptable: decrypt() returns "" and logs, and re-entering it fixes that.
const ENC_PREFIX = "enc:v1:";
export const SECRET_MASK = "••••••••";
let cachedKey;

function secretKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.PAYLOAD_SECRET;
  if (!secret) throw new Error("[ai-assist] PAYLOAD_SECRET is not set -- cannot encrypt the API key");
  cachedKey = Buffer.from(hkdfSync("sha256", secret, "polysite-plugin-ai-assist", "api-key-v1", 32));
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
    console.error("[ai-assist] could not decrypt the stored API key (was PAYLOAD_SECRET changed?) -- re-enter it in AI assist settings");
    return "";
  }
}
