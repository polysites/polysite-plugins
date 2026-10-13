import assert from "node:assert/strict";
import { test } from "node:test";

import { daysAgo, formSubmissionCounts } from "../src/counts.js";
import analyticsPlugin, { PUBLIC_FIELDS } from "../src/index.js";
import { describeTool, sitesOverview } from "../src/overview.js";
import { checkCode, checkConversionId, checkHost, checkToolId, isHttpsOrigin } from "../src/providers.js";

test("checkToolId accepts real identifiers and refuses anything that could carry markup", () => {
  assert.equal(checkToolId("plausible", "example.org"), null);
  assert.ok(checkToolId("plausible", "https://example.org"));
  assert.ok(checkToolId("plausible", 'example.org"><script>'));
  assert.equal(checkToolId("umami", "123e4567-e89b-12d3-a456-426614174000"), null);
  assert.ok(checkToolId("umami", "not-a-uuid"));
  assert.equal(checkToolId("ga4", "G-ABC123XYZ9"), null);
  assert.ok(checkToolId("ga4", "UA-12345-1"));
  assert.ok(checkToolId("ga4", "G-ABC');alert(1);//"));
  assert.equal(checkToolId("gtm", "GTM-ABC1234"), null);
  assert.ok(checkToolId("gtm", "G-ABC1234"));
  assert.equal(checkToolId("meta", "1234567890123456"), null);
  assert.ok(checkToolId("meta", "12345"));
  assert.equal(checkToolId("linkedin", "123456"), null);
  assert.equal(checkToolId("x", "o1abc"), null);
  assert.equal(checkToolId("tiktok", "C4A1B2C3D4E5F6G7H8I9"), null);
  assert.ok(checkToolId("tiktok", ""), "an empty id is an error for a tool that needs one");
  assert.equal(checkToolId("custom", ""), null, "a custom script has no id");
});

test("checkConversionId and checkHost and checkCode", () => {
  assert.equal(checkConversionId("linkedin", ""), null);
  assert.equal(checkConversionId("linkedin", "9876543"), null);
  assert.ok(checkConversionId("linkedin", "abc"));
  assert.equal(checkConversionId("x", "tw-o1abc-o1abd"), null);
  assert.ok(checkConversionId("x", "o1abc"));
  assert.equal(checkHost(""), null);
  assert.equal(checkHost("https://stats.example.org:8443"), null);
  assert.ok(checkHost("http://stats.example.org"));
  assert.ok(checkHost("https://stats.example.org/js"));
  assert.ok(checkHost("javascript:alert(1)"));
  assert.equal(isHttpsOrigin(undefined), false);
  assert.equal(checkCode("<script>1</script>"), null);
  assert.ok(checkCode("   "));
  assert.ok(checkCode("x".repeat(20001)));
});

const kit = { canManageSiteSettings: (user) => user?.manage === true };
const sitesConfig = () =>
  analyticsPlugin(
    { collections: [{ slug: "sites", fields: [{ type: "tabs", tabs: [{ label: "General" }, { label: "Advanced" }] }] }, { slug: "forms", fields: [{ name: "title", type: "text" }] }, { slug: "pages", fields: [] }] },
    kit,
  );

test("the plugin adds its own settings collection and the overview screen, and changes no core collection", () => {
  const config = sitesConfig();
  const sites = config.collections.find((c) => c.slug === "sites");
  assert.deepEqual(sites.fields[0].tabs.map((t) => t.label), ["General", "Advanced"], "nothing is added to Sites");
  assert.equal(sites.fields.length, 1);
  const forms = config.collections.find((c) => c.slug === "forms");
  assert.equal(forms.fields.length, 1);
  assert.equal(forms.fields[0].name, "title");
  assert.equal(config.collections.find((c) => c.slug === "pages").fields.length, 0);
  assert.deepEqual(config.collections.map((c) => c.slug), ["sites", "forms", "pages", "analytics-settings"]);
  assert.equal(config.globals[0].slug, "analytics-overview");
  assert.equal(config.globals[0].access.update(), false);
  assert.deepEqual(config.endpoints.map((e) => e.path), ["/analytics/form-counts", "/analytics/overview"]);
});

const settings = () => sitesConfig().collections.find((c) => c.slug === "analytics-settings");

test("the settings collection declares which fields are public, and only fields it really has", () => {
  const c = settings();
  const declared = c.custom.polysite.siteSettings;
  assert.equal(declared.key, "analytics");
  assert.deepEqual(declared.publicFields, PUBLIC_FIELDS);
  const names = c.fields.map((f) => f.name);
  for (const name of declared.publicFields) assert.ok(names.includes(name), `${name} is a field`);
  assert.deepEqual(names, ["tools", "respectPrivacySignals", "consentNotice"]);
});

test("only site-settings managers write the settings; signed-in users read them; the public reads nothing", () => {
  const { access, admin } = settings();
  const as = (user) => ({ req: { user } });
  assert.equal(access.read(as(null)), false);
  assert.equal(access.read(as({ id: 1 })), true);
  for (const op of ["create", "update", "delete"]) {
    assert.equal(access[op](as({ id: 1 })), false, `${op} needs site-settings permission`);
    assert.equal(access[op](as({ id: 1, manage: true })), true);
    assert.equal(access[op](as(null)), false);
  }
  assert.equal(admin.hidden({ user: { id: 1 } }), true);
  assert.equal(admin.hidden({ user: { id: 1, manage: true } }), false);
});

test("the tool rows are plain data in the plugin's own table, with no enum of other plugins' names", () => {
  const row = settings().fields.find((f) => f.name === "tools").fields;
  assert.deepEqual(row.find((f) => f.name === "tool").options.map((o) => o.value), ["ga4", "gtm", "meta", "tiktok", "linkedin", "x", "plausible", "umami", "custom"]);
});

test("the tool row validators depend on the chosen tool", () => {
  const row = settings().fields.find((f) => f.name === "tools").fields;
  const field = (name) => row.find((f) => f.name === name);

  assert.equal(field("toolId").validate("G-ABC123XYZ9", { siblingData: { tool: "ga4" } }), true);
  assert.equal(typeof field("toolId").validate("", { siblingData: { tool: "ga4" } }), "string");
  assert.equal(typeof field("toolId").validate("not-an-id", { siblingData: { tool: "meta" } }), "string");
  assert.equal(field("toolId").validate("", { siblingData: { tool: "custom" } }), true);

  assert.equal(field("scriptHost").validate("https://stats.example.org", { siblingData: { tool: "umami" } }), true);
  assert.equal(typeof field("scriptHost").validate("http://x.org", { siblingData: { tool: "umami" } }), "string");
  assert.equal(field("scriptHost").validate("http://ignored", { siblingData: { tool: "ga4" } }), true);

  assert.equal(typeof field("code").validate("", { siblingData: { tool: "custom" } }), "string");
  assert.equal(field("code").validate("<script>1</script>", { siblingData: { tool: "custom" } }), true);
  assert.equal(field("code").validate("", { siblingData: { tool: "ga4" } }), true);
  assert.equal(typeof field("name").validate(" ", { siblingData: { tool: "custom" } }), "string");
  assert.equal(typeof field("conversionId").validate("nope", { siblingData: { tool: "linkedin" } }), "string");
});

test("describeTool says when a tool asks first and never includes pasted code", () => {
  assert.deepEqual(
    (({ tool, label, category, cookies, asksFirst }) => ({ tool, label, category, cookies, asksFirst }))(describeTool({ tool: "ga4", toolId: "G-ABC123XYZ9" })),
    { tool: "ga4", label: "Google Analytics 4", category: "analytics", cookies: true, asksFirst: true },
  );
  assert.equal(describeTool({ tool: "plausible", toolId: "example.org" }).asksFirst, false);
  assert.equal(describeTool({ tool: "plausible", toolId: "example.org", askFirst: true }).asksFirst, true);
  assert.equal(describeTool({ tool: "gtm", toolId: "GTM-ABC1234" }).category, "marketing");
  assert.equal(describeTool({ tool: "gtm", toolId: "GTM-ABC1234", category: "analytics" }).category, "analytics");
  const custom = describeTool({ tool: "custom", name: "Live chat", category: "essential", code: "secret()" });
  assert.equal(custom.label, "Live chat");
  assert.equal(custom.asksFirst, false);
  assert.ok(!JSON.stringify(custom).includes("secret"));
  assert.equal(describeTool({ tool: "plausible", toolId: "example.org" }).dashboard, "https://plausible.io/example.org");
  assert.equal(describeTool({ tool: "mystery" }), null);
});

test("formSubmissionCounts reads through the caller's access and totals per window", async () => {
  const seen = [];
  const payload = {
    find: async (args) => (seen.push(args), { docs: [{ id: 3, title: "Join", site: { name: "Demo" } }], totalDocs: 1 }),
    findByID: async (args) => (seen.push(args), { id: args.id, title: "One", site: null }),
    count: async (args) => (seen.push(args), { totalDocs: args.where.and ? 2 : 9 }),
  };
  const user = { id: 1 };
  const now = new Date("2026-04-30T00:00:00.000Z");
  const out = await formSubmissionCounts(payload, user, now);
  assert.deepEqual(out.rows, [{ id: 3, title: "Join", site: "Demo", last7: 2, last30: 2, total: 9 }]);
  assert.ok(seen.every((a) => a.overrideAccess === false && a.user === user));
  assert.equal(daysAgo(7, now), "2026-04-23T00:00:00.000Z");

  const one = await formSubmissionCounts(payload, user, now, "5");
  assert.equal(one.rows[0].id, "5");
  const missing = await formSubmissionCounts({ ...payload, findByID: async () => { throw new Error("Forbidden"); } }, user, now, "5");
  assert.deepEqual(missing.rows, []);
});

test("sitesOverview reads each site's tools from the settings collection, as the caller", async () => {
  const seen = [];
  const user = { id: 1 };
  const payload = {
    find: async (args) => {
      seen.push(args);
      if (args.collection === "sites") return { docs: [{ id: 1, name: "One", domain: "one.test" }, { id: 2, name: "Two", domain: "two.test", analytics: { tools: [{ tool: "ga4", toolId: "G-OLD1234" }] } }] };
      return { docs: [{ id: 9, site: 1, respectPrivacySignals: false, tools: [{ tool: "plausible", toolId: "example.org" }, { tool: "custom", name: "Chat", code: "secret()" }] }] };
    },
  };
  const out = await sitesOverview(payload, user);
  assert.deepEqual(out.map((s) => [s.id, s.settingsId, s.respectPrivacySignals, s.tools.map((t) => t.tool)]), [[1, 9, false, ["plausible", "custom"]], [2, null, true, []]]);
  assert.ok(!JSON.stringify(out).includes("secret"));
  assert.ok(seen.every((a) => a.overrideAccess === false && a.user === user));
  assert.deepEqual(seen[1].where, { site: { in: [1, 2] } });
});
