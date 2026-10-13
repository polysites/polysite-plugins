import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Authenticator secrets (and later, SSO client secrets) are encrypted at rest with AES-256-GCM, keyed from
// PAYLOAD_SECRET through HKDF with a label specific to this plugin. Same scheme and stored form as the email and
// notifications plugins ("enc:v1:" + base64(iv|tag|ciphertext)); the helper is copied, not shared, so each plugin stays
// independently distributable. A changed PAYLOAD_SECRET makes a stored value undecryptable: decrypt() returns "" and
// logs, so a person re-enrols instead of the server crashing.
const ENC_PREFIX = "enc:v1:";
export const SECRET_MASK = "••••••••";
const keys = new Map();

function derive(label) {
  if (keys.has(label)) return keys.get(label);
  const secret = process.env.PAYLOAD_SECRET;
  if (!secret) throw new Error("[auth] PAYLOAD_SECRET is not set -- cannot protect sign-in secrets");
  const key = Buffer.from(hkdfSync("sha256", secret, "polysite-plugin-auth", label, 32));
  keys.set(label, key);
  return key;
}

export const secretKey = () => derive("secret-v1");
// A separate key for hashing recovery codes, so nothing that can decrypt a secret can also forge a code.
export const recoveryKey = () => derive("recovery-v1");

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
    console.error("[auth] could not decrypt a stored sign-in secret (was PAYLOAD_SECRET changed?) -- the person must set it up again");
    return "";
  }
}

// A separate key again for API keys: a key is stored only as an HMAC of itself, so reading the table does not reveal one.
export const apiKeyKey = () => derive("api-key-v1");
