import { CONTENT_TYPES, checkHandle, DEFAULT_CONTENT_TYPES, DEFAULT_NETWORKS, DEFAULT_PLACEMENT, DEFAULT_STYLE, MAX_TEXT, NETWORKS, PLACEMENTS, STYLES } from "../web/utils/share.js";

const options = (record) => Object.entries(record).map(([value, label]) => ({ label: typeof label === "string" ? label : label.label, value }));

const whenEnabled = (_, siblingData) => siblingData?.enabled === true;

// The networks, the look and the placement are fixed by this plugin, so they are enumerations in its own table (adding a network later is
// a migration of this plugin's). The content types are not: which ones exist depends on the other plugins installed, so they are plain
// text, and a name that is no longer known is kept, never rejected (the web part treats any content type from another plugin as "other").
const keepKnownNames = (value) => value == null || (Array.isArray(value) && value.every((v) => typeof v === "string" && /^[a-z0-9-]+$/.test(v))) || "Use the names of content types, like pages.";

export const PUBLIC_FIELDS = ["enabled", "networks", "style", "placement", "contentTypes", "text", "via"];

const shareFields = (kit) => [
  {
    name: "enabled",
    type: "checkbox",
    defaultValue: false,
    label: "Show share buttons on this site",
    admin: { description: "Off by default. When on, visitors see buttons that share the page they are on. Nothing is loaded from any other website until a visitor clicks one." },
  },
  {
    name: "networks",
    type: "select",
    hasMany: true,
    options: options(NETWORKS),
    defaultValue: DEFAULT_NETWORKS,
    label: "Buttons",
    admin: {
      condition: whenEnabled,
      description:
        "Which buttons to show, in this order. Copy link and the device's own share menu appear only for visitors whose browser can do them (and need JavaScript); the rest are plain links.",
    },
    // A custom validator replaces Payload's own check that every value is one of the options, so it is repeated here.
    validate: (value, { siblingData }) => {
      const list = Array.isArray(value) ? value : [];
      if (list.some((v) => typeof v !== "string" || !Object.hasOwn(NETWORKS, v))) return "Choose only from the buttons listed.";
      return siblingData?.enabled === true && !list.length ? "Choose at least one button." : true;
    },
  },
  {
    name: "style",
    type: "select",
    options: options(STYLES),
    defaultValue: DEFAULT_STYLE,
    label: "Look",
    admin: { condition: whenEnabled, description: "Floating buttons always show icons only." },
  },
  {
    name: "placement",
    type: "select",
    options: options(PLACEMENTS),
    defaultValue: DEFAULT_PLACEMENT,
    label: "Where",
    admin: {
      condition: whenEnabled,
      description:
        "Floating works with every theme. \"Where the theme puts it\" shows the buttons only where the theme has made a place for them (a theme author adds <SiteSlot name=\"share\" /> or <ShareButtons />).",
    },
  },
  {
    name: "contentTypes",
    type: "text",
    hasMany: true,
    defaultValue: DEFAULT_CONTENT_TYPES,
    validate: keepKnownNames,
    label: "Show on",
    admin: {
      condition: whenEnabled,
      description: `Which kinds of address get the buttons, by name: ${Object.entries(CONTENT_TYPES)
        .map(([value, label]) => `${value} (${label[0].toLowerCase()}${label.slice(1)})`)
        .join(", ")}. News and articles need the Posts plugin.`,
    },
  },
  // The words that go with the link are the one thing a person translates, so they follow the site's languages when the core offers that.
  ...[
    {
      name: "text",
      type: "text",
      label: "Message (optional)",
      maxLength: MAX_TEXT,
      admin: {
        condition: whenEnabled,
        description:
          "Goes in front of the page's title when someone shares, for networks that carry a message (X, WhatsApp, Telegram, email). Write {title} to put the title somewhere else, like: Read \"{title}\" and tell a friend.",
      },
    },
  ].map((field) => (kit?.i18n?.localizeNamed ? kit.i18n.localizeNamed([field], ["text"])[0] : field)),
  {
    name: "via",
    type: "text",
    label: "X account (optional)",
    admin: { condition: whenEnabled, description: "Your handle on X, like polysite. X adds \"via @polysite\" to the post." },
    validate: (value) => checkHandle(value) ?? true,
  },
];

// The buttons themselves are drawn by the plugin's web part (web/), a Nuxt layer the web app loads like a theme; this part only stores and
// checks the choices, in the plugin's own `share-settings` collection: one row per site, nothing added to Sites. The core attaches the
// public fields to the site the web app already fetches, as `site.extensions.share`, and refreshes the public site when the row changes
// (apps/cms/src/plugins/siteSettings.ts). Removing the plugin deletes nothing: the settings table stays in the database.
export default function sharePlugin(incomingConfig, kit) {
  const ShareSettings = {
    slug: "share-settings",
    labels: { singular: "Share buttons", plural: "Share buttons" },
    admin: {
      group: "Administration",
      description: "Buttons that let visitors share the page they are on. Nothing is loaded from any other website until a visitor clicks one.",
      hidden: ({ user }) => !kit.canManageSiteSettings(user),
      custom: { navSubgroup: "Site features" },
    },
    // One row per site (the core scopes it to a site and opens the current site's row). Editors of the site may read it; changing it is
    // a site-settings permission, as for the rest of the site's settings.
    access: {
      read: ({ req: { user } }) => Boolean(user),
      create: ({ req: { user } }) => kit.canManageSiteSettings(user),
      update: ({ req: { user } }) => kit.canManageSiteSettings(user),
      delete: ({ req: { user } }) => kit.canManageSiteSettings(user),
    },
    fields: shareFields(kit),
    custom: { polysite: { siteSettings: { key: "share", publicFields: PUBLIC_FIELDS } } },
  };

  return { ...incomingConfig, collections: [...(incomingConfig.collections ?? []), ShareSettings] };
}
