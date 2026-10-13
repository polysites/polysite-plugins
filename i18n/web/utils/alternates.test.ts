import { describe, expect, it } from "vitest";

import { alternateLinks, pageLanguages, shouldNoindex, switcherLanguages } from "./alternates";

const setup = { default: "en", languages: ["en", "fr", "de"] };
const address = (code: string) => (code === "en" ? "/about" : `/${code}/about`);

describe("which languages a page really exists in", () => {
  it("is the default plus every language with text, in the site's order", () => {
    expect(pageLanguages(setup, ["fr"])).toEqual(["en", "fr"]);
    expect(pageLanguages(setup, ["de", "fr"])).toEqual(["en", "fr", "de"]);
    expect(pageLanguages(setup, [])).toEqual(["en"]);
  });

  it("ignores languages the site doesn't offer, and says nothing when the page isn't indexed", () => {
    expect(pageLanguages(setup, ["fr", "ja"])).toEqual(["en", "fr"]);
    expect(pageLanguages(setup, null)).toEqual([]);
    expect(pageLanguages(setup, undefined)).toEqual([]);
  });
});

describe("the alternate links", () => {
  it("point at each language and at the default as x-default", () => {
    const links = alternateLinks(setup, ["en", "fr"], "https://example.org", address);
    expect(links).toEqual([
      { rel: "alternate", hreflang: "en", href: "https://example.org/about" },
      { rel: "alternate", hreflang: "fr", href: "https://example.org/fr/about" },
      { rel: "alternate", hreflang: "x-default", href: "https://example.org/about" },
    ]);
  });

  it("are left out when the page has only one language", () => {
    expect(alternateLinks(setup, ["en"], "https://example.org", address)).toEqual([]);
    expect(alternateLinks(setup, [], "https://example.org", address)).toEqual([]);
  });
});

describe("keeping untranslated copies out of search engines", () => {
  it("noindexes a language the page has no text in", () => {
    expect(shouldNoindex(setup, "de", ["fr"])).toBe(true);
    expect(shouldNoindex(setup, "de", [])).toBe(true);
  });

  it("indexes translated pages and the default language, and decides nothing when the page isn't indexed", () => {
    expect(shouldNoindex(setup, "fr", ["fr"])).toBe(false);
    expect(shouldNoindex(setup, "en", [])).toBe(false);
    expect(shouldNoindex(setup, "fr", null)).toBe(false);
  });
});

describe("the language switcher's choices", () => {
  it("offers the languages the page has", () => {
    expect(switcherLanguages(setup, "en", ["fr"])).toEqual(["en", "fr"]);
  });

  it("keeps the language being viewed even when the page isn't translated into it, in site order", () => {
    expect(switcherLanguages(setup, "de", ["fr"])).toEqual(["en", "fr", "de"]);
  });

  it("offers every language when nothing is known about the page", () => {
    expect(switcherLanguages(setup, "en", null)).toEqual(["en", "fr", "de"]);
  });
});
