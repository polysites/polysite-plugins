import assert from "node:assert/strict";
import { test } from "node:test";

import { searchEndpoint } from "../src/endpoints.js";
import searchPlugin, { PUBLIC_FIELDS } from "../src/index.js";
import { languageFor, offeredBy } from "../src/languages.js";
import { bodySnippet, clampPerPage, cleanQuery, MAX_QUERY, MAX_TERMS, pageNumber, relevance, SNIPPET_LENGTH, snippetOf } from "../src/query.js";
import { clientKey, createLimiter } from "../src/ratelimit.js";
import { collectionsFor, readSettings, searchableCollections, searchSite } from "../src/search.js";

// ---- the query ----------------------------------------------------------------------------------------------------

test("a search is cleaned: whitespace collapses, wildcards and control characters go, repeats are dropped", () => {
  assert.deepEqual(cleanQuery("  budget   plan "), { q: "budget plan", terms: ["budget", "plan"], tooShort: false });
  assert.equal(cleanQuery("100%_off\\ now\u0000").q, "100 off now");
  assert.deepEqual(cleanQuery("News news NEWS").terms, ["News"]);
  assert.equal(cleanQuery("%%%").q, "");
});

test("a search that is too short, or missing, is flagged", () => {
  for (const raw of [undefined, null, "", "   ", "a", "%a%"]) assert.equal(cleanQuery(raw).tooShort, true, String(raw));
  assert.equal(cleanQuery("ab").tooShort, false);
});

test("a search is bounded in length and in words", () => {
  const long = cleanQuery("x".repeat(500));
  assert.equal(long.q.length, MAX_QUERY);
  const many = cleanQuery(Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "));
  assert.equal(many.terms.length, MAX_TERMS);
});

test("page numbers and page sizes are kept in range", () => {
  assert.equal(pageNumber("3"), 3);
  for (const bad of [undefined, "0", "-2", "abc", "NaN"]) assert.equal(pageNumber(bad), 1);
  assert.equal(clampPerPage(25), 25);
  assert.equal(clampPerPage(9999), 50);
  for (const bad of [0, -1, "x", null, undefined]) assert.equal(clampPerPage(bad), 10);
});

test("an exact title beats a prefix, a word start, a contained word and an address-only match", () => {
  const terms = ["budget"];
  const q = "budget";
  const scores = [
    relevance("Budget", "budget", terms, q),
    relevance("Budget day", "x", terms, q),
    relevance("The budget", "x", terms, q),
    relevance("Unbudgeted", "x", terms, q),
    relevance("Something else", "budget-news", terms, q),
  ];
  assert.deepEqual([...scores].sort((a, b) => b - a), scores);
  assert.equal(new Set(scores).size, scores.length);
});

test("a result's summary is its excerpt, else its SEO description, trimmed", () => {
  assert.equal(snippetOf({ excerpt: " Hello   there ", meta: { description: "seo" } }), "Hello there");
  assert.equal(snippetOf({ meta: { description: "seo" } }), "seo");
  assert.equal(snippetOf({}), "");
  assert.ok(snippetOf({ excerpt: "word ".repeat(100) }).endsWith("…"));
  assert.ok(snippetOf({ excerpt: "word ".repeat(100) }).length <= 221);
});

// ---- languages ----------------------------------------------------------------------------------------------------

test("the search language is one the site offers, else the site's default", () => {
  const site = { extensions: { languages: { languages: ["en", "fr"], defaultLanguage: "en" } } };
  assert.equal(languageFor(site, "fr"), "fr");
  assert.equal(languageFor(site, "de"), "en");
  assert.equal(languageFor(site, undefined), "en");
  assert.equal(languageFor({}, "fr"), "en");
  assert.deepEqual(offeredBy({ extensions: { languages: { languages: ["fr", "en"], defaultLanguage: "fr" } } }), ["fr", "en"]);
});

// ---- the limiter --------------------------------------------------------------------------------------------------

test("a client gets its budget per window, then waits, then starts again", () => {
  let t = 0;
  const limiter = createLimiter({ max: 3, windowMs: 60_000, now: () => t });
  for (let i = 0; i < 3; i++) assert.equal(limiter.hit("a").ok, true);
  const blocked = limiter.hit("a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfter, 60);
  assert.equal(limiter.hit("b").ok, true, "another client is unaffected");
  t = 59_000;
  assert.equal(limiter.hit("a").retryAfter, 1);
  t = 60_000;
  assert.equal(limiter.hit("a").ok, true);
});

test("the whole server has a ceiling too, and the table of clients cannot grow without bound", () => {
  const t = 0;
  const limiter = createLimiter({ max: 5, globalMax: 4, windowMs: 1000, now: () => t, maxKeys: 3 });
  for (let i = 0; i < 4; i++) assert.equal(limiter.hit(`ip${i}`).ok, true);
  assert.equal(limiter.hit("ip9").ok, false, "past the global ceiling even for a new client");
});

test("the client is the last address the proxy saw, not one the visitor typed", () => {
  assert.equal(clientKey(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9");
  assert.equal(clientKey(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientKey(new Headers()), "unknown");
  assert.equal(clientKey({ "x-forwarded-for": "1.1.1.1" }), "1.1.1.1");
});

// ---- settings and collections -------------------------------------------------------------------------------------

const config = {
  collections: [
    { slug: "pages" },
    { slug: "posts", labels: { plural: "Posts" }, custom: { polysite: { module: { value: "posts" }, routable: { docType: "post" } } } },
    { slug: "post-categories", custom: { polysite: { module: { value: "posts" } } } },
    { slug: "media" },
  ],
};

test("pages and every routable content type are searchable; anything else is not", () => {
  assert.deepEqual(
    searchableCollections(config).map((c) => c.slug),
    ["pages", "posts"],
  );
});

test("a site searches what it chose, and only modules it has on", () => {
  const all = searchableCollections(config);
  assert.deepEqual(collectionsFor({ enabledModules: ["pages", "posts"] }, readSettings({}), all).map((c) => c.slug), ["pages", "posts"]);
  assert.deepEqual(collectionsFor({ enabledModules: ["pages"] }, readSettings({}), all).map((c) => c.slug), ["pages"]);
  assert.deepEqual(collectionsFor({ enabledModules: ["pages", "posts"] }, readSettings({ extensions: { search: { collections: ["posts"] } } }), all).map((c) => c.slug), ["posts"]);
});

test("settings default to off and are clamped", () => {
  assert.equal(readSettings({}).enabled, false);
  assert.equal(readSettings({ extensions: { search: { enabled: true, perPage: 500, placeholder: "  Find  " } } }).perPage, 50);
  assert.equal(readSettings({ extensions: { search: { enabled: true, placeholder: "  Find  " } } }).placeholder, "Find");
  assert.equal(readSettings(null).enabled, false);
});

test("the plugin adds its own site-settings collection, leaves the core's collections alone, and adds the endpoint", () => {
  const sites = { slug: "sites", fields: [{ type: "tabs", tabs: [{ label: "General", fields: [] }, { label: "Advanced", fields: [] }] }] };
  const out = searchPlugin({ collections: [sites, { slug: "pages" }], endpoints: [{ path: "/x", method: "get" }], ...{ localization: {} } });
  assert.deepEqual(out.collections[0], sites, "Sites is untouched: the plugin adds no field and no tab to it");
  assert.deepEqual(out.collections[1], { slug: "pages" });
  assert.deepEqual(out.endpoints.map((e) => e.path), ["/x", "/site-search"]);
  const settings = out.collections.find((c) => c.slug === "search-settings");
  assert.ok(settings, "the settings collection exists");
  assert.deepEqual(settings.custom.polysite.siteSettings, { key: "search", publicFields: PUBLIC_FIELDS });
  assert.equal(settings.fields.find((f) => f.name === "enabled").defaultValue, false);
  // every field the public site reads is a real field of the row (and nothing else is promised)
  for (const name of PUBLIC_FIELDS) assert.ok(settings.fields.some((f) => f.name === name), name);
  assert.ok(!settings.fields.some((f) => f.name === "site"), "the core's multi-tenant plugin adds the site field, not this plugin");
});

test("only site-settings managers can change the settings, and anyone signed in can read the row", () => {
  const kit = { canManageSiteSettings: (user) => user?.role === "site-admin" };
  const settings = searchPlugin({ collections: [] }, kit).collections.find((c) => c.slug === "search-settings");
  const req = (user) => ({ req: { user } });
  assert.equal(settings.access.read(req({ role: "site-user" })), true);
  assert.equal(settings.access.read(req(null)), false);
  for (const op of ["create", "update", "delete"]) {
    assert.equal(settings.access[op](req({ role: "site-admin" })), true, op);
    assert.equal(settings.access[op](req({ role: "site-user" })), false, op);
    assert.equal(settings.access[op](req(null)), false, op);
  }
  assert.equal(settings.admin.hidden({ user: { role: "site-user" } }), true);
  assert.equal(settings.admin.hidden({ user: { role: "site-admin" } }), false);
});

test("the placeholder is made translatable when the core offers the helper", () => {
  const kit = { canManageSiteSettings: () => true, i18n: { localizeNamed: (fields, names) => fields.map((f) => (names.includes(f.name) ? { ...f, localized: true } : f)) } };
  const settings = searchPlugin({ collections: [] }, kit).collections.find((c) => c.slug === "search-settings");
  assert.equal(settings.fields.find((f) => f.name === "placeholder").localized, true);
  assert.notEqual(settings.fields.find((f) => f.name === "perPage").localized, true);
});


// ---- a search, against a fake database ----------------------------------------------------------------------------

// A small stand-in for Payload's local API: `find` answers from tables and records how it was asked.
function fakePayload({ index = {}, live = {}, drafts = ["pages", "posts"], bodies = null } = {}) {
  const calls = [];
  const collections = Object.fromEntries(["pages", "posts", "site-urls", "sites"].map((s) => [s, { config: { versions: drafts.includes(s) ? { drafts: true } : undefined } }]));
  // `bodies` (index row id -> text) means the core's index has the searchText column.
  if (bodies) collections["site-urls"].config.fields = [{ name: "title" }, { name: "searchText" }];
  return {
    calls,
    config,
    collections,
    logger: { error() {} },
    async find(args) {
      calls.push(args);
      if (args.collection === "site-urls" && args.select?.searchText) {
        const ids = args.where.and.find((c) => c.id)?.id.in ?? [];
        return { docs: ids.filter((id) => id in bodies).map((id) => ({ id, searchText: bodies[id] })) };
      }
      if (args.collection === "site-urls") return { docs: index[args.locale] ?? [] };
      const ids = args.where.and.find((c) => c.id)?.id.in ?? [];
      return { docs: (live[args.collection] ?? []).filter((d) => ids.includes(d.id) && !(d.drafted && args.where.and.some((c) => c._status))) };
    },
  };
}

const site = { id: 7, domain: "example.org", enabledModules: ["pages", "posts"], extensions: { search: { enabled: true, perPage: 2 }, languages: { languages: ["en", "fr"], defaultLanguage: "en" } } };
const entry = (n, slug, id, path, extra = {}) => ({ id: n, doc: { relationTo: slug, value: id }, path, docType: slug === "posts" ? "post" : "page", site: 7, priority: 0, languages: ["en"], ...extra });
const search = (payload, q, extra = {}) => searchSite(payload, { site, ...cleanQuery(q), q: cleanQuery(q).q, lang: "en", page: 1, ...extra });

test("a search asks the index about this site's published items only, and the live documents as an anonymous visitor", async () => {
  const payload = fakePayload({ index: { en: [entry(1, "pages", 10, "budget")] }, live: { pages: [{ id: 10, title: "Budget" }] } });
  const out = await search(payload, "budget");
  assert.equal(out.total, 1);
  const [indexCall, liveCall] = payload.calls;
  assert.equal(indexCall.collection, "site-urls");
  assert.equal(indexCall.overrideAccess, false);
  assert.ok(indexCall.where.and.some((c) => c.site?.equals === 7));
  assert.ok(indexCall.where.and.some((c) => c.status?.equals === "published"));
  assert.equal(liveCall.overrideAccess, false);
  assert.equal(liveCall.draft, false);
  assert.ok(liveCall.where.and.some((c) => c.site?.equals === 7));
  assert.ok(liveCall.where.and.some((c) => c._status?.equals === "published"));
});

test("an index entry whose live document is a draft, gone, or on another site is not returned", async () => {
  const payload = fakePayload({
    index: { en: [entry(1, "pages", 10, "budget"), entry(2, "pages", 11, "budget-draft"), entry(3, "pages", 12, "budget-gone"), entry(4, "pages", 13, "budget-other", { site: 99 })] },
    live: { pages: [{ id: 10, title: "Budget" }, { id: 11, title: "Budget draft", drafted: true }, { id: 13, title: "Budget elsewhere" }] },
  });
  const out = await search(payload, "budget", { site: { ...site, extensions: { search: { enabled: true, perPage: 10 } } } });
  assert.deepEqual(out.results.map((r) => r.id), [10]);
});

test("a collection without drafts is not filtered on a status it does not have", async () => {
  const payload = fakePayload({ drafts: [], index: { en: [entry(1, "pages", 10, "budget")] }, live: { pages: [{ id: 10, title: "Budget" }] } });
  await search(payload, "budget");
  assert.ok(!payload.calls[1].where.and.some((c) => c._status));
});

test("results are ranked by relevance and paged, with totals", async () => {
  const payload = fakePayload({
    index: { en: [entry(1, "pages", 1, "a"), entry(2, "pages", 2, "b"), entry(3, "pages", 3, "c")] },
    live: { pages: [{ id: 1, title: "About the budget" }, { id: 2, title: "Budget" }, { id: 3, title: "Budgeting tips" }] },
  });
  const first = await search(payload, "budget");
  assert.deepEqual(first.results.map((r) => r.title), ["Budget", "Budgeting tips"]);
  assert.equal(first.total, 3);
  assert.equal(first.totalPages, 2);
  const second = await search(payload, "budget", { page: 2 });
  assert.deepEqual(second.results.map((r) => r.title), ["About the budget"]);
  const past = await search(payload, "budget", { page: 9 });
  assert.equal(past.page, 2, "a page past the end shows the last one");
});

test("another language is searched in that language, with the default language's text for what is not translated yet", async () => {
  const payload = fakePayload({
    index: {
      fr: [entry(1, "pages", 1, "bonjour", { languages: ["en", "fr"] })],
      en: [entry(1, "pages", 1, "bonjour", { languages: ["en", "fr"] }), entry(2, "pages", 2, "hello-only", { languages: ["en"] })],
    },
    live: { pages: [{ id: 1, title: "Bonjour" }, { id: 2, title: "Hello only" }] },
  });
  const out = await search(payload, "o", { q: "bo", terms: ["bo"], lang: "fr", page: 1 });
  assert.equal(out.lang, "fr");
  assert.deepEqual(payload.calls.filter((c) => c.collection === "site-urls").map((c) => c.locale), ["fr", "en"]);
  assert.ok(payload.calls.every((c) => c.collection !== "site-urls" || c.fallbackLocale === "en"));
  assert.deepEqual(out.results.map((r) => r.id).sort(), [1, 2]);
});

test("a language the site does not offer falls back to its default", async () => {
  const payload = fakePayload({ index: { en: [] } });
  const out = await search(payload, "budget", { lang: "de" });
  assert.equal(out.lang, "en");
  assert.equal(payload.calls[0].locale, "en");
});

test("only the collections the site chose are searched", async () => {
  const payload = fakePayload({ index: { en: [] } });
  await search(payload, "budget", { site: { ...site, extensions: { search: { enabled: true, collections: ["posts"] } } } });
  const inClause = relationsAsked(payload.calls[0]);
  assert.deepEqual(inClause, ["posts"]);
});

test("a site with the posts module off does not search posts", async () => {
  const payload = fakePayload({ index: { en: [] } });
  await search(payload, "budget", { site: { ...site, enabledModules: ["pages"] } });
  assert.deepEqual(relationsAsked(payload.calls[0]), ["pages"]);
});

test("no index, or nothing searchable, is an empty answer rather than an error", async () => {
  const payload = fakePayload();
  delete payload.collections["site-urls"];
  assert.equal((await search(payload, "budget")).total, 0);
  const none = fakePayload();
  assert.equal((await search(none, "budget", { site: { ...site, enabledModules: [] } })).total, 0);
  assert.equal(none.calls.length, 0);
});

// ---- body text ----------------------------------------------------------------------------------------------------

const termGroups = (call) => call.where.and.filter((c) => c.or?.some((o) => o.title)).map((c) => c.or);

test("with body text in the index, every word may be in the title, the address or the body; without it, only the first two", async () => {
  const withBody = fakePayload({ bodies: {}, index: { en: [] } });
  await search(withBody, "budget plan");
  const groups = termGroups(withBody.calls[0]);
  assert.equal(groups.length, 2, "one group per word: all words must match");
  assert.deepEqual(groups[0].map((o) => Object.keys(o)[0]), ["title", "path", "searchText"]);
  assert.deepEqual(groups[1][2], { searchText: { like: "plan" } });
  // A hidden field can only be queried without access control, so the query itself must say what a visitor may see.
  assert.equal(withBody.calls[0].overrideAccess, true);
  assert.ok(withBody.calls[0].where.and.some((c) => c.site?.equals === 7) && withBody.calls[0].where.and.some((c) => c.status?.equals === "published"));
  assert.ok(!withBody.calls[0].select.searchText, "candidates are read without their bodies");
  const older = fakePayload({ index: { en: [] } });
  await search(older, "budget");
  assert.deepEqual(termGroups(older.calls[0])[0].map((o) => Object.keys(o)[0]), ["title", "path"], "a core without the column is searched on titles and addresses");
});

test("operators, quotes and wildcards are only ever bound values of a plain 'contains' match", async () => {
  const nasty = "a&b | !c :* 'd' \"e\" (f) <g> 100%_ \\";
  const payload = fakePayload({ bodies: {}, index: { en: [] } });
  await search(payload, nasty);
  const values = termGroups(payload.calls[0]).flatMap((group) => group.map((o) => Object.values(o)[0]));
  assert.ok(values.length > 0);
  for (const v of values) {
    assert.deepEqual(Object.keys(v), ["like"]);
    assert.ok(!/[%_\\]/.test(v.like), v.like);
  }
  assert.ok(!JSON.stringify(payload.calls[0].where).includes("to_tsquery"));
});

test("a word only in the body finds the page, with a snippet from the body and the words in it", async () => {
  const text = `${"Intro words. ".repeat(30)}The housing levy changes next year for renters.`;
  const payload = fakePayload({ bodies: { 1: text }, index: { en: [entry(1, "pages", 10, "plans")] }, live: { pages: [{ id: 10, title: "Our plans" }] } });
  const out = await search(payload, "levy renters");
  assert.deepEqual(out.results.map((r) => r.id), [10]);
  assert.ok(out.results[0].snippet.includes("housing levy changes"));
  assert.ok(out.results[0].snippet.startsWith("…"));
  assert.ok(out.results[0].snippet.length <= 225);
  const bodyCall = payload.calls.find((c) => c.select?.searchText);
  assert.equal(bodyCall.overrideAccess, true, "reading a hidden field needs it; the where does the visitor rule");
  assert.ok(bodyCall.where.and.some((c) => c.site?.equals === 7) && bodyCall.where.and.some((c) => c.status?.equals === "published"));
});

test("a summary that shows the searched word is kept; one that does not gives way to the body", async () => {
  const payload = fakePayload({
    bodies: { 1: "Long text mentioning the levy clearly.", 2: "Long text mentioning the levy clearly." },
    index: { en: [entry(1, "pages", 10, "a"), entry(2, "pages", 11, "b")] },
    live: { pages: [{ id: 10, title: "A", excerpt: "A short note about the levy." }, { id: 11, title: "B", excerpt: "Unrelated summary." }] },
  });
  const out = await search(payload, "levy", { site: { ...site, extensions: { search: { enabled: true, perPage: 10 } } } });
  const byId = Object.fromEntries(out.results.map((r) => [r.id, r.snippet]));
  assert.equal(byId[10], "A short note about the levy.");
  assert.equal(byId[11], "Long text mentioning the levy clearly.");
});

test("an entry with no body text keeps its summary, and a failure reading bodies only costs the snippet", async () => {
  const payload = fakePayload({ bodies: {}, index: { en: [entry(1, "pages", 10, "levy")] }, live: { pages: [{ id: 10, title: "Levy", excerpt: "Summary." }] } });
  assert.equal((await search(payload, "levy")).results[0].snippet, "Summary.");
  const find = payload.find.bind(payload);
  payload.find = async (args) => {
    if (args.select?.searchText) throw new Error("boom");
    return find(args);
  };
  const out = await search(payload, "levy");
  assert.equal(out.total, 1);
});

test("more words in better places rank higher: title, then address, then body", () => {
  const terms = ["tax", "plan"];
  const q = "tax plan";
  const both = relevance("Our tax and plan", "x", terms, q);
  const oneTitleOneBody = relevance("Our tax", "x", terms, q);
  const oneTitleOnePath = relevance("Our tax", "plan", terms, q);
  const pathOnly = relevance("Other", "tax-plan", terms, q);
  const bodyOnly = relevance("Other", "other", terms, q);
  assert.ok(both > oneTitleOnePath && oneTitleOnePath > oneTitleOneBody && oneTitleOneBody > pathOnly && pathOnly > bodyOnly && bodyOnly > 0, JSON.stringify([both, oneTitleOnePath, oneTitleOneBody, pathOnly, bodyOnly]));
  assert.ok(relevance("tax plan", "x", terms, q) > both, "the exact title wins");
});

test("a snippet shows the window with the most different words, at word edges, as plain text", () => {
  const far = `${"filler ".repeat(80)}alpha is here. ${"filler ".repeat(40)}alpha and beta together in one place. ${"filler ".repeat(40)}`;
  const s = bodySnippet(far, ["alpha", "beta"]);
  assert.ok(s.includes("alpha and beta together"), s);
  assert.ok(s.startsWith("…") && s.endsWith("…"));
  assert.ok(s.length <= SNIPPET_LENGTH + 4);
  assert.equal(bodySnippet("nothing relevant", ["zzz"]), "");
  assert.equal(bodySnippet("", ["a"]), "");
  assert.equal(bodySnippet("Short text with Levy.", ["levy"]), "Short text with Levy.");
  assert.equal(bodySnippet("a <script>alert(1)</script> b", ["script"]), "a <script>alert(1)</script> b", "markup stays text: the page escapes it");
  assert.equal(bodySnippet("odd (chars) [x] a.b*c", ["(chars)", "a.b*c"]), "odd (chars) [x] a.b*c", "regex characters in a word are literal");
});

// ---- the endpoint -------------------------------------------------------------------------------------------------

function request(query, headers = {}) {
  const calls = [];
  const payload = fakePayload({ index: { en: [entry(1, "pages", 10, "budget")] }, live: { pages: [{ id: 10, title: "Budget" }] } });
  const find = payload.find.bind(payload);
  payload.find = async (args) => {
    calls.push(args.collection);
    if (args.collection === "sites") return { docs: query.includes("domain=example.org") ? [site] : query.includes("domain=off.org") ? [{ ...site, extensions: { search: { enabled: false } } }] : [] };
    return find(args);
  };
  return { calls, req: { url: `http://x/api/site-search?${query}`, headers: new Headers(headers), payload } };
}

const handler = (limiter) => searchEndpoint({ limiter }).handler;
const open = { hit: () => ({ ok: true, retryAfter: 0 }) };

test("the endpoint answers a search, never cached", async () => {
  const { req } = request("domain=example.org&q=budget");
  const res = await handler(open)(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.total, 1);
  assert.equal(body.results[0].title, "Budget");
});

test("it needs a domain, an existing site, and search switched on for it", async () => {
  assert.equal((await handler(open)(request("q=budget").req)).status, 400);
  assert.equal((await handler(open)(request("domain=nowhere.org&q=budget").req)).status, 404);
  assert.equal((await handler(open)(request("domain=off.org&q=budget").req)).status, 404);
});

test("a search that is too short reads nothing", async () => {
  const { req, calls } = request("domain=example.org&q=a");
  const body = await (await handler(open)(req)).json();
  assert.equal(body.tooShort, true);
  assert.deepEqual(calls, ["sites"]);
});

test("past the budget the answer is 429 with Retry-After, and nothing is read", async () => {
  const limiter = createLimiter({ max: 1 });
  const { req, calls } = request("domain=example.org&q=budget", { "x-forwarded-for": "203.0.113.1" });
  assert.equal((await handler(limiter)(req)).status, 200);
  const before = calls.length;
  const res = await handler(limiter)(req);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
  assert.equal(calls.length, before);
});

test("a failure inside is a plain 500, with no detail for the visitor", async () => {
  const { req } = request("domain=example.org&q=budget");
  req.payload.find = async () => {
    throw new Error("secret detail");
  };
  req.payload.logger = { error() {} };
  const res = await handler(open)(req);
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(await res.json()).includes("secret"));
});

// ---- helpers and the stored list of collections --------------------------------------------------------------------

function relationsAsked(call) {
  const group = call.where.and.find((c) => c.or?.every((o) => o["doc.relationTo"]));
  return group.or.map((o) => o["doc.relationTo"].equals);
}

test("a content type that has since been removed stays in the list and does not stop the settings being saved", () => {
  const settings = searchPlugin({ collections: [] }).collections.find((c) => c.slug === "search-settings");
  const validate = settings.fields.find((f) => f.name === "collections").validate;
  assert.equal(validate(["pages", "events"]), true);
  assert.equal(validate(undefined), true);
  assert.notEqual(validate("pages"), true);
  assert.notEqual(validate(["Not A Name!"]), true);
});
