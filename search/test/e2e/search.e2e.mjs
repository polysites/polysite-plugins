// End-to-end check of public search (the search plugin plus the core's URL index and the web app), against a RUNNING stack.
// It switches search on for the dev site, writes pages and posts (published, draft, unpublished, on another site, in two
// languages), asks the public endpoint and the results page as a visitor would, and puts everything back.
//
//   BASE=http://cms:3001 WEB=http://web:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... SITE_ID=1 SITE_HOST=voidslate.localhost \
//     OTHER_HOST=second.localhost node plugins/search/test/e2e/search.e2e.mjs
//
// Needs the core and the search plugin; the posts and i18n plugins make it check more (posts, a second language).
import http from "node:http";

const BASE = process.env.BASE;
const WEB = process.env.WEB;
const SITE_ID = Number(process.env.SITE_ID ?? 1);
const SITE_HOST = process.env.SITE_HOST ?? "voidslate.localhost";
const OTHER_HOST = process.env.OTHER_HOST ?? "second.localhost";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(cond);
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + String(extra).slice(0, 400)}`);
};
const skip = (name, why) => console.log(`skip ${name} (${why})`);

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `JWT ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

// Each phase of the run asks from its own address, so the endpoint's rate limit (30 a minute per address) is never what a
// check trips over, except in the one place that tests it.
let nextAddress = 10;
const newAddress = () => `198.51.100.${nextAddress++}`;

// A visitor's search. No token: the endpoint is public.
async function search(domain, query, address = newAddress()) {
  const params = new URLSearchParams({ domain, ...query });
  const res = await api("GET", `/api/site-search?${params}`, { headers: { "X-Forwarded-For": address } });
  return res;
}

// A page on the public site as a visitor would ask for it. (fetch() won't let a script set Host, and the site is picked by it.)
function visit(path, { host = SITE_HOST, address = newAddress() } = {}) {
  const url = new URL(WEB);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path, method: "GET", headers: { Host: host, "X-Forwarded-For": address } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
const titles = (res) => (res.json?.results ?? []).map((r) => r.title);
const lexical = (text) => ({ root: { type: "root", format: "", indent: 0, version: 1, direction: null, children: [{ type: "paragraph", format: "", indent: 0, version: 1, direction: null, children: [{ type: "text", text, version: 1, format: 0, mode: "normal", style: "", detail: 0 }] }] } });
const hero = (heading) => [{ blockType: "hero", heading, subheading: "" }];

const login = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
const admin = login.json?.token;
ok("admin signs in", Boolean(admin));

const sites = (await api("GET", `/api/sites?depth=0&limit=50`, { token: admin })).json?.docs ?? [];
const site = sites.find((s) => s.id === SITE_ID);
const other = sites.find((s) => s.domain === OTHER_HOST);
ok("the dev site and a second site exist", Boolean(site) && Boolean(other), `${sites.map((s) => s.domain)}`);
const hasPosts = (site?.enabledModules ?? []).includes("posts") && (await api("GET", "/api/posts?limit=1", { token: admin })).status === 200;
const hasI18n = (await api("GET", "/api/i18n/status", { token: admin })).status === 200;

// A site's search settings are one row of the plugin's own `search-settings` collection (none until first saved). The public
// site gets the public part of it as `site.extensions.search` on the site it already fetches.
const settingsRow = async (siteId) => (await api("GET", `/api/search-settings?where[site][equals]=${siteId}&depth=0&limit=1`, { token: admin })).json?.docs?.[0] ?? null;
const rowBefore = { site: await settingsRow(SITE_ID), other: other ? await settingsRow(other.id) : null };
// A site's languages are one row of the i18n plugin's `site-languages` collection (none until first saved).
const langRow = async (siteId) => (hasI18n ? (await api("GET", `/api/site-languages?where[site][equals]=${siteId}&depth=0&limit=1`, { token: admin })).json?.docs?.[0] ?? null : null);
const setLanguages = async (siteId, body) => {
  const row = await langRow(siteId);
  return row ? api("PATCH", `/api/site-languages/${row.id}`, { token: admin, body }) : api("POST", "/api/site-languages", { token: admin, body: { site: siteId, ...body } });
};
const before = { langs: await langRow(SITE_ID) };
const token = `zq${Date.now().toString(36)}`; // a word nothing else on the site contains
const made = []; // [collection, id], removed at the end
const create = async (collection, body) => {
  const res = await api("POST", `/api/${collection}`, { token: admin, body });
  const id = res.json?.doc?.id;
  if (id) made.push([collection, id]);
  return { ...res, id };
};
const patchSite = (id, body) => api("PATCH", `/api/sites/${id}`, { token: admin, body });
// Changes a site's search settings the way the admin does: update its row, or create it on first save.
const setSearch = async (siteId, data) => {
  const row = await settingsRow(siteId);
  return row ? api("PATCH", `/api/search-settings/${row.id}`, { token: admin, body: data }) : api("POST", "/api/search-settings", { token: admin, body: { site: siteId, ...data } });
};
// What the public site is told about a site: `extensions` on the site, read the way the web app reads it (no sign-in).
const publicSearch = async (siteId) => (await api("GET", `/api/sites/${siteId}?depth=0`)).json?.extensions?.search;

try {
  // ---- off until switched on ---------------------------------------------------------------------------------------
  // A site that never saved its settings has no row: that is "off", not an error.
  if (!rowBefore.site) {
    ok("a site that never saved its settings is off, with no extension", (await publicSearch(SITE_ID)) === undefined && (await search(SITE_HOST, { q: "home" })).status === 404);
  } else skip("a site with no settings row", "this site already has one");
  await setSearch(SITE_ID, { enabled: false });
  const off = await search(SITE_HOST, { q: "home" });
  ok("a site that has not switched search on answers 404", off.status === 404, `${off.status}`);
  const offPage = await visit("/search?q=home");
  ok("and has no results page", offPage.status === 404, `${offPage.status}`);

  const on = await setSearch(SITE_ID, { enabled: true, perPage: 2, collections: [], placeholder: "Find it" });
  ok("a site administrator can switch search on", (on.status === 200 || on.status === 201) && on.json?.doc?.enabled === true, JSON.stringify(on.json)?.slice(0, 300));
  const ext = await publicSearch(SITE_ID);
  ok("the site carries its settings as extensions.search", ext?.enabled === true && ext?.perPage === 2 && ext?.placeholder === "Find it", JSON.stringify(ext));
  ok("and only the public fields of the row", Object.keys(ext ?? {}).every((k) => ["enabled", "placeholder", "perPage", "collections"].includes(k)), JSON.stringify(ext));
  const second = await api("POST", "/api/search-settings", { token: admin, body: { site: SITE_ID, enabled: false } });
  if (second.json?.doc?.id) made.push(["search-settings", second.json.doc.id]);
  ok("a site cannot have a second settings row", second.status >= 400, `${second.status}`);
  if (hasI18n) await setLanguages(SITE_ID, { languages: ["en", "fr"], defaultLanguage: "en" });
  await setSearch(other.id, { enabled: true, perPage: 10 });

  // ---- what exists --------------------------------------------------------------------------------------------------
  const live = await create("pages", { title: `Pomegranate ${token}`, slug: `${token}-live`, site: SITE_ID, _status: "published", content: hero("Live") });
  const liveB = await create("pages", { title: `Pomegranate jam ${token}`, slug: `${token}-live-b`, site: SITE_ID, _status: "published", content: hero("Live B") });
  const liveC = await create("pages", { title: `Quince ${token}`, slug: `${token}-live-c`, site: SITE_ID, _status: "published", content: hero("Live C") });
  const draft = await create("pages", { title: `Hiddendraft ${token}`, slug: `${token}-draft`, site: SITE_ID, _status: "draft", content: hero("Draft") });
  const unpublished = await create("pages", { title: `Withdrawn ${token}`, slug: `${token}-withdrawn`, site: SITE_ID, _status: "published", content: hero("W") });
  await api("PATCH", `/api/pages/${unpublished.id}`, { token: admin, body: { _status: "draft" } });
  const foreign = await create("pages", { title: `Elsewhere ${token}`, slug: `${token}-elsewhere`, site: other.id, _status: "published", content: hero("Elsewhere") });
  ok("pages are written (published, draft, unpublished, and one on the other site)", [live, liveB, liveC, draft, unpublished, foreign].every((r) => r.status === 201 || r.id), JSON.stringify([live.status, draft.status, foreign.status]));
  // A page edited after publishing: the live title is what visitors search, not the unpublished edit.
  await api("PATCH", `/api/pages/${liveB.id}?draft=true`, { token: admin, body: { title: `Renamed in draft ${token}`, _status: "draft" } });
  await new Promise((r) => setTimeout(r, 1500));

  // ---- the endpoint, as a visitor -----------------------------------------------------------------------------------
  const found = await search(SITE_HOST, { q: `pomegranate ${token}` });
  ok("a published page is found by its words", found.status === 200 && titles(found).includes(`Pomegranate ${token}`), JSON.stringify(found.json)?.slice(0, 300));
  const hit = found.json?.results?.find((r) => r.title === `Pomegranate ${token}`);
  ok("a result says what it is and where it lives", hit?.type === "page" && hit?.path === `${token}-live` && hit?.collection === "pages", JSON.stringify(hit));
  ok("results come with totals and no cache", found.json?.total === 2 && found.json?.perPage === 2 && found.headers.get("cache-control") === "no-store", JSON.stringify(found.json)?.slice(0, 200));
  ok("the best match comes first", titles(found)[0] === `Pomegranate ${token}`, JSON.stringify(titles(found)));
  ok("a page edited as a draft is found by its published title, not the edit", !titles(await search(SITE_HOST, { q: `Renamed in draft` })).some((t) => t.includes(token)) && titles(found).includes(`Pomegranate jam ${token}`), JSON.stringify(titles(found)));

  const all = await search(SITE_HOST, { q: token });
  ok("a draft that was never published is not found", !titles(all).includes(`Hiddendraft ${token}`) && !JSON.stringify(all.json).includes("Hiddendraft"), JSON.stringify(titles(all)));
  ok("an unpublished page is not found", !JSON.stringify(all.json).includes("Withdrawn"));
  ok("another site's page is not found on this site", !JSON.stringify(all.json).includes("Elsewhere"), JSON.stringify(titles(all)));
  const draftByTitle = await search(SITE_HOST, { q: "Hiddendraft" });
  ok("nor by searching for the draft's own title", draftByTitle.json?.total === 0, JSON.stringify(draftByTitle.json)?.slice(0, 200));
  const otherAll = await search(OTHER_HOST, { q: token });
  ok("the other site finds its own page and none of this site's", titles(otherAll).join("|") === `Elsewhere ${token}`, JSON.stringify(titles(otherAll)));

  const p1 = await search(SITE_HOST, { q: token, page: "1" });
  const p2 = await search(SITE_HOST, { q: token, page: "2" });
  const past = await search(SITE_HOST, { q: token, page: "99" });
  ok("three matches page at two a page", p1.json?.total === 3 && p1.json?.totalPages === 2 && p1.json?.results?.length === 2, JSON.stringify(p1.json)?.slice(0, 250));
  ok("the second page has the rest", p2.json?.results?.length === 1 && p2.json?.page === 2);
  ok("a page past the end shows the last one", past.json?.page === 2 && past.json?.results?.length === 1);

  // ---- bad input ---------------------------------------------------------------------------------------------------
  ok("a search without a domain is refused", (await search("", { q: token })).status === 400);
  ok("an unknown domain is a 404, not someone else's content", (await search("nowhere.invalid", { q: token })).status === 404);
  const short = await search(SITE_HOST, { q: "a" });
  ok("a search that is too short reads nothing", short.status === 200 && short.json?.tooShort === true && short.json?.results?.length === 0);
  for (const q of ["%%", "_", "%a%", "\\", "' OR 1=1 --", "<script>alert(1)</script>", "x".repeat(5000)]) {
    const res = await search(SITE_HOST, { q });
    ok(`odd input is handled (${JSON.stringify(q).slice(0, 24)})`, res.status === 200 && Array.isArray(res.json?.results), `${res.status} ${JSON.stringify(res.json)?.slice(0, 160)}`);
  }
  ok("a wildcard is not a way to list everything", (await search(SITE_HOST, { q: "%%%" })).json?.total === 0 && (await search(SITE_HOST, { q: "__" })).json?.total === 0);

  // ---- body text ---------------------------------------------------------------------------------------------------
  // Words that are only in the text of a page, never in its title or address.
  const bt = `bq${Date.now().toString(36)}`; // a word of its own, so these pages do not change the counts above
  const text = (body) => [{ blockType: "textBlock", heading: "", body: lexical(body) }];
  const w = (name) => `${name}${bt}`;
  const bodyPage = await create("pages", { title: `Plain title ${bt}`, slug: `${bt}-body`, site: SITE_ID, _status: "published", content: text(`Intro. The ${w("Bodyonly")} levy and ${w("Secondword")} are discussed here, with <b>tags</b> and & stuff.`) });
  const rankTitle = await create("pages", { title: `Rankword ${bt}`, slug: `${bt}-rank-a`, site: SITE_ID, _status: "published", content: hero("R") });
  const rankBody = await create("pages", { title: `Different ${bt}`, slug: `${bt}-rank-b`, site: SITE_ID, _status: "published", content: text(`This mentions Rankword ${bt} only in its text.`) });
  const draftBody = await create("pages", { title: `Draft body page ${bt}`, slug: `${bt}-draftbody`, site: SITE_ID, _status: "draft", content: text(`Secret ${w("Draftbody")} words`) });
  const withdrawnBody = await create("pages", { title: `Withdrawn body ${bt}`, slug: `${bt}-withdrawnbody`, site: SITE_ID, _status: "published", content: text(`Soon gone ${w("Withdrawnbody")}`) });
  await api("PATCH", `/api/pages/${withdrawnBody.id}`, { token: admin, body: { _status: "draft" } });
  const editedBody = await create("pages", { title: `Edited body page ${bt}`, slug: `${bt}-editedbody`, site: SITE_ID, _status: "published", content: text(`The live text says ${w("Livebody")}.`) });
  const editedFull = (await api("GET", `/api/pages/${editedBody.id}?depth=0`, { token: admin })).json;
  await api("PATCH", `/api/pages/${editedBody.id}?draft=true`, { token: admin, body: { content: [{ id: editedFull?.content?.[0]?.id, blockType: "textBlock", body: lexical(`The draft text says ${w("Editedbody")}.`) }], _status: "draft" } });
  const foreignBody = await create("pages", { title: `Foreign body ${bt}`, slug: `${bt}-foreignbody`, site: other.id, _status: "published", content: text(`Only on the other site ${w("Otherbody")}`) });
  const escapes = await create("pages", { title: `Escapes ${bt}`, slug: `${bt}-escapes`, site: SITE_ID, _status: "published", content: text(`Look at ${w("Esc")} <script>alert("x")</script> <img src=x onerror=alert(1)> done`) });
  const longBody = await create("pages", { title: `Long ${bt}`, slug: `${bt}-long`, site: SITE_ID, _status: "published", content: text(`${w("Headword")} ${"filler ".repeat(12000)} ${w("Tailword")}`) });
  ok("pages with text are written", [bodyPage, rankTitle, rankBody, draftBody, withdrawnBody, editedBody, foreignBody, escapes, longBody].every((r) => r.id), JSON.stringify([bodyPage.status, longBody.status, editedBody.status]));
  await new Promise((r) => setTimeout(r, 2500));

  const inBody = await search(SITE_HOST, { q: w("Bodyonly") });
  ok("a word only in a published page's body finds the page", titles(inBody).join("|") === `Plain title ${bt}`, JSON.stringify(inBody.json)?.slice(0, 300));
  ok("with a snippet of the body that holds the word", inBody.json?.results?.[0]?.snippet?.includes(w("Bodyonly")), JSON.stringify(inBody.json?.results?.[0]));
  ok("every word must be there, in any order", titles(await search(SITE_HOST, { q: `${w("Secondword")} ${w("Bodyonly")}` })).length === 1 && (await search(SITE_HOST, { q: `${w("Bodyonly")} ${w("Draftbody")}` })).json?.total === 0);
  ok("case does not matter", titles(await search(SITE_HOST, { q: w("Bodyonly").toUpperCase() })).length === 1);
  ok("a word only in a draft's body is never found", (await search(SITE_HOST, { q: w("Draftbody") })).json?.total === 0);
  ok("nor one in an unpublished page's body", (await search(SITE_HOST, { q: w("Withdrawnbody") })).json?.total === 0);
  ok("a page edited as a draft is found by its published text, not the edit", (await search(SITE_HOST, { q: w("Livebody") })).json?.total === 1 && (await search(SITE_HOST, { q: w("Editedbody") })).json?.total === 0);
  ok("another site's body is never found here, and is found there", (await search(SITE_HOST, { q: w("Otherbody") })).json?.total === 0 && titles(await search(OTHER_HOST, { q: w("Otherbody") })).length === 1);
  const ranked = await search(SITE_HOST, { q: `Rankword ${bt}` });
  ok("a title match ranks above a body-only match", titles(ranked)[0] === `Rankword ${bt}` && titles(ranked).includes(`Different ${bt}`), JSON.stringify(titles(ranked)));
  const pageIndex = await api("GET", `/api/site-urls?where[site][equals]=${SITE_ID}&where[path][equals]=${bt}-body&depth=0`);
  ok("the public index API does not hand out the stored body text", !JSON.stringify(pageIndex.json).includes("Bodyonly"), JSON.stringify(pageIndex.json)?.slice(0, 200));

  // What a visitor types: operators, quotes and wildcards are only text to look for.
  for (const q of ["a&b", "x | y", "!z", "foo:*", "'quoted'", '"two words"', "(a|b)", "a & !b", `${w("Bodyonly")}:*`, `${w("Bodyonly")} & !x`, "\\", "%", "'; DROP TABLE pages; --"]) {
    const res = await search(SITE_HOST, { q: `${q}x` });
    ok(`operators are harmless (${JSON.stringify(q).slice(0, 22)})`, res.status === 200 && Array.isArray(res.json?.results), `${res.status} ${JSON.stringify(res.json)?.slice(0, 160)}`);
  }
  ok("a made-up operator query does not match through its syntax", (await search(SITE_HOST, { q: `${w("Bodyonly")}:*` })).json?.total === 0 && (await search(SITE_HOST, { q: `${w("Bodyonly")} | ${w("Nomatch")}` })).json?.total === 0);

  const esc = await search(SITE_HOST, { q: w("Esc") });
  ok("a snippet is plain text with the page's own characters", esc.json?.results?.[0]?.snippet?.includes("<script>"), JSON.stringify(esc.json?.results?.[0]));
  const escPage = await visit(`/search?q=${encodeURIComponent(w("Esc"))}`);
  ok("and the results page escapes it and marks the word", escPage.status === 200 && escPage.text.includes("&lt;script&gt;") && !escPage.text.includes("<script>alert") && !escPage.text.includes("<img src=x") && escPage.text.includes("<mark"), `${escPage.status}`);
  const bodyHtml = await visit(`/search?q=${encodeURIComponent(w("Bodyonly"))}`);
  ok("the results page shows the body snippet with the word marked", bodyHtml.status === 200 && new RegExp(`<mark[^>]*>${w("Bodyonly")}</mark>`, "i").test(bodyHtml.text) && bodyHtml.text.includes("&lt;b&gt;tags"), `${bodyHtml.status}`);
  const headRes = await search(SITE_HOST, { q: w("Headword") });
  const tailRes = await search(SITE_HOST, { q: w("Tailword") });
  ok("the head of a very long body is found; text past the 50,000 character cap is not", headRes.json?.total === 1 && tailRes.json?.total === 0, JSON.stringify([headRes.status, headRes.json?.total, tailRes.json?.total, longBody.status]));

  // ---- what is searchable ------------------------------------------------------------------------------------------
  if (hasPosts) {
    const post = await create("posts", { title: `Newsworthy ${token}`, slug: `${token}-post`, site: SITE_ID, _status: "published", body: lexical("Body text"), excerpt: `An excerpt about ${token}` });
    const draftPost = await create("posts", { title: `Postdraft ${token}`, slug: `${token}-postdraft`, site: SITE_ID, _status: "draft", body: lexical("Body text") });
    ok("posts are written", post.status === 201 && draftPost.status === 201, JSON.stringify(post.json)?.slice(0, 200));
    await new Promise((r) => setTimeout(r, 1000));
    const withPosts = await search(SITE_HOST, { q: `Newsworthy ${token}` });
    const postHit = withPosts.json?.results?.[0];
    ok("a published post is found, with its section address and excerpt", postHit?.type === "post" && postHit?.path === `news/${token}-post` && postHit?.snippet?.includes(token), JSON.stringify(withPosts.json)?.slice(0, 300));
    ok("a draft post is not", (await search(SITE_HOST, { q: "Postdraft" })).json?.total === 0);
    const bodyPost = await create("posts", { title: `Postbody title ${bt}`, slug: `${bt}-post`, site: SITE_ID, _status: "published", body: lexical(`Words ${w("Postbody")} only in the post text`) });
    const draftBodyPost = await create("posts", { title: `Postdraftbody title ${bt}`, slug: `${bt}-postdraft`, site: SITE_ID, _status: "draft", body: lexical(`Hidden ${w("Postdraftbody")} words`) });
    await new Promise((r) => setTimeout(r, 1500));
    const inPost = await search(SITE_HOST, { q: w("Postbody") });
    ok("a word only in a published post's body finds the post, with a snippet and its section address", bodyPost.status === 201 && titles(inPost).join("|") === `Postbody title ${bt}` && inPost.json.results[0].snippet.includes(w("Postbody")) && inPost.json.results[0].path === `news/${bt}-post`, JSON.stringify(inPost.json)?.slice(0, 300));
    ok("and one only in a draft post's body is never found", draftBodyPost.status === 201 && (await search(SITE_HOST, { q: w("Postdraftbody") })).json?.total === 0);
    await setSearch(SITE_ID, { collections: ["posts"] });
    const onlyPosts = await search(SITE_HOST, { q: token });
    ok("a site can restrict search to some content types", titles(onlyPosts).length === 1 && titles(onlyPosts)[0] === `Newsworthy ${token}`, JSON.stringify(titles(onlyPosts)));
    await setSearch(SITE_ID, { collections: ["pages"] });
    const onlyPages = await search(SITE_HOST, { q: token });
    ok("or to pages only", onlyPages.json?.total === 3 && !JSON.stringify(onlyPages.json).includes("Newsworthy"), JSON.stringify(titles(onlyPages)));
    await setSearch(SITE_ID, { collections: [] });
    const everything = await search(SITE_HOST, { q: token });
    ok("and with nothing chosen searches everything", everything.json?.total === 4, JSON.stringify(everything.json?.total));
  } else {
    skip("posts", "the posts plugin or its module isn't on this site");
  }

  // ---- languages ---------------------------------------------------------------------------------------------------
  if (hasI18n) {
    await setSearch(SITE_ID, { perPage: 10 });
    const fr = await api("PATCH", `/api/pages/${live.id}?locale=fr`, { token: admin, body: { title: `Grenade ${token}`, _status: "published" } });
    ok("a page is translated into French", fr.status === 200, JSON.stringify(fr.json)?.slice(0, 200));
    await new Promise((r) => setTimeout(r, 1500));
    const inFr = await search(SITE_HOST, { q: `Grenade ${token}`, lang: "fr" });
    ok("a French search finds the French title", titles(inFr)[0] === `Grenade ${token}`, JSON.stringify(inFr.json)?.slice(0, 300));
    ok("and says it searched in French", inFr.json?.lang === "fr");
    const inEn = await search(SITE_HOST, { q: `Grenade ${token}`, lang: "en" });
    ok("an English search does not find French words", inEn.json?.total === 0, JSON.stringify(titles(inEn)));
    const frAll = await search(SITE_HOST, { q: token, lang: "fr" });
    ok("a French search shows the default language for what is not translated yet", titles(frAll).includes(`Quince ${token}`) && titles(frAll).includes(`Grenade ${token}`), JSON.stringify(titles(frAll)));
    ok("without listing the English title of a page that has a French one", !titles(frAll).includes(`Pomegranate ${token}`), JSON.stringify(titles(frAll)));
    const de = await search(SITE_HOST, { q: `Pomegranate ${token}`, lang: "de" });
    ok("a language the site does not offer is searched in the default", de.json?.lang === "en" && titles(de).includes(`Pomegranate ${token}`), JSON.stringify(de.json)?.slice(0, 200));
    const draftFr = await search(SITE_HOST, { q: "Hiddendraft", lang: "fr" });
    ok("drafts stay hidden in every language", draftFr.json?.total === 0);
    // The text of a translation is searched in that language.
    const frBody = await create("pages", { title: `Corps ${bt}`, slug: `${bt}-fr`, site: SITE_ID, _status: "published", content: text(`English ${w("Enbody")} here`) });
    const frFull = (await api("GET", `/api/pages/${frBody.id}?depth=0`, { token: admin })).json;
    const frPatch = await api("PATCH", `/api/pages/${frBody.id}?locale=fr`, { token: admin, body: { title: `Corps fr ${bt}`, content: [{ id: frFull?.content?.[0]?.id, blockType: "textBlock", body: lexical(`Texte ${w("Corpsfr")} ici`) }], _status: "published" } });
    await new Promise((r) => setTimeout(r, 2000));
    ok("a page is translated, text included", frPatch.status === 200, JSON.stringify(frPatch.json)?.slice(0, 200));
    ok("a French search finds a word in the French text", titles(await search(SITE_HOST, { q: w("Corpsfr"), lang: "fr" })).join("|") === `Corps fr ${bt}`);
    ok("an English search does not", (await search(SITE_HOST, { q: w("Corpsfr"), lang: "en" })).json?.total === 0);
    ok("and the English text is found in English", titles(await search(SITE_HOST, { q: w("Enbody"), lang: "en" })).join("|") === `Corps ${bt}`);
    // Reindex rebuilds every entry, in every language, with its text.
    const reindex = await api("POST", "/api/site-urls/reindex", { token: admin, body: { collections: ["pages"] } });
    await new Promise((r) => setTimeout(r, 1500));
    ok("the admin's Reindex works", reindex.status === 200, `${reindex.status} ${JSON.stringify(reindex.json)?.slice(0, 200)}`);
    ok("after it, body text is still found in each language", titles(await search(SITE_HOST, { q: w("Corpsfr"), lang: "fr" })).join("|") === `Corps fr ${bt}` && titles(await search(SITE_HOST, { q: w("Enbody"), lang: "en" })).join("|") === `Corps ${bt}` && (await search(SITE_HOST, { q: w("Bodyonly") })).json?.total === 1);
    ok("and a French title is still French, not copied from English", titles(await search(SITE_HOST, { q: `Grenade ${token}`, lang: "fr" }))[0] === `Grenade ${token}`);
    ok("a draft's words are still not in the index after it", (await search(SITE_HOST, { q: w("Draftbody") })).json?.total === 0 && (await search(SITE_HOST, { q: w("Editedbody") })).json?.total === 0);
  } else {
    skip("languages", "the i18n plugin isn't installed");
  }

  // ---- the results page, as a visitor -----------------------------------------------------------------------------
  await setSearch(SITE_ID, { perPage: 2 });
  const page = await visit(`/search?q=${encodeURIComponent(`pomegranate ${token}`)}`);
  ok("the results page renders", page.status === 200 && page.text.includes(`<mark`) && page.text.includes(`${token}-live`), `${page.status}`);
  ok("it has a labelled search form and a results region", /<form[^>]*role="search"/.test(page.text) && /<label[^>]*for="[^"]+"[^>]*>[^<]*Search<\/label>/.test(page.text) && /<section[^>]*aria-labelledby=/.test(page.text), "missing landmark or label");
  ok("it announces the count politely", /role="status"[^>]*>[^<]*(<!--[^>]*-->)*[^<]*2 results/.test(page.text), "no live count");
  ok("it asks search engines not to index it", /<meta[^>]*name="robots"[^>]*noindex/.test(page.text));
  ok("it shows the site's placeholder", page.text.includes('placeholder="Find it"'));
  ok("it links to the pages found", new RegExp(`href="/${token}-live"`).test(page.text));
  ok("it never shows a draft or another site's page", !/Hiddendraft|Withdrawn|Elsewhere/.test(page.text));
  const pageTwo = await visit(`/search?q=${encodeURIComponent(token)}&page=2`);
  ok("the second page of results has previous and page numbers", pageTwo.status === 200 && /Page 2 of/.test(pageTwo.text) && /rel="prev"/.test(pageTwo.text), `${pageTwo.status}`);

  const none = await visit(`/search?q=${encodeURIComponent(`nothing${token}`)}`);
  ok("a search with no matches says so and suggests what to do", none.status === 200 && /No results for/.test(none.text) && /Check the spelling/.test(none.text), `${none.status}`);
  ok("different searches are different pages (nothing is cached across them)", none.text !== page.text && !none.text.includes(`${token}-live`));
  const empty = await visit("/search");
  ok("the results page with no search invites one", empty.status === 200 && /Type a word or two/.test(empty.text));
  const shortPage = await visit("/search?q=a");
  ok("a search that is too short says how long it must be", shortPage.status === 200 && /at least 2 characters/.test(shortPage.text));
  const markup = await visit(`/search?q=${encodeURIComponent("<b>bold</b>")}`);
  ok("what a visitor types is shown as text, never as markup", markup.status === 200 && !markup.text.replace(/content="[^"]*"/g, "").includes("<b>bold</b>") && markup.text.includes("&lt;b&gt;bold"), `${markup.status}`);
  const script = await visit(`/search?q=${encodeURIComponent("<script>alert(1)</script>")}`);
  ok("and a script in the address is refused by the site's own filter, not echoed", script.status !== 200 || !script.text.includes("<script>alert(1)</script>"), `${script.status}`);
  const elsewhere = await visit(`/search?q=${encodeURIComponent(token)}`, { host: OTHER_HOST });
  ok("the other site's results page shows only its own content", elsewhere.status === 200 && elsewhere.text.includes(`${token}-elsewhere`) && !elsewhere.text.includes(`${token}-live`), `${elsewhere.status}`);

  if (hasI18n) {
    const frPage = await visit(`/fr/search?q=${encodeURIComponent(token)}`);
    ok("the results page speaks French under /fr/", frPage.status === 200 && /Recherche/.test(frPage.text) && /résultat/.test(frPage.text) && /lang="fr"/.test(frPage.text), `${frPage.status}`);
    ok("with French results and links that stay in French", frPage.text.includes(`Grenade`) && new RegExp(`href="/fr/${token}-live"`).test(frPage.text));
    const frNone = await visit(`/fr/search?q=${encodeURIComponent(`nothing${token}`)}`);
    ok("and its empty state in French", /Aucun résultat/.test(frNone.text));
  }

  // ---- the budget ---------------------------------------------------------------------------------------------------
  const pushy = "203.0.113.200";
  const codes = [];
  for (let i = 0; i < 40; i++) codes.push((await search(SITE_HOST, { q: `budget${i}` }, pushy)).status);
  const limited = await search(SITE_HOST, { q: "budget" }, pushy);
  ok("one address that searches too often is told to wait (429 with Retry-After)", codes.includes(429) && limited.status === 429 && Number(limited.headers.get("retry-after")) >= 1, JSON.stringify(codes.slice(25)));
  ok("while another address is unaffected", (await search(SITE_HOST, { q: "budget" }, newAddress())).status === 200);
  const webLimited = await visit("/search?q=budget", { address: pushy });
  ok("and the results page, which passes the visitor's address on, says so rather than failing", webLimited.status === 200 && /Too many searches/.test(webLimited.text), `${webLimited.status}`);
  const spoof = await search(SITE_HOST, { q: "budget" }, `1.2.3.4, ${newAddress()}`);
  ok("an address a visitor makes up in front of the proxy's own does not get a fresh budget", spoof.status === 200);
  const spoofed = await api("GET", `/api/site-search?domain=${SITE_HOST}&q=budget`, { headers: { "X-Forwarded-For": `9.9.9.9, ${pushy}` } });
  ok("it is the last address that counts", spoofed.status === 429, `${spoofed.status}`);

  // ---- a deleted page leaves the results -----------------------------------------------------------------------------
  const gone = made.find(([c, id]) => c === "pages" && id === liveC.id);
  await api("DELETE", `/api/pages/${liveC.id}`, { token: admin });
  made.splice(made.indexOf(gone), 1);
  await new Promise((r) => setTimeout(r, 1000));
  ok("a deleted page is no longer found", !titles(await search(SITE_HOST, { q: `Quince ${token}` })).length);
} finally {
  for (const [collection, id] of made) await api("DELETE", `/api/${collection}/${id}`, { token: admin });
  if (hasI18n) {
    const row = await langRow(SITE_ID);
    if (!before.langs && row) await api("DELETE", `/api/site-languages/${row.id}`, { token: admin });
    else if (before.langs) await setLanguages(SITE_ID, { languages: before.langs.languages ?? [], defaultLanguage: before.langs.defaultLanguage });
  }
  // Put each site's settings back: the row as it was, or no row at all if there was none.
  for (const [siteId, was] of [[SITE_ID, rowBefore.site], [other?.id, rowBefore.other]]) {
    if (!siteId) continue;
    const now = await settingsRow(siteId);
    if (was && now) await api("PATCH", `/api/search-settings/${now.id}`, { token: admin, body: { enabled: was.enabled ?? false, perPage: was.perPage ?? 10, collections: was.collections ?? [], placeholder: was.placeholder ?? "" } });
    else if (!was && now) await api("DELETE", `/api/search-settings/${now.id}`, { token: admin });
  }
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
