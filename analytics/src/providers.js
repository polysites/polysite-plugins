// The catalogue of tracking tools a site can switch on, and how each one's
// settings are checked. The CMS validates what an admin types; the web app
// applies the same rules again before it builds anything for a visitor's
// browser (web/utils/tracking.ts in this plugin), so a bad value is refused at both ends.
// The two lists are kept in step by hand.
//
// category: when the visitor's agreement is needed.
//   essential  - not tracking; loads without asking
//   analytics  - measures visits
//   marketing  - advertising and conversion pixels; always asks first
// cookies: whether the tool sets cookies or similar identifiers in the visitor's browser.

export const CATEGORIES = {
  essential: "Essential (no consent needed)",
  analytics: "Analytics",
  marketing: "Marketing / advertising",
};

export const TOOLS = {
  ga4: {
    label: "Google Analytics 4",
    category: "analytics",
    cookies: true,
    idLabel: "Measurement ID",
    idHelp: "Starts with G-, like G-ABC123XYZ9.",
    idPattern: /^G-[A-Z0-9]{4,14}$/,
    dashboard: () => "https://analytics.google.com/",
  },
  gtm: {
    label: "Google Tag Manager",
    category: "marketing",
    cookies: true,
    // A container can load anything, so it asks as marketing unless the admin says otherwise.
    categoryChoosable: true,
    idLabel: "Container ID",
    idHelp: "Starts with GTM-, like GTM-ABC1234.",
    idPattern: /^GTM-[A-Z0-9]{4,12}$/,
    dashboard: () => "https://tagmanager.google.com/",
  },
  meta: {
    label: "Meta (Facebook) Pixel",
    category: "marketing",
    cookies: true,
    idLabel: "Pixel ID",
    idHelp: "A number of 10 to 20 digits, from Meta Events Manager.",
    idPattern: /^\d{10,20}$/,
    dashboard: () => "https://business.facebook.com/events_manager2/",
  },
  tiktok: {
    label: "TikTok Pixel",
    category: "marketing",
    cookies: true,
    idLabel: "Pixel ID",
    idHelp: "Letters and digits, from TikTok Events Manager.",
    idPattern: /^[A-Z0-9]{10,30}$/i,
    dashboard: () => "https://ads.tiktok.com/",
  },
  linkedin: {
    label: "LinkedIn Insight Tag",
    category: "marketing",
    cookies: true,
    idLabel: "Partner ID",
    idHelp: "A number, from LinkedIn Campaign Manager.",
    idPattern: /^\d{4,12}$/,
    conversionLabel: "Form submission conversion ID (optional)",
    conversionHelp: "The conversion rule's number in Campaign Manager. When set, each form submission is reported as that conversion.",
    conversionPattern: /^\d{3,12}$/,
    dashboard: () => "https://www.linkedin.com/campaignmanager/",
  },
  x: {
    label: "X (Twitter) Pixel",
    category: "marketing",
    cookies: true,
    idLabel: "Pixel ID",
    idHelp: "Letters and digits, from X Events Manager.",
    idPattern: /^[a-z0-9]{4,12}$/i,
    conversionLabel: "Form submission event ID (optional)",
    conversionHelp: "The event's ID from X Events Manager, like tw-abc12-abc34. When set, each form submission is reported as that event.",
    conversionPattern: /^tw-[a-z0-9]+-[a-z0-9]+$/i,
    dashboard: () => "https://ads.x.com/",
  },
  plausible: {
    label: "Plausible",
    category: "analytics",
    cookies: false,
    hostable: true,
    idLabel: "Domain",
    idHelp: "The domain you added in Plausible, like example.org.",
    idPattern: /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
    defaultHost: "https://plausible.io",
    dashboard: (id, host) => `${host || "https://plausible.io"}/${id}`,
  },
  umami: {
    label: "Umami",
    category: "analytics",
    cookies: false,
    hostable: true,
    idLabel: "Website ID",
    idHelp: "The website ID shown in Umami (a UUID).",
    idPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    defaultHost: "https://cloud.umami.is",
    dashboard: (id, host) => host || "https://cloud.umami.is",
  },
  custom: {
    label: "Custom script",
    category: "marketing",
    cookies: null, // unknown: it is whatever the pasted code does
    categoryChoosable: true,
    dashboard: () => null,
  },
};

export const MAX_CODE_LENGTH = 20000;
export const PLACEMENTS = { head: "In the page head", body: "At the end of the page body" };

// An https origin and nothing else: no path, query, credentials or fragment.
export function isHttpsOrigin(value) {
  if (typeof value !== "string") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.origin === value.replace(/\/$/, "") && !url.username && !url.password;
}

// Each returns an error message, or null when the value is acceptable.
export function checkToolId(tool, value) {
  const def = TOOLS[tool];
  if (!def?.idPattern) return null;
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) return `Enter the ${def.idLabel.toLowerCase()} for ${def.label}. ${def.idHelp}`;
  return def.idPattern.test(id) ? null : `That doesn't look like a ${def.label} ${def.idLabel.toLowerCase()}. ${def.idHelp}`;
}

export function checkConversionId(tool, value) {
  const def = TOOLS[tool];
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || !def?.conversionPattern) return null;
  return def.conversionPattern.test(id) ? null : `That doesn't look right. ${def.conversionHelp}`;
}

export function checkHost(value) {
  if (!value) return null;
  return isHttpsOrigin(String(value).trim()) ? null : "Use a full https address with no path, like https://stats.example.org.";
}

export function checkCode(value) {
  const code = typeof value === "string" ? value.trim() : "";
  if (!code) return "Paste the script or tag to add.";
  if (code.length > MAX_CODE_LENGTH) return `That is longer than ${MAX_CODE_LENGTH.toLocaleString("en")} characters.`;
  return null;
}
