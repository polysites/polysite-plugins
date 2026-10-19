import { describe, expect, it } from "vitest";

import { availabilityText, canRegister, eventJsonLd, formatEventDay, formatEventShortDate, formatEventTimes, safeRedirect } from "./eventFormat";
import { eventHref, listHref, matchEventsRoute, sectionOf } from "./eventsRoute";
import { eventLexicalToNodes, eventSafeHref } from "./eventLexical";

describe("which events screen an address belongs to", () => {
  it("knows the list, its pages, past events and one event", () => {
    expect(matchEventsRoute("events", "events")).toEqual({ kind: "list", page: 1, past: false });
    expect(matchEventsRoute("events/page/2", "events")).toEqual({ kind: "list", page: 2, past: false });
    expect(matchEventsRoute("events/past", "events")).toEqual({ kind: "list", page: 1, past: true });
    expect(matchEventsRoute("events/past/page/3", "events")).toEqual({ kind: "list", page: 3, past: true });
    expect(matchEventsRoute("events/spring-rally", "events")).toEqual({ kind: "event", slug: "spring-rally" });
    expect(matchEventsRoute("events/cancel", "events")).toEqual({ kind: "cancel" });
  });

  it("does not claim addresses that are not its own", () => {
    expect(matchEventsRoute("about", "events")).toBeNull();
    expect(matchEventsRoute("events/a/b", "events")).toBeNull();
    expect(matchEventsRoute("events/page", "events")).toBeNull();
    expect(matchEventsRoute("events/page/1", "events")).toBeNull();
    expect(matchEventsRoute("events/page/0", "events")).toBeNull();
    expect(matchEventsRoute("events/page/x", "events")).toBeNull();
    expect(matchEventsRoute("events/cancel/extra", "events")).toBeNull();
    expect(matchEventsRoute("events/past/other", "events")).toBeNull();
  });

  it("follows the site's own section address", () => {
    expect(sectionOf(undefined)).toBe("events");
    expect(sectionOf({ extensions: { events: { path: "/whats-on/" } } })).toBe("whats-on");
    expect(matchEventsRoute("whats-on/spring-rally", "whats-on")).toEqual({ kind: "event", slug: "spring-rally" });
    expect(matchEventsRoute("events/spring-rally", "whats-on")).toBeNull();
  });

  it("builds the addresses it matches", () => {
    expect(listHref("events")).toBe("/events");
    expect(listHref("events", 2)).toBe("/events/page/2");
    expect(listHref("events", 1, true)).toBe("/events/past");
    expect(listHref("events", 3, true)).toBe("/events/past/page/3");
    expect(eventHref("events", "spring-rally")).toBe("/events/spring-rally");
  });
});

describe("how an event's time is written", () => {
  it("uses the event's own time zone, not the reader's", () => {
    expect(formatEventDay("2026-11-14T23:30:00Z", "America/Toronto")).toBe("Saturday, November 14, 2026");
    expect(formatEventDay("2026-11-15T03:00:00Z", "America/Toronto")).toBe("Saturday, November 14, 2026");
    expect(formatEventDay("2026-11-15T03:00:00Z", "UTC")).toBe("Sunday, November 15, 2026");
  });

  it("gives a range, with the zone once, and a date on the end when it is another day", () => {
    expect(formatEventTimes("2026-11-14T23:30:00Z", "2026-11-15T01:30:00Z", "America/Toronto")).toMatch(/^6:30\s?p\.?m\.? – 8:30\s?p\.?m\.? EST$/i);
    expect(formatEventTimes("2026-11-14T23:30:00Z", "2026-11-15T09:30:00Z", "America/Toronto")).toMatch(/– Nov 15, 4:30/);
    expect(formatEventTimes("2026-11-14T23:30:00Z", null, "America/Toronto")).toMatch(/^6:30\s?p\.?m\.? EST$/i);
  });

  it("copes with nothing, and with a zone that does not exist", () => {
    expect(formatEventDay(undefined)).toBe("");
    expect(formatEventTimes(undefined, undefined)).toBe("");
    expect(formatEventDay("2026-11-14T23:30:00Z", "Not/AZone")).toBe("Saturday, November 14, 2026");
    expect(formatEventShortDate("2026-11-14T23:30:00Z", "America/Toronto")).toEqual({ month: "Nov", day: "14" });
  });
});

describe("what the places say", () => {
  const t = (_key: string, fallback: string, values?: Record<string, string | number>) => fallback.replace(/\{(\w+)\}/g, (_m, k) => String(values?.[k]));
  const base = { capacity: 10, confirmedGuests: 4, waitlist: false, waitlistedGuests: 0, maxGuests: 1 } as const;

  it("says how many are left, or why you cannot register", () => {
    expect(availabilityText({ ...base, state: "open", spotsLeft: 6 }, t)).toBe("6 places left");
    expect(availabilityText({ ...base, state: "open", spotsLeft: 1 }, t)).toBe("1 place left");
    expect(availabilityText({ ...base, state: "open", spotsLeft: null }, t)).toBe("");
    expect(availabilityText({ ...base, state: "full", spotsLeft: 0 }, t)).toMatch(/full/);
    expect(availabilityText({ ...base, state: "waitlist", spotsLeft: 0, waitlist: true }, t)).toMatch(/waiting list/);
    expect(availabilityText({ ...base, state: "closed", spotsLeft: 0 }, t)).toMatch(/closed/);
    expect(availabilityText({ ...base, state: "upcoming", spotsLeft: 0 }, t)).toMatch(/hasn't opened/);
    expect(availabilityText(null, t)).toBe("");
  });

  it("lets a person try to register when it is open or a waiting list is on", () => {
    expect(canRegister({ ...base, state: "open", spotsLeft: 6 })).toBe(true);
    expect(canRegister({ ...base, state: "waitlist", spotsLeft: 0, waitlist: true })).toBe(true);
    expect(canRegister({ ...base, state: "full", spotsLeft: 0 })).toBe(false);
    expect(canRegister({ ...base, state: "closed", spotsLeft: 0 })).toBe(false);
    expect(canRegister(null)).toBe(false);
  });
});

describe("where a person is sent after registering", () => {
  it("follows a path on this site or an https address, and nothing else", () => {
    expect(safeRedirect("/thank-you")).toEqual({ to: "/thank-you", external: false });
    expect(safeRedirect("https://example.com/thanks")).toEqual({ to: "https://example.com/thanks", external: true });
    for (const bad of ["//evil.example", "javascript:alert(1)", "http://example.com", "https://u:p@example.com", "thank-you", "", null, undefined]) expect(safeRedirect(bad as string | null)).toBeNull();
  });
});

describe("text that reaches the page", () => {
  it("keeps a title from closing a script tag", () => {
    expect(eventJsonLd({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });

  it("only lets safe links and images out of the rich text", () => {
    expect(eventSafeHref("javascript:alert(1)")).toBeNull();
    expect(eventSafeHref("https://example.com")).toBe("https://example.com");
    expect(eventSafeHref("/events")).toBe("/events");
    const nodes = eventLexicalToNodes({ root: { children: [{ type: "paragraph", children: [{ type: "link", fields: { url: "javascript:alert(1)" }, children: [{ type: "text", text: "click" }] }] }] } });
    expect(JSON.stringify(nodes)).not.toContain("javascript:");
    expect(JSON.stringify(nodes)).toContain("click");
  });
});
