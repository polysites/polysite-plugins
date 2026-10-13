import { SYSTEM_DEFAULT } from "./query.js";

// What a site offers, read the way the web app reads it (apps/web/utils/language.ts), from `site.extensions.languages`: no languages set means English only,
// the default comes first, and a default that isn't offered is replaced by the first listed.
export function offeredBy(site) {
  const setup = site?.extensions?.languages;
  const listed = Array.isArray(setup?.languages) ? setup.languages.filter((c) => typeof c === "string" && c) : [];
  if (listed.length === 0) return [SYSTEM_DEFAULT];
  const wanted = typeof setup?.defaultLanguage === "string" ? setup.defaultLanguage : "";
  const def = listed.includes(wanted) ? wanted : listed[0];
  return [def, ...listed.filter((c) => c !== def)];
}

/** The language to search in: the one asked for when the site offers it, otherwise the site's default. */
export function languageFor(site, asked) {
  const offered = offeredBy(site);
  const wanted = typeof asked === "string" ? asked.trim() : "";
  return offered.includes(wanted) ? wanted : offered[0];
}
