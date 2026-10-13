import assert from "node:assert/strict";
import { test } from "node:test";

import { describeSettingsChange, purgeOldLogs, recipientsOf } from "../src/logs.js";
import { htmlToText } from "../src/text.js";

test("htmlToText keeps links, paragraphs and list items readable", () => {
  const text = htmlToText('<p>Hello &amp; welcome</p><p>Reset: <a href="https://x.org/r?t=1">your password</a></p><ul><li>One</li><li>Two</li></ul>');
  assert.match(text, /Hello & welcome/);
  assert.match(text, /your password \(https:\/\/x\.org\/r\?t=1\)/);
  assert.match(text, /- One/);
  assert.equal(htmlToText(undefined), "");
  assert.equal(htmlToText('<a href="https://x.org">https://x.org</a>'), "https://x.org");
});

test("recipientsOf flattens strings, lists and address objects", () => {
  assert.equal(recipientsOf("a@x.org"), "a@x.org");
  assert.equal(recipientsOf(["a@x.org", { name: "B", address: "b@x.org" }]), "a@x.org, b@x.org");
  assert.equal(recipientsOf(undefined), "");
});

test("describeSettingsChange names what changed and never prints secrets", () => {
  const before = { smtpHost: "old.example.org", smtpPort: 587, smtpUser: "me", fromAddress: "a@x.org", fromName: "Polysite", logRetentionDays: 90 };
  const after = { ...before, smtpHost: "new.example.org", smtpUser: "someone-else", fromName: "Campaign" };
  const lines = describeSettingsChange(before, after, { smtpPassword: "a-new-password" });
  assert.deepEqual(lines, ["SMTP host: old.example.org → new.example.org", "From name: Polysite → Campaign", "SMTP username changed", "SMTP password changed"]);
  assert.ok(!lines.join("\n").includes("a-new-password"));
  assert.ok(!lines.join("\n").includes("someone-else"));
});

test("describeSettingsChange ignores an untouched password and unchanged fields", () => {
  const same = { smtpHost: "h", smtpPort: 25, smtpUser: "u", fromAddress: "a@x.org", fromName: "K", logRetentionDays: 90 };
  assert.deepEqual(describeSettingsChange(same, { ...same }, { smtpPassword: "••••••••" }), []);
  assert.deepEqual(describeSettingsChange(same, { ...same }, {}), []);
});

test("purgeOldLogs deletes entries older than the cutoff and does nothing without a period", async () => {
  const calls = [];
  const payload = { delete: async (args) => (calls.push(args), { docs: [{ id: 1 }, { id: 2 }] }) };
  const now = new Date("2026-04-01T00:00:00.000Z");
  assert.equal(await purgeOldLogs(payload, 30, now), 2);
  assert.equal(calls[0].where.createdAt.less_than, "2026-03-02T00:00:00.000Z");
  assert.equal(await purgeOldLogs(payload, 0, now), 0);
  assert.equal(calls.length, 1);
});
