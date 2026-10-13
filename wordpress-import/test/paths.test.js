import assert from "node:assert/strict";
import { test } from "node:test";

import { freeSlug, isoDate, leafSlug, normalizeSlug, oldPathOf, pagePath, redirectFor, siteHostOf, slugify } from "../src/paths.js";

test("slugs follow the core's rules", () => {
  assert.equal(normalizeSlug("/About Us/"), "about-us");
  assert.equal(normalizeSlug("a/b c/d"), "a/b-c/d");
  assert.equal(normalizeSlug("/"), "/");
  assert.equal(slugify("Café Déjà Vu & Co."), "cafe-deja-vu-and-co");
  assert.equal(slugify("%d0%bf"), "");
});

test("a leaf slug falls back to the title, then to the id", () => {
  assert.equal(leafSlug({ slug: "Hello-World", title: "x", id: 1 }), "hello-world");
  assert.equal(leafSlug({ slug: "", title: "Spring Day!", id: 1 }), "spring-day");
  assert.equal(leafSlug({ slug: "%d0%bf%d1%80", title: "Привет", id: 9 }), "wp-9");
});

test("a child page's address includes its parents, loops stop", () => {
  const a = { id: 1, slug: "about", parent: 0 };
  const b = { id: 2, slug: "team", parent: 1 };
  const c = { id: 3, slug: "board", parent: 2 };
  const byId = new Map([a, b, c].map((p) => [p.id, p]));
  assert.equal(pagePath(c, byId), "about/team/board");
  assert.equal(pagePath(a, byId), "about");
  const x = { id: 10, slug: "x", parent: 11 };
  const y = { id: 11, slug: "y", parent: 10 };
  assert.equal(pagePath(x, new Map([x, y].map((p) => [p.id, p]))), "y/x");
  assert.equal(pagePath({ id: 5, slug: "orphan", parent: 99 }, byId), "orphan");
});

test("the old path comes from the old address; query-style addresses have none", () => {
  assert.equal(oldPathOf("https://old.example/2024/03/Spring-Day/"), "2024/03/spring-day");
  assert.equal(oldPathOf("https://old.example/"), null);
  assert.equal(oldPathOf("https://old.example/?p=24"), null);
  assert.equal(oldPathOf("https://old.example/?page_id=13&preview=true"), null);
  assert.equal(oldPathOf("https://other.example/x/", { siteHost: "old.example" }), null);
  assert.equal(oldPathOf("not a url"), null);
});

test("a redirect is made only when the address changes", () => {
  assert.deepEqual(redirectFor("2024/03/spring-day", "news/spring-day"), { fromPath: "2024/03/spring-day", toPath: "news/spring-day" });
  assert.equal(redirectFor("about-us", "about-us"), null);
  assert.equal(redirectFor("About-Us/", "about-us"), null);
  assert.equal(redirectFor(null, "x"), null);
  assert.equal(redirectFor("", "x"), null);
});

test("dates: GMT first, then the feed date, never the zero date", () => {
  assert.equal(isoDate({ dateGmt: "2024-03-08 14:30:00" }), "2024-03-08T14:30:00.000Z");
  assert.equal(isoDate({ dateGmt: "0000-00-00 00:00:00", pubDate: "Fri, 08 Mar 2024 14:30:00 +0000" }), "2024-03-08T14:30:00.000Z");
  assert.equal(isoDate({ dateGmt: "0000-00-00 00:00:00", date: "2024-03-13 10:00:00" }), "2024-03-13T10:00:00.000Z");
  assert.equal(isoDate({ dateGmt: "0000-00-00 00:00:00", date: "0000-00-00 00:00:00" }), null);
  assert.equal(isoDate({}), null);
});

test("the site host comes from the export's addresses", () => {
  assert.equal(siteHostOf({ baseSiteUrl: "https://Garden.Example/blog" }), "garden.example");
  assert.equal(siteHostOf({ link: "http://x.example" }), "x.example");
  assert.equal(siteHostOf({}), "");
});

test("a free slug adds a number", () => {
  assert.equal(freeSlug("a", new Set()), "a");
  assert.equal(freeSlug("a", new Set(["a", "a-2"])), "a-3");
});
