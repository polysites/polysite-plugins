import assert from "node:assert/strict";
import { test } from "node:test";

import i18nPlugin, { PUBLIC_FIELDS, SLUG } from "../src/index.js";
import { checkDefaultLanguage, checkLanguages, normaliseSiteLanguages, offeredBy, selectedSiteId, unionOffered } from "../src/languages.js";

test("a site with no row or no languages set offers English only", () => {
  for (const row of [null, undefined, {}, { languages: [] }, { languages: "fr" }]) assert.deepEqual(offeredBy(row), ["en"]);
});

test("the default comes first, and the first listed stands in when the default isn't offered", () => {
  assert.deepEqual(offeredBy({ languages: ["fr", "en"], defaultLanguage: "en" }), ["en", "fr"]);
  assert.deepEqual(offeredBy({ languages: ["fr", "de"], defaultLanguage: "xx" }), ["fr", "de"]);
  assert.deepEqual(offeredBy({ languages: ["fr", "en", "de"] }), ["fr", "en", "de"]);
});

test("several sites together offer the union, each language once, and English when some site has no row", () => {
  const rows = [{ languages: ["en", "fr"] }, { languages: ["fr", "de"], defaultLanguage: "fr" }];
  assert.deepEqual(unionOffered(rows).sort(), ["de", "en", "fr"]);
  assert.deepEqual(unionOffered([{ languages: ["fr", "de"] }]).sort(), ["de", "fr"]);
  assert.deepEqual(unionOffered([{ languages: ["fr", "de"] }], 2).sort(), ["de", "en", "fr"]);
  assert.deepEqual(unionOffered([], 0), []);
  assert.deepEqual(unionOffered([], 1), ["en"]);
});

test("the site an admin is working in is read from the multi-tenant cookie", () => {
  assert.equal(selectedSiteId("a=1; payload-tenant=7; b=2"), "7");
  assert.equal(selectedSiteId("payload-tenant=undefined"), null);
  assert.equal(selectedSiteId("payload-tenant="), null);
  assert.equal(selectedSiteId("other=1"), null);
  assert.equal(selectedSiteId(undefined), null);
});

test("saving keeps the default among the languages, drops repeats, and clears the default when none are offered", () => {
  assert.deepEqual(normaliseSiteLanguages({ languages: ["fr", "de"], defaultLanguage: "es", site: 1 }), { languages: ["fr", "de"], defaultLanguage: "fr", site: 1 });
  assert.deepEqual(normaliseSiteLanguages({ languages: ["fr", "fr", "en"], defaultLanguage: "en" }), { languages: ["fr", "en"], defaultLanguage: "en" });
  assert.deepEqual(normaliseSiteLanguages({ languages: [], defaultLanguage: "fr" }), { languages: [], defaultLanguage: null });
  assert.equal(normaliseSiteLanguages(undefined), undefined);
});

test("a save naming only one of the two is completed from the saved row, and one naming neither is left alone", () => {
  const original = { languages: ["en", "fr"], defaultLanguage: "en" };
  assert.deepEqual(normaliseSiteLanguages({ defaultLanguage: "fr" }, original), { languages: ["en", "fr"], defaultLanguage: "fr" });
  assert.deepEqual(normaliseSiteLanguages({ languages: ["de"] }, original), { languages: ["de"], defaultLanguage: "de" });
  assert.deepEqual(normaliseSiteLanguages({ site: 3 }, original), { site: 3 });
  assert.deepEqual(normaliseSiteLanguages({ site: 3 }), { site: 3 });
});

const known = new Set(["en", "fr", "pt-BR"]);

test("only languages in the catalog can be stored, since the column is plain text and not an enum", () => {
  assert.equal(checkLanguages(known)(["en", "pt-BR"]), true);
  assert.equal(checkLanguages(known)([]), true);
  assert.equal(checkLanguages(known)(null), true);
  assert.match(checkLanguages(known)(["en", "xx", "yy"]), /xx, yy/);
  assert.match(checkLanguages(known)("fr"), /list of language codes/);
});

test("the default language must be in the catalog and among the offered ones", () => {
  const check = checkDefaultLanguage(known);
  assert.equal(check("fr", { siblingData: { languages: ["en", "fr"] } }), true);
  assert.equal(check("fr", { siblingData: { languages: [] } }), true);
  assert.equal(check(undefined, { siblingData: { languages: ["en"] } }), true);
  assert.match(check("pt-BR", { siblingData: { languages: ["en", "fr"] } }), /must be one of/);
  assert.match(check("xx", { siblingData: {} }), /Not a language/);
});

const kit = { canManageSiteSettings: (user) => user?.isSuperAdmin === true };
const baseConfig = () => ({
  localization: { locales: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }], defaultLocale: "en", fallback: true },
  collections: [
    { slug: "pages", fields: [] },
    { slug: "sites", fields: [{ type: "tabs", tabs: [{ label: "General", fields: [] }, { label: "Advanced", fields: [] }] }] },
  ],
});

test("the plugin adds its own site-languages collection, a languages cell to the lists, and leaves Sites exactly as it was", () => {
  const config = baseConfig();
  const sitesBefore = JSON.stringify(config.collections.find((c) => c.slug === "sites"));
  const out = i18nPlugin(config, kit);
  assert.equal(JSON.stringify(out.collections.find((c) => c.slug === "sites")), sitesBefore, "Sites is not touched");

  const own = out.collections.find((c) => c.slug === SLUG);
  assert.deepEqual(own.fields.map((f) => f.name), ["languages", "defaultLanguage"]);
  assert.deepEqual(own.fields.map((f) => f.type), ["text", "text"], "plain text, never a select (a select is a database enum)");
  assert.equal(own.fields[0].hasMany, true);
  assert.deepEqual(own.custom.polysite.siteSettings, { key: "languages", publicFields: PUBLIC_FIELDS });
  assert.deepEqual(PUBLIC_FIELDS, ["languages", "defaultLanguage"]);
  assert.equal(own.hooks.beforeValidate.length, 1);
  assert.equal(own.admin.custom.navSubgroup, "Site features", "nested in the admin menu (admin.custom is what reaches the browser)");
  assert.equal(own.fields[0].admin.components.Field.clientProps.options.length, 2);
  assert.equal(own.fields[1].admin.components.Field.clientProps.single, true);

  const pages = out.collections.find((c) => c.slug === "pages");
  assert.deepEqual(pages.fields.map((f) => f.name), ["translations"]);
  assert.equal(pages.fields[0].type, "ui");
  assert.equal(pages.admin.defaultColumns, undefined, "a collection with no default columns is left to Payload");
  assert.equal(typeof out.localization.filterAvailableLocales, "function");
  assert.equal(out.custom?.polysite?.languagesFor, undefined, "the core reads site.extensions.languages, not a function left in the config");
  assert.equal(out.endpoints[0].path, "/i18n/status");
  assert.equal(out.admin.components.header.length, 1);
});

test("the choice can be read by editors but changed only with the site-settings permission", () => {
  const own = i18nPlugin(baseConfig(), kit).collections.find((c) => c.slug === SLUG);
  const req = (user) => ({ req: { user } });
  assert.equal(own.access.read(req({ id: 1 })), true);
  assert.equal(own.access.read(req(null)), false);
  assert.equal(own.access.update(req({ id: 1 })), false);
  assert.equal(own.access.update(req({ isSuperAdmin: true })), true);
  assert.equal(own.admin.hidden({ user: { id: 1 } }), true);
  assert.equal(own.admin.hidden({ user: { isSuperAdmin: true } }), false);
});

test("the list shows the languages column after the first two, and only once", () => {
  const config = baseConfig();
  config.collections[0].admin = { defaultColumns: ["title", "slug", "_status", "updatedAt"] };
  const once = i18nPlugin(config, kit);
  assert.deepEqual(once.collections[0].admin.defaultColumns, ["title", "slug", "translations", "_status", "updatedAt"]);
  const twice = i18nPlugin(once, kit);
  assert.deepEqual(twice.collections[0].admin.defaultColumns, once.collections[0].admin.defaultColumns);
});

test("a core without translatable storage is left exactly as it was", () => {
  const config = { collections: [{ slug: "sites", fields: [] }] };
  assert.equal(i18nPlugin(config, kit), config);
  const stringLocales = { localization: { locales: ["en", "fr"] }, collections: [] };
  assert.equal(i18nPlugin(stringLocales, kit), stringLocales);
});

// A payload whose site-languages rows are given by site id; `sites` is how many sites exist.
const fakePayload = (rows, sites = Object.keys(rows).length) => ({
  find: async ({ collection, where }) => {
    assert.equal(collection, SLUG);
    const one = where?.site?.equals;
    const many = where?.site?.in?.map(String);
    const docs = Object.entries(rows)
      .filter(([id]) => (one !== undefined ? String(one) === id : many ? many.includes(id) : true))
      .map(([, row]) => row);
    return { docs };
  },
  count: async () => ({ totalDocs: sites }),
});

test("an editor can write in the languages of the site they are working in, and English when nothing is offered", async () => {
  const out = i18nPlugin(baseConfig(), kit);
  const filter = out.localization.filterAvailableLocales;
  const all = out.localization.locales;
  const payload = fakePayload({ 1: { languages: ["fr", "en"], defaultLanguage: "fr" } }, 2);
  const req = (cookie, user) => ({ payload, user, headers: new Headers(cookie ? { cookie } : {}) });
  const codes = async (r) => (await filter({ req: r, locales: all })).map((l) => l.code);

  assert.deepEqual(await codes(req("payload-tenant=1", { isSuperAdmin: true })), ["en", "fr"]);
  assert.deepEqual(await codes(req("payload-tenant=2", { isSuperAdmin: true })), ["en"], "a site with no row offers English only");
  assert.deepEqual(await codes(req(undefined, { isSuperAdmin: true })), ["en", "fr"]);
  assert.deepEqual(await codes(req(undefined, { assignedSites: [{ site: 2 }] })), ["en"]);
  assert.deepEqual(await codes(req(undefined, { assignedSites: [{ site: { id: 1 } }] })), ["en", "fr"]);
});

test("a failure in the lookup falls back to English instead of breaking the admin", async () => {
  const out = i18nPlugin(baseConfig(), kit);
  const broken = {
    find: async () => {
      throw new Error("db down");
    },
    count: async () => {
      throw new Error("db down");
    },
  };
  const result = await out.localization.filterAvailableLocales({ req: { payload: broken, user: { isSuperAdmin: true }, headers: new Headers() }, locales: out.localization.locales });
  assert.deepEqual(result.map((l) => l.code), ["en"]);
});

test("the status endpoint says whether the person can write in more than one language", async () => {
  const out = i18nPlugin(baseConfig(), kit);
  const handler = out.endpoints.find((e) => e.path === "/i18n/status").handler;
  const call = async (rows, cookie) => (await handler({ payload: fakePayload(rows), user: { isSuperAdmin: true }, headers: new Headers({ cookie }) })).json();
  assert.deepEqual(await call({ 1: { languages: ["en", "fr"] } }, "payload-tenant=1"), { multilingual: true, languages: ["en", "fr"] });
  assert.deepEqual(await call({}, "payload-tenant=1"), { multilingual: false, languages: ["en"] });
  assert.equal((await handler({ payload: fakePayload({}), user: null, headers: new Headers() })).status, 401);
});
