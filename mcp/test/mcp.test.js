import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFormData } from "../src/forms.js";
import { markdownToLexical } from "../src/markdown.js";
import { convertRichText, describeBlocks, prepareBlocks } from "../src/schema.js";

const pages = {
  fields: [
    {
      type: "blocks",
      name: "content",
      blocks: [
        { slug: "hero", labels: { singular: "Hero" }, fields: [{ name: "heading", type: "text", required: true }, { name: "subheading", type: "text" }] },
        { slug: "textBlock", fields: [{ name: "body", type: "richText" }, { name: "bodyHTML", type: "text", virtual: true }] },
      ],
    },
  ],
};

test("markdown: headings, lists, emphasis, links", () => {
  const { root } = markdownToLexical("## Title\n\nHello **bold** and *it*.\n\n- a\n- b\n\n1. one\n2. two\n\n[ok](https://x.org) [bad](javascript:alert(1))");
  assert.deepEqual(root.children.map((c) => c.type), ["heading", "paragraph", "list", "list", "paragraph"]);
  assert.equal(root.children[0].tag, "h2");
  assert.equal(root.children[2].listType, "bullet");
  assert.equal(root.children[3].listType, "number");
  const para = root.children[1].children;
  assert.equal(para[1].format, 1);
  assert.equal(para[3].format, 2);
  const links = root.children[4].children.filter((n) => n.type === "link");
  assert.equal(links.length, 1);
  assert.equal(links[0].fields.url, "https://x.org");
});

test("markdown: empty input still gives a valid document", () => {
  assert.equal(markdownToLexical("").root.children.length, 1);
});

test("describeBlocks hides virtual fields and flags rich text", () => {
  const described = describeBlocks(pages);
  assert.deepEqual(described[1].fields.map((f) => f.name), ["body"]);
  assert.match(described[1].fields[0].note, /Markdown/);
});

test("prepareBlocks converts rich text and rejects unknown blocks and fields", () => {
  const [hero, text] = prepareBlocks(pages, [{ blockType: "hero", heading: "Hi" }, { blockType: "textBlock", body: "Some **text**" }]);
  assert.equal(hero.heading, "Hi");
  assert.equal(text.body.root.type, "root");
  assert.throws(() => prepareBlocks(pages, [{ blockType: "carousel" }]), /unknown blockType/);
  assert.throws(() => prepareBlocks(pages, [{ blockType: "hero", headline: "x" }]), /unknown field/);
});

test("convertRichText reaches into arrays and groups", () => {
  const fields = [{ name: "items", type: "array", fields: [{ name: "answer", type: "richText" }] }];
  const out = convertRichText(fields, { items: [{ answer: "Yes" }] });
  assert.equal(out.items[0].answer.root.type, "root");
});

test("buildFormData builds fields, unique names, select options and a confirmation", () => {
  const data = buildFormData({
    title: "Contact",
    fields: [{ label: "Name", required: true }, { label: "Name" }, { label: "Topic", type: "select", options: ["Press", "General"] }],
    confirmation: "Thanks!",
  });
  assert.deepEqual(data.fields.map((f) => f.name), ["name", "name_2", "topic"]);
  assert.equal(data.fields[2].options[0].value, "press");
  assert.equal(data.confirmationType, "message");
  assert.equal(data.confirmationMessage.root.type, "root");
});

test("buildFormData refuses bad input with a clear message", () => {
  assert.throws(() => buildFormData({ title: "x", fields: [] }), /at least one field/);
  assert.throws(() => buildFormData({ title: "x", fields: [{ label: "A", type: "select" }] }), /options are required/);
  assert.throws(() => buildFormData({ title: "x", fields: [{ label: "A", type: "date" }] }, ["text"]), /not available/);
});
