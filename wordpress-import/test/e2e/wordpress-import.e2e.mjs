// End-to-end check of the WordPress import plugin against a RUNNING stack: upload through the admin API, dry run, import,
// the pages, posts, images, redirects and menu it makes, a second run (nothing duplicated), protection of edits made here,
// what a Site User and a Site Admin of another site may do, and that another site is untouched. It cleans up after itself.
//
//   BASE=http://cms:3001 WEB=http://web:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... SITE_ID=1 OTHER_SITE_ID=2 \
//     SITE_HOST=voidslate.localhost FIXTURE_HOST=e2e-runner node plugins/wordpress-import/test/e2e/wordpress-import.e2e.mjs
//
// It starts a small web server of its own (the pretend old WordPress site, serving two real images) and the CMS has to be able to
// reach it as FIXTURE_HOST:FIXTURE_PORT, and to be started with WORDPRESS_IMPORT_ALLOW_PRIVATE_HOSTS=1 (the CMS refuses private addresses
// otherwise, which is the point of that guard). Needs the posts plugin for the post checks.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE;
const WEB = process.env.WEB;
const SITE_ID = Number(process.env.SITE_ID ?? 1);
const OTHER_SITE_ID = Number(process.env.OTHER_SITE_ID ?? 2);
const SITE_HOST = process.env.SITE_HOST ?? "voidslate.localhost";
const FIXTURE_HOST = process.env.FIXTURE_HOST ?? "e2e-runner";
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 9187);
const here = path.dirname(fileURLToPath(import.meta.url));

const results = [];
const ok = (name, cond, extra = "") => {
  results.push(Boolean(cond));
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + String(extra).slice(0, 500)}`);
};

async function api(method, p, { token, body, raw, headers } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(raw === undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `JWT ${token}` } : {}), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const login = async (email, password) => (await api("POST", "/api/users/login", { body: { email, password } })).json?.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visit = (p, host = SITE_HOST) => {
  const url = new URL(WEB);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: p, method: "GET", headers: { Host: host } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
};
async function eventually(fn, test, tries = 15) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (test(last)) return last;
    await sleep(1000);
  }
  return last;
}

// ---- the pretend old WordPress site ---------------------------------------------------------------------------------
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=", "base64");
const hits = [];
const fixture = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url === "/wp-content/uploads/2024/03/hero.png") return res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
  if (req.url === "/wp-content/uploads/2024/03/plot.jpg") return res.writeHead(200, { "Content-Type": "image/jpeg" }).end(JPG);
  res.writeHead(404).end("not here");
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, "0.0.0.0", r));
const OLD_SITE = `http://${FIXTURE_HOST}:${FIXTURE_PORT}`;

const sample = fs.readFileSync(path.join(here, "..", "fixtures", "sample.wxr.xml"), "utf8").replaceAll("{{SITE}}", OLD_SITE);
// A page with images the import must not fetch: another host, and the cloud metadata address.
const withBlocked = sample.replace(
  "</channel>",
  `<item><title>Remote images</title><link>${OLD_SITE}/remote-images/</link><wp:post_id>70</wp:post_id><wp:post_date_gmt><![CDATA[2024-03-14 10:00:00]]></wp:post_date_gmt><wp:post_name><![CDATA[remote-images]]></wp:post_name><wp:status><![CDATA[publish]]></wp:status><wp:post_type><![CDATA[page]]></wp:post_type><content:encoded><![CDATA[<p>Far away.</p><p><img src="https://blocked.example/x.png" alt="far"><img src="http://169.254.169.254/latest/meta-data/x.png" alt="meta"></p>]]></content:encoded></item></channel>`,
);

// ---- sign in ----------------------------------------------------------------------------------------------------------
const admin = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
ok("the Super Admin signs in", Boolean(admin));
const siteUser = await login("contenteditor@dev.localhost", process.env.ADMIN_PASSWORD);
const siteAdmin = await login("campaignmanager@dev.localhost", process.env.ADMIN_PASSWORD);
ok("a Site User and a Site Admin sign in", Boolean(siteUser) && Boolean(siteAdmin));

const site = (await api("GET", `/api/sites/${SITE_ID}?depth=0`, { token: admin })).json;
const otherSite = (await api("GET", `/api/sites/${OTHER_SITE_ID}?depth=0`, { token: admin })).json;
const navOf = (s) => JSON.stringify((s?.headerNavItems ?? []).map((n) => [n.label, n.href]));
const navBefore = (site?.headerNavItems ?? []).map((n) => ({ label: n.label, href: n.href }));
const otherNavBefore = navOf(otherSite);
const hasPosts = (await api("GET", "/api/post-categories?limit=1", { token: admin })).status === 200;

const list = async (collection, where, token = admin) => (await api("GET", `/api/${collection}?${where}&limit=500&depth=0`, { token })).json?.docs ?? [];
const preexistingCategories = new Set((await list("post-categories", `where[site][equals]=${SITE_ID}`)).map((c) => c.slug));
const mediaBefore = (await list("media", `where[site][equals]=${SITE_ID}`)).length;
const otherBefore = {
  pages: (await list("pages", `where[site][equals]=${OTHER_SITE_ID}`)).length,
  redirects: (await list("redirects", `where[site][equals]=${OTHER_SITE_ID}`)).length,
  media: (await list("media", `where[site][equals]=${OTHER_SITE_ID}`)).length,
};

const imports = [];
let importId;
async function cleanup() {
  // Everything the import made on the test site, found through its own records; categories that were there before stay.
  const rows = await list("wordpress-import-map", `where[site][equals]=${SITE_ID}`);
  for (const r of rows) {
    if (r.collection === "post-categories") {
      const doc = (await api("GET", `/api/post-categories/${r.docId}?depth=0`, { token: admin })).json;
      if (doc?.slug && preexistingCategories.has(doc.slug)) continue;
    }
    await api("DELETE", `/api/${r.collection}/${r.docId}`, { token: admin });
  }
  for (const r of rows) await api("DELETE", `/api/wordpress-import-map/${r.id}`, { token: admin });
  for (const id of imports) await api("DELETE", `/api/wordpress-imports/${id}`, { token: admin });
  await api("PATCH", `/api/sites/${SITE_ID}`, { token: admin, body: { headerNavItems: navBefore } });
}
const poll = async (id, wanted, timeoutMs = 180000) => {
  const seen = new Set();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const doc = (await api("GET", `/api/wordpress-imports/${id}?depth=0`, { token: admin })).json;
    seen.add(doc?.status);
    if (wanted.includes(doc?.status)) return { doc, seen };
    await sleep(500);
  }
  return { doc: (await api("GET", `/api/wordpress-imports/${id}?depth=0`, { token: admin })).json, seen };
};
const startPhase = (id, phase, token = admin) => api("POST", `/api/wordpress-imports/${id}/start`, { token, body: { phase } });
const upload = (id, xml, token = admin) => api("POST", `/api/wordpress-imports/${id}/file?name=${encodeURIComponent("sample.xml")}`, { token, raw: xml, headers: { "Content-Type": "application/xml" } });

try {
  await cleanup(); // leftovers of an earlier, interrupted run

  // ---- who may use it ----------------------------------------------------------------------------------------------
  const refused = await api("POST", "/api/wordpress-imports", { token: siteUser, body: { title: "nope", site: SITE_ID } });
  ok("a Site User cannot create an import", refused.status === 403, `${refused.status} ${JSON.stringify(refused.json)}`);
  const refusedOther = await api("POST", "/api/wordpress-imports", { token: siteAdmin, body: { title: "wrong site", site: OTHER_SITE_ID } });
  ok("a Site Admin cannot create one for a site that is not theirs", refusedOther.status >= 400, `${refusedOther.status}`);

  // ---- create + upload -----------------------------------------------------------------------------------------------
  const created = await api("POST", "/api/wordpress-imports", {
    token: admin,
    body: { title: "E2E import", site: SITE_ID, options: { targetStatus: "published", menuMode: "append", bylineMode: "author", createRedirects: true, importMedia: true } },
  });
  importId = created.json?.doc?.id;
  ok("a Super Admin creates an import for the site", created.status === 201 && importId, JSON.stringify(created.json));
  imports.push(importId);
  ok("a new import starts as 'new' with no file", created.json?.doc?.status === "new" && !created.json?.doc?.fileName);

  const forbiddenStart = await startPhase(importId, "analyse", siteUser);
  ok("a Site User cannot start it", forbiddenStart.status === 403, `${forbiddenStart.status}`);
  const forbiddenUpload = await upload(importId, withBlocked, siteUser);
  ok("a Site User cannot upload to it", forbiddenUpload.status === 403, `${forbiddenUpload.status}`);
  ok("a Site User cannot read it", [403, 404].includes((await api("GET", `/api/wordpress-imports/${importId}`, { token: siteUser })).status));

  const otherDoc = (await api("POST", "/api/wordpress-imports", { token: admin, body: { title: "other site import", site: OTHER_SITE_ID } })).json?.doc;
  if (otherDoc) imports.push(otherDoc.id);
  const crossSite = await upload(otherDoc?.id, withBlocked, siteAdmin);
  ok("a Site Admin cannot use another site's import", [403, 404].includes(crossSite.status), `${crossSite.status}`);

  ok("something that is not a WordPress export is refused", (await upload(importId, "<html><body>hello</body></html>")).status === 400);
  ok("and so is an empty file", (await upload(importId, "")).status === 400);
  const noFile = await startPhase(importId, "analyse");
  ok("a dry run cannot start without a file", noFile.status === 400, `${noFile.status}`);

  const up = await upload(importId, withBlocked);
  ok("the export uploads (streamed to disk)", up.status === 200 && up.json?.size === Buffer.byteLength(withBlocked), JSON.stringify(up.json));
  const early = await startPhase(importId, "import");
  ok("importing before the dry run is refused", early.status === 409, `${early.status}`);

  // ---- dry run ---------------------------------------------------------------------------------------------------------
  const dry = await startPhase(importId, "analyse");
  ok("the dry run starts", dry.status === 200, JSON.stringify(dry.json));
  const analysed = await poll(importId, ["analysed", "failed"]);
  const a = analysed.doc?.analysis;
  ok("the dry run finishes", analysed.doc?.status === "analysed" && a, `${analysed.doc?.status} ${analysed.doc?.error}`);
  ok("it counts the file", a?.totals?.pages === 7 && a?.totals?.posts === 5 && a?.totals?.media === 2 && a?.totals?.menus === 1, JSON.stringify(a?.totals));
  ok("it says what an import would do", a?.willImport?.pages === 5 && a?.willImport?.posts === (hasPosts ? 2 : 0) && a?.willImport?.redirects === (hasPosts ? 2 : 0), JSON.stringify(a?.willImport));
  ok("it lists what it cannot import (password, page builder, other type)", ["password", "page-builder", "post-type"].every((c) => a?.unsupported?.some((u) => u.code === c)), JSON.stringify(a?.unsupported?.map((u) => u.code)));
  ok("it reports dropped constructs", ["script", "iframe", "table", "shortcode:contact-form-7"].every((c) => a?.constructs?.some((x) => x.code === c)), JSON.stringify(a?.constructs?.map((x) => x.code)));
  ok("it knows which image hosts it will not fetch", a?.media?.blockedHosts?.["blocked.example"] === 1 && a?.media?.blockedHosts?.["169.254.169.254"] === 1, JSON.stringify(a?.media));
  ok("it shows old and new addresses", a?.samples?.pages?.some((s) => s.to === "about-us/team") && (!hasPosts || a?.samples?.posts?.some((s) => s.from === "2024/03/spring-planting-day" && s.to === "news/spring-planting-day")), JSON.stringify(a?.samples));
  ok("it reports no address conflicts on a clean site", (a?.conflicts ?? []).length === 0, JSON.stringify(a?.conflicts));
  ok("the dry run changed nothing", (await list("pages", `where[site][equals]=${SITE_ID}&where[slug][equals]=about-us`)).length === 0 && (await list("media", `where[site][equals]=${SITE_ID}`)).length === mediaBefore && !hits.length, `${hits}`);

  // ---- import ----------------------------------------------------------------------------------------------------------
  const go = await startPhase(importId, "import");
  ok("the import starts", go.status === 200, JSON.stringify(go.json));
  const done = await poll(importId, ["done", "failed"]);
  const r = done.doc?.result;
  ok("the import finishes", done.doc?.status === "done" && r, `${done.doc?.status} ${done.doc?.error}`);
  ok("nothing failed", r?.failed === 0, JSON.stringify(r));
  ok("it created pages, posts, images, redirects", r?.created?.pages === 5 && r?.created?.posts === (hasPosts ? 2 : 0) && r?.created?.media === 2 && r?.created?.redirects === (hasPosts ? 2 : 0), JSON.stringify(r?.created));

  const page = async (slug) => (await list("pages", `where[site][equals]=${SITE_ID}&where[slug][equals]=${encodeURIComponent(slug)}`))[0];
  const about = await page("about-us");
  const team = await page("about-us/team");
  const contact = await page("contact");
  const landing = await page("landing");
  ok("pages exist with their WordPress slugs, a child under its parent", about && team && contact && landing, `${Boolean(about)} ${Boolean(team)} ${Boolean(contact)} ${Boolean(landing)}`);
  ok("a published WordPress page is published here", about?._status === "published");
  ok("the original date is kept", about?.createdAt === "2024-03-04T08:00:00.000Z", about?.createdAt);
  const aboutBody = JSON.stringify(about?.content ?? []);
  ok("rich text: heading, list, bold and link are real editor nodes", /"type":"heading"[^}]*"tag":"h2"/.test(aboutBody) || (aboutBody.includes('"tag":"h2"') && aboutBody.includes("What we grow")), aboutBody.slice(0, 300));
  ok("the list has its items", aboutBody.includes('"listType":"bullet"') && aboutBody.includes("Tomatoes") && aboutBody.includes("Beans, in "));
  ok("bold text keeps its format", /"text":"2011","format":1/.test(aboutBody) || (aboutBody.includes("2011") && aboutBody.includes('"format":1')));
  ok("script content is gone", !aboutBody.includes("alert(") && !aboutBody.includes("<script"));
  if (hasPosts) ok("a link to an old post address points at the new address", aboutBody.includes('"url":"/news/spring-planting-day"'), aboutBody.slice(-400));
  const contactBody = JSON.stringify(contact?.content ?? []);
  ok("a gallery shortcode became the two images, a form shortcode was dropped", (contactBody.match(/"relationTo":"media"/g) ?? []).length === 2 && !contactBody.includes("contact-form-7"));
  const remote = await page("remote-images");
  ok("images on other hosts and the metadata address were not fetched, and are kept as links", JSON.stringify(remote?.content).includes("https://blocked.example/x.png") && !hits.some((h) => h.includes("meta-data")), JSON.stringify(hits));
  ok("images came from the local fixture server, once each", hits.filter((h) => h.endsWith("hero.png")).length === 1 && hits.filter((h) => h.endsWith("plot.jpg")).length === 1, JSON.stringify(hits));
  const mediaAfter = await list("media", `where[site][equals]=${SITE_ID}`);
  ok("both images are in the site's media library", mediaAfter.length === mediaBefore + 2 && mediaAfter.some((m) => /hero/.test(m.filename)) && mediaAfter.some((m) => /plot/.test(m.filename)), JSON.stringify(mediaAfter.map((m) => m.filename)));

  let spring;
  if (hasPosts) {
    spring = (await list("posts", `where[site][equals]=${SITE_ID}&where[slug][equals]=spring-planting-day`))[0];
    const compost = (await list("posts", `where[site][equals]=${SITE_ID}&where[slug][equals]=compost-workshop`))[0];
    ok("posts exist with their slugs", spring && compost);
    ok("a post keeps its date and gets the author as byline", spring?.publishedAt === "2024-03-08T14:30:00.000Z" && spring?.byline === "Sam Rivera", `${spring?.publishedAt} ${spring?.byline}`);
    ok("the excerpt and featured image come over", spring?.excerpt === "First planting day of the year." && spring?.heroImage, JSON.stringify([spring?.excerpt, spring?.heroImage]));
    const body = JSON.stringify(spring?.body ?? {});
    ok("a post's image is an upload node, its quote and list are kept, unsafe markup is not", body.includes('"type":"upload"') && body.includes("Many hands make light work.") && body.includes('"listType":"bullet"') && !body.includes("onerror") && !body.includes("javascript:"), body.slice(0, 300));
    const cats = await Promise.all((spring?.categories ?? []).map(async (c) => (await api("GET", `/api/post-categories/${typeof c === "object" ? c.id : c}?depth=0`, { token: admin })).json?.slug));
    ok("categories and tags are post categories (and an existing one is reused)", cats.includes("news") && cats.includes("volunteering"), JSON.stringify(cats));
    const eventsCats = await list("post-categories", `where[site][equals]=${SITE_ID}&where[slug][equals]=events`);
    ok("a category that already existed was not duplicated", eventsCats.length === 1, `${eventsCats.length}`);
    ok("posts come in published when they were published", spring?._status === "published");
    const red = (await list("redirects", `where[site][equals]=${SITE_ID}&where[fromPath][equals]=2024/03/spring-planting-day`))[0];
    ok("the old post address redirects to the new one (301)", red?.redirectType === "external" && red?.toUrl === "/news/spring-planting-day" && red?.statusCode === "301", JSON.stringify(red));
    ok("a page whose address did not change gets no redirect", (await list("redirects", `where[site][equals]=${SITE_ID}&where[fromPath][equals]=about-us`)).length === 0);
  }

  const siteAfter = (await api("GET", `/api/sites/${SITE_ID}?depth=0`, { token: admin })).json;
  const nav = (siteAfter?.headerNavItems ?? []).map((n) => n.href);
  ok("the WordPress menu was added to the header (existing links kept, none twice)", nav.includes("/") && nav.includes("https://elsewhere.example/tools") && nav.length === new Set(nav).size && navBefore.every((n) => nav.includes(n.href)), JSON.stringify(nav));

  const logs = await list("wordpress-import-log", `where[job][equals]=${importId}`);
  const logCodes = new Set(logs.map((l) => l.code));
  ok("the log says what was dropped or skipped", ["shortcode:contact-form-7", "script", "page-builder", "password", "media-failed"].every((c) => logCodes.has(c)), JSON.stringify([...logCodes]));

  // The public site (published content is live; it may take a moment for the cache to follow).
  const publicAbout = await eventually(() => visit("/about-us"), (res) => res.status === 200 && res.text.includes("What we grow"));
  ok("the imported page is on the public site", publicAbout.status === 200 && publicAbout.text.includes("What we grow"), `${publicAbout.status}`);
  if (hasPosts) {
    const publicPost = await eventually(() => visit("/news/spring-planting-day"), (res) => res.status === 200 && res.text.includes("Saturday"));
    ok("and so is the post", publicPost.status === 200 && publicPost.text.includes("Saturday"), `${publicPost.status}`);
    const old = await eventually(() => visit("/2024/03/spring-planting-day"), (res) => [301, 302, 307, 308].includes(res.status));
    ok("the old WordPress address sends visitors to the new one", [301, 302, 307, 308].includes(old.status) && String(old.headers.location ?? "").endsWith("/news/spring-planting-day"), `${old.status} ${old.headers.location}`);
  }

  // ---- again: nothing is duplicated ---------------------------------------------------------------------------------------
  const hitsBefore = hits.length;
  const pagesBefore = (await list("pages", `where[site][equals]=${SITE_ID}`)).length;
  const postsBefore = hasPosts ? (await list("posts", `where[site][equals]=${SITE_ID}`)).length : 0;
  const redirectsBefore = (await list("redirects", `where[site][equals]=${SITE_ID}`)).length;
  const catsBefore = hasPosts ? (await list("post-categories", `where[site][equals]=${SITE_ID}`)).length : 0;
  await startPhase(importId, "import");
  const again = await poll(importId, ["done", "failed"]);
  const r2 = again.doc?.result;
  ok("a second run finishes", again.doc?.status === "done" && r2?.failed === 0, `${again.doc?.status} ${again.doc?.error}`);
  const counts2 = {
    pages: (await list("pages", `where[site][equals]=${SITE_ID}`)).length,
    posts: hasPosts ? (await list("posts", `where[site][equals]=${SITE_ID}`)).length : 0,
    redirects: (await list("redirects", `where[site][equals]=${SITE_ID}`)).length,
    cats: hasPosts ? (await list("post-categories", `where[site][equals]=${SITE_ID}`)).length : 0,
    media: (await list("media", `where[site][equals]=${SITE_ID}`)).length,
  };
  ok("it updates in place: no page, post, category, redirect or image is duplicated", counts2.pages === pagesBefore && counts2.posts === postsBefore && counts2.redirects === redirectsBefore && counts2.cats === catsBefore && counts2.media === mediaBefore + 2, JSON.stringify(counts2));
  ok("and downloads nothing again", hits.length === hitsBefore, JSON.stringify(hits.slice(hitsBefore)));
  ok("the second run created nothing", r2?.created?.pages === 0 && r2?.created?.posts === 0 && r2?.created?.media === 0 && r2?.created?.redirects === 0, JSON.stringify(r2?.created));
  const navAgain = ((await api("GET", `/api/sites/${SITE_ID}?depth=0`, { token: admin })).json?.headerNavItems ?? []).map((n) => n.href);
  ok("and does not add the menu twice", navAgain.length === nav.length, JSON.stringify(navAgain));

  // ---- changes made here are not overwritten --------------------------------------------------------------------------------
  await api("PATCH", `/api/pages/${about.id}`, { token: admin, body: { title: "About the garden (edited here)" } });
  await startPhase(importId, "import");
  const third = await poll(importId, ["done", "failed"]);
  const aboutNow = await page("about-us");
  ok("a page edited here is left alone by the next import", aboutNow?.title === "About the garden (edited here)" && third.doc?.result?.skipped?.edited >= 1, `${aboutNow?.title} ${JSON.stringify(third.doc?.result?.skipped)}`);
  ok("and the log says so", (await list("wordpress-import-log", `where[job][equals]=${importId}&where[code][equals]=edited-here`)).length >= 1);
  await api("PATCH", `/api/wordpress-imports/${importId}`, { token: admin, body: { options: { overwrite: true } } });
  await startPhase(importId, "import");
  await poll(importId, ["done", "failed"]);
  ok("with Overwrite ticked it is replaced", (await page("about-us"))?.title === "About us");
  await api("PATCH", `/api/wordpress-imports/${importId}`, { token: admin, body: { options: { overwrite: false } } });

  // ---- another site is untouched --------------------------------------------------------------------------------------------
  const otherAfter = {
    pages: (await list("pages", `where[site][equals]=${OTHER_SITE_ID}`)).length,
    redirects: (await list("redirects", `where[site][equals]=${OTHER_SITE_ID}`)).length,
    media: (await list("media", `where[site][equals]=${OTHER_SITE_ID}`)).length,
  };
  ok("the other site has no new pages, redirects or media", JSON.stringify(otherAfter) === JSON.stringify(otherBefore), JSON.stringify({ otherBefore, otherAfter }));
  ok("and its header menu is unchanged", navOf((await api("GET", `/api/sites/${OTHER_SITE_ID}?depth=0`, { token: admin })).json) === otherNavBefore);
  ok("and the import left no record on it", (await list("wordpress-import-map", `where[site][equals]=${OTHER_SITE_ID}`)).length === 0);

  // ---- a large file: streamed, counted, progress seen ------------------------------------------------------------------------
  const body = "<p>" + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40) + "</p>";
  const parts = [sample.slice(0, sample.indexOf("</channel>"))];
  for (let i = 0; i < 3000; i++) {
    parts.push(`<item><title>Bulk ${i}</title><link>${OLD_SITE}/bulk-${i}/</link><dc:creator><![CDATA[sam]]></dc:creator><content:encoded><![CDATA[${body}]]></content:encoded><wp:post_id>${1000 + i}</wp:post_id><wp:post_date_gmt><![CDATA[2024-01-01 10:00:00]]></wp:post_date_gmt><wp:post_name><![CDATA[bulk-${i}]]></wp:post_name><wp:status><![CDATA[publish]]></wp:status><wp:post_type><![CDATA[post]]></wp:post_type></item>`);
  }
  parts.push("</channel></rss>");
  const big = parts.join("\n");
  const bigDoc = (await api("POST", "/api/wordpress-imports", { token: admin, body: { title: "E2E big file", site: SITE_ID } })).json?.doc;
  imports.push(bigDoc.id);
  const bigUp = await upload(bigDoc.id, big);
  ok(`a ${(big.length / 1048576).toFixed(1)} MB export uploads`, bigUp.status === 200, JSON.stringify(bigUp.json));
  const t0 = Date.now();
  await startPhase(bigDoc.id, "analyse");
  const bigDone = await poll(bigDoc.id, ["analysed", "failed"]);
  ok("and its dry run counts every post", bigDone.doc?.status === "analysed" && bigDone.doc.analysis.totals.posts === 3005, `${bigDone.doc?.status} ${bigDone.doc?.error} ${JSON.stringify(bigDone.doc?.analysis?.totals)}`);
  console.log(`      (dry run of ${(big.length / 1048576).toFixed(1)} MB took ${((Date.now() - t0) / 1000).toFixed(1)} s; statuses seen: ${[...bigDone.seen].join(", ")})`);

  // ---- deleting an import removes its file and log -----------------------------------------------------------------------------
  const logCount = (await list("wordpress-import-log", `where[job][equals]=${importId}`)).length;
  ok("the log has entries before the import is deleted", logCount > 0);
  const del = await api("DELETE", `/api/wordpress-imports/${importId}`, { token: admin });
  ok("an import can be deleted", del.status === 200, `${del.status}`);
  imports.splice(imports.indexOf(importId), 1);
  ok("which removes its log", (await list("wordpress-import-log", `where[job][equals]=${importId}`)).length === 0);
} finally {
  await cleanup().catch((err) => console.log("cleanup problem:", err?.message));
  fixture.close();
}

const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
