# Site search

Lets visitors search a site's **published** pages and posts: a search box a theme can place anywhere, and a
results page at `/search` with highlighted matches, a short summary under each result, and page links.
Every site chooses for itself whether search is on, what it covers, and how many results a page shows.

Search matches **titles, addresses and body text**. It reads the index Polysite already keeps of every page and item a site
answers to (the **Site URLs** list in the admin), which carries each live entry's title, address and the plain text of its
body (`searchText`, added by the core), so anything a content-type plugin publishes is searchable the moment its plugin is
installed, with nothing to configure. See [How it matches](#how-it-matches).

**Scope:** per-site. The plugin is installed once, and each site switches it on for itself (off by default).

## What it adds

- **A "Site search" settings page** (Administration → Site features → Site search): one document per site, the one for the site chosen in
  the site switcher, created the first time it is saved. It lives in the plugin's own `search-settings` table; nothing is
  added to Sites. Changing it needs the site-settings permission.
  - **Switch search on.** Turns on the results page and the search box. Off by default.
  - **Placeholder text.** What the empty box says. Leave empty for the standard words in the visitor's
    language. Written per language on a site that offers several.
  - **Results per page.** 1 to 50, ten by default.
  - **What visitors can search.** Pages, and every content type that has public addresses (posts, for
    example). Leave empty to search all of them. A content type whose module is switched off for the site is
    never searched.
- **`GET /api/site-search`**, the public endpoint behind both (see below).
- **The web part** (`web/`, a Nuxt layer the web app finds by itself): the search box, the results page,
  and the fixed words in English, French, Spanish and German.

## What visitors get

- A **search box** wherever the theme puts it, and a **results page** at `/search` (or `/fr/search`, and so
  on, on a site with several languages). Searching is an ordinary form, so it works without scripts and a
  search is an address a visitor can share.
- Results ranked by where the words are found (title first, then address, then body text), with the matched words
  highlighted, what kind of item each is, and a snippet under it: the item's excerpt or SEO description, or the part of
  its text around the words.
- Several words must **all** appear, in any order. Case does not matter.
- Clear states for **no results** (with a suggestion), a search that is **too short**, a **busy** server and a
  **failure**, announced to screen readers.
- The results page is marked `noindex`, is never cached, and shows what was typed as text, never as markup.

### Languages

A search runs in the language of the address. `/fr/search?q=grenade` finds French titles. A page that has no
French text yet is searched, and shown, in the site's default language, the same fallback the pages themselves
use; a page that does have French text is judged on its French title only. A language the site does not offer
is searched in the default language.

## For theme builders

Put the box where it belongs in the layout:

```vue
<SiteSlot name="search" />
```

It draws nothing on a site that has not switched search on, and nothing on the results page itself (which
has its own form). The box is a plain `<form role="search">`; style it with the classes `poly-search-form`,
`poly-search-input` and `poly-search-button`. The results page uses `poly-search`, `poly-search-results`,
`poly-search-status`, `poly-search-list`, `poly-search-item`, `poly-search-type`, `poly-search-snippet` and
`poly-search-pages`, with `<mark>` around matches.

A page whose slug is `search` is hidden by the results page, and the results page needs the **Pages** module
on for the site.

## The endpoint

```
GET /api/site-search?domain=example.org&q=budget[&lang=fr][&page=2]
```

Public, no sign-in. The web app calls it with the request's own host name.

| Parameter | |
| --- | --- |
| `domain` | Which site. Required. A site that does not exist, or has not switched search on, answers `404`. |
| `q` | The words. 2 to 100 characters, at most six words. Anything shorter answers `tooShort: true` and reads nothing. |
| `lang` | A language the site offers; otherwise the site's default. |
| `page` | From 1. A page past the end returns the last page. At most 200 results are reachable. |

The answer: `{ q, tooShort, lang, page, perPage, total, totalPages, results: [{ id, collection, type, title, path, snippet }] }`,
never cached (`Cache-Control: no-store`).

**What it can and cannot return.** The index says where to look; every result is then re-read from its live
document **as an anonymous visitor**, so a result is returned only if that document is on this site and is
published, and its own collection's read access allows it. A draft, an unpublished page, a page on another
site, or an index entry whose document has since been deleted never appears, whatever the index still says.

**Limits.** Each address gets 30 searches a minute (`POLYSITE_SEARCH_RATE_LIMIT` changes it; `0` switches it
off), and the whole server 20 times that; past it the answer is `429` with `Retry-After`. The address is the
last one in `X-Forwarded-For`, the one the proxy (Caddy) added, and the results page passes the visitor's
address on, so the limit counts visitors and not the web server. The count lives in the CMS process's
memory. A search reads at most 200 index entries.

## How it matches

- **Every word** must appear, in any order, in the entry's title, its address or its body text. A word matches inside a
  longer word too ("budg" finds "budget"), in any case. Words are looked for as plain text: the characters `% _ \`
  are removed, and everything else (`& | ! : * ' "` and so on) is only ever text to find, never query syntax. The
  words are bound values of a "contains" match; no search expression is built from what was typed.
- **Ranking** (`query.js`, `relevance`): a title that is exactly the search, then one that starts with it, then one where
  every word starts a word of the title, then one that contains every word. Below those, each word scores by where it
  is found, so more words in better places rank higher: in the title 40 (at the start of a word) or 30, else in the
  address 15, else only in the body 4. Ties go to the content type's index priority, then the title.
- **Snippets** (`query.js`, `bodySnippet`): the item's own summary (excerpt, else SEO description) when it shows a
  searched word, otherwise the window of about 220 characters of the body holding the most different searched words,
  cut at word edges with `…`. They are plain text; the results page marks the words and escapes everything. Only the
  bodies of the results on the page being shown are read.
- **Where the text comes from**: the core fills `searchText` when a page or post is saved or published, from the live
  version only (a draft over a live page is not indexed, a page that was never published has none), one value per
  language. It holds the prose fields (text, rich text, blocks, arrays) up to 50,000 characters, never addresses,
  hidden fields or fields with their own read rule.
- **A core without body text** (older than this feature) has no `searchText`; the plugin detects that and searches
  titles and addresses only, as before.
- **Cost**: each word is a case-insensitive "contains" match over the site's entries. Measured on 6,000 entries of about
  7 KB (2,000 for the site searched), one word took about 90 ms in the database, and through the real endpoint a site with 4,000 entries of about 3 KB answered in about 110 ms; cost grows in step with the site's total text. A
  trigram index does not help here (the word may be in the title, the address or the body, which are in different
  tables), so none is kept. The rate limit bounds the load.
- **Languages**: the text is matched the way titles are, per language, with the default language as the fallback. There is
  no stemming and no accent folding, so it works the same for every script, Chinese and Japanese included.

## What it does not do

- **Suggest as you type**, correct spelling, or match word stems ("budgets" does not find "budget").
- **Search other plugins' private collections** (forms, submissions, users). Only items with public
  addresses are searchable.

## Installing, switching off, removing

Install by putting the folder in `plugins/` and restarting, like any plugin. The plugin creates its own tables with its
own migrations (`migrations/`, run by the core on start in production; generate more with `scripts/pluginMigrations.sh`),
and changes no core table. Removing the folder, or listing `search` in `POLYSITE_PLUGINS_OFF`, removes the box, the page and the
endpoint and **deletes nothing**: each site's settings stay in the database.

## For developers

```text
src/index.js        the plugin: the search-settings collection (one row per site) and the endpoint
src/endpoints.js    GET /api/site-search: site lookup, rate limit, validation
src/search.js       one search: index candidates, then live documents re-read as a visitor
src/query.js        cleaning what was typed, ranking, summaries and body snippets
src/ratelimit.js    the fixed-window limiter and who the client is
src/languages.js    which languages a site offers
src/seed.js         dev only: switches search on for the dev site
web/                the Nuxt layer: SearchBox, SearchForm, SearchRoute, dictionaries (fr, es, de)
test/               unit tests; test/e2e/search.e2e.mjs drives a running stack
```

- A content type needs nothing to be searchable beyond being declared `routable` (see the main README's
  content-type plugins section): the core then puts its items in the URL index with their address, and this
  plugin offers the collection in the settings' "What visitors can search" menu.
- The web part registers its results page through `$contentRoutes` and its box through `$siteSlots` (slot
  `search`). It turns off the app's page cache for `/search` and `/*/search`, since a cached search would keep
  every distinct query for good.
- Payload cannot query `doc.relationTo` with `in` on the index (`The following path cannot be queried`);
  `equals` works, so the collection filter is an `or` of `equals`.
- Publishing publishes every language together (see the i18n plugin), so an edit saved as a draft in one
  language and then published in another goes live in both.

Tests: `docker exec polysite-cms-1 sh -c 'cd /repo/plugins/search && node --test test/*.test.js'`.
The web part's tests run with the web app's (`web/utils/search.test.ts`).

The end-to-end check is `test/e2e/search.e2e.mjs`. It needs a running stack with the core and this plugin
(the posts and i18n plugins make it check more), and the same environment as the others in `tests/e2e`:

```bash
docker run --rm --network <project>_default -v "$PWD/plugins/search:/w:ro" -w /w \
  -e BASE=http://cms:3001 -e WEB=http://web:3000 -e SITE_ID=1 -e SITE_HOST=voidslate.localhost -e OTHER_HOST=second.localhost \
  -e ADMIN_EMAIL=<a Super Admin> -e ADMIN_PASSWORD=<its password> node:22 node test/e2e/search.e2e.mjs
```
