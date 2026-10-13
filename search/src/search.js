import { languageFor, offeredBy } from "./languages.js";
import { bodySnippet, clampPerPage, MAX_RESULTS, mentions, relevance, snippetOf } from "./query.js";

// The collections whose published items visitors can search: pages, and every collection a content-type plugin declared as
// routable (it has a public address, so the core's URL index already holds an entry for it). Read from the built config, so a
// new content type is searchable the moment its plugin is installed, with no change here.
export function searchableCollections(config) {
  const found = [{ slug: "pages", module: "pages", docType: "page", label: "Pages" }];
  for (const c of config?.collections ?? []) {
    const meta = c?.custom?.polysite;
    if (!meta?.routable || c.slug === "pages") continue;
    const plural = typeof c.labels?.plural === "string" ? c.labels.plural : c.slug;
    found.push({ slug: c.slug, module: meta.module?.value ?? c.slug, docType: meta.routable.docType ?? c.slug, label: plural });
  }
  return found;
}

/** What a site's search settings say, with every value in range. */
export function readSettings(site) {
  const s = site?.extensions?.search ?? {};
  return {
    enabled: s.enabled === true,
    placeholder: typeof s.placeholder === "string" ? s.placeholder.trim() : "",
    perPage: clampPerPage(s.perPage),
    collections: Array.isArray(s.collections) ? s.collections.filter((c) => typeof c === "string") : [],
  };
}

/**
 * The collections this site's visitors may search: those the site chose (none chosen means all), that exist in this install,
 * and whose module the site has switched on (a site that turned the Posts module off does not search posts).
 */
export function collectionsFor(site, settings, available) {
  const modules = Array.isArray(site?.enabledModules) ? site.enabledModules : null;
  return available.filter((c) => (settings.collections.length === 0 || settings.collections.includes(c.slug)) && (modules === null || modules.includes(c.module)));
}

const idOf = (ref) => (ref && typeof ref === "object" ? ref.id : ref);

const hasDrafts = (payload, slug) => Boolean(payload.collections?.[slug]?.config?.versions?.drafts);

// Whether the core's index carries body text (`searchText`, added to the core after this plugin first shipped). Without it a
// search still works, on titles and addresses.
export function indexHasBody(payload) {
  const config = payload.collections?.["site-urls"]?.config;
  const fields = config?.flattenedFields ?? config?.fields ?? [];
  return fields.some((f) => f?.name === "searchText");
}

// Every word must be somewhere in the entry: its title, its address or (when the index has it) its body text. Each word is one
// "contains" match on a bound value, never part of a query string, so nothing a visitor types can change what is asked.
function termFilter(terms, body) {
  return terms.map((term) => ({ or: [{ title: { like: term } }, { path: { like: term } }, ...(body ? [{ searchText: { like: term } }] : [])] }));
}

async function indexHits(payload, { site, locale, fallbackLocale, terms, slugs, body }) {
  const res = await payload.find({
    collection: "site-urls",
    where: {
      and: [{ site: { equals: site.id } }, { status: { equals: "published" } }, { or: slugs.map((slug) => ({ "doc.relationTo": { equals: slug } })) }, ...termFilter(terms, body)],
    },
    locale,
    fallbackLocale,
    depth: 0,
    limit: MAX_RESULTS,
    pagination: false,
    sort: "-priority",
    // The body text is a hidden field of the index (never in an API answer), and Payload refuses a query that names a hidden field
    // unless it is made without access control. So with body text the read is made that way, and the where above does what the
    // index's read rule does for a visitor: this site, published entries only. (Without body text, the rule itself applies.) The
    // answer is cut down to what is needed, so the 200 candidates do not each carry up to 50,000 characters.
    overrideAccess: body,
    ...(body ? { select: { title: true, path: true, doc: true, site: true, languages: true, priority: true, docType: true, status: true } } : {}),
  });
  return res.docs ?? [];
}

// The body text of the entries on the page being shown, for their snippets. Read separately and only for those few entries
// (the text is up to 50,000 characters each), and re-checked for this site and for published entries.
async function bodiesOf(payload, { site, lang, def, rows }) {
  const bodies = new Map();
  const byLocale = new Map();
  for (const r of rows) byLocale.set(r.locale, [...(byLocale.get(r.locale) ?? []), r.rowId]);
  for (const [locale, ids] of byLocale) {
    try {
      const res = await payload.find({
        collection: "site-urls",
        where: { and: [{ id: { in: ids } }, { site: { equals: site.id } }, { status: { equals: "published" } }] },
        locale,
        fallbackLocale: def,
        depth: 0,
        limit: ids.length,
        pagination: false,
        overrideAccess: true, // the where above names the site and published entries itself (see indexHits)
        showHiddenFields: true,
        select: { searchText: true },
      });
      for (const doc of res.docs ?? []) if (typeof doc.searchText === "string") bodies.set(doc.id, doc.searchText);
    } catch (err) {
      payload.logger?.error?.(`[search] could not read body text: ${err.message}`);
    }
  }
  return bodies;
}

// The index says where to look; the live documents are the truth. A document is returned only if, asked as an anonymous
// visitor (each collection's own read access applies), it belongs to this site and is published. That drops an index entry
// whose document was unpublished, deleted or moved since, whatever the index still says.
async function liveDocs(payload, { site, locale, fallbackLocale, bySlug }) {
  const live = new Map();
  await Promise.all(
    [...bySlug].map(async ([slug, ids]) => {
      try {
        const res = await payload.find({
          collection: slug,
          where: {
            and: [{ id: { in: ids } }, { site: { equals: site.id } }, ...(hasDrafts(payload, slug) ? [{ _status: { equals: "published" } }] : [])],
          },
          draft: false,
          locale,
          fallbackLocale,
          depth: 0,
          limit: ids.length,
          pagination: false,
          overrideAccess: false,
          select: { title: true, excerpt: true, meta: true, site: true, _status: true },
        });
        for (const doc of res.docs ?? []) live.set(`${slug}:${doc.id}`, doc);
      } catch (err) {
        // A collection that cannot be read as a visitor contributes nothing.
        payload.logger?.error?.(`[search] could not check ${slug}: ${err.message}`);
      }
    }),
  );
  return live;
}

/**
 * One search of one site. `params`: { site, q, terms, lang, page }. Returns { lang, page, perPage, total, totalPages, results }.
 * Language: results are matched in `lang`; an item with no text in `lang` is matched, and shown, in the site's default
 * language (the same fallback the pages themselves use).
 */
export async function searchSite(payload, params) {
  const { site, q, terms } = params;
  const settings = readSettings(site);
  const perPage = settings.perPage;
  const lang = languageFor(site, params.lang);
  const def = offeredBy(site)[0];
  const allowed = collectionsFor(site, settings, searchableCollections(payload.config)).filter((c) => payload.collections?.[c.slug]);
  const empty = { lang, page: 1, perPage, total: 0, totalPages: 0, results: [] };
  if (allowed.length === 0 || !payload.collections?.["site-urls"]) return empty;
  const slugs = allowed.map((c) => c.slug);

  const body = indexHasBody(payload);
  const candidates = new Map();
  const passes = lang === def ? [lang] : [lang, def];
  for (const locale of passes) {
    const hits = await indexHits(payload, { site, locale, fallbackLocale: def, terms, slugs, body });
    for (const hit of hits) {
      const slug = hit.doc?.relationTo;
      const id = idOf(hit.doc?.value);
      if (!slugs.includes(slug) || id === undefined || id === null || String(idOf(hit.site)) !== String(site.id)) continue;
      // The default-language pass is for items with no text in `lang`; one that has it was already judged in `lang`.
      if (locale !== lang && Array.isArray(hit.languages) && hit.languages.includes(lang)) continue;
      const key = `${slug}:${id}`;
      if (!candidates.has(key)) candidates.set(key, { key, slug, id, path: hit.path, docType: hit.docType, priority: hit.priority ?? 0, rowId: hit.id, locale });
    }
  }
  if (candidates.size === 0) return empty;

  const bySlug = new Map();
  for (const c of candidates.values()) bySlug.set(c.slug, [...(bySlug.get(c.slug) ?? []), c.id]);
  const live = await liveDocs(payload, { site, locale: lang, fallbackLocale: def, bySlug });

  const ranked = [...candidates.values()]
    .filter((c) => live.has(c.key) && typeof c.path === "string")
    .map((c) => {
      const doc = live.get(c.key);
      const title = typeof doc.title === "string" && doc.title.trim() ? doc.title.trim() : c.path;
      return { ...c, title, summary: snippetOf(doc), score: relevance(title, c.path, terms, q) };
    })
    .sort((a, b) => b.score - a.score || b.priority - a.priority || a.title.localeCompare(b.title, lang));

  const total = Math.min(ranked.length, MAX_RESULTS);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, params.page ?? 1), totalPages);
  const shown = ranked.slice((page - 1) * perPage, page * perPage);
  const bodies = body && shown.length > 0 ? await bodiesOf(payload, { site, lang, def, rows: shown }) : new Map();
  // Under each result: the item's own summary when it shows a searched word, else the stretch of the body that does, else the summary.
  const snippetFor = (r) => (mentions(r.summary, terms) ? r.summary : bodySnippet(bodies.get(r.rowId), terms) || r.summary);
  const results = shown.map((r) => ({
    id: r.id,
    collection: r.slug,
    type: r.docType,
    title: r.title,
    path: r.path,
    snippet: snippetFor(r),
  }));
  return { lang, page, perPage, total, totalPages: total === 0 ? 0 : totalPages, results };
}
