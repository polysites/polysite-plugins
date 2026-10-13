import assert from "node:assert/strict";
import { test } from "node:test";

import { clockOf, columnsOf, lines, mailHref, pictureOf, rows, safeHref, safeSrc, telHref, timeParts } from "../web/utils/blocks.js";

test("links: http, https, mailto, tel and relative addresses pass, and come back as typed (trimmed)", () => {
  for (const ok of [
    "https://example.org/a?b=1#c",
    "http://example.org",
    "HTTPS://EXAMPLE.ORG",
    "mailto:hello@example.org",
    "tel:+15550100",
    "/contact",
    "/fr/contact?x=1",
    "contact",
    "../contact",
    "#top",
    "?page=2",
  ]) {
    assert.equal(safeHref(ok), ok, ok);
  }
  assert.equal(safeHref("  /contact \n"), "/contact");
});

test("links: anything that could run script or leave by a side door is refused", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.org/x",
    "blob:https://example.org/abc",
    "//evil.example/x",
    "/\\evil.example/x",
    "\\\\evil.example\\x",
    "https://example.org/ x",
    "https://example.org/" + "a".repeat(3000),
    "",
    "   ",
    null,
    undefined,
    42,
    {},
    ["https://example.org"],
  ]) {
    assert.equal(safeHref(bad), "", JSON.stringify(bad)?.slice(0, 60));
  }
});

test("pictures: http, https and relative only", () => {
  assert.equal(safeSrc("/api/media/file/a.webp"), "/api/media/file/a.webp");
  assert.equal(safeSrc("https://cdn.example.org/a.png"), "https://cdn.example.org/a.png");
  for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "mailto:a@b.co", "tel:123", "//evil.example/a.png", 5, null]) {
    assert.equal(safeSrc(bad), "", String(bad));
  }
});

test("phone and email become links only when they look right", () => {
  assert.equal(telHref("+1 (555) 010-0100"), "tel:+15550100100");
  assert.equal(telHref("555.0100"), "tel:5550100");
  assert.equal(telHref("call us"), "");
  assert.equal(telHref("12+34"), "tel:1234");
  assert.equal(telHref(null), "");
  assert.equal(mailHref(" hello@example.org "), "mailto:hello@example.org");
  for (const bad of ["hello", "a@b", "a b@example.org", "<script>@example.org", 'a"@example.org', "a@example.org,b@example.org", "a@example.org?subject=x", "", null]) {
    assert.equal(mailHref(bad), "", String(bad));
  }
});

test("lines: an address typed over several lines", () => {
  assert.deepEqual(lines("1 Main Street\r\n\nSpringfield  \n"), ["1 Main Street", "Springfield"]);
  assert.deepEqual(lines(undefined), []);
});

test("columns: 2, 3 or 4, otherwise 3", () => {
  assert.deepEqual(["2", "3", "4", 2, 4, "5", "x", null, undefined].map(columnsOf), [2, 3, 4, 2, 4, 3, 3, 3, 3]);
});

test("rows: only objects survive, so one bad row cannot break a page", () => {
  assert.deepEqual(rows([{ a: 1 }, null, "x", 3, [1], { b: 2 }]), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(rows(undefined), []);
  assert.deepEqual(rows("nope"), []);
});

test("pictures from the media library: a drawable address, the description it carries, a fallback when it has none", () => {
  assert.deepEqual(pictureOf({ url: "/api/media/file/a.webp", alt: " A chair ", width: 800, height: 600 }), { src: "/api/media/file/a.webp", alt: "A chair", width: 800, height: 600 });
  assert.equal(pictureOf({ url: "/a.png", alt: "" }, "Fallback").alt, "Fallback");
  assert.equal(pictureOf({ url: "/a.png" }).alt, "");
  assert.equal(pictureOf({ url: "/a.png", width: -4, height: "x" }).width, undefined);
  assert.equal(pictureOf(12), null, "just an id, not drawable");
  assert.equal(pictureOf({ url: "javascript:alert(1)" }), null);
  assert.equal(pictureOf(null), null);
});

test("times: a time of day is told from other words", () => {
  assert.equal(clockOf("9:30"), "09:30");
  assert.equal(clockOf("09.05"), "09:05");
  assert.equal(clockOf("9am"), "09:00");
  assert.equal(clockOf("12am"), "00:00");
  assert.equal(clockOf("12pm"), "12:00");
  assert.equal(clockOf("5:45 PM"), "17:45");
  for (const no of ["Closed", "25:00", "9:75", "13pm", "", null, "2019"]) assert.equal(clockOf(no), "", String(no));
});

test("times: a range keeps its words and marks both ends; anything else stays plain text", () => {
  assert.deepEqual(timeParts("9:30 - 10:15"), [
    { text: "9:30", datetime: "09:30" },
    { text: " - " },
    { text: "10:15", datetime: "10:15" },
  ]);
  assert.deepEqual(timeParts("9am to 5pm"), [{ text: "9am", datetime: "09:00" }, { text: " to " }, { text: "5pm", datetime: "17:00" }]);
  assert.deepEqual(timeParts("Closed"), [{ text: "Closed" }]);
  assert.deepEqual(timeParts("By appointment - call us"), [{ text: "By appointment - call us" }]);
  assert.deepEqual(timeParts("14:00"), [{ text: "14:00", datetime: "14:00" }]);
  assert.deepEqual(timeParts(""), []);
  assert.deepEqual(timeParts(undefined), []);
});
