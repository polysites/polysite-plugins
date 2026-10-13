import { searchEndpoint } from "./endpoints.js";
import { DEFAULT_PER_PAGE, MAX_PER_PAGE } from "./query.js";
import { searchableCollections } from "./search.js";

// Public search for a site's published content. The core already keeps an index of every page and routable item
// (the `site-urls` collection, which also powers the admin's search); this plugin is the visitor-facing side:
//
//  - a `search-settings` collection with one row per site (switch it on, the box's placeholder, results per page, what is
//    searchable). It is the plugin's own table; nothing is added to Sites. The core attaches the public fields to the site
//    the web app already fetches, as `site.extensions.search` (apps/cms/src/plugins/siteSettings.ts);
//  - GET /api/site-search, a rate-limited, site-scoped, published-only, language-aware endpoint;
//  - the web part (plugins/search/web): a search box a theme places with <SiteSlot name="search" /> and a results page at /search.
//
// Removing the plugin deletes nothing: the settings table stays in the database.
// Stored as plain text, not a database enum: the list of searchable content types depends on which plugins are installed, and a
// plugin must not change its table when another plugin comes or goes. Anything that is not a name is refused; a name that is no
// longer installed is kept (putting its plugin back finds everything as it was).
const keepKnownNames = (value) => value == null || (Array.isArray(value) && value.every((v) => typeof v === "string" && /^[a-z0-9-]+$/.test(v))) || "Use the names of content types, like pages.";

export const PUBLIC_FIELDS = ["enabled", "placeholder", "perPage", "collections"];

export default function searchPlugin(incomingConfig, kit) {
  const options = searchableCollections(incomingConfig).map((c) => ({ label: c.label, value: c.slug }));

  const fields = [
    // Only a name for the document in the admin (instead of "[Untitled]" or its id); never shown to the public site.
    { name: "title", type: "text", defaultValue: "Site search", admin: { hidden: true } },
    {
      name: "enabled",
      type: "checkbox",
      defaultValue: false,
      label: "Switch search on",
      admin: { description: "Turns on the results page (/search) and the search box in themes that place one." },
    },
    {
      name: "placeholder",
      type: "text",
      label: "Placeholder text",
      admin: { description: "Shown in the empty search box. Leave empty for the standard words in the visitor's language." },
    },
    {
      name: "perPage",
      type: "number",
      label: "Results per page",
      defaultValue: DEFAULT_PER_PAGE,
      min: 1,
      max: MAX_PER_PAGE,
    },
    {
      name: "collections",
      type: "text",
      hasMany: true,
      // A content type whose plugin has since been removed may still be ticked here. That is kept, not rejected: the value
      // stays in the database so putting the plugin back finds everything as it was, and saving meanwhile must not fail.
      validate: keepKnownNames,
      label: "What visitors can search",
      // The menu is the core's ModuleSelect component (the same one the module lists of Roles and Sites use): the value is plain text, the
      // list of choices is what is installed.
      admin: {
        description: "Leave empty to search everything. Only published items are ever found.",
        components: { Field: { path: "/components/ModuleSelect#ModuleSelect", clientProps: { options } } },
      },
    },
  ];

  const SearchSettings = {
    slug: "search-settings",
    labels: { singular: "Site search", plural: "Site search" },
    admin: {
      group: "Administration",
      description: "Lets visitors search this site's published pages and posts. Drafts and other sites' content never appear.",
      hidden: ({ user }) => !kit.canManageSiteSettings(user),
      // The one level of sub-group the admin nav supports (components/AdminNav reads admin.custom).
      custom: { navSubgroup: "Site features" },
      // The name the settings document goes by (it has no title of its own).
      useAsTitle: "title",
    },
    // One row per site (the core scopes it to a site and opens the current site's row). Editors of the site may read
    // it; changing it is a site-settings permission, as for the rest of the site's settings.
    access: {
      read: ({ req: { user } }) => Boolean(user),
      create: ({ req: { user } }) => kit.canManageSiteSettings(user),
      update: ({ req: { user } }) => kit.canManageSiteSettings(user),
      delete: ({ req: { user } }) => kit.canManageSiteSettings(user),
    },
    // The placeholder is the one piece of text here; a site in several languages writes it in each (when the core stores it so).
    fields: kit?.i18n?.localizeNamed ? kit.i18n.localizeNamed(fields, ["placeholder"]) : fields,
    custom: { polysite: { siteSettings: { key: "search", publicFields: PUBLIC_FIELDS } } },
  };

  return {
    ...incomingConfig,
    collections: [...(incomingConfig.collections ?? []), SearchSettings],
    endpoints: [...(incomingConfig.endpoints ?? []), searchEndpoint()],
  };
}
