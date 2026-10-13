import assert from "node:assert/strict";
import { test } from "node:test";

import { autop, cleanHref, convertHtml, detectPageBuilder, htmlToText, imageKey } from "../src/html.js";

const kids = (lexical) => lexical.root.children;
const textOf = (n) => (n.text !== undefined ? n.text : (n.children ?? []).map(textOf).join(""));
const types = (lexical) => kids(lexical).map((n) => n.type);

test("paragraphs, headings and inline formats become Lexical nodes", () => {
  const { lexical } = convertHtml("<h2>Title</h2><p>One <strong>bold</strong> and <em>italic</em>, <u>under</u>.</p>");
  assert.deepEqual(types(lexical), ["heading", "paragraph"]);
  assert.equal(kids(lexical)[0].tag, "h2");
  const p = kids(lexical)[1];
  assert.deepEqual(p.children.map((c) => [c.text, c.format]), [["One ", 0], ["bold", 1], [" and ", 0], ["italic", 2], [", ", 0], ["under", 8], [".", 0]]);
});

test("the root has the shape the editor stores", () => {
  const { lexical } = convertHtml("<p>x</p>");
  assert.equal(lexical.root.type, "root");
  assert.equal(lexical.root.version, 1);
  assert.equal(kids(lexical)[0].textFormat, 0);
});

test("classic-editor text without <p> tags gets paragraphs from blank lines and breaks from single newlines", () => {
  assert.equal(autop("One\nstill one\n\nTwo"), "<p>One<br>\nstill one</p>\n<p>Two</p>");
  const { lexical } = convertHtml("One\nstill one\n\nTwo");
  assert.deepEqual(types(lexical), ["paragraph", "paragraph"]);
  assert.deepEqual(kids(lexical)[0].children.map((c) => c.type), ["text", "linebreak", "text"]);
  assert.equal(autop("<p>already</p>"), "<p>already</p>");
});

test("lists, nested lists and ordered lists", () => {
  const { lexical } = convertHtml("<ul><li>A</li><li>B<ul><li>B1</li></ul></li></ul><ol><li>One</li></ol>");
  const [ul, ol] = kids(lexical);
  assert.equal(ul.listType, "bullet");
  assert.equal(ul.tag, "ul");
  assert.equal(ul.children.length, 3);
  assert.equal(textOf(ul.children[1]), "B");
  assert.equal(ul.children[2].children[0].type, "list");
  assert.equal(ol.listType, "number");
  assert.equal(ol.children[0].value, 1);
});

test("a block quote keeps its text and a rule becomes a horizontal rule", () => {
  const { lexical } = convertHtml("<blockquote><p>Wise words.</p><p>More.</p></blockquote><hr>");
  assert.deepEqual(types(lexical), ["quote", "horizontalrule"]);
  assert.equal(textOf(kids(lexical)[0]), "Wise words.More.");
});

test("scripts, styles, forms and event handlers are removed and reported; text around them stays", () => {
  const { lexical, report } = convertHtml('<p onclick="x()" style="color:red">Hello</p><script>alert(1)</script><style>p{}</style><form><input name="a"><button>Go</button></form><object data="x"></object>');
  assert.deepEqual(types(lexical), ["paragraph"]);
  assert.equal(JSON.stringify(lexical).includes("alert"), false);
  assert.equal(JSON.stringify(lexical).includes("onclick"), false);
  const codes = report.entries().map((e) => e.code);
  for (const c of ["script", "style", "form", "embed"]) assert.ok(codes.includes(c), c);
});

test("links: safe addresses stay, javascript: and data: do not, and the text is kept", () => {
  const { lexical, report } = convertHtml('<p><a href="https://a.example/x">ok</a> <a href="javascript:alert(1)">bad</a> <a href="  JaVa\tScript:x">worse</a> <a href="data:text/html,x">data</a> <a href="mailto:a@b.example">mail</a> <a href="/about">rel</a></p>');
  const links = kids(lexical)[0].children.filter((c) => c.type === "link");
  assert.deepEqual(links.map((l) => l.fields.url), ["https://a.example/x", "mailto:a@b.example", "/about"]);
  assert.equal(textOf(kids(lexical)[0]), "ok bad worse data mail rel");
  assert.equal(report.entries().find((e) => e.code === "unsafe-link").count, 3);
  assert.equal(cleanHref("//cdn.example/x"), "https://cdn.example/x");
  assert.equal(cleanHref("page.html"), null);
  assert.equal(cleanHref("page.html", "https://old.example/blog/"), "https://old.example/blog/page.html");
});

test("a link can be rewritten, and bold text inside one stays in one link", () => {
  const { lexical } = convertHtml('<p><a href="https://old.example/about/">go <b>now</b></a></p>', { rewriteLink: (h) => (h.startsWith("https://old.example/about") ? "/about-us" : undefined) });
  const link = kids(lexical)[0].children[0];
  assert.equal(link.fields.url, "/about-us");
  assert.deepEqual(link.children.map((c) => [c.text, c.format]), [["go ", 0], ["now", 1]]);
});

test("an imported image becomes an upload; one that was not imported becomes a link to the original", () => {
  const images = new Map([[imageKey("https://old.example/wp-content/uploads/a.jpg"), { id: 7 }]]);
  const { lexical, report } = convertHtml('<p>Before <img src="https://old.example/wp-content/uploads/a-300x200.jpg" alt="A"> after</p><p><img src="https://other.example/b.png" alt="B"></p>', { images });
  assert.deepEqual(types(lexical), ["paragraph", "upload", "paragraph", "paragraph"]);
  const up = kids(lexical)[1];
  assert.equal(up.relationTo, "media");
  assert.equal(up.value, 7);
  assert.equal(up.version, 3);
  assert.equal(kids(lexical)[3].children[0].fields.url, "https://other.example/b.png");
  assert.equal(report.entries().find((e) => e.code === "image-link").count, 1);
});

test("the images in a body are listed once each, with their alt text, for downloading", () => {
  const { images } = convertHtml('<img src="https://o.example/a.jpg" alt="A"><img src="https://o.example/a.jpg"><img data-src="https://o.example/lazy.jpg" src="data:image/gif;base64,AAA"><img src="data:image/png;base64,AAA">');
  assert.deepEqual(images.map((i) => i.src), ["https://o.example/a.jpg", "https://o.example/lazy.jpg"]);
  assert.equal(images[0].alt, "A");
});

test("imageKey ignores size suffixes, scheme, case and queries", () => {
  assert.equal(imageKey("http://Old.Example/wp-content/uploads/a-1024x768.jpg?x=1"), imageKey("https://old.example/wp-content/uploads/a.jpg"));
  assert.equal(imageKey("https://o.example/a-scaled.jpg"), "o.example/a.jpg");
});

test("iframes become links, tables become one line per row, both reported", () => {
  const { lexical, report } = convertHtml('<iframe src="https://video.example/e/1"></iframe><table><thead><tr><th>Time</th><th>Job</th></tr></thead><tbody><tr><td>9:00</td><td>Dig</td></tr></tbody></table>');
  assert.equal(kids(lexical)[0].children[0].fields.url, "https://video.example/e/1");
  assert.equal(textOf(kids(lexical)[1]), "Time | Job");
  assert.equal(textOf(kids(lexical)[2]), "9:00 | Dig");
  const codes = report.entries().map((e) => e.code);
  assert.ok(codes.includes("iframe") && codes.includes("table"));
});

test("shortcodes: captions keep their image and text, galleries become images, others are dropped and counted, plain brackets stay", () => {
  const attachments = new Map([[40, { url: "https://old.example/a.png", alt: "A" }], [41, { url: "https://old.example/b.png", alt: "B" }]]);
  const { lexical, report, images } = convertHtml('[caption id="x" caption="Garden view"]<img src="https://old.example/c.png" alt="C">[/caption]\n\n[gallery ids="40,41"]\n\nSee [1] and [sic]. [contact-form-7 id="5"] [vc_row][vc_column_text]Kept text[/vc_column_text][/vc_row]', { attachmentsById: attachments });
  const text = JSON.stringify(lexical);
  assert.ok(text.includes("Garden view"));
  assert.ok(text.includes("Kept text"));
  assert.ok(text.includes("[1]") && text.includes("[sic]"));
  assert.equal(text.includes("contact-form-7"), false);
  assert.deepEqual(images.map((i) => i.src), ["https://old.example/c.png", "https://old.example/a.png", "https://old.example/b.png"]);
  const codes = report.entries().map((e) => e.code);
  assert.ok(codes.includes("shortcode:contact-form-7"));
  assert.ok(codes.includes("shortcode:vc_row"));
  assert.ok(codes.includes("gallery"));
});

test("block-editor comments are ignored; blocks that save no markup are reported", () => {
  const { lexical, report } = convertHtml("<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph --><!-- wp:latest-posts /--><!-- wp:more /-->");
  assert.deepEqual(types(lexical), ["paragraph"]);
  assert.deepEqual(report.entries().map((e) => e.code), ["dynamic-block:latest-posts"]);
});

test("page builders are recognised from their markers", () => {
  assert.equal(detectPageBuilder({ meta: { _elementor_data: "[]" } }), "Elementor");
  assert.equal(detectPageBuilder({ html: '<div class="elementor-section">' }), "Elementor");
  assert.equal(detectPageBuilder({ meta: { _et_pb_use_builder: "on" } }), "Divi");
  assert.equal(detectPageBuilder({ html: "[vc_row]x[/vc_row]" }), "WPBakery");
  assert.equal(detectPageBuilder({ html: "<p>plain</p>" }), null);
});

test("an empty or markup-only body comes out empty", () => {
  assert.equal(convertHtml("").empty, true);
  assert.equal(convertHtml("<div> <span></span> </div><script>x</script>").empty, true);
  assert.equal(convertHtml("<p>&nbsp;</p>").empty, true);
});

test("htmlToText gives plain text for excerpts", () => {
  assert.equal(htmlToText("<p>Fish &amp; <b>chips</b></p>\n<p>tonight</p>"), "Fish & chips tonight");
});

test("preformatted text keeps its lines", () => {
  const { lexical } = convertHtml("<pre>line one\n  line two</pre>");
  assert.equal(textOf(kids(lexical)[0]), "line one  line two");
  assert.deepEqual(kids(lexical)[0].children.map((c) => c.type), ["text", "linebreak", "text"]);
});

test("a very large body converts without trouble", () => {
  const html = Array.from({ length: 20000 }, (_, i) => `<p>Paragraph ${i} with <a href="https://x.example/${i}">a link</a>.</p>`).join("\n");
  const { lexical } = convertHtml(html);
  assert.equal(kids(lexical).length, 20000);
});
