import { buildCollections } from "./collections.js";
import { checkNewsPath, DEFAULT_NEWS_LABEL, DEFAULT_NEWS_PATH, DEFAULT_PER_PAGE } from "./urls.js";

// What of a site's news settings the public site may read. The core attaches these to the site the web app already fetches,
// as `site.extensions.news` (apps/cms/src/plugins/siteSettings.ts); the plugin's own server code reads the same place.
export const PUBLIC_FIELDS = ["label", "path", "perPage"];

// Adds three collections: `posts` and `post-categories` (the content), and `news-settings`, one row per site, which says
// where that site shows its posts. The settings are the plugin's own table; nothing is added to Sites. Applied before the
// core plugins (the manifest says `"kind": ["content-type", "site-settings"]`), which then scope the collections to a site.
export default function postsPlugin(incomingConfig, kit) {
  const NewsSettings = {
    slug: "news-settings",
    labels: { singular: "News settings", plural: "News settings" },
    admin: {
      group: "Administration",
      description: "Where this site shows its posts. Turn the Posts module on for the site under General, Enabled Modules.",
      hidden: ({ user }) => !kit.canManageSiteSettings(user),
      custom: { navSubgroup: "Site features" },
    },
    // One row per site (the core scopes it to a site and opens the current site's row). Editors of the site may read it;
    // changing it is a site-settings permission, as for the rest of the site's settings.
    access: {
      read: ({ req: { user } }) => Boolean(user),
      create: ({ req: { user } }) => kit.canManageSiteSettings(user),
      update: ({ req: { user } }) => kit.canManageSiteSettings(user),
      delete: ({ req: { user } }) => kit.canManageSiteSettings(user),
    },
    fields: [
      {
        name: "label",
        type: "text",
        defaultValue: DEFAULT_NEWS_LABEL,
        admin: { description: "The heading of the list of posts, and what themes call the section." },
      },
      {
        name: "path",
        type: "text",
        label: "Section address",
        defaultValue: DEFAULT_NEWS_PATH,
        admin: { description: "The list lives at /<this>, and each post at /<this>/<post-slug>. A page with the same slug as this is hidden by the list." },
        validate: (value) => checkNewsPath(value) ?? true,
      },
      { name: "perPage", type: "number", label: "Posts per page", defaultValue: DEFAULT_PER_PAGE, min: 1, max: 50 },
      {
        name: "resetNews",
        type: "ui",
        admin: { components: { Field: "../../../plugins/posts/src/admin/ResetNewsSettings#ResetNewsSettings" } },
      },
    ],
    custom: { polysite: { siteSettings: { key: "news", publicFields: PUBLIC_FIELDS } } },
  };

  return { ...incomingConfig, collections: [...(incomingConfig.collections ?? []), ...buildCollections(kit), NewsSettings] };
}
