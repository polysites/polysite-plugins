// End-to-end check of the share plugin against a RUNNING Polysite that has the plugin installed (a dev stack, or the stack that
// tests/e2e/run-with-plugins.sh builds). It switches the buttons on for one site through the API, reads the pages the public site
// really renders, checks the links in them, and puts every setting back. Not part of the plugin's unit tests (test/share.test.js).
//
//   BASE=http://cms:3001 WEB=http://web:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//   SITE_ID=1 SITE_HOST=voidslate.localhost OTHER_SITE_ID=2 OTHER_HOST=second.localhost node test/e2e/share.e2e.mjs
//
// WEB must be the web app itself (or a proxy that passes the Host header through): the site is picked by the Host header.
import http from "node:http";

const BASE = process.env.BASE;
const WEB = process.env.WEB;
const SITE_ID = Number(process.env.SITE_ID ?? 1);
const SITE_HOST = process.env.SITE_HOST ?? "voidslate.localhost";
const OTHER_ID = Number(process.env.OTHER_SITE_ID ?? 2);
const OTHER_HOST = process.env.OTHER_HOST ?? "second.localhost";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(Boolean(cond));
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + String(extra).slice(0, 400)}`);
};

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `JWT ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

// A page of the public site as a visitor's browser would ask for it: node's fetch won't let a script set the Host header.
function visit(host, path) {
  const url = new URL(WEB);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path, method: "GET", headers: { Host: host } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const unescapeHtml = (s) => s.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const SHARE_NAV = /<nav\b[^>]*\bclass="[^"]*\bpoly-share\b[^"]*"[\s\S]*?<\/nav>/;
// The navigation itself: a page's stylesheet may mention the class names even when no buttons are drawn.
const nav = (html) => html.match(SHARE_NAV)?.[0] ?? null;
// network -> { href, rel, target } for the plain links in the buttons
function links(html) {
  const found = {};
  for (const m of (nav(html) ?? "").matchAll(/<a\b[^>]*>/g)) {
    const tag = m[0];
    const network = tag.match(/poly-share-(facebook|x|linkedin|whatsapp|telegram|reddit|email)\b/)?.[1];
    if (!network) continue;
    found[network] = {
      href: unescapeHtml(tag.match(/\bhref="([^"]*)"/)?.[1] ?? ""),
      rel: tag.match(/\brel="([^"]*)"/)?.[1],
      target: tag.match(/\btarget="([^"]*)"/)?.[1],
      label: unescapeHtml(tag.match(/\baria-label="([^"]*)"/)?.[1] ?? ""),
    };
  }
  return found;
}
const canonical = (html) => html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/)?.[1] ?? html.match(/<link[^>]*href="([^"]*)"[^>]*rel="canonical"/)?.[1];
const lexical = (text) => ({ root: { type: "root", format: "", indent: 0, version: 1, direction: null, children: [{ type: "paragraph", format: "", indent: 0, version: 1, direction: null, children: [{ type: "text", text, version: 1, format: 0, mode: "normal", style: "", detail: 0 }] }] } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
const admin = login.json?.token;
ok("admin signs in", Boolean(admin));

const stamp = Date.now();
// The settings are the plugin's own collection, one row per site; the core attaches the public fields to the site as `extensions.share`.
const rowOf = async (id) => (await api("GET", `/api/share-settings?where[site][equals]=${id}&depth=0&limit=1`, { token: admin })).json?.docs?.[0];
const extensionOf = async (id) => (await api("GET", `/api/sites/${id}?depth=0`, { token: admin })).json?.extensions;
const before = {};
const rowBefore = {};
for (const id of [SITE_ID, OTHER_ID]) {
  before[id] = (await api("GET", `/api/sites/${id}?depth=0`, { token: admin })).json;
  rowBefore[id] = await rowOf(id);
}
const list = await api("GET", "/api/share-settings?limit=1", { token: admin });
ok("the plugin's own settings collection exists (the plugin is installed and the database has its table)", list.status === 200, list.status);
ok("Sites itself carries no share field: the settings are not columns of a core table", !("share" in (before[SITE_ID] ?? {})), Object.keys(before[SITE_ID] ?? {}).join());
ok("the site payload has an `extensions` object (the core attaches the plugin's public fields)", typeof before[SITE_ID]?.extensions === "object" && before[SITE_ID].extensions !== null, JSON.stringify(before[SITE_ID]?.extensions));
ok("a site that has never set it up has no share settings, which the site treats as off", rowBefore[OTHER_ID] || (await extensionOf(OTHER_ID))?.share === undefined, JSON.stringify(await extensionOf(OTHER_ID)));

const cleanup = [];
// Creates the site's row on first use, then updates it. Returns the REST response.
const setShare = async (id, share) => {
  const row = await rowOf(id);
  return row ? api("PATCH", `/api/share-settings/${row.id}`, { token: admin, body: share }) : api("POST", "/api/share-settings", { token: admin, body: { site: id, ...share } });
};
const makePage = async (siteId, slug, title, published = true) => {
  const res = await api("POST", "/api/pages", { token: admin, body: { title, slug, site: siteId, _status: published ? "published" : "draft", content: [{ blockType: "hero", heading: title, subheading: "share e2e" }] } });
  if (res.json?.doc?.id) cleanup.push(["pages", res.json.doc.id]);
  return res;
};

try {
  const slug = `share-e2e-${stamp}`;
  const title = `Tom & Jerry's "big" day: 100% <b>fun</b>`;
  await makePage(SITE_ID, slug, title);

  // A row created with nothing but its site is off, with the documented defaults (on the site this run does not use for its own settings).
  if (!rowBefore[OTHER_ID]) {
    const made = await api("POST", "/api/share-settings", { token: admin, body: { site: OTHER_ID } });
    const d = made.json?.doc;
    ok("a new settings row is off by default, with the standard buttons and kinds of page", made.status === 201 && d?.enabled === false && JSON.stringify(d?.networks) === JSON.stringify(["facebook", "x", "linkedin", "email", "copy"]) && d?.style === "buttons" && d?.placement === "floating-bottom" && JSON.stringify(d?.contentTypes) === JSON.stringify(["pages", "posts"]), JSON.stringify(made.json)?.slice(0, 300));
    ok("and the site then reports it as off", (await extensionOf(OTHER_ID))?.share?.enabled === false);
    const twice = await api("POST", "/api/share-settings", { token: admin, body: { site: OTHER_ID } });
    ok("a site cannot have a second row", twice.status >= 400, twice.status);
    const noAdmin = await api("GET", "/api/share-settings");
    ok("the settings collection is not readable without signing in (the public site gets its fields through the site)", noAdmin.status === 403 || noAdmin.status === 401, noAdmin.status);
  }
  await makePage(OTHER_ID, slug, title);

  // --- the settings, through the API --------------------------------------------------------------------------------------------
  const settings = {
    enabled: true,
    networks: ["reddit", "facebook", "x", "linkedin", "whatsapp", "telegram", "email", "copy", "native"],
    style: "buttons",
    placement: "floating-bottom",
    contentTypes: ["pages", "home", "posts"],
    text: "Worth a read:",
    via: "@polysite",
  };
  const saved = await setShare(SITE_ID, settings);
  ok("an administrator can save the settings", saved.status === 200 || saved.status === 201, JSON.stringify(saved.json)?.slice(0, 300));
  const read = (await extensionOf(SITE_ID))?.share;
  ok("they round-trip, in the order chosen", JSON.stringify(read?.networks) === JSON.stringify(settings.networks) && read.enabled === true && read.style === "buttons" && read.placement === "floating-bottom" && read.text === "Worth a read:" && read.via === "@polysite" && JSON.stringify([...read.contentTypes].sort()) === JSON.stringify([...settings.contentTypes].sort()), JSON.stringify(read));
  const publicRead = await fetch(`${BASE}/api/sites?where[domain][equals]=${SITE_HOST}&depth=0&limit=1`).then((r) => r.json());
  ok("and are readable by the public site (it has no sign-in)", publicRead.docs?.[0]?.extensions?.share?.enabled === true);

  const badVia = await setShare(SITE_ID, { via: "not a handle!" });
  ok("an X account that isn't a handle is refused", badVia.status === 400, badVia.status);
  const noButtons = await setShare(SITE_ID, { networks: [] });
  ok("switching it on with no buttons is refused", noButtons.status === 400, noButtons.status);
  const unknown = await setShare(SITE_ID, { networks: ["facebook", "myspace"] });
  ok("a network the plugin doesn't know is refused", unknown.status === 400, unknown.status);
  const stillGood = (await extensionOf(SITE_ID))?.share;
  ok("and a refused save changes nothing", JSON.stringify(stillGood?.networks) === JSON.stringify(settings.networks) && stillGood?.via === "@polysite");

  // --- the public page ----------------------------------------------------------------------------------------------------------
  await sleep(1500); // the save refreshes the site's cache
  const page = await visit(SITE_HOST, `/${slug}`);
  ok("the page renders", page.status === 200, page.status);
  const html = nav(page.text);
  ok("it has the share buttons, as a labelled navigation", Boolean(html) && /aria-label="Share this page"/.test(html), html?.slice(0, 200));
  const l = links(page.text);
  ok("exactly the chosen link networks are there, in the chosen order", JSON.stringify(Object.keys(l)) === JSON.stringify(["reddit", "facebook", "x", "linkedin", "whatsapp", "telegram", "email"]), JSON.stringify(Object.keys(l)));

  const canon = canonical(page.text);
  const url = new URL(canon ?? "http://missing");
  ok("the page's canonical address is on this site's own domain", url.host === SITE_HOST && url.pathname === `/${slug}`, canon);
  const q = (href) => new URL(href).searchParams;
  ok("Facebook and LinkedIn carry that address", q(l.facebook?.href ?? "http://x").get("u") === canon && q(l.linkedin?.href ?? "http://x").get("url") === canon);
  ok("X carries the message, the address and the account", q(l.x.href).get("text") === `Worth a read: ${title}` && q(l.x.href).get("url") === canon && q(l.x.href).get("via") === "polysite", l.x?.href);
  ok("Telegram, Reddit and WhatsApp carry the title and address", q(l.telegram.href).get("url") === canon && q(l.telegram.href).get("text") === `Worth a read: ${title}` && q(l.reddit.href).get("title") === title && q(l.reddit.href).get("url") === canon && q(l.whatsapp.href).get("text") === `Worth a read: ${title} ${canon}`, JSON.stringify([l.telegram?.href, l.reddit?.href, l.whatsapp?.href]));
  const mailto = l.email.href;
  ok("email is a mailto link with the title as the subject and the address in the body", mailto.startsWith("mailto:?subject=") && decodeURIComponent(mailto.match(/subject=([^&]*)/)[1]) === title && decodeURIComponent(mailto.match(/body=([^&]*)/)[1]).endsWith(canon), mailto);
  ok("a title with quotes, ampersands and markup is percent-encoded in every address and never appears raw", Object.values(l).every((x) => !/[<>" ]/.test(x.href)) && !/<b>fun<\/b>/.test(html));
  ok("the page's own title is in the links (not the site's name)", l.reddit.href.includes(encodeURIComponent("Tom & Jerry")), l.reddit.href);

  ok("every outside link has rel noopener noreferrer, and email (which opens a mail app) has no new tab", ["reddit", "facebook", "x", "linkedin", "whatsapp", "telegram"].every((n) => l[n].rel === "noopener noreferrer" && l[n].target === "_blank") && l.email.target === undefined);
  ok("every button has a name for screen readers", Object.values(l).every((x) => /\S/.test(x.label)) && l.facebook.label === "Share on Facebook", JSON.stringify(Object.values(l).map((x) => x.label)));
  ok("the buttons load nothing from anywhere: no script, image, frame or style link inside them", !/<(script|img|iframe|link|object|embed|video|audio|source)\b/i.test(html));
  ok("copy and the device menu need JavaScript, so they are not in the server's HTML", !/poly-share-copy|poly-share-native/.test(html));
  ok("there is a quiet live region for \"Link copied\"", /role="status"[^>]*aria-live="polite"/.test(html));
  ok("the page itself loads no script from another site because of the buttons", !(page.text.match(/<script[^>]*\bsrc="https?:\/\/[^"]+"/g) ?? []).some((s) => /facebook|twitter|x\.com|linkedin|whatsapp|t\.me|reddit/.test(s)));

  // --- another site is not affected -----------------------------------------------------------------------------------------------
  const other = await visit(OTHER_HOST, `/${slug}`);
  ok("the same page on a site that hasn't switched it on has no buttons", other.status === 200 && !nav(other.text) && !nav(other.text), other.status);
  const otherHome = await visit(OTHER_HOST, "/");
  ok("nor does that site's home page", otherHome.status === 200 && !nav(otherHome.text));

  // --- which addresses show them --------------------------------------------------------------------------------------------------
  const home = await visit(SITE_HOST, "/");
  ok("the home page shows them when Home is ticked", Boolean(nav(home.text)) && canonical(home.text)?.endsWith("/"), home.status);

  const postSlug = `share-e2e-post-${stamp}`;
  const post = await api("POST", "/api/posts", { token: admin, body: { title: "A post about sharing", slug: postSlug, site: SITE_ID, _status: "published", body: lexical("Hello") } });
  if (post.json?.doc?.id) cleanup.push(["posts", post.json.doc.id]);
  const hasPosts = post.status === 201;
  if (hasPosts) {
    const postPage = await visit(SITE_HOST, `/news/${postSlug}`);
    const pl = links(postPage.text);
    ok("a news post (posts plugin) shows them when News and articles is ticked, with the post's own title", postPage.status === 200 && q(pl.x?.href ?? "http://x").get("text") === "Worth a read: A post about sharing" && new URL(canonical(postPage.text)).pathname === `/news/${postSlug}`, `${postPage.status} ${pl.x?.href}`);
  } else {
    console.log("skip posts: the posts plugin is not installed on this stack");
  }

  // changing the settings refreshes pages the site had already cached
  await setShare(SITE_ID, { contentTypes: ["home"] });
  await sleep(1500);
  const pageAgain = await visit(SITE_HOST, `/${slug}`);
  ok("unticking Pages removes the buttons from a page that had them (the site refreshes itself)", pageAgain.status === 200 && !nav(pageAgain.text), "the buttons are still there");
  const homeAgain = await visit(SITE_HOST, "/");
  ok("while the home page keeps them", Boolean(nav(homeAgain.text)));
  if (hasPosts) {
    const postAgain = await visit(SITE_HOST, `/news/${postSlug}`);
    ok("and a post, not ticked now, has none", postAgain.status === 200 && !nav(postAgain.text));
    await setShare(SITE_ID, { contentTypes: ["posts"] });
    await sleep(1500);
    const postOnly = await visit(SITE_HOST, `/news/${postSlug}`);
    const pagesNow = await visit(SITE_HOST, `/${slug}`);
    ok("ticking only News and articles shows them on posts and not on pages or the home page", Boolean(nav(postOnly.text)) && !nav(pagesNow.text) && !nav((await visit(SITE_HOST, "/")).text));
  }

  // --- placement and look ------------------------------------------------------------------------------------------------------------
  await setShare(SITE_ID, { contentTypes: ["pages"], placement: "floating-side", style: "buttons", networks: ["facebook", "copy"] });
  await sleep(1500);
  const side = await visit(SITE_HOST, `/${slug}`);
  ok("only the networks still ticked remain (the others are gone)", JSON.stringify(Object.keys(links(side.text))) === JSON.stringify(["facebook"]), JSON.stringify(Object.keys(links(side.text))));
  ok("the side placement is a floating bar, and a floating bar shows icons only (no names)", /poly-share--floating[^"]*poly-share--side|poly-share--side[^"]*poly-share--floating/.test(nav(side.text) ?? "") && !/poly-share-name/.test(nav(side.text) ?? ""));
  await setShare(SITE_ID, { placement: "inline" });
  await sleep(1500);
  const inline = await visit(SITE_HOST, `/${slug}`);
  ok("\"where the theme puts it\" shows nothing on a layout that has made no place for it (and no duplicate floating copy)", inline.status === 200 && !nav(inline.text));

  await setShare(SITE_ID, { enabled: false });
  await sleep(1500);
  const off = await visit(SITE_HOST, `/${slug}`);
  ok("switching it off removes the buttons again", off.status === 200 && !nav(off.text));

  // --- a second language, when the i18n plugin is installed ----------------------------------------------------------------------------
  const i18n = await api("GET", "/api/i18n/status", { token: admin });
  if (i18n.status === 200) {
    // The i18n plugin keeps a site's languages in its own `site-languages` collection, one row per site.
    const languageRow = async () => (await api("GET", `/api/site-languages?where[site][equals]=${SITE_ID}&depth=0&limit=1`, { token: admin })).json?.docs?.[0] ?? null;
    const original = await languageRow();
    try {
      const languages = { languages: ["en", "fr"], defaultLanguage: "en" };
      if (original) await api("PATCH", `/api/site-languages/${original.id}`, { token: admin, body: languages });
      else await api("POST", "/api/site-languages", { token: admin, body: { site: SITE_ID, ...languages } });
      const frSet = await api("PATCH", `/api/share-settings/${(await rowOf(SITE_ID)).id}?locale=fr`, { token: admin, body: { text: "À lire :" } });
      await setShare(SITE_ID, { enabled: true, placement: "floating-bottom", networks: ["facebook", "x", "email", "copy"], contentTypes: ["pages"], via: "" });
      const created = await api("GET", `/api/pages?where[slug][equals]=${slug}&where[site][equals]=${SITE_ID}&depth=0`, { token: admin });
      const pageId = created.json?.docs?.[0]?.id;
      await api("PATCH", `/api/pages/${pageId}?locale=fr`, { token: admin, body: { title: "Bonjour à tous", _status: "published" } });
      await sleep(2000);
      const enPage = await visit(SITE_HOST, `/${slug}`);
      const frPage = await visit(SITE_HOST, `/fr/${slug}`);
      const en = links(enPage.text);
      const fr = links(frPage.text);
      ok("the message can be written per language", frSet.status === 200, JSON.stringify(frSet.json)?.slice(0, 200));
      ok("the English page says \"Share on Facebook\" and shares its own title", en.facebook?.label === "Share on Facebook" && q(en.x?.href ?? "http://x").get("text") === `Worth a read: ${title}`, JSON.stringify(en.x));
      ok("the French page's fixed words are French", fr.facebook?.label === "Partager sur Facebook" && fr.email?.label === "Partager par courriel" && /aria-label="Partager cette page"/.test(nav(frPage.text) ?? ""), JSON.stringify(fr));
      ok("it shares the French title with the French message and the /fr/ address", q(fr.x?.href ?? "http://x").get("text") === "À lire : Bonjour à tous" && new URL(q(fr.x.href).get("url")).pathname === `/fr/${slug}`, fr.x?.href);
    } finally {
      const now = await languageRow();
      if (now && original) await api("PATCH", `/api/site-languages/${now.id}`, { token: admin, body: { languages: original.languages ?? [], defaultLanguage: original.defaultLanguage ?? null } });
      else if (now) await api("DELETE", `/api/site-languages/${now.id}`, { token: admin });
    }
  } else {
    console.log("skip languages: the i18n plugin is not installed on this stack");
  }
} finally {
  for (const [collection, id] of cleanup) await api("DELETE", `/api/${collection}/${id}`, { token: admin });
  // The rows this run created go with it; a row that was already there is put back as it was.
  for (const id of [SITE_ID, OTHER_ID]) {
    const row = await rowOf(id);
    if (!row) continue;
    const original = rowBefore[id];
    if (!original) await api("DELETE", `/api/share-settings/${row.id}`, { token: admin });
    else {
      await api("PATCH", `/api/share-settings/${row.id}`, { token: admin, body: { enabled: original.enabled, networks: original.networks, style: original.style, placement: original.placement, contentTypes: original.contentTypes, text: original.text ?? "", via: original.via ?? "" } });
      // The text for French was written on the same row; set it back too.
      await api("PATCH", `/api/share-settings/${row.id}?locale=fr`, { token: admin, body: { text: "" } });
    }
  }
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
