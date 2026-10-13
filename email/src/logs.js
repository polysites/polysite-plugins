// A record of what the email plugin did, so "did the password reset go out?" has an
// answer other than the server log. Three kinds of entry:
//   message          an email Polysite handed to the mail server (sent or failed)
//   test             the "send a test email" button
//   settings-change  who changed Email Settings, and which fields
//
// Bodies are never stored: a password-reset message contains a working reset link.
// Recipients and subjects are personal information, so entries expire (the
// "Keep email logs for" setting, 90 days by default).

const isSuper = ({ req: { user } }) => user?.isSuperAdmin === true;

export const EmailLogs = {
  slug: "email-logs",
  labels: { singular: "Email Log", plural: "Email Logs" },
  admin: {
    group: "Administration",
    // Nested under an "Email" section in the admin sidebar.
    custom: { navSubgroup: "Email" },
    useAsTitle: "subject",
    defaultColumns: ["createdAt", "kind", "status", "to", "subject", "errorMessage"],
    description: "Every email Polysite sent or tried to send, and changes to Email Settings. Message bodies are not stored.",
  },
  defaultSort: "-createdAt",
  // Written by the plugin only (through the local API); nobody edits history by hand.
  access: { read: isSuper, create: () => false, update: () => false, delete: isSuper },
  fields: [
    {
      name: "kind",
      type: "select",
      required: true,
      defaultValue: "message",
      index: true,
      options: [
        { label: "Message", value: "message" },
        { label: "Test email", value: "test" },
        { label: "Settings change", value: "settings-change" },
      ],
    },
    {
      name: "status",
      type: "select",
      required: true,
      index: true,
      options: [
        { label: "Sent", value: "sent" },
        { label: "Failed", value: "failed" },
        { label: "Recorded", value: "recorded" },
      ],
    },
    { name: "to", type: "text", index: true },
    { name: "from", type: "text" },
    { name: "subject", type: "text" },
    { name: "attempts", type: "number", admin: { description: "How many times the plugin tried (temporary refusals are retried twice)." } },
    { name: "providerResponse", type: "text", admin: { description: "What the mail server said when it accepted the message." } },
    { name: "messageId", type: "text" },
    { name: "errorMessage", type: "text" },
    { name: "errorCode", type: "text" },
    { name: "responseCode", type: "number", admin: { description: "The SMTP reply code, for example 535 for a bad password or 421 for a temporary refusal." } },
    { name: "actor", type: "relationship", relationTo: "users", admin: { description: "Who triggered it, for test emails and settings changes." } },
    { name: "details", type: "textarea" },
  ],
};

/** Addresses as one readable string, whether Nodemailer was given a string, a list or objects. */
export function recipientsOf(to) {
  const list = Array.isArray(to) ? to : to ? [to] : [];
  return list
    .map((r) => (typeof r === "string" ? r : (r?.address ?? "")))
    .filter(Boolean)
    .join(", ");
}

const SECRET_MASK = "••••••••";

/**
 * Which Email Settings fields changed, in words, with no secret values. The
 * password can't be compared (it reads back masked), so it is judged from what
 * was submitted.
 */
export function describeSettingsChange(before, after, submitted = {}) {
  const lines = [];
  const same = (a, b) => (a ?? "") === (b ?? "");
  const show = (label, key) => {
    if (!same(before?.[key], after?.[key])) lines.push(`${label}: ${before?.[key] || "(empty)"} → ${after?.[key] || "(empty)"}`);
  };
  show("SMTP host", "smtpHost");
  show("SMTP port", "smtpPort");
  show("From address", "fromAddress");
  show("From name", "fromName");
  show("Keep logs for (days)", "logRetentionDays");
  if (!same(before?.smtpUser, after?.smtpUser)) lines.push("SMTP username changed");
  if (typeof submitted.smtpPassword === "string" && submitted.smtpPassword !== SECRET_MASK) lines.push("SMTP password changed");
  return lines;
}

/** Writes one entry. Logging must never stop an email or a save, so failures are only reported. */
export async function writeLog(payload, entry) {
  try {
    await payload.create({ collection: "email-logs", data: entry, overrideAccess: true });
  } catch (err) {
    console.error(`[email] could not write the email log: ${err.message}`);
  }
}

/** Deletes entries older than `days`. Returns how many. */
export async function purgeOldLogs(payload, days, now = new Date()) {
  if (!days || days < 1) return 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const res = await payload.delete({ collection: "email-logs", where: { createdAt: { less_than: cutoff } }, overrideAccess: true });
  return res.docs.length;
}

/** Runs the purge shortly after boot and every few hours, reading the setting each time. */
export function startLogPurge(payload) {
  const g = globalThis;
  if (g.__polysiteEmailPurge) {
    clearInterval(g.__polysiteEmailPurge.timer);
    clearTimeout(g.__polysiteEmailPurge.first);
  }
  const run = async () => {
    try {
      const settings = await payload.findGlobal({ slug: "email-settings", overrideAccess: true });
      const n = await purgeOldLogs(payload, settings?.logRetentionDays ?? 90);
      if (n > 0) payload.logger.info(`Email logs: deleted ${n} expired entr${n === 1 ? "y" : "ies"}`);
    } catch (err) {
      payload.logger.error({ err, msg: "Email log purge failed" });
    }
  };
  g.__polysiteEmailPurge = { timer: setInterval(run, 6 * 3_600_000).unref(), first: setTimeout(run, 2 * 60_000).unref() };
}
