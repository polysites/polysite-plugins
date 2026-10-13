import assert from "node:assert/strict";
import { test } from "node:test";

import sharePlugin, { PUBLIC_FIELDS } from "../src/index.js";
import {
  CONTENT_TYPES,
  DEFAULT_CONTENT_TYPES,
  DEFAULT_NETWORKS,
  NETWORKS,
  checkHandle,
  cleanHandle,
  cleanText,
  cleanUrl,
  composeMessage,
  contentKind,
  readSettings,
  shareLinks,
  shouldShow,
} from "../web/utils/share.js";

const PAGE = { url: "https://example.org/about?x=1", title: "About us & our plans" };
const ALL = ["facebook", "x", "linkedin", "whatsapp", "telegram", "reddit", "email", "copy", "native"];
const byNetwork = (links) => Object.fromEntries(links.map((l) => [l.network, l]));
const query = (href) => new URL(href).searchParams;

test("each network gets its own address, built from the page's address and title", () => {
  const links = byNetwork(shareLinks({ ...PAGE, networks: ALL }));
  assert.equal(links.facebook.href, "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.org%2Fabout%3Fx%3D1");
  assert.equal(links.linkedin.href, "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fexample.org%2Fabout%3Fx%3D1");
  assert.equal(query(links.x.href).get("url"), PAGE.url);
  assert.equal(query(links.x.href).get("text"), PAGE.title);
  assert.equal(query(links.telegram.href).get("url"), PAGE.url);
  assert.equal(query(links.telegram.href).get("text"), PAGE.title);
  assert.equal(query(links.reddit.href).get("url"), PAGE.url);
  assert.equal(query(links.reddit.href).get("title"), PAGE.title);
  assert.equal(query(links.whatsapp.href).get("text"), `${PAGE.title} ${PAGE.url}`);
  assert.ok(links.x.href.startsWith("https://x.com/intent/post?"));
  assert.ok(links.whatsapp.href.startsWith("https://wa.me/?"));
  assert.ok(links.telegram.href.startsWith("https://t.me/share/url?"));
  assert.ok(links.reddit.href.startsWith("https://www.reddit.com/submit?"));
});

test("email is a mailto link with the title as subject and the address in the body, spaces as %20 (not +)", () => {
  const { email } = byNetwork(shareLinks({ ...PAGE, networks: ["email"] }));
  assert.ok(email.href.startsWith("mailto:?subject="));
  assert.equal(email.external, false, "a mail link must not open a new tab");
  assert.ok(!email.href.includes("+"));
  const q = email.href.slice("mailto:?".length);
  const params = new URLSearchParams(q.replaceAll("+", "%2B"));
  assert.equal(params.get("subject"), PAGE.title);
  assert.equal(params.get("body"), `${PAGE.title}\n\n${PAGE.url}`);
});

test("only the networks that are switched on are returned, in the order chosen, once each", () => {
  assert.deepEqual(shareLinks({ ...PAGE, networks: ["reddit", "facebook", "reddit"] }).map((l) => l.network), ["reddit", "facebook"]);
  assert.deepEqual(shareLinks({ ...PAGE, networks: [] }), []);
  assert.deepEqual(shareLinks({ ...PAGE }), []);
  assert.deepEqual(shareLinks({ ...PAGE, networks: ["myspace", "__proto__", 7, null, "x"] }).map((l) => l.network), ["x"]);
  // copy and the device's menu are browser features, not links
  assert.deepEqual(shareLinks({ ...PAGE, networks: ["copy", "native", "facebook"] }).map((l) => l.network), ["facebook"]);
});

test("everything that reaches an address is percent-encoded, so a title cannot break out of it", () => {
  const nasty = `Tom & Jerry's "big" <b>day</b> #1?x=y&z=1 100% (really)! *`;
  for (const link of shareLinks({ url: "https://example.org/p", title: nasty, networks: ALL })) {
    assert.ok(!/[<>"' ]/.test(link.href), `${link.network}: ${link.href}`);
    assert.ok(!/[()*!]/.test(link.href), `${link.network} left a reserved character raw`);
  }
  const x = shareLinks({ url: "https://example.org/p", title: nasty, networks: ["x"] })[0];
  assert.equal(query(x.href).get("text"), nasty, "decoding gives the title back exactly");
  assert.equal(query(x.href).get("url"), "https://example.org/p");
  assert.equal([...query(x.href).keys()].length, 2, "the title's own & and ? did not add parameters");
});

test("the page address is checked: only http(s), no credentials, no fragment, no tracking parameters", () => {
  assert.equal(cleanUrl("https://example.org/a#section"), "https://example.org/a");
  assert.equal(cleanUrl("https://example.org/a?utm_source=x&id=2&fbclid=abc&gclid=1"), "https://example.org/a?id=2");
  assert.equal(cleanUrl("  http://example.org/a "), "http://example.org/a");
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "//example.org/a", "/relative", "ftp://example.org/a", "https://user:pass@example.org/", "", "not a url", null, undefined, 5]) {
    assert.equal(cleanUrl(bad), "", String(bad));
  }
  assert.deepEqual(shareLinks({ url: "javascript:alert(1)", title: "x", networks: ALL }), []);
  assert.deepEqual(shareLinks({ url: "", title: "x", networks: ALL }), []);
});

test("every link is https or mailto and nothing else", () => {
  for (const link of shareLinks({ ...PAGE, networks: ALL })) {
    assert.match(link.href, /^(https:\/\/|mailto:)/, link.network);
    assert.equal(link.external, link.network !== "email");
  }
});

test("titles and text are made safe: one line, no control characters, capped", () => {
  assert.equal(cleanText("a\nb\r\n\tc\u0000d"), "a b c d");
  assert.equal(cleanText("  spaced   out  "), "spaced out");
  assert.equal(cleanText(undefined), "");
  assert.equal(cleanText({}), "");
  const long = cleanText("x".repeat(500));
  assert.equal([...long].length, 200);
  assert.ok(long.endsWith("…"));
  const emoji = cleanText("😀".repeat(300), 10);
  assert.equal([...emoji].length, 10, "capped by characters, never splitting an emoji");
  assert.ok(emoji.isWellFormed());
  const links = shareLinks({ url: "https://example.org/", title: "line one\nline two", networks: ["x"] });
  assert.equal(query(links[0].href).get("text"), "line one line two");
});

test("the site's message goes in front of the title, or around it with {title}", () => {
  assert.equal(composeMessage("The plan", ""), "The plan");
  assert.equal(composeMessage("The plan", "Have a look:"), "Have a look: The plan");
  assert.equal(composeMessage("The plan", 'Read "{title}" and tell a friend.'), 'Read "The plan" and tell a friend.');
  assert.equal(composeMessage("", "Have a look:"), "Have a look:");
  const links = byNetwork(shareLinks({ ...PAGE, text: "Have a look:", networks: ["x", "email", "reddit", "whatsapp"] }));
  assert.equal(query(links.x.href).get("text"), `Have a look: ${PAGE.title}`);
  assert.equal(query(links.reddit.href).get("title"), PAGE.title, "a post title on Reddit is the page's, not the message");
  assert.equal(query(links.whatsapp.href).get("text"), `Have a look: ${PAGE.title} ${PAGE.url}`);
});

test("the X account is added as via, only when it is a real handle", () => {
  assert.equal(checkHandle(""), null);
  assert.equal(checkHandle(undefined), null);
  assert.equal(checkHandle("polysite"), null);
  assert.equal(checkHandle("@polysite_1"), null);
  for (const bad of ["a b", "polysite!", "x".repeat(16), "@@x", "https://x.com/polysite", "poly&via=evil"]) assert.equal(typeof checkHandle(bad), "string", bad);
  assert.equal(cleanHandle(" @polysite "), "polysite");
  assert.equal(cleanHandle("bad handle"), "");
  assert.equal(query(shareLinks({ ...PAGE, via: "@polysite", networks: ["x"] })[0].href).get("via"), "polysite");
  assert.equal(query(shareLinks({ ...PAGE, via: "bad&handle", networks: ["x"] })[0].href).has("via"), false);
  assert.equal(query(shareLinks({ ...PAGE, networks: ["x", "facebook"] })[0].href).has("via"), false);
  const other = shareLinks({ ...PAGE, via: "polysite", networks: ["facebook", "linkedin", "telegram", "reddit", "whatsapp", "email"] });
  assert.ok(other.every((l) => !l.href.includes("polysite")), "via belongs to X only");
});

test("settings from the API are checked, not trusted", () => {
  const defaults = readSettings(undefined);
  assert.deepEqual(defaults, { enabled: false, networks: DEFAULT_NETWORKS, style: "buttons", placement: "floating-bottom", contentTypes: DEFAULT_CONTENT_TYPES, text: "", via: "" });
  assert.equal(readSettings({ enabled: "true" }).enabled, false, "only a real true switches it on");
  assert.equal(readSettings({ enabled: true }).enabled, true);
  const given = readSettings({ enabled: true, networks: ["telegram", "bogus", "x", "x"], style: "icons", placement: "inline", contentTypes: ["home", "nope"], text: " Hi\n", via: "@me" });
  assert.deepEqual(given.networks, ["telegram", "x"]);
  assert.equal(given.style, "icons");
  assert.equal(given.placement, "inline");
  assert.deepEqual(given.contentTypes, ["home"]);
  assert.equal(given.text, "Hi");
  assert.equal(given.via, "me");
  const bad = readSettings({ enabled: true, networks: "facebook", style: "huge", placement: "__proto__", contentTypes: null });
  assert.deepEqual(bad.networks, DEFAULT_NETWORKS);
  assert.equal(bad.style, "buttons");
  assert.equal(bad.placement, "floating-bottom");
  assert.deepEqual(bad.contentTypes, DEFAULT_CONTENT_TYPES);
  assert.equal(readSettings(null).enabled, false);
  assert.equal(readSettings("string").enabled, false);
});

test("which kind of address it is, and whether a site shows the buttons there", () => {
  assert.equal(contentKind({ isHome: true, module: null }), "home");
  assert.equal(contentKind({ isHome: false, module: null }), "pages");
  assert.equal(contentKind({ isHome: false, module: "posts" }), "posts");
  assert.equal(contentKind({ isHome: false, module: "events" }), "other");

  const on = readSettings({ enabled: true, placement: "floating-side", contentTypes: ["pages", "posts"] });
  assert.equal(shouldShow(on, "pages", "floating"), true);
  assert.equal(shouldShow(on, "posts", "floating"), true);
  assert.equal(shouldShow(on, "home", "floating"), false, "the home page was not ticked");
  assert.equal(shouldShow(on, "other", "floating"), false);
  assert.equal(shouldShow(on, "pages", "inline"), false, "a floating site doesn't also get an inline copy");

  const inline = readSettings({ enabled: true, placement: "inline", contentTypes: ["pages"] });
  assert.equal(shouldShow(inline, "pages", "inline"), true);
  assert.equal(shouldShow(inline, "pages", "floating"), false);

  assert.equal(shouldShow(readSettings({ enabled: false }), "pages", "floating"), false, "off means off");
  assert.equal(shouldShow(readSettings({}), "pages", "floating"), false, "a site that never set it up shows nothing");
  assert.equal(shouldShow(null, "pages", "inline"), false);
});

test("the lists of choices are the ones the CMS offers", () => {
  assert.deepEqual(Object.keys(NETWORKS), ALL);
  assert.ok(DEFAULT_NETWORKS.every((n) => n in NETWORKS));
  assert.ok(DEFAULT_CONTENT_TYPES.every((t) => t in CONTENT_TYPES));
});

const kitFor = (extra = {}) => ({ canManageSiteSettings: (user) => user?.manage === true, ...extra });
const build = (kit = kitFor()) => sharePlugin({ collections: [{ slug: "sites", fields: [{ type: "tabs", tabs: [{ label: "General" }, { label: "Advanced" }] }] }, { slug: "pages", fields: [] }] }, kit);
const settings = (config) => config.collections.find((c) => c.slug === "share-settings");
const field = (config, name) => settings(config).fields.find((f) => f.name === name);

test("the plugin keeps its settings in its own collection and changes no other", () => {
  const config = build();
  assert.deepEqual(config.collections.map((c) => c.slug), ["sites", "pages", "share-settings"]);
  const sites = config.collections.find((c) => c.slug === "sites");
  assert.deepEqual(sites.fields[0].tabs.map((t) => t.label), ["General", "Advanced"], "no tab is added to Sites");
  assert.equal(sites.hooks, undefined, "and no hook");
  assert.deepEqual(settings(config).fields.map((f) => f.name), ["enabled", "networks", "style", "placement", "contentTypes", "text", "via"]);
});

test("the core is told which fields reach the public site, and every one is a field of the collection", () => {
  const declared = settings(build()).custom.polysite.siteSettings;
  assert.equal(declared.key, "share");
  const names = settings(build()).fields.map((f) => f.name);
  assert.deepEqual(declared.publicFields, names, "the whole row is public: it holds no secret");
  assert.deepEqual(PUBLIC_FIELDS, declared.publicFields);
});

test("the settings are off by default and offer every network", () => {
  const config = build();
  assert.equal(field(config, "enabled").defaultValue, false);
  assert.deepEqual(field(config, "networks").options.map((o) => o.value), ALL);
  assert.equal(field(config, "networks").hasMany, true);
  assert.equal(field(config, "style").type, "select");
  assert.equal(field(config, "placement").type, "select");
});

test("the kinds of page are plain text, so the table does not depend on which plugins are installed", () => {
  const contentTypes = field(build(), "contentTypes");
  assert.equal(contentTypes.type, "text");
  assert.equal(contentTypes.hasMany, true);
  assert.deepEqual(contentTypes.defaultValue, DEFAULT_CONTENT_TYPES);
  assert.equal(contentTypes.options, undefined);
  for (const known of Object.keys(CONTENT_TYPES)) assert.ok(contentTypes.admin.description.includes(`${known} (`), `${known} is listed for the editor`);
  assert.equal(contentTypes.validate(["pages", "home"]), true);
  assert.equal(contentTypes.validate(["events", "from-a-removed-plugin"]), true, "a name that is no longer installed is kept");
  assert.equal(contentTypes.validate(null), true);
  assert.equal(typeof contentTypes.validate(["Not a name!"]), "string");
  assert.equal(typeof contentTypes.validate("pages"), "string");
});

test("switching it on needs at least one button, and the X account is checked", () => {
  const config = build();
  const networks = field(config, "networks");
  assert.equal(networks.validate(["x"], { siblingData: { enabled: true } }), true);
  assert.equal(typeof networks.validate([], { siblingData: { enabled: true } }), "string");
  assert.equal(networks.validate([], { siblingData: { enabled: false } }), true, "nothing to choose while it is off");
  assert.equal(typeof networks.validate(["x", "myspace"], { siblingData: { enabled: false } }), "string", "an unknown network is refused even while it is off");
  assert.equal(typeof networks.validate(["__proto__"], { siblingData: { enabled: true } }), "string");
  assert.equal(field(config, "via").validate("polysite"), true);
  assert.equal(typeof field(config, "via").validate("not a handle"), "string");
  assert.equal(field(config, "via").validate(""), true);
});

test("the message follows the site's languages when the core can do that, and works without", () => {
  assert.ok(!field(build(), "text").localized);
  const kit = kitFor({ i18n: { localizeNamed: (fields, names) => fields.map((f) => (names.includes(f.name) ? { ...f, localized: true } : f)) } });
  assert.equal(field(build(kit), "text").localized, true);
  assert.ok(!field(build(kit), "via").localized, "only the message is translated");
});

test("anyone signed in can read the settings; changing them is a site-settings permission, and the nav entry follows it", () => {
  const { access, admin } = settings(build());
  const as = (user) => ({ req: { user } });
  assert.equal(access.read(as({ id: 1 })), true);
  assert.equal(access.read(as(null)), false, "not public: the public site gets the fields through the core");
  for (const op of ["create", "update", "delete"]) {
    assert.equal(access[op](as({ id: 1, manage: true })), true, op);
    assert.equal(access[op](as({ id: 1 })), false, op);
    assert.equal(access[op](as(null)), false, op);
  }
  assert.equal(admin.hidden({ user: { manage: true } }), false);
  assert.equal(admin.hidden({ user: { id: 1 } }), true);
});

test("the web part reads the settings from the site's extensions", () => {
  const site = { extensions: { share: { enabled: true, placement: "inline", networks: ["x", "email"], contentTypes: ["home"], via: "@polysite" } } };
  const read = readSettings(site.extensions.share);
  assert.deepEqual([read.enabled, read.placement, read.networks, read.contentTypes, read.via], [true, "inline", ["x", "email"], ["home"], "polysite"]);
  assert.equal(readSettings(({}).extensions?.share).enabled, false, "a site with no row yet shows nothing");
});
