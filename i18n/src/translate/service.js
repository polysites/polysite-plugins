import { offeredBy } from "../languages.js";
import { providerFromEnv } from "./providers.js";
import { planTranslation, totalCharacters } from "./walk.js";

// The machine-translation helper. An editor asks for the page or post they are on to be translated from the site's default language
// into another language the site offers. The server reads the document in both languages, sends only the prose that has no
// translation yet to the configured provider, and saves the result into the target language as a DRAFT. Each machine-made language
// is recorded in this plugin's own `machine-translations` collection and the document cannot be published until someone has marked
// it reviewed. Nothing here ever sends a form submission, a user or anything outside the one document.

export const MT_SLUG = "machine-translations";
export const TRANSLATABLE = ["pages", "posts"];

// Payload's own APIError is not importable from a plugin; these two properties are what its error handler reads for a clean 4xx.
const problem = (status, message) => Object.assign(new Error(message), { status, isPublic: true });
const siteIdOf = (doc) => (doc?.site && typeof doc.site === "object" ? doc.site.id : doc?.site);

// Whether this person may change this document, by the collection's own access rule (which may be a yes/no or a filter).
export async function canUpdate(req, collection, id) {
  const rule = req.payload.collections[collection]?.config?.access?.update;
  if (!rule) return Boolean(req.user);
  const allowed = await rule({ req, id });
  if (allowed === true) return true;
  if (!allowed) return false;
  const found = await req.payload.count({ collection, where: { and: [{ id: { equals: id } }, allowed] }, overrideAccess: true, req });
  return found.totalDocs > 0;
}

async function siteRow(payload, siteId) {
  const found = await payload.find({ collection: "site-languages", where: { site: { equals: siteId } }, limit: 1, depth: 0, pagination: false, overrideAccess: true });
  return found.docs[0] ?? null;
}

/** What the editor's button needs to know: whether the helper is usable here, in which languages, and what still needs review. */
export async function translationStatus(req, collection, id, env = process.env) {
  if (!req.user) throw problem(401, "Sign in first.");
  if (!TRANSLATABLE.includes(collection)) throw problem(400, "This kind of content cannot be machine translated.");
  const doc = await req.payload.findByID({ collection, id, depth: 0, overrideAccess: false, user: req.user, req, draft: true }).catch(() => null);
  if (!doc) throw problem(404, "Not found.");
  const row = await siteRow(req.payload, siteIdOf(doc));
  const offered = offeredBy(row);
  const { provider, reason } = providerFromEnv(env);
  const marks = await req.payload.find({
    collection: MT_SLUG,
    where: { and: [{ collectionSlug: { equals: collection } }, { docId: { equals: String(id) } }, { reviewed: { equals: false } }] },
    limit: 50,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  });
  const unreviewed = marks.docs.map((m) => m.locale);
  const base = { from: offered[0], languages: offered.slice(1), unreviewed, provider: provider?.label ?? null };
  if (offered.length < 2) return { ...base, available: false, reason: "This site offers only one language." };
  if (!row?.translationEnabled) return { ...base, available: false, reason: "Machine translation is switched off for this site (Site languages)." };
  if (!provider) return { ...base, available: false, reason };
  if (!(await canUpdate(req, collection, id))) return { ...base, available: false, reason: "You cannot change this document." };
  return { ...base, available: true };
}

export async function translateDocument(req, { collection, id, to, overwrite = false }, env = process.env) {
  const status = await translationStatus(req, collection, id, env);
  if (!status.available) throw problem(status.reason?.startsWith("Sign") ? 401 : 409, status.reason);
  if (!status.languages.includes(to)) throw problem(400, "The site does not offer that language, or it is the default language.");
  const { provider, maxChars } = providerFromEnv(env);
  const from = status.from;

  // No `req` here: a local call that is handed the endpoint's request keeps that request's language and fallback, which is exactly what these two
  // reads and the save below must not do.
  const read = (locale) => req.payload.findByID({ collection, id, locale, fallbackLocale: false, depth: 0, draft: true, overrideAccess: false, user: req.user });
  const [source, target] = await Promise.all([read(from), read(to)]);
  const fields = req.payload.collections[collection].config.fields;
  const plan = planTranslation(fields, source, target, { overwrite });
  if (plan.texts.length === 0) return { translated: 0, characters: 0, language: to, provider: provider.id, message: "Nothing left to translate." };
  const characters = totalCharacters(plan.texts);
  if (characters > maxChars) throw problem(413, `This page has ${characters} characters of text to translate and the limit is ${maxChars}.`);

  const translated = await provider.translate({ texts: plan.texts, from, to });
  const patch = plan.apply(translated);
  await req.payload.update({
    collection,
    id,
    locale: to,
    data: patch,
    draft: true,
    depth: 0,
    overrideAccess: false,
    user: req.user,
    // Lets the publish guard (and anyone reading the history) tell this save from an editor's.
    context: { machineTranslation: true },
  });

  const where = { and: [{ collectionSlug: { equals: collection } }, { docId: { equals: String(id) } }, { locale: { equals: to } }] };
  const existing = await req.payload.find({ collection: MT_SLUG, where, limit: 1, depth: 0, pagination: false, overrideAccess: true });
  const data = { collectionSlug: collection, docId: String(id), locale: to, provider: provider.id, reviewed: false };
  if (existing.docs[0]) await req.payload.update({ collection: MT_SLUG, id: existing.docs[0].id, data, overrideAccess: true });
  else await req.payload.create({ collection: MT_SLUG, data, overrideAccess: true });
  return { translated: plan.texts.length, characters, language: to, provider: provider.id };
}

export async function markReviewed(req, { collection, id, locale }) {
  if (!req.user) throw problem(401, "Sign in first.");
  if (!TRANSLATABLE.includes(collection)) throw problem(400, "This kind of content cannot be machine translated.");
  if (!(await canUpdate(req, collection, id))) throw problem(403, "You cannot change this document.");
  const where = { and: [{ collectionSlug: { equals: collection } }, { docId: { equals: String(id) } }, { locale: { equals: locale } }] };
  const found = await req.payload.find({ collection: MT_SLUG, where, limit: 1, depth: 0, pagination: false, overrideAccess: true });
  if (!found.docs[0]) return { reviewed: false, message: "Nothing to review in that language." };
  await req.payload.update({ collection: MT_SLUG, id: found.docs[0].id, data: { reviewed: true, reviewedBy: req.user.id }, overrideAccess: true });
  return { reviewed: true };
}

// beforeChange hook for pages and posts: a document with machine-translated text nobody has reviewed cannot be published.
export function publishGuard(collection) {
  return async ({ data, originalDoc, req }) => {
    if (data?._status !== "published" || req.context?.machineTranslation) return data;
    const id = originalDoc?.id;
    if (id === undefined || id === null) return data;
    const marks = await req.payload.find({
      collection: MT_SLUG,
      where: { and: [{ collectionSlug: { equals: collection } }, { docId: { equals: String(id) } }, { reviewed: { equals: false } }] },
      limit: 10,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    });
    if (marks.docs.length === 0) return data;
    const names = marks.docs.map((m) => m.locale).join(", ");
    throw problem(400, `Machine-translated text in ${names} has not been reviewed yet. Read it, then choose "Mark ${names} as reviewed" before publishing.`);
  };
}
