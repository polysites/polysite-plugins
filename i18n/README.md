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

Not translated: its pictures, links and the order of its blocks (shared by every language). A page's address can be translated: see "A page's address in each language".

## What a visitor sees when something isn't translated

- A field with no translation shows the default language's text.
- A page with no text in French at all is still reachable at `/fr/…` (showing the default text) but is marked `noindex`, left out of the sitemap and out of `hreflang`, so search engines don't see two copies.
- A language the site doesn't offer is just a missing page (a 404).

## For theme builders

- Use `useLocalePath()` for internal links so the visitor stays in their language: `<NuxtLink :to="localePath(item.href)">`.
- Put `<SiteSlot name="language-switcher" />` where the switcher should go; it draws nothing on a site with one language.
- Use `useT()` for fixed words: `t("form.thanks", "Thank you.")`. The English is written in the call; a language is added by registering a dictionary from a Nuxt plugin that depends on `strings`: `nuxtApp.$strings.register("fr", { "form.thanks": "Merci." })`. This plugin ships French, Spanish and German for the core's words (forms, captcha, the error page) and the news section's.
- The switcher draws plain unstyled links with the class `poly-language-switcher`; style it from your theme.

## A language that is not live yet (preview only)

On the same **Site languages** page, **Preview only (not live yet)** lists languages that editors can write in and preview but visitors cannot reach: no address (`/fr/about` is a 404), no entry in the switcher, `hreflang` or the sitemap. Take a language out of the list to put it live. The default language is always live. This is how a half-translated language stays private until it is ready (publishing one language on its own is still not built: Payload's per-language publish status is experimental).

To look at a preview-only language, open the page's **Live Preview** in the admin while that language is selected: the address it opens carries a signed link (`?_pl=...`, good for 12 hours, for that one language on that one site). The page is sent `noindex` and is never stored by the page cache. Links inside the previewed page do not carry the signature, so move around by choosing the language in the admin, not by clicking.

## A page's address in each language

Pages have an **Address in this language** field (below the shared **Address**). With French selected, `a-propos` makes the page `/fr/a-propos`; empty keeps `/fr/about`. Any script works (`/ar/من-نحن`). The shared address stays the page's identity and the default language's address. The old address keeps working: `/fr/about` sends visitors on to `/fr/a-propos` (a 301), and changing a translated address leaves a redirect from the old one (the URL manager shows it as `fr/<old address>`). The switcher, `hreflang` and the sitemap use each language's own address. An address must be unique among the site's pages in that language and cannot be a language code or one the site itself uses. Not covered yet: news posts (a post keeps its shared address under the language prefix, and the news section's own address, `/fr/news`, is the same in every language), and links typed inside content or menus (they stay as typed; a link to an old address is redirected).

## Machine translation (optional, off by default)

A **Translate** button on pages and posts translates the page you are on from the site's default language into another language and saves it as a draft. It is off until two things are true:

1. the server has a provider, set in its environment (never in the database or git):

   | Variable | |
   | --- | --- |
   | `POLYSITE_TRANSLATE_PROVIDER` | `claude`, `libretranslate` (or `echo`, which only marks text, for development; it refuses to run in production) |
   | `POLYSITE_TRANSLATE_API_KEY` | `claude`: an Anthropic API key. `libretranslate`: its key, if its server wants one |
   | `POLYSITE_TRANSLATE_URL` | `libretranslate`: the server address (a self-hosted one keeps the text on your own machine). `claude`: an alternative API address, such as a proxy |
   | `POLYSITE_TRANSLATE_MODEL` | `claude`: the model (default `claude-haiku-5-5`) |
   | `POLYSITE_TRANSLATE_MAX_CHARS` | the most text one translation may send (default 30000) |

2. the site switches **Machine translation helper** on, on its **Site languages** page.

What is sent: the prose of that one page or post that has no translation yet (text, long text and rich text; for rich text only the text itself, in order, so bold, links and headings are kept), and the two language names. Never form submissions, visitors' data, users, or anything outside that document. The person pressing the button must be allowed to change the page.

What happens next: the translation is saved as a **draft** in the target language, nothing goes live, and what is already translated is never overwritten. The language is marked in the list (`fr*`, dashed) as machine-translated, and **the page cannot be published until someone has read it and chosen "Mark fr as reviewed"**. Add a provider by writing one function (`translate({ texts, from, to })` returning the translated strings in the same order, in `src/translate/providers.js`).

Limits: a sentence split across differently formatted text nodes (a bold word in the middle) is translated in pieces; code blocks are left alone; the helper does not translate menu or footer labels (those are on the site's own screen).

## Settings that are not here yet

Publishing one language on its own (per document), translated addresses for news posts, and a domain per language.

## Right-to-left languages

The reading direction follows the language (`<html dir="rtl">` for Arabic, Hebrew, Persian, Urdu and the other right-to-left languages in the catalog). The core and the starter theme use logical CSS (`margin-inline-start`, `text-align: start`, ...), so a theme that does the same turns around by itself; `Polysite-themes/scripts/check-rtl.mjs` reports any left/right left in a theme. A directional arrow written as a character needs `class="poly-arrow"` so it is mirrored.

## For developers

```text
src/index.js                     the plugin: the site-languages collection, which languages an editor may write in, a Languages column on the lists
src/languages.js                 the rules (what a site offers, who may write in which language, what the settings must satisfy)
src/admin/LanguageSelect.js      the language menu of the settings page (plain text values, the catalog enforced by validation)
src/admin/LanguageMarker.js      shows the admin's language picker only when there is more than one language
src/admin/TranslateButton.js     the machine-translation button and the "mark reviewed" buttons
src/translate/                   providers.js (claude, libretranslate, echo), walk.js (finds the prose and puts the translation back), service.js (the endpoints and the publish guard)
src/admin/TranslationsCell.js    the Languages column: one tag per offered language, faint when there is no text
migrations/                      the plugin's own database migrations (its tables only)
web/                             the Nuxt layer: the switcher, the head tags, dictionaries (fr, es, de)
test/, web/utils/*.test.ts       unit tests (`node --test test/*.test.js` in this folder for the first); tests/e2e/multilang.e2e.mjs in the core repository drives a whole site through two languages
```

**Where the choice is stored.** In this plugin's own `site-languages` collection, one row per site (`languages`, a list of codes from the core's catalog, and `defaultLanguage`), both plain text: a language is never a database enum, because the catalog belongs to the core and grows with its releases, so the catalog is enforced by validation instead. Nothing is added to Sites or any other core table; the plugin's migration creates `site_languages` and `site_languages_texts` and touches only Payload's own bookkeeping table.

**How the core reads it.** The manifest says `"kind": "site-settings"`, so the core attaches the row's public fields to every site it returns, as `site.extensions.languages` (`{ languages, defaultLanguage }`). That key is the core's contract: the CMS (the search index, required-field rules) and the public web app (routing, the sitemap, `<html lang>`) read it, and any plugin could supply it. A site without it offers English only. Removing or deactivating the plugin therefore needs no migration: the key disappears, every site is English only, and the rows stay in `site_languages` until the plugin is put back.
