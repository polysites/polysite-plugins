// Small rules shared by the blocks' components. Plain data in, plain data out (no Nuxt, no Vue), so each rule is tested on its own.
// Block data is whatever an editor, an import or an API call put in a page, so nothing here trusts it: every function accepts any
// value and answers with something safe to draw.

const MAX_LENGTH = 2048;
// Control characters (a tab or newline inside "java\tscript:" is how a scheme is hidden), the DEL range and the line separators.
const CONTROL = new RegExp(`[\u0000-\u001f\u007f-\u009f${String.fromCharCode(0x2028, 0x2029)}]`);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const IMAGE_SCHEMES = new Set(["http", "https"]);

function clean(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > MAX_LENGTH || CONTROL.test(text)) return "";
  return text;
}

function allowed(text, schemes) {
  const scheme = SCHEME.exec(text)?.[1];
  if (scheme) return schemes.has(scheme.toLowerCase());
  // No scheme: a path on this site (/contact, ../contact, contact#top) or an anchor (#top). "//host" and "/\host" would leave the
  // site by a back door that looks relative, so they are not accepted; write the full address instead.
  return !/^(\/\/|\/\\|\\)/.test(text);
}

/** A link an editor typed, if it is safe to put in an `href`: http, https, mailto, tel or a relative address. Otherwise "". */
export function safeHref(value) {
  const text = clean(value);
  return text && allowed(text, LINK_SCHEMES) ? text : "";
}

/** The same for a picture's address: http, https or relative only. */
export function safeSrc(value) {
  const text = clean(value);
  return text && allowed(text, IMAGE_SCHEMES) ? text : "";
}

/** `tel:` link for a phone number as people write it ("+1 (555) 010-0100"); "" when there are no digits. */
export function telHref(value) {
  if (typeof value !== "string") return "";
  const digits = value.replace(/[^\d+]/g, "");
  if (!/\d/.test(digits) || digits.length > 32) return "";
  // A plus sign only means anything at the start.
  return `tel:${digits.startsWith("+") ? "+" : ""}${digits.replace(/\+/g, "")}`;
}

/** `mailto:` link for an email address; "" when it does not look like one. */
export function mailHref(value) {
  const text = typeof value === "string" ? value.trim() : "";
  // No spaces, quotes, brackets, commas, colons, "?" or "#": a second recipient or a mail header cannot ride along.
  const part = String.raw`[^\s@<>"',;:?#()[\]\\]+`;
  if (!text || text.length > 254 || !new RegExp(`^${part}@${part}\\.${part}$`).test(text)) return "";
  return `mailto:${text}`;
}

/** Text with line breaks as a list of lines (an address typed over several lines); blank lines are dropped. */
export function lines(value) {
  if (typeof value !== "string") return [];
  return value.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
}

/** The columns of a gallery: 2, 3 or 4 (anything else is 3). */
export function columnsOf(value) {
  const n = Number(value);
  return n === 2 || n === 4 ? n : 3;
}

/** The array a field should be, whatever it holds: only objects stay, so one bad row cannot break the page. */
export function rows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
}

/** A non-empty string, or "". */
export function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A picture from the media library (an object with `url` and `alt` when the page was read with depth, otherwise just an id, which
 * cannot be drawn). `fallbackAlt` is used when the picture has no description of its own; "" marks it decorative.
 */
export function pictureOf(media, fallbackAlt = "") {
  if (!media || typeof media !== "object") return null;
  const src = safeSrc(media.url);
  if (!src) return null;
  const size = (n) => (Number.isFinite(n) && n > 0 && n < 20000 ? Math.round(n) : undefined);
  return { src, alt: str(media.alt) || str(fallbackAlt), width: size(media.width), height: size(media.height) };
}

const CLOCK = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i;

/** One time of day ("9:30", "9am", "17.45") as the `HH:MM` a <time> element wants; "" if it is not a time. */
export function clockOf(value) {
  const m = CLOCK.exec(str(value));
  if (!m) return "";
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3]?.toLowerCase().replace(/\./g, "");
  if (minute > 59) return "";
  if (meridiem) {
    if (hour < 1 || hour > 12) return "";
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * A time or a range of times as parts to draw: `{ text, datetime }` for a time and `{ text }` for the words between ("-", "to").
 * Anything that is not clearly a time or a range ("Closed", "By appointment") is one plain part, so nothing is ever mislabelled.
 */
export function timeParts(value) {
  const whole = str(value);
  if (!whole) return [];
  const plain = [{ text: whole }];
  const range = /^(.+?)(\s*[-–—]\s*|\s+to\s+)(.+)$/i.exec(whole);
  if (range) {
    const from = clockOf(range[1]);
    const to = clockOf(range[3]);
    return from && to ? [{ text: range[1].trim(), datetime: from }, { text: ` ${range[2].trim()} ` },{ text: range[3].trim(), datetime: to }] : plain;
  }
  const at = clockOf(whole);
  return at ? [{ text: whole, datetime: at }] : plain;
}
