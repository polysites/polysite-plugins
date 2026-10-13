import { describe, expect, it } from "vitest";

import { lexicalToNodes, safeHref, type RNode } from "./lexical";
import { listHref, matchPostsRoute, sectionOf } from "./postsRoute";
import { buildRss, escapeXml } from "./rss";

describe("matchPostsRoute", () => {
  it("recognises each address under the section", () => {
    expect(matchPostsRoute("news", "news")).toEqual({ kind: "list", page: 1 });
    expect(matchPostsRoute("news/page/2", "news")).toEqual({ kind: "list", page: 2 });
    expect(matchPostsRoute("news/category/policy", "news")).toEqual({ kind: "category", category: "policy", page: 1 });
    expect(matchPostsRoute("news/category/policy/page/3", "news")).toEqual({ kind: "category", category: "policy", page: 3 });
    expect(matchPostsRoute("news/big-announcement", "news")).toEqual({ kind: "post", slug: "big-announcement" });
    expect(matchPostsRoute("/news/big-announcement/", "news")).toEqual({ kind: "post", slug: "big-announcement" });
  });

  it("follows a site's own section address and ignores everything else", () => {
    expect(matchPostsRoute("updates/hello", "updates")).toEqual({ kind: "post", slug: "hello" });
    expect(matchPostsRoute("updates/hello", "news")).toBeNull();
    expect(matchPostsRoute("about-us", "news")).toBeNull();
    expect(matchPostsRoute("newsletter", "news")).toBeNull();
    expect(matchPostsRoute("", "news")).toBeNull();
  });

  it("refuses malformed or duplicate addresses", () => {
    for (const bad of ["news/page", "news/page/1", "news/page/0", "news/page/abc", "news/page/2/extra", "news/category", "news/category/a/page", "news/category/a/page/1", "news/a/b"]) {
      expect(matchPostsRoute(bad, "news"), bad).toBeNull();
    }
  });

  it("builds addresses the matcher accepts, and reads a site's section", () => {
    expect(listHref("news")).toBe("/news");
    expect(listHref("news", 2)).toBe("/news/page/2");
    expect(listHref("news", 2, "policy")).toBe("/news/category/policy/page/2");
    expect(matchPostsRoute(listHref("blog", 4, "x").slice(1), "blog")).toEqual({ kind: "category", category: "x", page: 4 });
    expect(sectionOf(null)).toBe("news");
    expect(sectionOf({ extensions: { news: { path: "/updates/" } } })).toBe("updates");
    expect(sectionOf({ extensions: { news: { path: "" } } })).toBe("news");
  });
});

const text = (value: string, format = 0) => ({ type: "text", text: value, format });
const state = (...children: unknown[]) => ({ root: { type: "root", children } });
const html = (nodes: RNode[]): string =>
  nodes
    .map((n) => (n.text !== undefined ? n.text : `<${n.tag}${Object.entries(n.attrs ?? {}).map(([k, v]) => ` ${k}="${v}"`).join("")}>${html(n.children ?? [])}</${n.tag}>`))
    .join("");

describe("lexicalToNodes", () => {
  it("draws paragraphs, headings, lists, quotes and inline formatting", () => {
    const nodes = lexicalToNodes(
      state(
        { type: "heading", tag: "h2", children: [text("Title")] },
        { type: "paragraph", children: [text("Plain "), text("bold", 1), text(" and "), text("both", 3)] },
        { type: "list", listType: "bullet", children: [{ type: "listitem", children: [text("one")] }, { type: "listitem", children: [text("two")] }] },
        { type: "list", listType: "number", children: [{ type: "listitem", children: [text("first")] }] },
        { type: "quote", children: [text("said")] },
        { type: "horizontalrule" },
      ),
    );
    expect(html(nodes)).toBe(
      "<h2>Title</h2><p>Plain <strong>bold</strong> and <em><strong>both</strong></em></p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><blockquote>said</blockquote><hr></hr>",
    );
  });

  it("never turns an editor's text into markup", () => {
    const nodes = lexicalToNodes(state({ type: "paragraph", children: [text('<script>alert(1)</script><img src=x onerror="y">')] }));
    // It stays one text node; Vue escapes it when drawing.
    expect(nodes).toEqual([{ tag: "p", attrs: undefined, children: [{ text: '<script>alert(1)</script><img src=x onerror="y">' }] }]);
  });

  it("keeps safe links and drops dangerous ones, keeping their words", () => {
    const link = (url: string, extra = {}) => ({ type: "link", fields: { url, ...extra }, children: [text("go")] });
    expect(html(lexicalToNodes(state({ type: "paragraph", children: [link("https://example.org/a")] })))).toBe('<p><a href="https://example.org/a">go</a></p>');
    expect(html(lexicalToNodes(state({ type: "paragraph", children: [link("/contact")] })))).toBe('<p><a href="/contact">go</a></p>');
    expect(html(lexicalToNodes(state({ type: "paragraph", children: [link("https://x.org", { newTab: true })] })))).toContain('target="_blank" rel="noopener noreferrer"');
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.example", " vbscript:x"]) {
      expect(html(lexicalToNodes(state({ type: "paragraph", children: [link(bad)] }))), bad).toBe("<p>go</p>");
    }
    expect(safeHref("mailto:a@example.org")).toBe("mailto:a@example.org");
    expect(safeHref(5)).toBeNull();
  });

  it("draws an uploaded picture only when it has a safe address", () => {
    const upload = (value: unknown) => state({ type: "upload", value });
    expect(html(lexicalToNodes(upload({ url: "/api/media/file/a.webp", alt: "A <b>photo</b>", width: 800, height: 600 })))).toBe(
      '<figure><img src="/api/media/file/a.webp" alt="A <b>photo</b>" loading="lazy" width="800" height="600"></img></figure>',
    );
    expect(lexicalToNodes(upload({ url: "javascript:alert(1)" }))).toEqual([]);
    expect(lexicalToNodes(upload(7))).toEqual([]);
  });

  it("limits alignment to known values, skips empty paragraphs and unknown parts, and survives junk", () => {
    expect(html(lexicalToNodes(state({ type: "paragraph", format: "center", children: [text("hi")] })))).toBe('<p style="text-align:center">hi</p>');
    expect(html(lexicalToNodes(state({ type: "paragraph", format: "url(javascript:x)", children: [text("hi")] })))).toBe("<p>hi</p>");
    expect(lexicalToNodes(state({ type: "paragraph", children: [] }))).toEqual([]);
    expect(html(lexicalToNodes(state({ type: "block", children: [{ type: "paragraph", children: [text("kept")] }] })))).toBe("<p>kept</p>");
    for (const junk of [null, undefined, 5, "x", {}, { root: null }, { root: { children: "no" } }]) expect(lexicalToNodes(junk)).toEqual([]);
  });
});

describe("RSS", () => {
  it("escapes everything an editor typed", () => {
    expect(escapeXml(`a & b <c> "d" 'e'\u0001`)).toBe("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;");
  });

  it("builds a feed with the items in order, and can't be broken out of by a title", () => {
    const xml = buildRss(
      {
        title: "News <Site>",
        link: "https://example.org/news",
        description: "Latest",
        items: [
          { title: "Hello </title><evil/>", link: "https://example.org/news/hello?a=1&b=2", date: "2026-09-28T00:00:00.000Z", summary: "Sum", author: "Alex", categories: ["Policy"] },
          { title: "Second", link: "https://example.org/news/second", date: "2026-09-25T00:00:00.000Z" },
        ],
      },
      "https://example.org/feed.xml",
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<title>News &lt;Site&gt;</title>");
    expect(xml).toContain("<title>Hello &lt;/title&gt;&lt;evil/&gt;</title>");
    expect(xml).not.toContain("<evil/>");
    expect(xml).toContain("https://example.org/news/hello?a=1&amp;b=2");
    expect(xml).toContain("<pubDate>Mon, 28 Sep 2026 00:00:00 GMT</pubDate>");
    expect(xml).toContain("<dc:creator>Alex</dc:creator>");
    expect(xml).toContain("<category>Policy</category>");
    expect(xml.indexOf("Hello")).toBeLessThan(xml.indexOf("Second"));
    expect(xml.endsWith("</channel></rss>")).toBe(true);
  });
});
