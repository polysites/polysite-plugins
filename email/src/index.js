import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

import { emailEndpoints } from "./endpoints.js";
import { describeSettingsChange, EmailLogs, recipientsOf, startLogPurge, writeLog } from "./logs.js";
import { htmlToText } from "./text.js";

// The SMTP password is encrypted at rest (AES-256-GCM) with a key derived
// from PAYLOAD_SECRET -- the secret this project already has (Payload signs
// its JWTs with it), so there's no second key to provision or lose. HKDF
// with a plugin-specific label means the raw secret itself is never the
// cipher key, and a key derived for another purpose can't decrypt this.
// The key is derived once per process; each encrypt/decrypt afterward is a
// single AES-GCM operation on a short string (microseconds).
//
// Stored form: "enc:v1:" + base64(iv[12] | authTag[16] | ciphertext).
// Anything without that prefix is treated as legacy plaintext (read as-is,
// encrypted on its next save), so existing installs migrate on their own.
// Rotating PAYLOAD_SECRET makes the stored value undecryptable -- decrypt()
// then returns "" and logs why, so an admin simply re-enters the password.
const ENC_PREFIX = "enc:v1:";
let cachedKey;

function secretKey() {
  if (cachedKey) return cachedKey;
  const secret = process.env.PAYLOAD_SECRET;
  if (!secret) throw new Error("[email] PAYLOAD_SECRET is not set -- cannot encrypt the SMTP password");
  cachedKey = Buffer.from(hkdfSync("sha256", secret, "polysite-plugin-email", "smtp-password-v1", 32));
  return cachedKey;
}

function encrypt(plain) {
  if (!plain || plain.startsWith(ENC_PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

function decrypt(stored) {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored;
  try {
    const raw = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    console.error("[email] could not decrypt the stored SMTP password (was PAYLOAD_SECRET changed?) -- re-enter it in Email Settings");
    return "";
  }
}

// Global-scope plugin (see ../polysite.plugin.json) -- email transport is
// instance-wide infrastructure, not something a single site opts in or out
// of, so this never consults Sites.enabledModules the way a per-site
// plugin would.
//
// Settings are admin-configurable from the CMS itself (an "Email Settings"
// global this plugin registers), not just env vars -- a Super Admin edits
// SMTP host/port/credentials/from-address through the admin UI and it takes
// effect on the very next email sent, no restart. Env vars only seed the
// field defaults a brand-new install starts with; once a document exists,
// the database is authoritative. This intentionally writes its own adapter
// instead of using @payloadcms/email-nodemailer, whose `transport` option
// is a single Nodemailer transporter fixed at boot -- exactly the
// restart-to-reconfigure limitation the live-settings requirement here
// rules out.
const SECRET_MASK = "••••••••";

const EmailSettingsGlobal = {
  slug: "email-settings",
  admin: {
    group: "Administration",
    // Nested under an "Email" section in the admin sidebar.
    custom: { navSubgroup: "Email" },
    description: "SMTP settings for password-reset and other transactional email. Installed by the email plugin.",
  },
  // Minimal, self-contained check (not a shared import from apps/cms's own
  // access/roles.ts) -- a plugin package is meant to be independently
  // distributable, so it only relies on the one stable, documented contract
  // every Polysite install has: req.user.isSuperAdmin.
  access: {
    read: ({ req: { user } }) => Boolean(user?.isSuperAdmin),
    update: ({ req: { user } }) => Boolean(user?.isSuperAdmin),
  },
  // A saved change reaches the next email immediately: drop the cached
  // settings and connection pool so the following send rebuilds them.
  hooks: {
    afterChange: [
      async ({ doc, previousDoc, req }) => {
        invalidateEmailCache();
        // Who changed what, never the values of secrets.
        const changes = describeSettingsChange(previousDoc, doc, req.data ?? {});
        if (changes.length > 0) {
          await writeLog(req.payload, { kind: "settings-change", status: "recorded", subject: "Email settings changed", details: changes.join("\n"), actor: req.user?.id });
        }
        return doc;
      },
    ],
  },
  fields: [
    { name: "smtpHost", type: "text", defaultValue: process.env.SMTP_HOST || "", label: "SMTP Host" },
    { name: "smtpPort", type: "number", defaultValue: Number(process.env.SMTP_PORT) || 587, label: "SMTP Port" },
    { name: "smtpUser", type: "text", defaultValue: process.env.SMTP_USER || "", label: "SMTP Username" },
    {
      name: "smtpPassword",
      type: "text",
      defaultValue: process.env.SMTP_PASS || "",
      label: "SMTP Password",
      admin: { description: "Write-only: once saved it displays as bullets here and in the API. Leave the bullets untouched to keep the current password, type a new value to replace it, or clear the field to remove it." },
      hooks: {
        // Masked on every read (admin form, REST, GraphQL) unless the caller
        // opts in via context: `revealEmailSecrets` (the send adapter) gets
        // the decrypted password, `rawEmailSecrets` (beforeChange below) gets
        // the stored value untouched. Doing this at the field-hook layer
        // rather than with a custom masked-input component keeps the plugin
        // plain JS with no admin import-map wiring, and protects the API
        // response too, not just the UI.
        afterRead: [
          ({ value, req }) => {
            if (req.context?.revealEmailSecrets) return decrypt(value);
            if (req.context?.rawEmailSecrets) return value;
            return value ? SECRET_MASK : value;
          },
        ],
        // The admin form submits whatever it displayed -- the mask -- on any
        // save that didn't touch this field, so treat the mask as "keep".
        // `previousValue` can't supply it: Payload runs afterRead on the
        // original document too, so it's the mask itself (verified -- using
        // it overwrote the stored password with the mask). Re-read the
        // stored value raw instead, then encrypt (a no-op if it already is).
        beforeChange: [
          async ({ value, req }) => {
            let next = value;
            if (value === SECRET_MASK) {
              const current = await req.payload.findGlobal({
                slug: "email-settings",
                overrideAccess: true,
                context: { rawEmailSecrets: true },
              });
              next = current?.smtpPassword ?? "";
            }
            return encrypt(next);
          },
        ],
      },
    },
    { name: "fromAddress", type: "text", defaultValue: process.env.EMAIL_FROM_ADDRESS || "no-reply@polysite.local", label: "From Address" },
    { name: "fromName", type: "text", defaultValue: process.env.EMAIL_FROM_NAME || "Polysite", label: "From Name" },
    {
      name: "logRetentionDays",
      type: "number",
      defaultValue: 90,
      min: 1,
      label: "Keep email logs for (days)",
      admin: { description: "Email Logs hold recipients' addresses and subjects, so they are deleted after this many days." },
    },
    { name: "testSend", type: "ui", admin: { components: { Field: "../../../plugins/email/src/admin/EmailTest#EmailTest" } } },
  ],
};

// Settings + SMTP connection pool, built once and reused across sends. Doing
// a database read and opening a fresh SMTP connection (TCP, TLS, AUTH) for
// every email is what made bulk sending slow -- measured at ~46ms per email
// sequentially, and one new connection per message when sent concurrently,
// which real providers rate-limit. Same shape as rbac/permissionCache.ts:
// load lazily, refresh when the source changes (the global's afterChange
// hook calls invalidateEmailCache), plus a TTL as a backstop in case a
// second process ever edits the settings.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null; // { settings, transporter, expires }
let loading = null;

// A refusal worth retrying: the server said "try later" (4xx -- e.g. a
// per-IP connection cap) or the connection itself dropped. Bad credentials
// and rejected recipients (5xx) are not retried. A plaintext "421" sent to a
// TLS client on port 465 surfaces as ESOCKET / "wrong version number".
const RETRY_DELAYS_MS = [2000, 6000];
function isTransient(err) {
  if (err?.responseCode >= 400 && err.responseCode < 500) return true;
  return ["ESOCKET", "ECONNECTION", "ETIMEDOUT", "ECONNRESET", "EDNS"].includes(err?.code);
}

function invalidateEmailCache() {
  const old = cache;
  cache = null;
  loading = null;
  old?.transporter?.close();
}

async function loadEmailCache(payload) {
  const settings = await payload.findGlobal({
    slug: "email-settings",
    overrideAccess: true,
    context: { revealEmailSecrets: true },
  });

  const transporter = settings?.smtpHost
    ? nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort || 587,
        // Port 465 is implicit TLS (the connection is encrypted from the
        // first byte); every other port upgrades via STARTTLS when the
        // server offers it, which Nodemailer does on its own. Without this a
        // 465 connection just hangs waiting for a plaintext greeting.
        secure: Number(settings.smtpPort) === 465,
        auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPassword } : undefined,
        // One pooled connection, dropped when idle. Sequential sends still
        // reuse it (the bulk-send saving), but shared mail hosts cap
        // concurrent SMTP connections per IP very low -- this one answers
        // "421 Too many concurrent SMTP connections" -- and an idle pool of
        // 10 kept for 10 minutes (nodemailer's default) locked the CMS out
        // of its own mail server, so password-reset mail was refused.
        pool: true,
        maxConnections: 1,
        maxMessages: 100,
        socketTimeout: 20_000,
      })
    : null;

  cache = { settings, transporter, expires: Date.now() + CACHE_TTL_MS };
  return cache;
}

async function getEmailCache(payload) {
  if (cache && cache.expires > Date.now()) return cache;
  // Concurrent first sends share one load instead of each doing their own.
  loading ??= loadEmailCache(payload).finally(() => {
    loading = null;
  });
  return loading;
}

function polysiteEmailAdapter() {
  return ({ payload }) => ({
    name: "polysite-email",
    defaultFromAddress: process.env.EMAIL_FROM_ADDRESS || "no-reply@polysite.local",
    defaultFromName: process.env.EMAIL_FROM_NAME || "Polysite",
    sendEmail: async (input) => {
      // Our own markers, not Nodemailer options: what kind of send this is, and who triggered it.
      const { polysiteKind, polysiteActor, ...message } = input;
      const { settings, transporter } = await getEmailCache(payload);

      if (!transporter) {
        console.log(`[email] not configured (no SMTP host set in Email Settings) -- would have sent: "${message.subject}" to ${message.to}`);
        return;
      }

      const from = `"${settings.fromName}" <${settings.fromAddress}>`;
      const entry = { kind: polysiteKind === "test" ? "test" : "message", to: recipientsOf(message.to), from, subject: message.subject, actor: polysiteActor };

      for (let attempt = 0; ; attempt++) {
        try {
          const info = await transporter.sendMail({
            from,
            ...message,
            // HTML-only mail scores worse with spam filters; add a text version when there isn't one.
            ...(message.html && !message.text ? { text: htmlToText(message.html) } : {}),
          });
          await writeLog(payload, { ...entry, status: "sent", attempts: attempt + 1, providerResponse: info?.response, messageId: info?.messageId });
          return info;
        } catch (err) {
          if (attempt < RETRY_DELAYS_MS.length && isTransient(err)) {
            console.warn(`[email] transient failure (${err.message.split("\n")[0]}); retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
            continue;
          }
          // Payload's own callers (e.g. forgot-password) don't surface a send
          // failure to the client, so this log is how a bad SMTP setting is noticed.
          console.error(`[email] send failed ("${message.subject}" to ${message.to}): ${err.message}`);
          await writeLog(payload, {
            ...entry,
            status: "failed",
            attempts: attempt + 1,
            errorMessage: String(err.message).split("\n")[0].slice(0, 500),
            errorCode: err.code,
            responseCode: err.responseCode,
          });
          throw err;
        }
      }
    },
  });
}

export default function emailPlugin(incomingConfig) {
  return {
    ...incomingConfig,
    collections: [...(incomingConfig.collections ?? []), EmailLogs],
    globals: [...(incomingConfig.globals ?? []), EmailSettingsGlobal],
    endpoints: [...(incomingConfig.endpoints ?? []), ...emailEndpoints],
    onInit: async (payload) => {
      await incomingConfig.onInit?.(payload);
      startLogPurge(payload);
    },
    email: polysiteEmailAdapter(),
  };
}
