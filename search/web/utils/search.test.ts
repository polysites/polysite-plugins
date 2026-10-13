import { describe, expect, it } from "vitest";

import { highlight, isSearchPath, pageFrom, queryFrom, resultHref, resultsQuery, searchEnabled, termsOf, typeFallback } from "./search";

describe("search on a site", () => {
  it("is on only when the site says so", () => {
    expect(searchEnabled({ extensions: { search: { enabled: true } } })).toBe(true);
    for (const site of [null, undefined, {}, { search: null }, { extensions: { search: { enabled: false } } }, { extensions: { search: { enabled: null } } }]) expect(searchEnabled(site)).toBe(false);
  });

  it("owns the address /search and nothing under it", () => {
    expect(isSearchPath("search")).toBe(true);
    expect(isSearchPath("/search/")).toBe(true);
    for (const slug of ["", "searching", "search/results", "news/search", "about"]) expect(isSearchPath(slug)).toBe(false);
  });
});

describe("the words and page in the address", () => {
  it("takes the first value, collapses whitespace and bounds the length", () => {
    expect(queryFrom("  budget   plan ")).toBe("budget plan");
    expect(queryFrom(["one", "two"])).toBe("one");
    expect(queryFrom(undefined)).toBe("");
    expect(queryFrom("x".repeat(500))).toHaveLength(100);
  });

  it("reads a page number, and anything else is page 1", () => {
    expect(pageFrom("3")).toBe(3);
    for (const bad of [undefined, "0", "-1", "two", ["x"]]) expect(pageFrom(bad)).toBe(1);
  });

  it("builds the results address, leaving out page 1 and encoding what was typed", () => {
    expect(resultsQuery("budget")).toBe("?q=budget");
    expect(resultsQuery("a&b c", 2)).toBe("?q=a%26b+c&page=2");
  });
});

describe("a result's link", () => {
  it("is the item's address with one leading slash; the home page is /", () => {
    expect(resultHref("about")).toBe("/about");
    expect(resultHref("/about")).toBe("/about");
    expect(resultHref("news/budget-day")).toBe("/news/budget-day");
    expect(resultHref("/")).toBe("/");
    expect(resultHref("")).toBe("/");
  });
});

describe("marking the words found", () => {
  it("splits into plain and marked pieces, ignoring case", () => {
    expect(highlight("The Budget plan", ["budget"])).toEqual([
      { text: "The ", hit: false },
      { text: "Budget", hit: true },
      { text: " plan", hit: false },
    ]);
  });

  it("marks every word, and the longer one first", () => {
    const parts = highlight("budgeting for the budget", ["budget", "budgeting"]);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["budgeting", "budget"]);
  });

  it("treats what was typed as text, never as a pattern or markup", () => {
    expect(highlight("a.b (c) <b>", [".", "(c)"]).filter((p) => p.hit).map((p) => p.text)).toEqual([".", "(c)"]);
    expect(highlight("<b>x</b>", ["x"]).map((p) => p.text).join("")).toBe("<b>x</b>");
    expect(highlight("plain", [])).toEqual([{ text: "plain", hit: false }]);
    expect(highlight("", ["a"])).toEqual([]);
  });

  it("splits a search into its distinct words", () => {
    expect(termsOf("budget  plan budget")).toEqual(["budget", "plan"]);
    expect(termsOf("")).toEqual([]);
  });

  it("names a kind of item when no dictionary does", () => {
    expect(typeFallback("page")).toBe("Page");
    expect(typeFallback("event-listing")).toBe("Event listing");
    expect(typeFallback("")).toBe("");
  });
});
