import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BLOCK_SLUGS } from "../../src/blocks.js";
import { BLOCK_NAMES } from "./blockNames";

const here = path.dirname(fileURLToPath(import.meta.url));
// The core's own blocks: a plugin must not take over one of their names or slugs.
const CORE_SLUGS = ["hero", "textBlock", "faqAccordion", "featureGrid", "formEmbed", "signupForm", "leaderSpotlight", "donationTiers", "commitmentsGrid"];

describe("the blocks the web part draws", () => {
  it("are exactly the blocks the CMS part adds", () => {
    expect(Object.keys(BLOCK_NAMES).sort()).toEqual([...BLOCK_SLUGS].sort());
  });

  it("each have a plain component file named as a theme would override it", () => {
    for (const name of Object.values(BLOCK_NAMES)) {
      expect(name).toMatch(/^[A-Z][A-Za-z]+Block$/);
      expect(fs.existsSync(path.join(here, "..", "components", "blocks-pack", `${name}.vue`)), name).toBe(true);
    }
  });

  it("do not clash with the core's blocks", () => {
    for (const slug of Object.keys(BLOCK_NAMES)) expect(CORE_SLUGS, slug).not.toContain(slug);
    for (const name of Object.values(BLOCK_NAMES)) expect(CORE_SLUGS.map((s) => `${s[0]!.toUpperCase()}${s.slice(1)}Block`), name).not.toContain(name);
  });

  it("have a fixed word dictionary in every language the plugin ships, with the same keys", () => {
    const books = ["fr", "es", "de"].map((code) => JSON.parse(fs.readFileSync(path.join(here, "..", "locales", `${code}.json`), "utf-8")) as Record<string, string>);
    const keys = Object.keys(books[0]!).sort();
    for (const book of books) expect(Object.keys(book).sort()).toEqual(keys);
    for (const book of books) for (const value of Object.values(book)) expect(value.trim()).not.toBe("");
  });
});
