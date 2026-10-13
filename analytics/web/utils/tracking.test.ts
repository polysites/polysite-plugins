import { describe, expect, it } from "vitest";

import { defaultNotice, needsAnswer, plan, privacySignalOn, validTools } from "./tracking";

const GA = { tool: "ga4", toolId: "G-ABC123XYZ9" };
const META = { tool: "meta", toolId: "1234567890123456" };
const PLAUSIBLE = { tool: "plausible", toolId: "example.org" };
const opts = { signalOn: false, respectSignals: true, consent: {} };

describe("validTools", () => {
  it("accepts each tool's real identifier", () => {
    const tools = validTools([
      GA,
      { tool: "gtm", toolId: "GTM-ABC1234" },
      META,
      { tool: "tiktok", toolId: "C4A1B2C3D4E5F6G7H8I9" },
      { tool: "linkedin", toolId: "123456", conversionId: "9876543" },
      { tool: "x", toolId: "o1abc", conversionId: "tw-o1abc-o1abd" },
      PLAUSIBLE,
      { tool: "umami", toolId: "123e4567-e89b-12d3-a456-426614174000" },
    ]);
    expect(tools.map((t) => t.tool)).toEqual(["ga4", "gtm", "meta", "tiktok", "linkedin", "x", "plausible", "umami"]);
    expect(tools.find((t) => t.tool === "linkedin")?.conversionId).toBe("9876543");
  });

  it("drops anything switched off, unknown, malformed or carrying markup", () => {
    expect(validTools(null)).toEqual([]);
    expect(validTools([{ ...GA, enabled: false }])).toEqual([]);
    expect(validTools([{ tool: "mixpanel", toolId: "x" }])).toEqual([]);
    expect(validTools([{ tool: "plausible", toolId: 'x.org"><script>' }])).toEqual([]);
    expect(validTools([{ tool: "ga4", toolId: "G-AB');alert(1)" }])).toEqual([]);
    expect(validTools([{ tool: "meta", toolId: "12abc" }])).toEqual([]);
  });

  it("takes a self-hosted address only as a bare https origin", () => {
    expect(validTools([{ ...PLAUSIBLE, scriptHost: "https://stats.example.org" }])[0]?.host).toBe("https://stats.example.org");
    expect(validTools([{ ...PLAUSIBLE, scriptHost: "http://stats.example.org" }])).toEqual([]);
    expect(validTools([{ ...PLAUSIBLE, scriptHost: "https://stats.example.org/evil.js" }])).toEqual([]);
    expect(validTools([{ ...PLAUSIBLE }])[0]?.host).toBe("https://plausible.io");
  });

  it("ignores a conversion id that doesn't fit, and a stray host on Google", () => {
    expect(validTools([{ tool: "linkedin", toolId: "123456", conversionId: "abc" }])[0]?.conversionId).toBe("");
    expect(validTools([{ ...GA, scriptHost: "https://evil.example" }])[0]?.host).toBe("");
  });

  it("lets a tag manager or custom script choose its group, defaulting to marketing", () => {
    expect(validTools([{ tool: "gtm", toolId: "GTM-ABC1234" }])[0]?.category).toBe("marketing");
    expect(validTools([{ tool: "gtm", toolId: "GTM-ABC1234", category: "analytics" }])[0]?.category).toBe("analytics");
    expect(validTools([{ ...META, category: "essential" }])[0]?.category).toBe("marketing");
  });

  it("keeps a custom script's code and placement, and drops an empty or huge one", () => {
    const [t] = validTools([{ tool: "custom", name: "Chat", code: "  <script>1</script> ", placement: "body", category: "essential" }]);
    expect(t).toMatchObject({ label: "Chat", code: "<script>1</script>", placement: "body", category: "essential" });
    expect(validTools([{ tool: "custom", name: "Empty", code: "   " }])).toEqual([]);
    expect(validTools([{ tool: "custom", name: "Big", code: "x".repeat(20001) }])).toEqual([]);
  });
});

describe("plan", () => {
  const tools = validTools([GA, META, PLAUSIBLE, { tool: "custom", name: "Chat", code: "1", category: "essential" }]);

  it("loads essential and cookieless analytics at once, and asks about the rest", () => {
    const p = plan(tools, opts);
    expect(p.load.map((t) => t.tool)).toEqual(["plausible", "custom"]);
    expect(p.ask.sort()).toEqual(["analytics", "marketing"]);
  });

  it("loads only the groups the visitor accepted, and doesn't ask again about answered ones", () => {
    const p = plan(tools, { ...opts, consent: { analytics: true, marketing: false } });
    expect(p.load.map((t) => t.tool)).toEqual(["ga4", "plausible", "custom"]);
    expect(p.ask).toEqual([]);
  });

  it("asks only about a group added later", () => {
    expect(plan(tools, { ...opts, consent: { analytics: true } }).ask).toEqual(["marketing"]);
  });

  it("gives no analytics or marketing, and asks nothing, when the browser signals no tracking", () => {
    const p = plan(tools, { ...opts, signalOn: true, consent: { analytics: true, marketing: true } });
    expect(p.load.map((t) => t.tool)).toEqual(["custom"]);
    expect(p.ask).toEqual([]);
    expect(p.groups).toEqual([]);
  });

  it("ignores the signal when the site turned that respect off", () => {
    expect(plan(tools, { ...opts, signalOn: true, respectSignals: false }).load.map((t) => t.tool)).toEqual(["plausible", "custom"]);
  });

  it("asks before a cookieless tool when the site chose to", () => {
    const asked = validTools([{ ...PLAUSIBLE, askFirst: true }]);
    expect(needsAnswer(asked[0]!)).toBe(true);
    expect(plan(asked, opts).ask).toEqual(["analytics"]);
  });
});

describe("privacySignalOn and defaultNotice", () => {
  it("reads either browser signal", () => {
    expect(privacySignalOn({ doNotTrack: "1" })).toBe(true);
    expect(privacySignalOn({ globalPrivacyControl: true })).toBe(true);
    expect(privacySignalOn({ doNotTrack: "0" })).toBe(false);
    expect(privacySignalOn(undefined)).toBe(false);
  });

  it("names the tools being asked about", () => {
    const tools = validTools([GA, META]);
    expect(defaultNotice(tools, ["analytics", "marketing"])).toContain("Google Analytics 4, Meta (Facebook) Pixel");
    expect(defaultNotice(tools, ["marketing"])).toContain("marketing tools");
  });
});
