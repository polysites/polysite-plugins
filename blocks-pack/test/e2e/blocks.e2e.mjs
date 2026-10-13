// End-to-end check of the blocks-pack plugin against a RUNNING Polysite that has the plugin installed (a dev stack, or the stack that
// tests/e2e/run-with-plugins.sh builds, on an empty production-mode database). It creates a published page that holds every block,
// with hostile text and addresses in it, reads the page the public site really renders, checks the markup, and removes what it made.
// Not part of the plugin's unit tests (test/*.test.js).
//
//   BASE=http://cms:3001 WEB=http://web:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//   SITE_ID=1 SITE_HOST=voidslate.localhost node test/e2e/blocks.e2e.mjs
//
// WEB must be the web app itself (or a proxy that passes the Host header through): the site is picked by the Host header.
import http from "node:http";

const BASE = process.env.BASE;
const WEB = process.env.WEB;
const SITE_ID = Number(process.env.SITE_ID ?? 1);
const SITE_HOST = process.env.SITE_HOST ?? "voidslate.localhost";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(Boolean(cond));
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + String(extra).slice(0, 600)}`);
};

async function api(method, path, { token, body, form } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(form ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `JWT ${token}` } : {}) },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function visitUntil(host, path, want = 200) {
  let last;
  for (let i = 0; i < 20; i++) {
    last = await visit(host, path);
    if (last.status === want) return last;
    await sleep(1500);
  }
  return last;
}

const login = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
const admin = login.json?.token;
ok("admin signs in", Boolean(admin));

const stamp = Date.now();
const made = [];
const create = async (collection, body) => {
  const res = await api("POST", `/api/${collection}`, { token: admin, body });
  if (res.json?.doc?.id) made.push([collection, res.json.doc.id]);
  return res;
};

try {
  // ---- the plugin is installed, and added nothing to a core table's API shape
  const sites = await api("GET", `/api/sites/${SITE_ID}?depth=0`, { token: admin });
  ok("Sites itself carries no field of the plugin", sites.status === 200 && !Object.keys(sites.json ?? {}).some((k) => /blocks|gallery|pricing/i.test(k)), Object.keys(sites.json ?? {}).join());

  // ---- a picture to use (a 1x1 PNG)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), `blocks-${stamp}.png`);
  fd.append("_payload", JSON.stringify({ alt: "A test pixel", site: SITE_ID }));
  const media = await api("POST", "/api/media", { token: admin, form: fd });
  if (media.json?.doc?.id) made.push(["media", media.json.doc.id]);
  const imageId = media.json?.doc?.id;
  ok("a picture is uploaded", media.status === 201 && imageId, `${media.status} ${JSON.stringify(media.json)?.slice(0, 200)}`);

  // ---- required fields are enforced, with the contract's names
  const rejectedGallery = await create("pages", { title: `Rejected ${stamp}`, slug: `blocks-rejected-${stamp}`, site: SITE_ID, content: [{ blockType: "gallery", images: [{ caption: "no picture" }] }] });
  ok("a gallery picture row without a picture is refused", rejectedGallery.status === 400, `${rejectedGallery.status} ${JSON.stringify(rejectedGallery.json)?.slice(0, 200)}`);
  const rejectedCta = await create("pages", { title: `Rejected ${stamp}`, slug: `blocks-rejected2-${stamp}`, site: SITE_ID, content: [{ blockType: "cta", heading: "Only a heading" }] });
  ok("a call to action without its button words and address is refused", rejectedCta.status === 400, `${rejectedCta.status} ${JSON.stringify(rejectedCta.json)?.slice(0, 200)}`);
  const rejectedColumns = await create("pages", { title: `Rejected ${stamp}`, slug: `blocks-rejected3-${stamp}`, site: SITE_ID, content: [{ blockType: "gallery", columns: "7" }] });
  ok("a gallery with 7 columns is refused", rejectedColumns.status === 400, `${rejectedColumns.status}`);

  // ---- a page with every block, hostile text and addresses included
  const SCRIPT = '<script>window.__pwned=1</script>';
  const slug = `blocks-e2e-${stamp}`;
  const content = [
    { blockType: "gallery", heading: "Our work", columns: "4", images: [{ image: imageId, caption: `Caption ${SCRIPT}` }, { image: imageId }] },
    {
      blockType: "pricing",
      heading: "Plans",
      intro: "Pick one",
      plans: [
        { name: "Starter", price: "$45", period: "per month", description: "For one", features: [{ text: "One chair" }, { text: `Feature ${SCRIPT}` }], buttonLabel: "Unsafe buy", buttonHref: "javascript:alert(1)", highlighted: false },
        { name: "Pro", price: "$90", features: [{ text: "Two chairs" }], buttonLabel: "Choose Pro", buttonHref: "/contact", highlighted: true },
      ],
    },
    { blockType: "pricing", plans: [{ name: "Headingless plan", price: "Free" }] },
    { blockType: "testimonials", heading: "Kind words", items: [{ quote: `Wonderful ${SCRIPT}`, name: "Alex Morgan", role: "Regular client", image: imageId }, { quote: "Second", name: "Sam Lee" }] },
    { blockType: "timeline", heading: "Our story", entries: [{ period: "2019", title: "Opened", subtitle: "Main Street", description: "The first day" }, { period: "2022", title: "Moved" }] },
    { blockType: "team", heading: "The team", intro: "Meet us", members: [{ name: "Alex Morgan", role: "Owner", bio: "Founder", image: imageId }, { name: "Sam Lee" }] },
    { blockType: "cta", heading: "Ready to book?", text: "Come in", buttonLabel: "Book now", buttonHref: "https://example.org/book", secondaryLabel: "Hostile second", secondaryHref: "JaVaScRiPt:alert(2)" },
    {
      blockType: "hours-contact",
      heading: "Visit us",
      hours: [{ days: "Monday - Friday", time: "9am - 5pm" }, { days: "Sunday", time: "Closed" }],
      address: `1 Main Street\nSpringfield ${SCRIPT}`,
      phone: "+1 (555) 010-0100",
      email: "hello@example.org",
      note: "Closed on public holidays",
    },
    {
      blockType: "price-list",
      heading: "Services",
      intro: "Prices include tax",
      sections: [{ title: "Hair", items: [{ name: "Cut and finish", description: "45 minutes", price: "$45", tag: "popular" }, { name: "Colour", price: "from $80" }] }, { title: "Nails", items: [{ name: "Manicure", price: "$30", tag: "new" }] }],
    },
    {
      blockType: "schedule",
      heading: "Programme",
      days: [{ label: "Friday", sessions: [{ time: "09:30 - 10:15", title: "Opening", speaker: "Alex Morgan", room: "Hall A", description: "Welcome" }, { time: "11:00", title: "Workshop" }] }, { label: "Saturday", sessions: [{ time: "Morning", title: "Walk" }] }],
    },
    { blockType: "stats", heading: "In numbers", items: [{ value: "15+", label: "Years in business" }, { value: "98%", label: "Happy clients" }] },
    { blockType: "logos", heading: "Trusted by", items: [{ name: "Acme Ltd", image: imageId, href: "https://example.org" }, { name: "Hostile Ltd", href: "data:text/html,<script>alert(3)</script>" }, { name: "Plain Ltd" }] },
  ];
  const page = await create("pages", { title: "Blocks end to end", slug, site: SITE_ID, _status: "published", content });
  ok("a published page with every block is saved", page.status === 201, `${page.status} ${JSON.stringify(page.json)?.slice(0, 400)}`);

  const saved = (await api("GET", `/api/pages/${page.json?.doc?.id}?depth=0`, { token: admin })).json;
  ok("the blocks are stored in order with their contract names", saved?.content?.map((b) => b.blockType).join() === content.map((b) => b.blockType).join(), saved?.content?.map((b) => b.blockType).join());
  ok("a gallery's columns come back as chosen", saved?.content?.[0]?.columns === "4", saved?.content?.[0]?.columns);
  ok("a price list keeps its groups and items", saved?.content?.[8]?.sections?.[0]?.items?.[0]?.tag === "popular" && saved.content[8].sections.length === 2);

  // ---- what visitors get
  const shown = await visitUntil(SITE_HOST, `/${slug}`);
  ok("visitors get the page", shown.status === 200, `${shown.status} ${shown.text?.slice(0, 200)}`);
  const html = shown.text ?? "";
  // Vue marks the start and end of each list it draws with comments; they are not part of what a visitor or a screen reader meets.
  const main = (html.match(/<main\b[\s\S]*?<\/main>/)?.[0] ?? html).replace(/<!--[\s\S]*?-->/g, "");
  const section = (name) => main.match(new RegExp(`<section\\b[^>]*poly-block--${name}\\b[^>]*>[\\s\\S]*?</section>`))?.[0] ?? "";
  const has = (text, re) => re.test(text);

  for (const name of ["gallery", "pricing", "testimonials", "timeline", "team", "cta", "hours-contact", "price-list", "schedule", "stats", "logos"]) {
    ok(`the ${name} block is drawn with its stable class names`, section(name).includes(`poly-block poly-block--${name}`), main.includes("Unknown block type") ? "unknown block type" : "missing");
  }
  ok("no block is reported as unknown", !html.includes("Unknown block type"));

  // headings: one h1, and never a jump of more than one level down the page
  const levels = [...main.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  const jumps = levels.map((l, i) => (i > 0 && l > levels[i - 1] + 1 ? `h${levels[i - 1]} then h${l}` : null)).filter(Boolean);
  ok("the page has one h1, its title", levels.filter((l) => l === 1).length === 1 && levels[0] === 1, levels.join());
  ok("headings never skip a level", jumps.length === 0, jumps.join("; ") + " in " + levels.join());
  ok("a block without a title puts its items directly under the page's headings (h2, not h3)", /poly-block--pricing[\s\S]*?<h2[^>]*poly-pricing__name[^>]*>Headingless plan/.test(main) || has(main, /<h2[^>]*class="[^"]*poly-pricing__name[^"]*"[^>]*>Headingless plan/));
  ok("a titled block names its section for assistive technology", has(section("gallery"), /aria-labelledby="[^"]+"/) && has(section("gallery"), /<h2[^>]*id="[^"]+"[^>]*>Our work<\/h2>/));

  // text is text
  ok("text with a script tag is escaped, never run", !main.includes(SCRIPT) && !main.includes("<script>window.__pwned") && main.includes("&lt;script&gt;window.__pwned=1&lt;/script&gt;"));
  ok("every place that took the hostile text escaped it (caption, feature, quote, address)", (main.match(/&lt;script&gt;window\.__pwned=1&lt;\/script&gt;/g) ?? []).length === 4, String((main.match(/&lt;script&gt;window\.__pwned=1/g) ?? []).length));

  // links
  const hrefs = [...main.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
  ok("no link runs script or carries data", !hrefs.some((h) => /^\s*(javascript|data|vbscript):/i.test(h)), hrefs.join());
  ok("and no such address is left anywhere in the page's markup", !/(href|src)="\s*(javascript|data|vbscript):/i.test(main));
  ok("the unsafe plan button is left out, the safe one is a link", !main.includes("Unsafe buy") && has(main, /<a\b[^>]*href="\/contact"[^>]*>Choose Pro<\/a>/));
  ok("the call to action's safe button is a link and its hostile second one is gone", has(section("cta"), /<a\b[^>]*href="https:\/\/example\.org\/book"[^>]*>Book now<\/a>/) && !section("cta").includes("Hostile second"));
  ok("phone and email are tap-to-call and write-to links", has(section("hours-contact"), /href="tel:\+15550100100"/) && has(section("hours-contact"), /href="mailto:hello@example\.org"/));
  ok("a logo links where the editor said, and a hostile link leaves a plain logo", has(section("logos"), /<a\b[^>]*href="https:\/\/example\.org"/) && section("logos").includes("Hostile Ltd") && !has(section("logos"), /<a\b[^>]*>[^<]*Hostile Ltd/));

  // semantics
  ok("pictures have alt text from the media library", has(section("gallery"), /<img\b[^>]*alt="A test pixel"/));
  const imgs = [...main.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  ok("every picture in the page has an alt attribute", imgs.length >= 5 && imgs.every((tag) => /\balt="/.test(tag)), imgs.filter((tag) => !/\balt="/.test(tag)).join(" | "));
  ok("gallery: pictures are in a list, with figure and caption", has(section("gallery"), /<ul\b[^>]*poly-gallery__list--cols-4[\s\S]*<li\b[\s\S]*<figure\b[\s\S]*<figcaption\b/));
  ok("pricing: plans are a list, features a list inside, the recommended plan is marked in words", has(section("pricing"), /<ul\b[^>]*poly-pricing__list[\s\S]*<ul\b[^>]*poly-pricing__features/) && section("pricing").includes("Recommended"));
  ok("testimonials: a figure with a blockquote and a caption", has(section("testimonials"), /<figure\b[\s\S]*<blockquote\b[\s\S]*<figcaption\b/));
  ok("timeline: an ordered list", has(section("timeline"), /<ol\b[^>]*poly-timeline__list[\s\S]*<li\b/));
  ok("team: a list of people with headings", has(section("team"), /<ul\b[^>]*poly-team__list[\s\S]*<h3\b[^>]*>Alex Morgan/));
  ok("opening hours: a description list with machine-readable times, an <address> for contact details", has(section("hours-contact"), /<dl\b[\s\S]*<dt\b[^>]*>Monday - Friday[\s\S]*<time datetime="09:00">9am<\/time>[\s\S]*<time datetime="17:00">5pm<\/time>/) && has(section("hours-contact"), /<address\b[\s\S]*1 Main Street<br>Springfield/) && section("hours-contact").includes("Closed</dd>"));
  ok("price list: groups with headings and lists of items, tags kept", has(section("price-list"), /<h3\b[^>]*>Hair<\/h3>[\s\S]*<ul\b[\s\S]*Cut and finish[\s\S]*popular/) && section("price-list").includes("from $80"));
  ok("schedule: ordered sessions with <time>, speaker and room labelled", has(section("schedule"), /<ol\b[^>]*poly-schedule__sessions[\s\S]*<time datetime="09:30">09:30<\/time> - <time datetime="10:15">10:15<\/time>/) && has(section("schedule"), /Speaker: <\/span>Alex Morgan/) && has(section("schedule"), /Room: <\/span>Hall A/) && section("schedule").includes(">Morning<"));
  ok("stats: a description list (label, then value)", has(section("stats"), /<dl\b[\s\S]*<dt\b[^>]*>Years in business<\/dt><dd\b[^>]*>15\+<\/dd>/));
  ok("logos: a list", has(section("logos"), /<ul\b[^>]*poly-logos__list[\s\S]*<li\b/));
  ok("nothing is requested from another website (no external script, stylesheet or font from the blocks)", !/(?:src|href)="https?:\/\/(?!example\.org)[^"]*"[^>]*(?:poly-)/.test(main) && !/@import|fonts\.googleapis/.test(main));
  ok("no inline event handlers in the blocks", !/\son[a-z]+="/i.test(main));

  if (results.includes(false)) {
    console.log("--- markup for the failed checks ---");
    for (const name of ["hours-contact", "schedule"]) console.log(`[${name}]`, section(name));
    console.log("[img tags]", imgs.join("\n"));
  }

  // ---- data that is missing or odd
  const empty = await create("pages", {
    title: "Blocks empty",
    slug: `blocks-empty-${stamp}`,
    site: SITE_ID,
    _status: "published",
    content: [
      { blockType: "gallery" },
      { blockType: "pricing" },
      { blockType: "testimonials", items: [] },
      { blockType: "timeline" },
      { blockType: "team" },
      { blockType: "hours-contact" },
      { blockType: "price-list", sections: [{ title: "Only a title" }] },
      { blockType: "schedule", days: [{ label: "Day 1" }] },
      { blockType: "stats" },
      { blockType: "logos" },
      { blockType: "gallery", images: [{ image: imageId }] },
    ],
  });
  ok("a page whose blocks hold none of their optional data is saved", empty.status === 201, `${empty.status} ${JSON.stringify(empty.json)?.slice(0, 300)}`);
  const emptyShown = await visitUntil(SITE_HOST, `/blocks-empty-${stamp}`);
  ok("and renders, without errors and without empty sections", emptyShown.status === 200 && !emptyShown.text.includes("Unknown block type") && !/poly-block--(pricing|testimonials|timeline|team|hours-contact|stats|logos)\b/.test(emptyShown.text), `${emptyShown.status}`);
  ok("a picture with no caption and no description still has an alt attribute", /<img\b[^>]*poly-gallery__image[^>]*alt="A test pixel"/.test(emptyShown.text));

  const plain = await create("pages", { title: "Plain page", slug: `blocks-plain-${stamp}`, site: SITE_ID, _status: "published", content: [{ blockType: "hero", heading: "Plain hero" }] });
  const plainShown = await visitUntil(SITE_HOST, `/blocks-plain-${stamp}`);
  ok("a page that uses none of the plugin's blocks is unaffected", plain.status === 201 && plainShown.status === 200 && plainShown.text.includes("Plain hero") && !plainShown.text.includes("poly-block--"));
} finally {
  for (const [collection, id] of made.reverse()) await api("DELETE", `/api/${collection}/${id}`, { token: admin });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
