import { checkDefaultLanguage, checkLanguages, normaliseSiteLanguages, offeredBy, selectedSiteId, SYSTEM_DEFAULT, unionOffered } from "./languages.js";

// Admin component paths are relative to apps/cms/src (the import map's baseDir); see the notifications plugin.
const MARKER = "../../../plugins/i18n/src/admin/LanguageMarker#LanguageMarker";
const CELL = "../../../plugins/i18n/src/admin/TranslationsCell#TranslationsCell";
const SELECT = "../../../plugins/i18n/src/admin/LanguageSelect#LanguageSelect";

// The collections whose items have a title in each language: the list shows which languages an item has text in.
const TRANSLATED_LISTS = ["pages", "posts"];

export const SLUG = "site-languages";
export const PUBLIC_FIELDS = ["languages", "defaultLanguage"];

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Languages for a site: which ones it offers, which is the default, and who may write in them. The core always stores text in the
// translatable layout and knows 48 languages; this plugin is what lets a site actually offer more than English.
//
//  - the per-site choice lives in this plugin's own `site-languages` collection, one row per site. Nothing is added to Sites. The
//    core attaches the public fields to the site the web app already fetches, as `site.extensions.languages` (the name is the
//    core's contract, apps/cms/src/i18n/registry.ts), and reads the languages from there;
//  - the admin's language picker offers each editor the languages of the site they are working in;
//  - a Languages column on the page and post lists shows which languages an item has text in.
//
// Removing the plugin deletes nothing: the settings table and every translation stay in the database. Sites then have no
// `extensions.languages`, so they offer English only.
export default function i18nPlugin(incomingConfig, kit) {
  const locales = incomingConfig.localization?.locales ?? [];
  // A core without translatable storage has nothing for this plugin to switch on.
  if (!Array.isArray(locales) || locales.length === 0 || typeof locales[0] !== "object") return incomingConfig;

  const options = locales.map((locale) => ({ label: `${locale.label ?? locale.code} (${locale.code})`, value: locale.code }));
  const known = new Set(locales.map((l) => l.code));
  const sitesSlug = "sites";

  const rowFor = (payload, siteId) =>
    payload
      .find({ collection: SLUG, where: { site: { equals: siteId } }, limit: 1, depth: 0, pagination: false, overrideAccess: true })
      .then((found) => found.docs[0] ?? null)
      .catch(() => null);

  // The languages the signed-in person can write in right now: those of the site they are working in (the multi-tenant plugin keeps
  // that in a cookie), or, with none chosen, those of every site they may reach.
  async function availableCodes(req) {
    const { payload, user } = req;
    const chosen = selectedSiteId(req.headers?.get?.("cookie"));
    if (chosen) return offeredBy(await rowFor(payload, chosen));
    const ids = user?.isSuperAdmin
      ? null
      : [...new Set((user?.assignedSites ?? []).map((a) => (a && typeof a.site === "object" ? a.site.id : a?.site)).filter(Boolean).map(String))];
    const rows = await payload.find({
      collection: SLUG,
      where: ids ? { site: { in: ids } } : undefined,
      limit: 200,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    });
    const siteCount = ids ? ids.length : (await payload.count({ collection: sitesSlug, overrideAccess: true })).totalDocs;
    return unionOffered(rows.docs, siteCount);
  }

  const filterAvailableLocales = async ({ req, locales: all }) => {
    try {
      const codes = await availableCodes(req);
      const allowed = all.filter((l) => codes.includes(l.code));
      return allowed.length > 0 ? allowed : all.filter((l) => l.code === SYSTEM_DEFAULT);
    } catch {
      return all.filter((l) => l.code === SYSTEM_DEFAULT);
    }
  };

  // Plain text, not a database enum (the catalog is the core's and grows with its releases), so the language menu is the field's
  // admin component and the catalog is enforced by `validate`.
  const menu = (single) => ({ Field: { path: SELECT, clientProps: { options, single } } });

  const SiteLanguages = {
    slug: SLUG,
    labels: { singular: "Site languages", plural: "Site languages" },
    admin: {
      group: "Administration",
      description: "Which languages this site offers, and which one is the default. Leave the list empty for English only.",
      hidden: ({ user }) => !kit.canManageSiteSettings(user),
      // The admin menu nests it under "Site features" (admin.custom, which reaches the browser; collection-level custom does not).
      custom: { navSubgroup: "Site features" },
    },
    // One row per site (the core scopes it to a site and opens the current site's row). Editors of the site may read it, since
    // the admin's language column and picker follow it; changing it is a site-settings permission.
    access: {
      read: ({ req: { user } }) => Boolean(user),
      create: ({ req: { user } }) => kit.canManageSiteSettings(user),
      update: ({ req: { user } }) => kit.canManageSiteSettings(user),
      delete: ({ req: { user } }) => kit.canManageSiteSettings(user),
    },
    hooks: {
      beforeValidate: [({ data, originalDoc }) => normaliseSiteLanguages(data, originalDoc)],
    },
    fields: [
      {
        name: "languages",
        type: "text",
        hasMany: true,
        label: "Languages this site offers",
        validate: checkLanguages(known),
        admin: {
          description: "Leave empty for English only. Every language listed gets its own address prefix (/fr/about) and a language switcher.",
          components: menu(false),
        },
      },
      {
        name: "defaultLanguage",
        type: "text",
        label: "Default language",
        validate: checkDefaultLanguage(known),
        admin: {
          description: "The language of addresses without a prefix, and what visitors see when a page isn't translated yet.",
          condition: (data) => Array.isArray(data?.languages) && data.languages.length > 0,
          components: menu(true),
        },
      },
    ],
    custom: { polysite: { siteSettings: { key: "languages", publicFields: PUBLIC_FIELDS } } },
  };

  const collections = (incomingConfig.collections ?? []).map((collection) => {
    if (!TRANSLATED_LISTS.includes(collection.slug)) return collection;
    const columns = collection.admin?.defaultColumns;
    return {
      ...collection,
      fields: [
        ...(collection.fields ?? []),
        // No data: a list cell only (admin/TranslationsCell.js).
        { name: "translations", type: "ui", label: "Languages", admin: { components: { Cell: CELL } } },
      ],
      admin: {
        ...collection.admin,
        ...(Array.isArray(columns) && !columns.includes("translations") ? { defaultColumns: [...columns.slice(0, 2), "translations", ...columns.slice(2)] } : {}),
      },
    };
  });

  return {
    ...incomingConfig,
    localization: { ...incomingConfig.localization, filterAvailableLocales },
    admin: {
      ...incomingConfig.admin,
      components: { ...incomingConfig.admin?.components, header: [...(incomingConfig.admin?.components?.header ?? []), MARKER] },
    },
    collections: [...collections, SiteLanguages],
    endpoints: [
      ...(incomingConfig.endpoints ?? []),
      {
        // Tells the admin whether to show the language picker: only when the person can write in more than one language.
        path: "/i18n/status",
        method: "get",
        handler: async (req) => {
          if (!req.user) return json({ multilingual: false }, 401);
          try {
            const codes = await availableCodes(req);
            return json({ multilingual: codes.length > 1, languages: codes });
          } catch {
            return json({ multilingual: false, languages: [SYSTEM_DEFAULT] });
          }
        },
      },
    ],
  };
}
