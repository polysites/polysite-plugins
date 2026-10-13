import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";

import { readWxr } from "../src/wxr.js";
import { collect, sampleWxr } from "./helpers.js";

test("the sample export reads: channel, authors, terms and every item", async () => {
  const out = await collect(readWxr(sampleWxr()));
  assert.equal(out.channel.title, "Harbourlight Community Garden");
  assert.equal(out.channel.baseSiteUrl, "https://garden.example");
  assert.equal(out.channel.wxrVersion, "1.2");
  assert.deepEqual(out.authors.map((a) => a.login), ["sam", "jo"]);
  assert.equal(out.authors[0].displayName, "Sam Rivera");
  assert.deepEqual(out.terms.map((t) => `${t.taxonomy}:${t.slug}`), ["category:news", "category:events", "category:uncategorized", "post_tag:volunteering", "post_tag:composting", "nav_menu:main-menu"]);
  assert.equal(out.items.length, 18);
  const types = Object.fromEntries(out.items.reduce((m, i) => m.set(i.type, (m.get(i.type) ?? 0) + 1), new Map()));
  assert.deepEqual(types, { attachment: 2, page: 6, post: 5, product: 1, nav_menu_item: 4 });
});

test("CDATA, entities and fields of a post come through", async () => {
  const { items } = await collect(readWxr(sampleWxr()));
  const post = items.find((i) => i.id === 20);
  assert.equal(post.title, "Spring planting day");
  assert.equal(post.slug, "spring-planting-day");
  assert.equal(post.status, "publish");
  assert.equal(post.dateGmt, "2024-03-08 14:30:00");
  assert.equal(post.creator, "sam");
  assert.deepEqual(post.categories.map((c) => `${c.domain}:${c.nicename}`), ["category:news", "post_tag:volunteering"]);
  assert.equal(post.meta._thumbnail_id, "40");
  assert.match(post.content, /<b>Saturday<\/b>/);
  assert.match(post.content, /wp:latest-posts \/-->$/);
  const café = items.find((i) => i.id === 21);
  assert.equal(café.title, "Compost workshop café");
});

test("a CDATA section that ends in a bracket is read whole", async () => {
  const { items } = await collect(readWxr(sampleWxr()));
  assert.match(items.find((i) => i.id === 12).content, /\[gallery ids="40,41"\]$/);
  assert.equal(items.find((i) => i.id === 14).meta._elementor_data, '[{"id":"a1","elType":"section"}]');
});

test("the file can arrive in tiny pieces, even in the middle of a character", async () => {
  const bytes = Buffer.from(sampleWxr(), "utf8");
  const pieces = [];
  for (let i = 0; i < bytes.length; i += 7) pieces.push(bytes.subarray(i, i + 7));
  const out = await collect(readWxr(Readable.from(pieces)));
  assert.equal(out.items.length, 18);
  assert.equal(out.items.find((i) => i.id === 21).title, "Compost workshop café");
});

test("a huge text node (6 MB) is joined from the parser's pieces without loss", async () => {
  const big = "x".repeat(6 * 1024 * 1024);
  const xml = `<?xml version="1.0"?><rss><channel><title>t</title><item><title>big</title><content:encoded><![CDATA[<p>${big}</p>]]></content:encoded><wp:post_id>1</wp:post_id><wp:post_type>post</wp:post_type></item></channel></rss>`;
  const out = await collect(readWxr(Readable.from([Buffer.from(xml)])));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].content.length, big.length + 7);
});

test("a stray ampersand is reported as a warning and the rest is still read", async () => {
  const xml = `<rss><channel><title>t</title><item><title>Fish & chips</title><wp:post_id>1</wp:post_id><wp:post_type>post</wp:post_type></item><item><title>Two</title><wp:post_id>2</wp:post_id><wp:post_type>post</wp:post_type></item></channel></rss>`;
  const warnings = [];
  const out = await collect(readWxr(xml, { onWarning: (w) => warnings.push(w) }));
  assert.equal(out.items.length, 2);
  assert.ok(warnings.length >= 1);
});

test("a file that is not a WordPress export is refused", async () => {
  await assert.rejects(collect(readWxr("<html><body>hello</body></html>")), /WordPress export/);
  await assert.rejects(collect(readWxr("just text")), /WordPress export|XML/);
});

test("a byte order mark at the start is ignored", async () => {
  const out = await collect(readWxr(Readable.from([Buffer.from("﻿" + sampleWxr())])));
  assert.equal(out.items.length, 18);
});
