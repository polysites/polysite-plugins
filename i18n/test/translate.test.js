import assert from "node:assert/strict";
import { test } from "node:test";

import { checkResult, claudeProvider, libreTranslateProvider, providerFromEnv } from "../src/translate/providers.js";
import { lexicalTextNodes, planTranslation, totalCharacters } from "../src/translate/walk.js";

const para = (...texts) => ({ type: "paragraph", children: texts.map((text) => ({ type: "text", text, format: 0 })) });
const rich = (...paragraphs) => ({ root: { type: "root", children: paragraphs, direction: "ltr", format: "", indent: 0, version: 1 } });

// A cut-down collection: the shapes the real pages use (a title, a group, blocks with an array, a rich text, and fields that are shared).
const fields = [
  { name: "title", type: "text", localized: true },
  { name: "slug", type: "text" },
  { type: "row", fields: [{ name: "note", type: "textarea", localized: true }] },
  { name: "meta", type: "group", fields: [{ name: "description", type: "textarea", localized: true }, { name: "image", type: "upload" }] },
  {
    name: "content",
    type: "blocks",
    blocks: [
      { slug: "hero", fields: [{ name: "heading", type: "text", localized: true }, { name: "ctaHref", type: "text" }] },
      { slug: "faq", fields: [{ name: "items", type: "array", fields: [{ name: "question", type: "text", localized: true }, { name: "answer", type: "textarea", localized: true }] }] },
      { slug: "text", fields: [{ name: "body", type: "richText", localized: true }] },
    ],
  },
];

const source = {
  title: "About",
  slug: "about",
  note: "A note",
  meta: { description: "Describes it", image: 5 },
  content: [
    { id: "a", blockType: "hero", heading: "Welcome", ctaHref: "/join" },
    { id: "b", blockType: "faq", items: [{ id: "q1", question: "Why?", answer: "Because." }] },
    { id: "c", blockType: "text", body: rich(para("Hello ", "world"), { type: "code", children: [{ type: "text", text: "const x = 1" }] }) },
  ],
};
const emptyTarget = {
  title: null,
  slug: "about",
  note: null,
  meta: { description: null, image: 5 },
  content: [
    { id: "a", blockType: "hero", heading: null, ctaHref: "/join" },
    { id: "b", blockType: "faq", items: [{ id: "q1", question: null, answer: null }] },
    { id: "c", blockType: "text", body: null },
  ],
};

test("collects only prose that is translatable and still empty, in reading order", () => {
  const { texts } = planTranslation(fields, source, emptyTarget);
  assert.deepEqual(texts, ["About", "A note", "Describes it", "Welcome", "Why?", "Because.", "Hello ", "world"]);
});

test("puts the translation back into the same places, leaving shared fields and block structure alone", () => {
  const plan = planTranslation(fields, source, emptyTarget);
  const patch = plan.apply(plan.texts.map((t) => t.toUpperCase()));
  assert.equal(patch.title, "ABOUT");
  assert.equal(patch.note, "A NOTE");
  assert.deepEqual(patch.meta, { description: "DESCRIBES IT", image: 5 });
  assert.equal(patch.slug, undefined, "an unchanged field is not part of the patch");
  const [hero, faq, text] = patch.content;
  assert.deepEqual([hero.id, hero.heading, hero.ctaHref], ["a", "WELCOME", "/join"]);
  assert.deepEqual(faq.items[0], { id: "q1", question: "WHY?", answer: "BECAUSE." });
  assert.deepEqual(lexicalTextNodes(text.body).map((n) => n.text), ["HELLO ", "WORLD"]);
  // the code block is not sent and not changed
  assert.equal(text.body.root.children[1].children[0].text, "const x = 1");
});

test("does not overwrite a translation that already exists, unless asked to", () => {
  const partly = { ...emptyTarget, title: "À propos", content: emptyTarget.content.map((b) => (b.id === "a" ? { ...b, heading: "Bienvenue" } : b)) };
  const kept = planTranslation(fields, source, partly);
  assert.ok(!kept.texts.includes("About") && !kept.texts.includes("Welcome"));
  const all = planTranslation(fields, source, partly, { overwrite: true });
  assert.ok(all.texts.includes("About") && all.texts.includes("Welcome"));
});

test("has nothing to do when everything is translated or the source is empty", () => {
  const done = planTranslation(fields, source, source);
  assert.deepEqual(done.texts, []);
  assert.deepEqual(done.apply([]), {});
  assert.deepEqual(planTranslation(fields, { title: "", content: [] }, { title: null, content: [] }).texts, []);
});

test("refuses a translation of the wrong length, and never changes what it was given", () => {
  const before = JSON.stringify(emptyTarget);
  const plan = planTranslation(fields, source, emptyTarget);
  assert.throws(() => plan.apply(["one"]), /does not match/);
  plan.apply(plan.texts.map((t) => `x${t}`));
  assert.equal(JSON.stringify(emptyTarget), before);
});

test("counts characters", () => assert.equal(totalCharacters(["ab", "cde"]), 5));

test("the provider is chosen from the environment, and unavailable with a reason when it is not set up", () => {
  assert.match(providerFromEnv({}).reason, /not set up/);
  assert.equal(providerFromEnv({}).provider, null);
  assert.match(providerFromEnv({ POLYSITE_TRANSLATE_PROVIDER: "claude" }).reason, /API_KEY/);
  assert.match(providerFromEnv({ POLYSITE_TRANSLATE_PROVIDER: "libretranslate" }).reason, /URL/);
  assert.match(providerFromEnv({ POLYSITE_TRANSLATE_PROVIDER: "bogus" }).reason, /Unknown/);
  assert.equal(providerFromEnv({ POLYSITE_TRANSLATE_PROVIDER: "claude", POLYSITE_TRANSLATE_API_KEY: "k" }).provider.id, "claude");
  assert.equal(providerFromEnv({ POLYSITE_TRANSLATE_PROVIDER: "echo" }).provider.id, "echo");
  assert.equal(providerFromEnv({ POLYSITE_TRANSLATE_PROVIDER: "echo", NODE_ENV: "production" }).provider, null);
  assert.equal(providerFromEnv({ POLYSITE_TRANSLATE_PROVIDER: "echo", NODE_ENV: "production", POLYSITE_TRANSLATE_ALLOW_ECHO: "1" }).provider.id, "echo", "only the test stack opts in");
  assert.equal(providerFromEnv({ POLYSITE_TRANSLATE_PROVIDER: "echo", POLYSITE_TRANSLATE_MAX_CHARS: "50" }).maxChars, 50);
});

test("a result must be one string per input", () => {
  assert.deepEqual(checkResult(["a"], ["b"]), ["b"]);
  for (const bad of [null, [], ["a", "b"], [1]]) assert.throws(() => checkResult(["a"], bad), /different number/);
});

test("the Claude provider sends only the texts and the language names, with the key in a header, and reads the structured answer", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "thinking" }, { type: "text", text: JSON.stringify({ translations: ["Bonjour"] }) }] }) };
  };
  const provider = claudeProvider({ apiKey: "sk-test", fetchImpl });
  assert.deepEqual(await provider.translate({ texts: ["Hello"], from: "en", to: "fr" }), ["Bonjour"]);
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen.init.headers["x-api-key"], "sk-test");
  assert.equal(seen.body.model, "claude-haiku-5-5");
  assert.deepEqual(JSON.parse(seen.body.messages[0].content), ["Hello"]);
  assert.match(seen.body.system, /French/);
  assert.ok(!JSON.stringify(seen.body).includes("sk-test"), "the key is never in the body");
  assert.equal(seen.body.output_config.format.type, "json_schema");
});

test("the Claude provider reports a refusal, a cut-off and a bad answer instead of guessing", async () => {
  const answer = (body, ok = true) => claudeProvider({ apiKey: "k", fetchImpl: async () => ({ ok, status: 500, json: async () => body }) });
  await assert.rejects(answer({ stop_reason: "refusal", content: [] }).translate({ texts: ["a"], from: "en", to: "fr" }), /declined/);
  await assert.rejects(answer({ stop_reason: "max_tokens", content: [] }).translate({ texts: ["a"], from: "en", to: "fr" }), /too long/);
  await assert.rejects(answer({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }).translate({ texts: ["a"], from: "en", to: "fr" }), /unexpected/);
  await assert.rejects(answer({}, false).translate({ texts: ["a"], from: "en", to: "fr" }), /answered 500/);
  await assert.rejects(answer({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ translations: ["x", "y"] }) }] }).translate({ texts: ["a"], from: "en", to: "fr" }), /different number/);
});

test("the LibreTranslate provider posts the texts to its own server", async () => {
  let seen;
  const provider = libreTranslateProvider({ url: "http://lt:5000/", apiKey: "k", fetchImpl: async (url, init) => ((seen = { url, body: JSON.parse(init.body) }), { ok: true, json: async () => ({ translatedText: ["Hola"] }) }) });
  assert.deepEqual(await provider.translate({ texts: ["Hello"], from: "en", to: "es-MX" }), ["Hola"]);
  assert.equal(seen.url, "http://lt:5000/translate");
  assert.deepEqual([seen.body.source, seen.body.target], ["en", "es"]);
});

// ---- the service, against a small fake Payload

import { markReviewed, MT_SLUG, publishGuard, translateDocument, translationStatus } from "../src/translate/service.js";

function fakePayload({ translationEnabled = true, languages = ["en", "fr"], access } = {}) {
  const store = { marks: [] };
  const docs = {
    en: { id: 7, site: 3, title: "About", content: [{ id: "a", blockType: "hero", heading: "Welcome" }], _status: "draft" },
    fr: { id: 7, site: 3, title: null, content: [{ id: "a", blockType: "hero", heading: null }], _status: "draft" },
  };
  const updates = [];
  const payload = {
    collections: { pages: { config: { fields: [{ name: "title", type: "text", localized: true }, { name: "content", type: "blocks", blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text", localized: true }] }] }], access: { update: access ?? (() => true) } } } },
    findByID: async ({ locale }) => docs[locale ?? "en"],
    find: async ({ collection, where }) => {
      if (collection === "site-languages") return { docs: [{ site: 3, languages, defaultLanguage: "en", translationEnabled }] };
      const wanted = JSON.stringify(where);
      const reviewedFalse = wanted.includes('"reviewed":{"equals":false}');
      return { docs: store.marks.filter((m) => (!reviewedFalse || !m.reviewed) && wanted.includes(`"${m.docId}"`) && (!wanted.includes('"locale"') || wanted.includes(`"${m.locale}"`))) };
    },
    count: async () => ({ totalDocs: 1 }),
    update: async (args) => {
      if (args.collection === MT_SLUG) Object.assign(store.marks.find((m) => m.id === args.id), args.data);
      else updates.push(args);
      return {};
    },
    create: async ({ data }) => (store.marks.push({ id: store.marks.length + 1, ...data }), {}),
  };
  return { req: { user: { id: 1 }, payload }, store, updates };
}
const echoEnv = { POLYSITE_TRANSLATE_PROVIDER: "echo" };

test("the button is available only when the site switched it on, the server has a provider, and the person may edit", async () => {
  const on = fakePayload();
  assert.equal((await translationStatus(on.req, "pages", 7, echoEnv)).available, true);
  assert.deepEqual((await translationStatus(on.req, "pages", 7, echoEnv)).languages, ["fr"]);
  assert.match((await translationStatus(fakePayload({ translationEnabled: false }).req, "pages", 7, echoEnv)).reason, /switched off/);
  assert.match((await translationStatus(on.req, "pages", 7, {})).reason, /not set up/);
  assert.match((await translationStatus(fakePayload({ languages: [] }).req, "pages", 7, echoEnv)).reason, /only one language/);
  assert.match((await translationStatus(fakePayload({ access: () => false }).req, "pages", 7, echoEnv)).reason, /cannot change/);
  await assert.rejects(translationStatus({ ...on.req, user: null }, "pages", 7, echoEnv), /Sign in/);
  await assert.rejects(translationStatus(on.req, "users", 7, echoEnv), /cannot be machine translated/);
});

test("translating saves a draft in the target language and records it as unreviewed", async () => {
  const f = fakePayload();
  const out = await translateDocument(f.req, { collection: "pages", id: 7, to: "fr" }, echoEnv);
  assert.equal(out.translated, 2);
  assert.equal(f.updates.length, 1);
  assert.equal(f.updates[0].draft, true);
  assert.equal(f.updates[0].locale, "fr");
  assert.equal(f.updates[0].overrideAccess, false, "the person's own access applies");
  assert.deepEqual(f.updates[0].data.content[0], { id: "a", blockType: "hero", heading: "[fr] Welcome" });
  assert.equal(f.updates[0].data.title, "[fr] About");
  assert.equal(f.updates[0].context.machineTranslation, true);
  assert.deepEqual(f.store.marks.map((m) => [m.collectionSlug, m.docId, m.locale, m.reviewed]), [["pages", "7", "fr", false]]);
  assert.deepEqual((await translationStatus(f.req, "pages", 7, echoEnv)).unreviewed, ["fr"]);
});

test("it refuses a language the site does not offer, the default language, and too much text", async () => {
  const f = fakePayload();
  await assert.rejects(translateDocument(f.req, { collection: "pages", id: 7, to: "de" }, echoEnv), /does not offer/);
  await assert.rejects(translateDocument(f.req, { collection: "pages", id: 7, to: "en" }, echoEnv), /does not offer|default/);
  await assert.rejects(translateDocument(f.req, { collection: "pages", id: 7, to: "fr" }, { ...echoEnv, POLYSITE_TRANSLATE_MAX_CHARS: "5" }), /limit is 5/);
  assert.equal(f.updates.length, 0, "nothing was saved");
});

test("a document with unreviewed machine text cannot be published until it is marked reviewed", async () => {
  const f = fakePayload();
  await translateDocument(f.req, { collection: "pages", id: 7, to: "fr" }, echoEnv);
  const guard = publishGuard("pages");
  const publish = { data: { _status: "published" }, originalDoc: { id: 7 }, req: f.req };
  await assert.rejects(guard(publish), /not been reviewed/);
  assert.deepEqual(await guard({ ...publish, data: { _status: "draft" } }), { _status: "draft" }, "saving a draft is always allowed");
  assert.deepEqual(await guard({ ...publish, req: { ...f.req, context: { machineTranslation: true } } }), { _status: "published" });
  assert.equal((await markReviewed(f.req, { collection: "pages", id: 7, locale: "fr" })).reviewed, true);
  assert.deepEqual(await guard(publish), { _status: "published" });
  assert.deepEqual(await guard({ data: { _status: "published" }, originalDoc: undefined, req: f.req }), { _status: "published" }, "a new document has nothing to review");
});
