import { analyticsEndpoints } from "./endpoints.js";
import { CATEGORIES, checkCode, checkConversionId, checkHost, checkToolId, PLACEMENTS, TOOLS } from "./providers.js";

// Admin component paths are relative to apps/cms/src (the import map's baseDir).
const OVERVIEW_VIEW = "../../../plugins/analytics/src/admin/AnalyticsOverview#AnalyticsOverview";

const toolOptions = Object.entries(TOOLS).map(([value, t]) => ({ label: t.label, value }));
const categoryOptions = Object.entries(CATEGORIES).map(([value, label]) => ({ label, value }));
const placementOptions = Object.entries(PLACEMENTS).map(([value, label]) => ({ label, value }));

const is = (...tools) => (_, siblingData) => tools.includes(siblingData?.tool);
const hasId = (_, siblingData) => Boolean(TOOLS[siblingData?.tool]?.idPattern);

const toolRowFields = [
  {
    name: "tool",
    type: "select",
    required: true,
    options: toolOptions,
    admin: { description: "Pick a tool. Only the settings it needs appear below." },
  },
  { name: "enabled", type: "checkbox", defaultValue: true, label: "Switched on", admin: { description: "Untick to pause a tool without losing its settings." } },
  {
    name: "toolId",
    type: "text",
    label: "ID",
    admin: { condition: hasId, description: "The identifier from the tool's own dashboard. Its format is checked when you save." },
    validate: (value, { siblingData }) => (hasId(null, siblingData) ? (checkToolId(siblingData.tool, value) ?? true) : true),
  },
  {
    name: "scriptHost",
    type: "text",
    label: "Self-hosted address (optional)",
    admin: { condition: is("plausible", "umami"), description: "Leave empty for the provider's own cloud service. If you run it yourself, enter its address, like https://stats.example.org." },
    validate: (value, { siblingData }) => (is("plausible", "umami")(null, siblingData) ? (checkHost(value) ?? true) : true),
  },
  {
    name: "askFirst",
    type: "checkbox",
    defaultValue: false,
    label: "Ask visitors first",
    admin: {
      condition: is("plausible", "umami"),
      description: "These set no cookies, so they load straight away. Tick this to ask visitors first, if your policy or the rules where your visitors are call for it.",
    },
  },
  {
    name: "conversionId",
    type: "text",
    label: "Form submission event (optional)",
    admin: { condition: is("linkedin", "x"), description: "LinkedIn: the conversion rule's number. X: the event ID, like tw-abc12-abc34. When set, each form submission is reported as that conversion." },
    validate: (value, { siblingData }) => (checkConversionId(siblingData?.tool, value) ?? true),
  },
  {
    name: "category",
    type: "select",
    defaultValue: "marketing",
    options: categoryOptions,
    label: "Consent group",
    admin: {
      condition: is("gtm", "custom"),
      description:
        "Decides when it loads. A tag manager or pasted script can load anything, so it asks as Marketing unless you choose otherwise. Choose Essential only for something that does no tracking.",
    },
  },
  {
    name: "name",
    type: "text",
    label: "Name",
    admin: { condition: is("custom"), description: "Shown in the Analytics overview and the consent notice, like Live chat widget." },
    validate: (value, { siblingData }) => (siblingData?.tool === "custom" && !String(value ?? "").trim() ? "Give it a short name." : true),
  },
  {
    name: "placement",
    type: "select",
    defaultValue: "head",
    options: placementOptions,
    admin: { condition: is("custom") },
  },
  {
    name: "code",
    type: "textarea",
    label: "Script or tag",
    admin: {
      condition: is("custom"),
      rows: 10,
      description:
        "Paste the code exactly as the provider gives it: a <script> tag, several tags, or plain JavaScript. It runs in every visitor's browser, so paste only what you trust. It is added after the page loads, and only once its consent group allows it.",
    },
    validate: (value, { siblingData }) => (siblingData?.tool === "custom" ? (checkCode(value) ?? true) : true),
  },
];

const settingsFields = [
  {
    name: "tools",
    type: "array",
    label: "Tracking tools",
    labels: { singular: "Tool", plural: "Tools" },
    admin: {
      description:
        "Add analytics and advertising tools to this site without touching code. Add as many as you need. Each loads only after the consent step its group requires.",
    },
    fields: toolRowFields,
  },
  {
    name: "respectPrivacySignals",
    type: "checkbox",
    defaultValue: true,
    label: "Respect Do Not Track and Global Privacy Control",
    admin: { description: "Visitors whose browser says they don't want to be tracked get none of the analytics or marketing tools, and are not asked." },
  },
  {
    name: "consentNotice",
    type: "textarea",
    label: "Consent notice wording (optional)",
    admin: { description: "Shown when visitors are asked. Leave empty for a plain default that lists the tools. Say what you measure and why." },
  },
];

// What reaches the public site as `site.extensions.analytics`: the whole row, because every part of it is for the visitor's
// browser. The tool rows hold identifiers and (for a custom script) the code the browser must run, and the notice is shown
// to the visitor, so there is nothing here to hold back. Listed by name anyway, so a field added later (say an admin note)
// stays in the admin until someone decides it is public.
export const PUBLIC_FIELDS = ["tools", "respectPrivacySignals", "consentNotice"];

const AnalyticsSettings = (kit) => ({
  slug: "analytics-settings",
  labels: { singular: "Tracking tools", plural: "Tracking tools" },
  admin: {
    group: "Administration",
    description:
      "Analytics and advertising tools for this site. A pasted script runs in every visitor's browser, so paste only what you trust.",
    hidden: ({ user }) => !kit.canManageSiteSettings(user),
    custom: { navSubgroup: "Site features" },
  },
  // One row per site (the core scopes it to a site and opens the current site's row). Editors of the site may read it;
  // changing it is a site-settings permission, as it was when these settings were a tab on Sites.
  access: {
    read: ({ req: { user } }) => Boolean(user),
    create: ({ req: { user } }) => kit.canManageSiteSettings(user),
    update: ({ req: { user } }) => kit.canManageSiteSettings(user),
    delete: ({ req: { user } }) => kit.canManageSiteSettings(user),
  },
  fields: settingsFields,
  custom: { polysite: { siteSettings: { key: "analytics", publicFields: PUBLIC_FIELDS } } },
});

// A global with no data of its own whose edit screen is replaced by the Analytics
// overview. It exists so the screen gets a sidebar entry that follows the same
// per-role visibility as every other admin item, with no change to the core nav.
const overviewGlobal = {
  slug: "analytics-overview",
  label: "Analytics",
  admin: {
    group: "Content",
    components: { views: { edit: { default: { Component: OVERVIEW_VIEW } } } },
  },
  access: {
    read: ({ req: { user } }) => Boolean(user),
    update: () => false,
  },
  fields: [],
};

// Adds the `analytics-settings` collection (one row per site; nothing is added to Sites) and the Analytics overview screen.
// The core attaches the row's public fields to the site as
// `site.extensions.analytics` (apps/cms/src/plugins/siteSettings.ts). The scripts themselves are built by the web part
// (plugins/analytics/web/utils/tracking.ts) from these validated settings.
export default function analyticsPlugin(incomingConfig, kit) {
  return {
    ...incomingConfig,
    collections: [...(incomingConfig.collections ?? []), AnalyticsSettings(kit)],
    globals: [...(incomingConfig.globals ?? []), overviewGlobal],
    endpoints: [...(incomingConfig.endpoints ?? []), ...analyticsEndpoints],
  };
}
