import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";

import { analyse, parseAuthorMap, runImport } from "../src/importer.js";
import { sampleWxr } from "./helpers.js";
import { memoryStore } from "./memoryStore.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
let server;
let site;
let xml;
let mediaHits;

before(async () => {
  process.env.WORDPRESS_IMPORT_ALLOW_PRIVATE_HOSTS = "1";
  mediaHits = [];
  server = http.createServer((req, res) => {
    mediaHits.push(req.url);
    if (req.url.endsWith("hero.png")) return res.writeHead(200).end(PNG);
    if (req.url.endsWith("plot.jpg")) return res.writeHead(200).end(JPG);
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${server.address().port}`;
  xml = sampleWxr(site);
});
after(() => server.close());

const openStream = () => Readable.from([Buffer.from(xml)]);
const run = (store, options = {}) => runImport({ openStream, options, store });
const kinds = (store, col) => [...store.cols[col].values()].map((d) => d.slug).sort();

test("the dry run counts what an import would do and lists what it cannot import", async () => {
  const store = memoryStore();
  const a = await analyse({ openStream, options: {}, store });
  assert.equal(a.source.title, "Harbourlight Community Garden");
  assert.deepEqual(a.totals, { pages: 6, posts: 5, categories: 3, tags: 2, media: 2, menus: 1, menuItems: 4, authors: 2 });
  assert.equal(a.willImport.pages, 4);
  assert.equal(a.willImport.posts, 2);
  assert.equal(a.willImport.categories, 2);
  assert.equal(a.willImport.tags, 2);
  assert.deepEqual(a.byStatus.posts, { draft: 1, private: 1, publish: 2, trash: 1 });
  assert.equal(a.skipped.password, 1);
  assert.equal(a.skipped["status-draft"], 2);
  assert.equal(a.skipped["status-private"], 1);
  assert.equal(a.skipped["status-trash"], 1);
  const codes = a.unsupported.map((u) => u.code);
  assert.ok(codes.includes("password") && codes.includes("post-type") && codes.includes("page-builder"));
  assert.equal(a.unsupported.find((u) => u.code === "post-type").wpType, "product");
  const constructCodes = a.constructs.map((c) => c.code);
  for (const c of ["script", "iframe", "table", "shortcode:contact-form-7", "dynamic-block:latest-posts", "unsafe-link"]) assert.ok(constructCodes.includes(c), c);
  assert.equal(a.media.fetchable, 2);
  assert.equal(a.chosenMenu.slug, "main-menu");
  assert.equal(a.willImport.redirects, 2);
  assert.deepEqual(a.samples.pages.map((p) => p.to), ["about-us", "about-us/team", "contact", "landing"]);
  assert.deepEqual(a.samples.posts.map((p) => [p.from, p.to]), [["2024/03/spring-planting-day", "news/spring-planting-day"], ["events/compost-workshop", "news/compost-workshop"]]);
});

test("choosing drafts, private and trashed items selects them too", async () => {
  const a = await analyse({ openStream, options: { includeDrafts: true, includePrivate: true, includeTrashed: true }, store: memoryStore() });
  assert.equal(a.willImport.pages, 5); // password-protected is never imported
  assert.equal(a.willImport.posts, 5);
});

test("without the posts plugin posts are skipped with a message", async () => {
  const store = memoryStore({ hasPosts: false });
  const a = await analyse({ openStream, options: {}, store });
  assert.equal(a.willImport.posts, 0);
  assert.equal(a.postsPluginInstalled, false);
  assert.ok(a.unsupported.some((u) => u.code === "no-posts-plugin"));
  const s = await run(store);
  assert.equal(s.created.posts, 0);
  assert.equal(store.cols.posts.size, 0);
  assert.ok(store.logCodes().includes("no-posts-plugin"));
});

test("an import creates pages, posts, categories, media, redirects and the menu", async () => {
  const store = memoryStore();
  const s = await run(store);
  assert.deepEqual(kinds(store, "pages"), ["about-us", "about-us/team", "contact", "landing"]);
  assert.deepEqual(kinds(store, "posts"), ["compost-workshop", "spring-planting-day"]);
  assert.deepEqual(kinds(store, "post-categories"), ["composting", "events", "news", "volunteering"]);
  assert.equal(s.failed, 0, JSON.stringify(store.state.logs.filter((l) => l.level === "error")));

  const post = store.bySlug("posts", "spring-planting-day");
  assert.equal(post.publishedAt, "2024-03-08T14:30:00.000Z");
  assert.equal(post.byline, "Sam Rivera");
  assert.equal(post.draft, true);
  assert.equal(post._status, "draft");
  assert.equal(post.excerpt, "First planting day of the year.");
  assert.ok(post.heroImage, "featured image");
  assert.equal(post.categories.length, 2);
  const flat = JSON.stringify(post.body);
  assert.ok(flat.includes('"relationTo":"media"'), "in-content image is an upload");
  assert.equal(flat.includes("alert(1)"), false);
  assert.equal(flat.includes("steal"), false);
  assert.ok(flat.includes("Many hands make light work."));

  const about = store.bySlug("pages", "about-us");
  assert.equal(about.createdAt, "2024-03-04T08:00:00.000Z");
  assert.equal(about.content[0].blockType, "textBlock");
  assert.equal(JSON.stringify(about.content).includes("alert('hello')"), false);
  // the link to the old post address now points at the new one
  assert.ok(JSON.stringify(about.content).includes('"url":"/news/spring-planting-day"'));
  // the gallery on Contact became the two attachments, already downloaded
  assert.equal(JSON.stringify(store.bySlug("pages", "contact").content).split('"relationTo":"media"').length - 1, 2);
  assert.equal(store.cols.media.size, 2);

  const reds = [...store.cols.redirects.values()].map((r) => [r.fromPath, r.redirectType, r.toUrl || "page"]).sort();
  assert.deepEqual(reds, [
    ["2024/03/spring-planting-day", "external", "/news/spring-planting-day"],
    ["events/compost-workshop", "external", "/news/compost-workshop"],
  ]);
  // pages whose address is unchanged (about-us, contact) need none; the nested team page keeps its address too

  assert.deepEqual(store.state.nav.map((n) => [n.label, n.href]), [["Home", "/"], ["About us", "/about-us"], ["Elsewhere", "https://elsewhere.example/tools"]]);
  assert.equal(s.menu.items, 3);

  const codes = store.logCodes();
  for (const c of ["shortcode:contact-form-7", "script", "iframe", "table", "page-builder", "dynamic-block:latest-posts"]) assert.ok(codes.includes(c), c);
});

test("running the same import again updates in place: nothing is duplicated", async () => {
  const store = memoryStore();
  await run(store);
  const before = { pages: store.cols.pages.size, posts: store.cols.posts.size, cats: store.cols["post-categories"].size, media: store.cols.media.size, reds: store.cols.redirects.size };
  const hitsBefore = mediaHits.length;
  const s = await run(store);
  assert.deepEqual({ pages: store.cols.pages.size, posts: store.cols.posts.size, cats: store.cols["post-categories"].size, media: store.cols.media.size, reds: store.cols.redirects.size }, before);
  assert.equal(s.created.pages + s.created.posts + s.created.categories + s.created.media + s.created.redirects, 0);
  assert.equal(s.updated.pages, 4);
  assert.equal(s.updated.posts, 2);
  assert.equal(mediaHits.length, hitsBefore, "no image was downloaded again");
  assert.equal(store.state.nav.length, 3, "the menu was not added twice");
});

test("content edited in Polysite is left alone unless Overwrite is ticked", async () => {
  const store = memoryStore();
  await run(store);
  const page = store.bySlug("pages", "about-us");
  store.edit("pages", page.id, { title: "About the garden (edited)" });
  const s = await run(store);
  assert.equal(s.skipped.edited, 1);
  assert.equal(store.bySlug("pages", "about-us").title, "About the garden (edited)");
  assert.ok(store.logCodes().includes("edited-here"));
  const s2 = await run(store, { overwrite: true });
  assert.equal(s2.skipped.edited, 0);
  assert.equal(store.bySlug("pages", "about-us").title, "About us");
});

test("an item deleted in Polysite is not brought back, except with Overwrite", async () => {
  const store = memoryStore();
  await run(store);
  const post = store.bySlug("posts", "compost-workshop");
  store.cols.posts.delete(post.id);
  const s = await run(store);
  assert.equal(s.skipped.deleted, 1);
  assert.equal(store.cols.posts.size, 1);
  await run(store, { overwrite: true });
  assert.equal(store.cols.posts.size, 2);
});

test("a slug that already exists on the site is a conflict: skipped by default, renamed on request", async () => {
  const store = memoryStore();
  await store.create("pages", { title: "My own contact page", slug: "contact" });
  const a = await analyse({ openStream, options: {}, store });
  assert.deepEqual(a.conflicts.map((c) => [c.wanted, c.reason]), [["contact", "exists"]]);
  const s = await run(store);
  assert.equal(s.skipped.conflict, 1);
  assert.equal(store.cols.pages.size, 4); // theirs + about-us + team + landing
  assert.equal(store.bySlug("pages", "contact").title, "My own contact page");

  const store2 = memoryStore();
  await store2.create("pages", { title: "Mine", slug: "contact" });
  await run(store2, { onSlugConflict: "rename" });
  assert.deepEqual(kinds(store2, "pages"), ["about-us", "about-us/team", "contact", "contact-2", "landing"]);
});

test("a post cannot take a reserved news address", async () => {
  const store = memoryStore();
  const custom = xml.replace("<wp:post_name><![CDATA[compost-workshop]]>", "<wp:post_name><![CDATA[page]]>");
  const a = await analyse({ openStream: () => Readable.from([Buffer.from(custom)]), options: {}, store });
  assert.deepEqual(a.conflicts.map((c) => c.reason), ["reserved"]);
});

test("Publish as chosen: live WordPress items go live, everything else arrives as a draft", async () => {
  const store = memoryStore();
  await run(store, { targetStatus: "published", includeDrafts: true, includePrivate: true });
  assert.equal(store.bySlug("pages", "contact")._status, "published");
  assert.equal(store.bySlug("posts", "spring-planting-day")._status, "published");
  assert.equal(store.bySlug("posts", "spring-planting-day").draft, false);
  const draftPage = [...store.cols.pages.values()].find((p) => p.title === "Draft plans");
  assert.equal(draftPage._status, "draft");
  assert.ok(draftPage.slug, "a draft with no slug gets one from its title");
});

test("byline modes: author name, a fixed name, an author map, or none", async () => {
  for (const [options, expected] of [
    [{ bylineMode: "fixed", bylineText: "Garden team" }, "Garden team"],
    [{ bylineMode: "none" }, undefined],
    [{ bylineMode: "author", authorMap: "sam = Samantha R." }, "Samantha R."],
  ]) {
    const store = memoryStore();
    await run(store, options);
    assert.equal(store.bySlug("posts", "spring-planting-day").byline, expected, JSON.stringify(options));
  }
  assert.deepEqual([...parseAuthorMap("A = One\n# c\nb=Two")], [["a", "One"], ["b", "Two"]]);
});

test("images from another host are not fetched (the default); allowing the host fetches them", async () => {
  const other = xml.replace("</channel>", `<item><title>Remote</title><link>${site}/remote/</link><wp:post_id>60</wp:post_id><wp:post_name>remote</wp:post_name><wp:status>publish</wp:status><wp:post_type>page</wp:post_type><content:encoded><![CDATA[<p><img src="https://cdn.elsewhere.example/a.png" alt="far"></p>]]></content:encoded></item></channel>`);
  const store = memoryStore();
  await runImport({ openStream: () => Readable.from([Buffer.from(other)]), options: {}, store });
  assert.ok(JSON.stringify(store.bySlug("pages", "remote").content).includes('"url":"https://cdn.elsewhere.example/a.png"'));
  assert.ok(store.state.logs.some((l) => l.code === "media-failed" && /allow-list/.test(l.message)));
  const a = await analyse({ openStream: () => Readable.from([Buffer.from(other)]), options: {}, store: memoryStore() });
  assert.deepEqual(a.media.blockedHosts, { "cdn.elsewhere.example": 1 });
});

test("media can be switched off: images stay as links", async () => {
  const store = memoryStore();
  const hits = mediaHits.length;
  await run(store, { importMedia: false });
  assert.equal(store.cols.media.size, 0);
  assert.equal(mediaHits.length, hits);
});

test("menu modes: replace swaps the header menu, none leaves it", async () => {
  const store = memoryStore({ nav: [{ label: "Existing", href: "/existing" }] });
  await run(store, { menuMode: "none" });
  assert.deepEqual(store.state.nav.map((n) => n.label), ["Existing"]);
  await run(store, { menuMode: "replace" });
  assert.deepEqual(store.state.nav.map((n) => n.label), ["Home", "About us", "Elsewhere"]);
});

test("the redirect is skipped when its address is something else here, or already exists", async () => {
  const store = memoryStore();
  await store.saveRedirect(null, { fromPath: "events/compost-workshop", redirectType: "external", toUrl: "/somewhere" });
  await run(store);
  assert.equal(store.cols.redirects.size, 2);
  assert.equal([...store.cols.redirects.values()].find((r) => r.fromPath === "events/compost-workshop").toUrl, "/somewhere");
  assert.ok(store.logCodes().includes("redirect-exists"));
});

test("a failing item is logged and the rest still import", async () => {
  const store = memoryStore();
  const create = store.create.bind(store);
  store.create = async (collection, data, o) => {
    if (data.slug === "contact") throw new Error("boom");
    return create(collection, data, o);
  };
  const s = await run(store);
  assert.equal(s.failed, 1);
  assert.deepEqual(kinds(store, "pages"), ["about-us", "about-us/team", "landing"]);
  assert.ok(store.state.logs.some((l) => l.code === "item-failed" && /boom/.test(l.message)));
});
