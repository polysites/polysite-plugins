// End-to-end check of the posts plugin (news list, article, RSS feed, sitemap, SEO tags) and of its per-site News settings,
// against a RUNNING stack. It writes posts (published, draft, on another site), asks the public site as a visitor would,
// changes the News settings the way the admin does (the plugin's own `news-settings` row, one per site), and puts everything back.
//
//   BASE=http://cms:3001 WEB=http://web:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... SITE_ID=1 SITE_HOST=voidslate.localhost \
//     OTHER_HOST=second.localhost node plugins/posts/test/e2e/posts.e2e.mjs
//
// Needs the core and the posts plugin, with the Posts module on for the dev site (the plugin's dev seed does that).
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
  return { status: res.status, json };
}

// A page on the public site as a visitor would ask for it (the site is picked by the Host header, which fetch() won't let a script set).
function visit(path, { host = SITE_HOST } = {}) {
  const url = new URL(WEB);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path, method: "GET", headers: { Host: host } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
// The public site keeps what it rendered until the CMS tells it something changed, so a check retries for a few seconds.
async function eventually(fn, test, tries = 12) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (test(last)) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}
const lexical = (text) => ({ root: { type: "root", format: "", indent: 0, version: 1, direction: null, children: [{ type: "paragraph", format: "", indent: 0, version: 1, direction: null, children: [{ type: "text", text, version: 1, format: 0, mode: "normal", style: "", detail: 0 }] }] } });

const login = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
const admin = login.json?.token;
ok("admin signs in", Boolean(admin));

const sites = (await api("GET", `/api/sites?depth=0&limit=50`, { token: admin })).json?.docs ?? [];
const site = sites.find((s) => s.id === SITE_ID);
const other = sites.find((s) => s.domain === OTHER_HOST);
ok("the dev site exists with the Posts module on", Boolean(site) && (site.enabledModules ?? []).includes("posts"), JSON.stringify(site?.enabledModules));
ok("Sites itself carries no news column (the settings are the plugin's own table)", site && !("news" in site), JSON.stringify(Object.keys(site ?? {})));

const settingsRow = async (siteId) => (await api("GET", `/api/news-settings?where[site][equals]=${siteId}&limit=1&depth=0`, { token: admin })).json?.docs?.[0];
const rowBefore = await settingsRow(SITE_ID);
const setNews = async (data) => {
  const row = await settingsRow(SITE_ID);
  return row ? api("PATCH", `/api/news-settings/${row.id}`, { token: admin, body: data }) : api("POST", "/api/news-settings", { token: admin, body: { site: SITE_ID, ...data } });
};
// What the public site is told about the site: `extensions` on the site, read the way the web app reads it (no sign-in).
const publicNews = async () => (await api("GET", `/api/sites/${SITE_ID}?depth=0`)).json?.extensions?.news;

const token = `zn${Date.now().toString(36)}`;
const made = [];
const create = async (collection, body) => {
  const res = await api("POST", `/api/${collection}`, { token: admin, body });
  const id = res.json?.doc?.id;
  if (id) made.push([collection, id]);
  return { ...res, id };
};
const allText = (res) => res.text.replace(/<[^>]+>/g, " ");

try {
  // ---- the settings row ----------------------------------------------------------------------------------------------
  ok("the News settings are reachable and listable by an administrator", (await api("GET", "/api/news-settings?limit=5&depth=0", { token: admin })).status === 200);
  ok("a visitor cannot read the settings collection directly", (await api("GET", "/api/news-settings?limit=5")).status >= 400);
  const defaults = await setNews({ label: "News", path: "news", perPage: 10 });
  ok("an administrator can save the settings", defaults.status === 200 || defaults.status === 201, JSON.stringify(defaults.json)?.slice(0, 300));
  const ext0 = await publicNews();
  ok("the site carries them as extensions.news, public fields only", ext0?.path === "news" && ext0?.perPage === 10 && ext0?.label === "News" && Object.keys(ext0).every((k) => ["label", "path", "perPage"].includes(k)), JSON.stringify(ext0));
  const second = await api("POST", "/api/news-settings", { token: admin, body: { site: SITE_ID, label: "Again" } });
  if (second.json?.doc?.id) made.push(["news-settings", second.json.doc.id]);
  ok("a site cannot have a second settings row", second.status >= 400, `${second.status}`);
  const bad = await setNews({ path: "api" });
  ok("a section address the site already uses is refused", bad.status >= 400, `${bad.status}`);
  const bad2 = await setNews({ path: "Not Valid/" });
  ok("and so is one with capitals, spaces or slashes", bad2.status >= 400, `${bad2.status}`);

  // ---- content ---------------------------------------------------------------------------------------------------------
  const cat = await create("post-categories", { name: `Cat ${token}`, slug: `${token}-cat`, site: SITE_ID });
  const posts = [];
  for (let i = 1; i <= 3; i++) {
    posts.push(await create("posts", { title: `Story ${i} ${token}`, slug: `${token}-s${i}`, site: SITE_ID, _status: "published", publishedAt: new Date(Date.UTC(2030, 0, i)).toISOString(), byline: "Alex Morgan", excerpt: `Excerpt ${i} ${token}`, categories: cat.id ? [cat.id] : [], body: lexical(`Body ${i}`) }));
  }
  const draft = await create("posts", { title: `Hidden ${token}`, slug: `${token}-draft`, site: SITE_ID, _status: "draft", body: lexical("Draft body") });
  const foreign = other ? await create("posts", { title: `Elsewhere ${token}`, slug: `${token}-elsewhere`, site: other.id, _status: "published", body: lexical("Other site") }) : null;
  ok("posts are written (published, a draft, and one on the other site)", posts.every((p) => p.status === 201) && draft.status === 201 && (!other || foreign.status === 201), JSON.stringify([posts.map((p) => p.status), draft.status, foreign?.status]));

  // ---- the section at /news, as a visitor ------------------------------------------------------------------------------
  const list = await eventually(() => visit("/news"), (r) => r.status === 200 && r.text.includes(`Story 3 ${token}`));
  ok("the news list shows published posts, newest first", list.status === 200 && list.text.indexOf(`Story 3 ${token}`) > 0 && list.text.indexOf(`Story 3 ${token}`) < list.text.indexOf(`Story 1 ${token}`), `${list.status}`);
  ok("it hides a draft and another site's post", !list.text.includes(`Hidden ${token}`) && !list.text.includes(`Elsewhere ${token}`));
  ok("it uses the section label as heading", /<h1[^>]*>\s*News\s*<\/h1>/.test(list.text), (list.text.match(/<h1[^>]*>.*?<\/h1>/s) ?? [""])[0]);

  const article = await visit(`/news/${token}-s2`);
  ok("an article opens at /news/<slug>", article.status === 200 && allText(article).includes(`Story 2 ${token}`) && allText(article).includes("Body 2"), `${article.status}`);
  ok("with its SEO tags (title, og:type article, NewsArticle structured data, feed link)", /<title>[^<]*Story 2/.test(article.text) && /property="og:type" content="article"/.test(article.text) && article.text.includes('"@type":"NewsArticle"') && article.text.includes('type="application/rss+xml"'), "");
  ok("a draft's address is a 404", (await visit(`/news/${token}-draft`)).status === 404);
  ok("another site's post is a 404 here", (await visit(`/news/${token}-elsewhere`)).status === 404);
  ok("a category page lists its posts", allText(await visit(`/news/category/${token}-cat`)).includes(`Story 1 ${token}`));

  const feed = await visit("/feed.xml");
  ok("the RSS feed lists the posts with links under /news", feed.status === 200 && /rss\+xml/.test(String(feed.headers["content-type"])) && feed.text.includes(`/news/${token}-s1`) && !feed.text.includes(`${token}-draft`) && !feed.text.includes(`${token}-elsewhere`), `${feed.status}`);
  ok("its channel title uses the section label", /<title>[^<]*: News<\/title>/.test(feed.text));

  const urls = (await api("GET", `/api/site-urls?where[site][equals]=${SITE_ID}&limit=200&depth=0`, { token: admin })).json?.docs ?? [];
  ok("the URL index points the posts at /news", urls.some((u) => u.path === `news/${token}-s1` && u.docType === "post"), JSON.stringify(urls.filter((u) => String(u.path).includes(token)).map((u) => u.path)));
  // The sitemap page itself is cached for ten minutes by the web app, so ask for the list it is built from.
  const sitemap = await eventually(() => visit("/api/__sitemap__/urls"), (r) => r.status === 200 && r.text.includes(`${token}-s1`));
  ok("the sitemap lists the published posts and not the draft", sitemap.status === 200 && sitemap.text.includes(`/news/${token}-s1`) && !sitemap.text.includes(`${token}-draft`), `${sitemap.status}`);

  // ---- change the settings: another label, address and page size -----------------------------------------------------------
  const changed = await setNews({ label: `Updates ${token}`, path: "updates", perPage: 2 });
  ok("the settings are changed (label, address, page size)", changed.status === 200, JSON.stringify(changed.json)?.slice(0, 300));
  const ext1 = await publicNews();
  ok("the site's extensions.news follows at once", ext1?.path === "updates" && ext1?.perPage === 2 && ext1?.label === `Updates ${token}`, JSON.stringify(ext1));

  const updates = await eventually(() => visit("/updates"), (r) => r.status === 200);
  ok("the list now lives at /updates, with the new label and two per page", updates.status === 200 && allText(updates).includes(`Updates ${token}`) && allText(updates).includes(`Story 3 ${token}`) && !allText(updates).includes(`Story 1 ${token}`), `${updates.status}`);
  ok("page 2 has the rest", allText(await visit("/updates/page/2")).includes(`Story 1 ${token}`));
  ok("an article is at /updates/<slug>", (await visit(`/updates/${token}-s2`)).status === 200);
  const oldList = await eventually(() => visit("/news"), (r) => r.status === 404);
  ok("and /news is no longer the list", oldList.status === 404, `${oldList.status}`);
  const feed2 = await eventually(() => visit("/feed.xml"), (r) => r.text.includes(`/updates/${token}-s1`));
  ok("the feed follows: links under /updates, the new label in its title", feed2.text.includes(`/updates/${token}-s1`) && feed2.text.includes(`Updates ${token}`), "");

  // A post saved after the change is indexed under the new address (the address is read from the settings row).
  await api("PATCH", `/api/posts/${posts[0].id}`, { token: admin, body: { excerpt: `Edited ${token}` } });
  await new Promise((r) => setTimeout(r, 1000));
  const urls2 = (await api("GET", `/api/site-urls?where[site][equals]=${SITE_ID}&limit=200&depth=0`, { token: admin })).json?.docs ?? [];
  ok("a post saved after the change is indexed under the new section", urls2.some((u) => u.path === `updates/${token}-s1`), JSON.stringify(urls2.filter((u) => String(u.path).includes(token)).map((u) => u.path)));

  // ---- a site without the module or settings ----------------------------------------------------------------------------------
  if (other && !(other.enabledModules ?? []).includes("posts")) {
    ok("a site without the Posts module has no feed", (await visit("/feed.xml", { host: OTHER_HOST })).status === 404);
    ok("and no news list", (await visit("/news", { host: OTHER_HOST })).status === 404);
    ok("and no extensions.news", (await api("GET", `/api/sites/${other.id}?depth=0`)).json?.extensions?.news === undefined);
  }
} finally {
  for (const [collection, id] of made.reverse()) await api("DELETE", `/api/${collection}/${id}`, { token: admin });
  // Put the settings back: the row as it was, or no row at all if there was none.
  const now = await settingsRow(SITE_ID);
  if (rowBefore && now) await api("PATCH", `/api/news-settings/${now.id}`, { token: admin, body: { label: rowBefore.label ?? "News", path: rowBefore.path ?? "news", perPage: rowBefore.perPage ?? 10 } });
  else if (!rowBefore && now) await api("DELETE", `/api/news-settings/${now.id}`, { token: admin });
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
