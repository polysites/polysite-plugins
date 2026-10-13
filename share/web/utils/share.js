// The share plugin's rules, in plain JavaScript with no dependencies so that both halves use the same code: the CMS part
// (src/index.js) takes the lists of choices and the checks from here, and the web part (components, composables) builds the
// links with it. It is also tested on its own (test/share.test.js), without Nuxt or Payload.
//
// Privacy by construction: everything here only builds ADDRESSES. Nothing loads a script, an image or a font from a network,
// and nothing is requested until a visitor follows one of the links.

/**
 * The networks a site can offer, in the order the admin lists them. `link` ones are plain addresses that work with no
 * JavaScript; `copy` and `native` need the browser's own features and only appear once the page has loaded and the browser has them.
 */
export const NETWORKS = {
  facebook: { label: "Facebook", kind: "link" },
  x: { label: "X", kind: "link" },
  linkedin: { label: "LinkedIn", kind: "link" },
  whatsapp: { label: "WhatsApp", kind: "link" },
  telegram: { label: "Telegram", kind: "link" },
  reddit: { label: "Reddit", kind: "link" },
  email: { label: "Email", kind: "link" },
  copy: { label: "Copy link", kind: "copy" },
  native: { label: "Share (this device's menu)", kind: "native" },
};

export const NETWORK_KEYS = Object.keys(NETWORKS);
export const DEFAULT_NETWORKS = ["facebook", "x", "linkedin", "email", "copy"];

export const STYLES = {
  buttons: "Icon and name",
  icons: "Icons only",
  text: "Names only",
};
export const DEFAULT_STYLE = "buttons";

export const PLACEMENTS = {
  inline: "Where the theme puts it (and nowhere else)",
  "floating-bottom": "Floating, along the bottom of the page",
  "floating-side": "Floating, at the side of the page (a bar along the bottom on narrower screens)",
};
export const DEFAULT_PLACEMENT = "floating-bottom";

/**
 * Which addresses show the buttons. `posts` is the news and articles of the posts plugin; `other` is any other content type a plugin
 * adds. The list is fixed (the database stores it as a list of choices), so a content type from a future plugin shares `other`.
 */
export const CONTENT_TYPES = {
  home: "The home page",
  pages: "Pages",
  posts: "News and articles",
  other: "Other content types added by plugins",
};
export const DEFAULT_CONTENT_TYPES = ["pages", "posts"];

export const MAX_TITLE = 200;
export const MAX_TEXT = 200;

const isObject = (value) => typeof value === "object" && value !== null;
const keep = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter((v) => typeof v === "string" && allowed.includes(v)))] : []);

/** The admin's check on the X handle. Returns a message, or null when it is fine (or empty). */
export function checkHandle(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^@?[A-Za-z0-9_]{1,15}$/.test(value.trim())) return "Enter an X handle like polysite: letters, numbers and underscores, up to 15 characters.";
  return null;
}

/** "@polysite" or "polysite" -> "polysite"; anything that is not a handle -> "". */
export function cleanHandle(value) {
  return typeof value === "string" && checkHandle(value) === null ? value.trim().replace(/^@/, "") : "";
}

/** Text going into somebody else's page or a message: one line, no control characters, no longer than `max`. */
export function cleanText(value, max = MAX_TITLE) {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : flat;
}

// Parameters that only say where a visitor came from. A shared address has no business carrying them.
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|twclid|ttclid|li_fat_id|mc_cid|mc_eid|igshid|yclid|_ga|_gl|ref_src)$/i;

/**
 * The address to share: http or https only, no credentials, no fragment, no tracking parameters. Returns "" for anything else, so a
 * `javascript:` or `data:` value can never reach a link.
 */
export function cleanUrl(value) {
  if (typeof value !== "string") return "";
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password) return "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return url.toString();
}

// encodeURIComponent leaves ! ' ( ) * alone; encode those too so a title can never end a quoted string or look like markup.
const enc = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * What to say with the link. `{title}` in the site's own text is replaced by the page's title; without it the text goes in front.
 * Returns "" when there is nothing to say.
 */
export function composeMessage(title, text) {
  const t = cleanText(title);
  const prefix = cleanText(text, MAX_TEXT);
  if (!prefix) return t;
  return prefix.includes("{title}") ? cleanText(prefix.replaceAll("{title}", t), MAX_TEXT + MAX_TITLE) : cleanText(t ? `${prefix} ${t}` : prefix, MAX_TEXT + MAX_TITLE);
}

const BUILDERS = {
  facebook: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
  x: ({ url, message, via }) => `https://x.com/intent/post?text=${enc(message)}&url=${enc(url)}${via ? `&via=${enc(via)}` : ""}`,
  linkedin: ({ url }) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
  whatsapp: ({ url, message }) => `https://wa.me/?text=${enc(message ? `${message} ${url}` : url)}`,
  telegram: ({ url, message }) => `https://t.me/share/url?url=${enc(url)}&text=${enc(message)}`,
  reddit: ({ url, title }) => `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}`,
  email: ({ url, title, message }) => `mailto:?subject=${enc(title)}&body=${enc(message ? `${message}\n\n${url}` : url)}`,
};

/**
 * The plain links for a page, for the networks that are switched on, in the order given.
 *
 * @param {{ url: string, title?: string, text?: string, via?: string, networks?: string[] }} input
 * @returns {{ network: string, label: string, href: string, external: boolean }[]}
 *   Empty when the address is not an http(s) address. `copy` and `native` are not links, so they are not in this list.
 */
export function shareLinks(input) {
  const url = cleanUrl(input?.url);
  if (!url) return [];
  const title = cleanText(input?.title);
  const ctx = { url, title, message: composeMessage(title, input?.text), via: cleanHandle(input?.via) };
  return keep(input?.networks, NETWORK_KEYS)
    .filter((key) => NETWORKS[key].kind === "link")
    .map((key) => {
      const href = BUILDERS[key](ctx);
      return { network: key, label: NETWORKS[key].label, href, external: !href.startsWith("mailto:") };
    });
}

/**
 * What the CMS stored for a site, made safe to use: unknown values dropped and the defaults filled in. Nothing that arrives from the
 * API is trusted to be what the admin offered.
 */
export function readSettings(raw) {
  const share = isObject(raw) ? raw : {};
  const networks = keep(share.networks, NETWORK_KEYS);
  const types = keep(share.contentTypes, Object.keys(CONTENT_TYPES));
  return {
    enabled: share.enabled === true,
    // The order the admin chose is kept. An empty list means "never set": it falls back to the defaults.
    networks: networks.length ? networks : DEFAULT_NETWORKS,
    style: Object.hasOwn(STYLES, share.style) ? share.style : DEFAULT_STYLE,
    placement: Object.hasOwn(PLACEMENTS, share.placement) ? share.placement : DEFAULT_PLACEMENT,
    contentTypes: types.length ? types : DEFAULT_CONTENT_TYPES,
    text: cleanText(share.text, MAX_TEXT),
    via: cleanHandle(share.via),
  };
}

/** Which kind of address this is, in the terms of the CMS setting. `module` is the site module of the content route that owns the address, if one does. */
export function contentKind({ isHome, module }) {
  if (isHome) return "home";
  if (!module) return "pages";
  return module === "posts" ? "posts" : "other";
}

/** Whether a site's buttons should show on an address of this kind, and where. */
export function shouldShow(settings, kind, where) {
  if (!settings?.enabled) return false;
  if (!settings.contentTypes.includes(kind)) return false;
  const floating = settings.placement !== "inline";
  return where === "floating" ? floating : !floating;
}
