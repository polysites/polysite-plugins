# i18n plugin: languages

Lets a site offer more than one language: its own address for each (`/fr/about`), a language switcher, the right tags for search engines, and a translated sitemap. Editors write each translation next to the original in the same page or post.

**What it needs from the core.** The core already stores every piece of translatable text in the per-language layout, with English as the only language a fresh install offers (Known Issue #62). This plugin is what turns more languages on. Removing it never deletes a translation: the text stays in the database, and every site goes back to English only.

## What you get

| For | What |
| --- | --- |
| **Visitors** | `example.org/about` in the site's default language and `example.org/fr/about` in French; a language switcher; the page's `lang` and reading direction; fixed words (form and captcha messages, the news section's "Newer" and "Older", the 404 and error page) in their language |
| **Search engines** | `hreflang` alternates (with `x-default`) on every translated page, a sitemap that lists each language of each page with its alternates, and `noindex` on a page that is only showing the default language under another language's address |
| **Editors** | A language picker in the admin (shown only when you can write in more than one language), a **Languages** column on pages and posts showing which languages have text, and a first translation that needs only the fields being translated |
| **Administrators** | A **Site languages** entry (Administration, Site features) with one settings page per site |

## Turning a language on

1. Choose the site in the site switcher, then open **Administration → Site features → Site languages**. Each site has its own page there.
2. Choose the languages the site offers and its **default language**. The default is what addresses without a prefix show, and what a missing translation falls back to. Leave the list empty for English only.
3. Save. Editors working on that site now see the language picker; visitors see the switcher on themes that include it.

A site's default language needn't be English. A French-only site simply lists French and makes it the default; English is then not offered to its editors.

## Writing a translation

Open a page or post and pick the language at the top of the screen. Fields you haven't translated show the default language's text, and saving a translation needs only what you are translating: a field that is *required* is required in the site's default language only. **Publishing publishes every language together** (publishing one language on its own is a later step).

Not translated: the page's address (`/fr/about` is the same slug as `/about`), its pictures, links and the order of its blocks. Those are shared by every language.

## What a visitor sees when something isn't translated

- A field with no translation shows the default language's text.
- A page with no text in French at all is still reachable at `/fr/…` (showing the default text) but is marked `noindex`, left out of the sitemap and out of `hreflang`, so search engines don't see two copies.
- A language the site doesn't offer is just a missing page (a 404).

## For theme builders

- Use `useLocalePath()` for internal links so the visitor stays in their language: `<NuxtLink :to="localePath(item.href)">`.
- Put `<SiteSlot name="language-switcher" />` where the switcher should go; it draws nothing on a site with one language.
- Use `useT()` for fixed words: `t("form.thanks", "Thank you.")`. The English is written in the call; a language is added by registering a dictionary from a Nuxt plugin that depends on `strings`: `nuxtApp.$strings.register("fr", { "form.thanks": "Merci." })`. This plugin ships French, Spanish and German for the core's words (forms, captcha, the error page) and the news section's.
- The switcher draws plain unstyled links with the class `poly-language-switcher`; style it from your theme.

## Settings that are not here yet

Translated addresses (the slug is the same in every language), publishing one language at a time, machine translation and a domain per language. A "this language is live / preview only" switch for a site is also not built.

## For developers

```text
src/index.js                     the plugin: the site-languages collection, which languages an editor may write in, a Languages column on the lists
src/languages.js                 the rules (what a site offers, who may write in which language, what the settings must satisfy)
src/admin/LanguageSelect.js      the language menu of the settings page (plain text values, the catalog enforced by validation)
src/admin/LanguageMarker.js      shows the admin's language picker only when there is more than one language
src/admin/TranslationsCell.js    the Languages column: one tag per offered language, faint when there is no text
migrations/                      the plugin's own database migrations (its tables only)
web/                             the Nuxt layer: the switcher, the head tags, dictionaries (fr, es, de)
test/, web/utils/*.test.ts       unit tests (`node --test test/*.test.js` in this folder for the first); tests/e2e/multilang.e2e.mjs in the core repository drives a whole site through two languages
```

**Where the choice is stored.** In this plugin's own `site-languages` collection, one row per site (`languages`, a list of codes from the core's catalog, and `defaultLanguage`), both plain text: a language is never a database enum, because the catalog belongs to the core and grows with its releases, so the catalog is enforced by validation instead. Nothing is added to Sites or any other core table; the plugin's migration creates `site_languages` and `site_languages_texts` and touches only Payload's own bookkeeping table.

**How the core reads it.** The manifest says `"kind": "site-settings"`, so the core attaches the row's public fields to every site it returns, as `site.extensions.languages` (`{ languages, defaultLanguage }`). That key is the core's contract: the CMS (the search index, required-field rules) and the public web app (routing, the sitemap, `<html lang>`) read it, and any plugin could supply it. A site without it offers English only. Removing or deactivating the plugin therefore needs no migration: the key disappears, every site is English only, and the rows stay in `site_languages` until the plugin is put back.
