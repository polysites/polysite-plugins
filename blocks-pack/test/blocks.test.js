import assert from "node:assert/strict";
import { test } from "node:test";

import { BLOCKS, BLOCK_SLUGS } from "../src/blocks.js";
import blocksPackPlugin from "../src/index.js";

const SLUGS = ["gallery", "pricing", "testimonials", "timeline", "team", "cta", "hours-contact", "price-list", "schedule", "stats", "logos"];

// The shape of the core's config that matters here: a pages collection whose `content` is a blocks field, and other collections.
const coreConfig = () => ({
  secret: "x",
  collections: [
    { slug: "users", fields: [{ name: "name", type: "text" }] },
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "content", type: "blocks", blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }] },
        { name: "other", type: "blocks", blocks: [] },
      ],
    },
    { slug: "media", fields: [{ name: "alt", type: "text" }] },
  ],
});

const find = (config, slug) => config.collections.find((c) => c.slug === slug);
const contentOf = (config) => find(config, "pages").fields.find((f) => f.name === "content");
const block = (slug) => BLOCKS.find((b) => b.block.slug === slug).block;
const names = (fields) => fields.map((f) => f.name);

test("adds exactly these block slugs to the page content, after the core's own", () => {
  const out = blocksPackPlugin(coreConfig());
  assert.deepEqual(
    contentOf(out).blocks.map((b) => b.slug),
    ["hero", ...SLUGS],
  );
  assert.deepEqual(BLOCK_SLUGS, SLUGS);
});

test("adds no field, collection or other setting to anything else", () => {
  const before = coreConfig();
  const out = blocksPackPlugin(before);
  assert.deepEqual(out.collections.map((c) => c.slug), ["users", "pages", "media"]);
  assert.deepEqual(find(out, "users"), find(before, "users"));
  assert.deepEqual(find(out, "media"), find(before, "media"));
  const pages = find(out, "pages");
  assert.deepEqual(names(pages.fields), ["title", "content", "other"]);
  assert.deepEqual(pages.fields[0], find(before, "pages").fields[0]);
  assert.deepEqual(pages.fields[2], find(before, "pages").fields[2], "another blocks field on pages is not touched");
  const { collections: _a, ...rest } = out;
  const { collections: _b, ...restBefore } = before;
  assert.deepEqual(rest, restBefore);
});

test("does not change the config it is given", () => {
  const before = coreConfig();
  const snapshot = JSON.stringify(before);
  blocksPackPlugin(before);
  assert.equal(JSON.stringify(before), snapshot);
});

test("applying it twice adds each block once", () => {
  const twice = blocksPackPlugin(blocksPackPlugin(coreConfig()));
  assert.deepEqual(
    contentOf(twice).blocks.map((b) => b.slug),
    ["hero", ...SLUGS],
  );
});

test("a config without pages, or without a content field, comes back as it was", () => {
  const noPages = { collections: [{ slug: "users", fields: [] }] };
  assert.deepEqual(blocksPackPlugin(noPages), noPages);
  assert.deepEqual(blocksPackPlugin({}), { collections: [] });
  const plain = { collections: [{ slug: "pages", fields: [{ name: "content", type: "richText" }] }] };
  assert.deepEqual(blocksPackPlugin(plain), plain);
});

test("the field names are the contract the themes build on", () => {
  assert.deepEqual(names(block("gallery").fields), ["heading", "images", "columns"]);
  assert.deepEqual(names(block("gallery").fields[1].fields), ["image", "caption"]);
  assert.deepEqual(names(block("pricing").fields), ["heading", "intro", "plans"]);
  assert.deepEqual(names(block("pricing").fields[2].fields), ["name", "price", "period", "description", "features", "buttonLabel", "buttonHref", "highlighted"]);
  assert.deepEqual(names(block("pricing").fields[2].fields[4].fields), ["text"]);
  assert.deepEqual(names(block("testimonials").fields[1].fields), ["quote", "name", "role", "image"]);
  assert.deepEqual(names(block("timeline").fields[1].fields), ["period", "title", "subtitle", "description"]);
  assert.deepEqual(names(block("team").fields), ["heading", "intro", "members"]);
  assert.deepEqual(names(block("team").fields[2].fields), ["name", "role", "bio", "image"]);
  assert.deepEqual(names(block("cta").fields), ["heading", "text", "buttonLabel", "buttonHref", "secondaryLabel", "secondaryHref"]);
  assert.deepEqual(names(block("hours-contact").fields), ["heading", "hours", "address", "phone", "email", "note"]);
  assert.deepEqual(names(block("hours-contact").fields[1].fields), ["days", "time"]);
  assert.deepEqual(names(block("price-list").fields), ["heading", "intro", "sections"]);
  assert.deepEqual(names(block("price-list").fields[2].fields), ["title", "items"]);
  assert.deepEqual(names(block("price-list").fields[2].fields[1].fields), ["name", "description", "price", "tag"]);
  assert.deepEqual(names(block("schedule").fields), ["heading", "days"]);
  assert.deepEqual(names(block("schedule").fields[1].fields), ["label", "sessions"]);
  assert.deepEqual(names(block("schedule").fields[1].fields[1].fields), ["time", "title", "speaker", "room", "description"]);
  assert.deepEqual(names(block("stats").fields[1].fields), ["value", "label"]);
  assert.deepEqual(names(block("logos").fields[1].fields), ["name", "image", "href"]);
});

test("required fields are exactly the ones the contract names", () => {
  const required = (fields, path = "") =>
    fields.flatMap((f) => [...(f.required ? [path + f.name] : []), ...(f.fields ? required(f.fields, `${path}${f.name}.`) : [])]);
  const byBlock = Object.fromEntries(BLOCKS.map(({ block: b }) => [b.slug, required(b.fields)]));
  assert.deepEqual(byBlock, {
    gallery: ["images.image"],
    pricing: ["plans.name", "plans.price"],
    testimonials: ["items.quote", "items.name"],
    timeline: ["entries.period", "entries.title"],
    team: ["members.name"],
    cta: ["heading", "buttonLabel", "buttonHref"],
    "hours-contact": ["hours.days", "hours.time"],
    "price-list": ["sections.title", "sections.items.name"],
    schedule: ["days.label", "days.sessions.time", "days.sessions.title"],
    stats: ["items.value", "items.label"],
    logos: ["items.name"],
  });
});

test("pictures are relations to the media library and the gallery offers 2, 3 or 4 columns", () => {
  const pictures = [
    block("gallery").fields[1].fields[0],
    block("testimonials").fields[1].fields[3],
    block("team").fields[2].fields[3],
    block("logos").fields[1].fields[1],
  ];
  for (const f of pictures) assert.deepEqual([f.type, f.relationTo], ["upload", "media"]);
  const columns = block("gallery").fields[2];
  assert.equal(columns.type, "select");
  assert.deepEqual(columns.options.map((o) => o.value), ["2", "3", "4"]);
  assert.equal(columns.defaultValue, "3");
  assert.equal(block("pricing").fields[2].fields[7].type, "checkbox");
});

test("every field explains itself in plain words", () => {
  const missing = [];
  const walk = (fields, path) =>
    fields.forEach((f) => {
      if (!f.admin?.description) missing.push(path + f.name);
      if (f.fields) walk(f.fields, `${path}${f.name}.`);
    });
  for (const { block: b } of BLOCKS) walk(b.fields, `${b.slug}.`);
  assert.deepEqual(missing, []);
});

test("words are made translatable through the core's helper, and links, numbers and pictures are not asked about", () => {
  const asked = [];
  const kit = {
    i18n: {
      localizeNamed(fields, wanted) {
        asked.push(wanted);
        return fields.map((f) => (wanted.includes(f.name) ? { ...f, marked: true } : f));
      },
    },
  };
  const out = blocksPackPlugin(coreConfig(), kit);
  const gallery = contentOf(out).blocks.find((b) => b.slug === "gallery");
  assert.deepEqual(gallery.fields.filter((f) => f.marked).map((f) => f.name), ["heading", "images"]);
  assert.equal(gallery.fields.find((f) => f.name === "columns").marked, undefined);
  assert.equal(asked.length, SLUGS.length);
  for (const wanted of asked) for (const name of wanted) assert.ok(!/href|phone|email|columns|image$/i.test(name), `${name} is not a translatable word`);
  const contact = contentOf(out).blocks.find((b) => b.slug === "hours-contact");
  assert.deepEqual(contact.fields.filter((f) => f.marked).map((f) => f.name), ["heading", "hours", "address", "note"]);
});

test("without the core's helper the blocks are still added, just not translatable", () => {
  const out = blocksPackPlugin(coreConfig(), undefined);
  assert.equal(contentOf(out).blocks.length, 1 + SLUGS.length);
});
