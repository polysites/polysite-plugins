// What search engines and visitors are told about the other languages of a page. Plain data in, plain data out, so each
// rule is tested without Nuxt.

export interface LanguageSetup {
  default: string;
  languages: string[];
}

/** The page's addresses in other languages, as `withLanguage` makes them. */
export type AddressOf = (code: string) => string;

/**
 * The languages this page really exists in: the default (which always has the address), the current one, and every other
 * language the CMS's index says has text. `translated` is null when the index knows nothing about the page (an error page, a
 * page that is not in the index); then nothing can be said about translations.
 */
export function pageLanguages(setup: LanguageSetup, translated: string[] | null | undefined): string[] {
  if (!translated) return [];
  return setup.languages.filter((code) => code === setup.default || translated.includes(code));
}

/** The alternate links for the page head: one per language, plus x-default pointing at the default language. */
export function alternateLinks(setup: LanguageSetup, have: string[], origin: string, addressOf: AddressOf) {
  if (have.length < 2) return [];
  return [
    ...have.map((code) => ({ rel: "alternate" as const, hreflang: code, href: `${origin}${addressOf(code)}` })),
    { rel: "alternate" as const, hreflang: "x-default", href: `${origin}${addressOf(setup.default)}` },
  ];
}

/**
 * A page shown in a language it has no text in (it falls back to the default language) must not be indexed: it would be a
 * second copy of the default page at another address.
 */
export function shouldNoindex(setup: LanguageSetup, current: string, translated: string[] | null | undefined): boolean {
  if (!translated || current === setup.default) return false;
  return !translated.includes(current);
}

/** The languages the switcher offers: those the page has, or all of the site's when nothing is known about the page. */
export function switcherLanguages(setup: LanguageSetup, current: string, translated: string[] | null | undefined): string[] {
  if (!translated) return setup.languages;
  const have = pageLanguages(setup, translated);
  return have.includes(current) ? have : [...have, current].sort((a, b) => setup.languages.indexOf(a) - setup.languages.indexOf(b));
}
