import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCollections } from "../src/collections.js";
import postsPlugin, { PUBLIC_FIELDS } from "../src/index.js";
import { buildPostUrl, checkNewsPath, DEFAULT_NEWS_PATH, newsPath } from "../src/urls.js";

// What the core offers a plugin (apps/cms/src/plugins/contentTypes.ts), faked so the plugin is tested alone.
const kit = (overrides = {}) => ({
  hasCapability: (user, module, op) => Boolean(user?.can?.includes(`${module}:${op}`)),
  normalizeSlug: (s) => s.trim().toLowerCase().replace(/\s+/g, "-"),
  uniquePerSite: () => () => true,
  recordException: () => {},
  // The core's publish rules are tested in the core; here they are stand-ins that record how the plugin uses them.
  i18n: { localizeNamed: (fields, names) => fields.map((f) => (names.includes(f.name) ? { ...f, localized: true } : f)) },
  workflow: {
    publishAware: (module, base) => Object.assign(async (args) => base(args), { publishAwareFor: module }),
    publishRules: (collection, module) => Object.assign(() => {}, { publishRulesFor: [collection, module] }),
    reviewFields: (module) => [{ name: "reviewState", forModule: module }],
    isDraftRequest: (query) => query?.draft === "true",
    changesLiveSite: ({ isDraftSave }) => !isDraftSave,
  },
  ...overrides,
});

test("the section address defaults to news and trims what the admin typed", () => {
  assert.equal(newsPath(null), DEFAULT_NEWS_PATH);
  assert.equal(newsPath({ extensions: { news: { path: "" } } }), "news");
  assert.equal(newsPath({ extensions: { news: { path: "/updates/" } } }), "updates");
});

test("the section address accepts plain words and refuses anything that could clash or misbehave", () => {
  for (const ok of [undefined, null, "", "news", "updates", "our-stories", "blog2"]) assert.equal(checkNewsPath(ok), null, String(ok));
  for (const bad of ["News", "a b", "a/b", "../x", "-news", "api", "admin", "feed.xml", "x".repeat(41), "news?x=1"]) assert.equal(typeof checkNewsPath(bad), "string", bad);
});

test("a post's public address is built from the site, the section and the slug", () => {
  assert.equal(buildPostUrl("example.org", "news", "big-day", "https"), "https://example.org/news/big-day");
  assert.equal(buildPostUrl("example.org", "updates", "/big-day"), "http://example.org/updates/big-day");
  assert.equal(buildPostUrl("example.org", "news", undefined), "http://example.org/news");
});

test("both collections declare themselves to the core, and only posts is addressable", () => {
  const [posts, categories] = buildCollections(kit());
  assert.deepEqual([posts.slug, categories.slug], ["posts", "post-categories"]);
  assert.equal(posts.custom.polysite.module.value, "posts");
  assert.equal(categories.custom.polysite.module.value, "posts");
  assert.equal(categories.custom.polysite.routable, undefined);

  const routable = posts.custom.polysite.routable;
  assert.equal(routable.docType, "post");
  assert.equal(routable.urlPath({ slug: "big-day" }, { site: { extensions: { news: { path: "updates" } } } }), "updates/big-day");
  assert.equal(routable.urlPath({ slug: "big-day" }, { site: null }), "news/big-day");
});

test("visitors only read published posts; staff with the permission read everything", () => {
  const [posts] = buildCollections(kit());
  assert.deepEqual(posts.access.read({ req: { user: undefined } }), { _status: { equals: "published" } });
  assert.equal(posts.access.read({ req: { user: { can: ["posts:read"] } } }), true);
  assert.equal(posts.access.create({ req: { user: { can: ["posts:read"] } } }), false);
  assert.equal(posts.access.create({ req: { user: { can: ["posts:create"] } } }), true);
});

test("posts have drafts, version history and scheduled publishing, and follow the core's publish rules", () => {
  const [posts] = buildCollections(kit());
  assert.deepEqual(posts.versions, { maxPerDoc: 25, drafts: { autosave: false, schedulePublish: true, validate: false } });
  assert.equal(posts.access.update.publishAwareFor, "posts");
  assert.deepEqual(posts.hooks.beforeChange[0].publishRulesFor, ["posts", "posts"]);
  assert.equal(posts.fields.find((f) => f.name === "reviewState")?.forModule, "posts");
  for (const name of ["title", "excerpt", "byline", "body"]) assert.equal(posts.fields.find((f) => f.name === name).localized, true, name);
  for (const name of ["slug", "publishedAt", "heroImage"]) assert.notEqual(posts.fields.find((f) => f.name === name).localized, true, name);
  const legacy = posts.fields.find((f) => f.name === "status");
  assert.equal(legacy.hidden, true, "the old status field stays, hidden, so no column is dropped");
  assert.equal(legacy.required, undefined);
});

test("editing needs the update permission, and the site is refreshed only when something live changed", async () => {
  const [posts] = buildCollections(kit());
  assert.equal(await posts.access.update({ req: { user: { can: ["posts:update"] } } }), true);
  assert.equal(await posts.access.update({ req: { user: { can: ["posts:read"] } } }), false);
  const calls = [];
  const original = globalThis.fetch;
  process.env.NUXT_REVALIDATE_URL = "http://web.test/revalidate";
  globalThis.fetch = async (url) => (calls.push(url), { ok: true });
  try {
    await posts.hooks.afterChange[0]({ req: { query: { draft: "true" } } });
    assert.equal(calls.length, 0, "saving a draft doesn't touch the public site");
    await posts.hooks.afterChange[0]({ req: { query: {} } });
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
    delete process.env.NUXT_REVALIDATE_URL;
  }
});

test("'page' and 'category' can't be post slugs, and everything else goes through the per-site check", async () => {
  const calls = [];
  const [posts] = buildCollections(kit({ uniquePerSite: () => (value) => (calls.push(value), true) }));
  const validate = posts.fields.find((f) => f.name === "slug").validate;
  assert.equal(typeof (await validate("page", {})), "string");
  assert.equal(typeof (await validate("category", {})), "string");
  assert.equal(await validate("budget-day", {}), true);
  assert.deepEqual(calls, ["budget-day"]);
});

test("a first publish fills in the date, and an existing date is kept", () => {
  const [posts] = buildCollections(kit());
  const hook = posts.fields.find((f) => f.name === "publishedAt").hooks.beforeChange[0];
  assert.match(hook({ value: undefined, siblingData: { _status: "published" } }), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(hook({ value: "2026-01-01T00:00:00.000Z", siblingData: { _status: "published" } }), "2026-01-01T00:00:00.000Z");
  assert.equal(hook({ value: undefined, siblingData: { _status: "draft" } }), undefined);
});

test("the plugin adds posts, post-categories and its own news-settings, and leaves other collections (Sites included) alone", () => {
  const sites = { slug: "sites", fields: [{ type: "tabs", tabs: [{ label: "General" }, { label: "Advanced" }] }] };
  const out = postsPlugin({ collections: [{ slug: "pages", fields: [] }, sites] }, kit());
  assert.deepEqual(out.collections.map((c) => c.slug), ["pages", "sites", "posts", "post-categories", "news-settings"]);
  assert.equal(out.collections.find((c) => c.slug === "sites"), sites, "Sites is returned untouched: no field, tab or column is added to it");
  assert.equal(out.collections.find((c) => c.slug === "pages").fields.length, 0);
});

test("the news settings are the plugin's own collection, declared for the core to attach to each site", () => {
  const settings = postsPlugin({ collections: [] }, kit()).collections.find((c) => c.slug === "news-settings");
  assert.deepEqual(settings.custom.polysite.siteSettings, { key: "news", publicFields: PUBLIC_FIELDS });
  assert.deepEqual(PUBLIC_FIELDS, ["label", "path", "perPage"]);
  const names = settings.fields.map((f) => f.name);
  for (const name of PUBLIC_FIELDS) assert.ok(names.includes(name), name);
  assert.ok(names.includes("resetNews"));

  const path = settings.fields.find((f) => f.name === "path");
  assert.equal(path.validate("news"), true);
  assert.equal(typeof path.validate("api"), "string");
  assert.equal(settings.fields.find((f) => f.name === "resetNews").type, "ui");
});

test("only people who manage site settings can change the news settings", () => {
  const settings = postsPlugin({ collections: [] }, kit({ canManageSiteSettings: (user) => user?.manager === true })).collections.find((c) => c.slug === "news-settings");
  const req = (user) => ({ req: { user } });
  assert.equal(settings.access.read(req({})), true);
  assert.equal(settings.access.read(req(null)), false);
  assert.equal(settings.access.update(req({ manager: true })), true);
  assert.equal(settings.access.update(req({})), false);
  assert.equal(settings.access.create(req({})), false);
  assert.equal(settings.admin.hidden({ user: {} }), true);
  assert.equal(settings.admin.hidden({ user: { manager: true } }), false);
});

test("a site config without a Sites collection gets just the new collections", () => {
  const out = postsPlugin({ collections: [] }, kit());
  assert.deepEqual(out.collections.map((c) => c.slug), ["posts", "post-categories", "news-settings"]);
});

test("version history is for people who can read posts, not for every signed-in person", () => {
  const [posts] = buildCollections(kit());
  const as = (can) => posts.access.readVersions({ req: { user: can ? { can } : null } });
  assert.equal(as(["posts:read"]), true);
  assert.equal(as(["media:read"]), false);
  assert.equal(as(null), false);
});
