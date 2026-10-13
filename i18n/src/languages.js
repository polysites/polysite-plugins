// The rules for which languages a site offers and who may write in which, as plain functions so each one is tested alone.
export const SYSTEM_DEFAULT = "en";

const textList = (value) => (Array.isArray(value) ? value.filter((c) => typeof c === "string" && c) : []);

// A site's offer, from its `site-languages` row: its languages with the default first. A site with no row, or none set, offers
// English only. This is the same rule the core applies to `site.extensions.languages` (apps/cms/src/i18n/registry.ts).
export function offeredBy(row) {
  const listed = textList(row?.languages);
  if (listed.length === 0) return [SYSTEM_DEFAULT];
  const wanted = typeof row?.defaultLanguage === "string" ? row.defaultLanguage : "";
  const def = listed.includes(wanted) ? wanted : listed[0];
  return [def, ...listed.filter((c) => c !== def)];
}

// The union of what several sites offer (what an editor with access to all of them can write in). `siteCount` is how many sites
// there are; a site without a row offers English, so English is in the union when some site has no row.
export function unionOffered(rows, siteCount = rows.length) {
  const seen = new Set();
  for (const row of rows) for (const code of offeredBy(row)) seen.add(code);
  if (siteCount > rows.length) seen.add(SYSTEM_DEFAULT);
  return [...seen];
}

// The multi-tenant plugin remembers the site an admin is working in, in a cookie.
export function selectedSiteId(cookieHeader, name = "payload-tenant") {
  for (const part of String(cookieHeader ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      const value = decodeURIComponent(rest.join("="));
      return value && value !== "undefined" ? value : null;
    }
  }
  return null;
}

// Keeps the default language among the offered ones, drops repeats, and clears the default when nothing is offered.
// A save that names only one of the two (an API call changing just the default) is completed from the saved row; a save that
// names neither is left alone.
export function normaliseSiteLanguages(data, original) {
  if (!data) return data;
  if (!("languages" in data) && !("defaultLanguage" in data)) return data;
  const listed = [...new Set(textList("languages" in data ? data.languages : original?.languages))];
  if (listed.length === 0) return { ...data, languages: [], defaultLanguage: null };
  const wanted = "defaultLanguage" in data ? data.defaultLanguage : original?.defaultLanguage;
  return { ...data, languages: listed, defaultLanguage: listed.includes(wanted) ? wanted : listed[0] };
}

// The codes are stored as plain text (never a database enum: the catalog belongs to the core and grows with its releases), so the
// catalog is enforced here instead. `known` is the set of catalog codes.
export const checkLanguages = (known) => (value) => {
  if (value == null) return true;
  if (!Array.isArray(value) || !value.every((c) => typeof c === "string")) return "Languages must be a list of language codes.";
  const unknown = value.filter((c) => !known.has(c));
  return unknown.length === 0 || `Not a language Polysite knows: ${unknown.join(", ")}.`;
};

export const checkDefaultLanguage = (known) => (value, { siblingData } = {}) => {
  if (!value) return true;
  if (!known.has(value)) return `Not a language Polysite knows: ${value}.`;
  const listed = textList(siblingData?.languages);
  if (listed.length === 0) return true;
  return listed.includes(value) || "The default language must be one of the languages this site offers.";
};
