# Share plugin: share buttons

Lets a site show buttons that share the page a visitor is on: Facebook, X, LinkedIn, WhatsApp, Telegram, Reddit,
email, "copy link" and the device's own share menu. It is built to keep visitors private: the buttons are plain
links, there are no third-party scripts, no tracking pixels and no widgets, and **nothing is requested from any
other website until a visitor clicks one**.

**Scope:** per-site. Install it once; each site switches the buttons on for itself (off by default), chooses its
buttons, and chooses which kinds of page get them. A site that hasn't switched it on is exactly as it was.

## What a visitor sees

| | |
| --- | --- |
| **Buttons** | The networks the site chose, in the order it chose, as a list of links. Icon and name, icons only, or names only. |
| **Where** | A bar floating along the bottom of the page or at its side (at the bottom on narrow screens), or in the page itself where the theme has made a place for it. |
| **The shared page** | The page's own address (the canonical one, on the site's own domain, in the visitor's language: `/fr/about`) and its own title, read from the same tags the page already writes for search engines and social sites. |
| **Copy link** | Copies the address and says "Link copied" (announced to screen readers). Appears only once the page has loaded. |
| **Share...** | The phone or computer's own share menu, only on browsers that have one. |

## Turning it on for a site

Choose the site, then open **Administration → Site features → Share buttons** (one settings page per site; it needs the permission to manage site settings).

- **Show share buttons on this site.** Off by default.
- **Buttons.** Which networks, in this order. Facebook, X, LinkedIn, WhatsApp, Telegram, Reddit, Email, Copy link
  and the device's share menu. Choose at least one.
- **Look.** Icon and name, icons only, or names only. A floating bar always shows icons only.
- **Where.** *Floating, along the bottom* (the default), *floating, at the side*, or *where the theme puts it*.
  Floating works with every theme. The last one shows the buttons only where the theme has made a place for them
  (below).
- **Show on.** The home page, pages, news and articles (the posts plugin), and other content types that plugins
  add. Pages and news are on by default.
- **Message (optional).** Words that go in front of the page's title when someone shares, on the networks that
  carry a message (X, WhatsApp, Telegram, email): `Worth a read:`. Write `{title}` to put the title somewhere
  else: `Read "{title}" and tell a friend.` On a site in several languages the message is written per language.
- **X account (optional).** Your handle, like `polysite`. X adds "via @polysite".

Saving refreshes the public site, so a change shows within a few seconds even on pages it had already cached.

## Privacy

- Every network button is an ordinary link with `rel="noopener noreferrer"`, opening the network's own share
  page in a new tab. Email is a `mailto:` link.
- The icons are drawn into the page (inline SVG). The plugin loads no script, image, font or frame from anywhere.
- Nothing is sent when the page loads or when the buttons are shown. A network learns that someone is sharing the
  page only when that person clicks.
- It sets no cookie and writes nothing to the browser's storage, so it needs no consent notice.
- The address that is shared has no fragment, no password and none of the common tracking parameters
  (`utm_*`, `fbclid`, `gclid` and the like), and must be `http` or `https`.
- Titles and messages are cleaned (one line, no control characters, at most 200 characters) and percent-encoded
  for each network, so a title with quotes, ampersands or markup can't break out of an address.

## Works without JavaScript

The server sends the finished links in the page's HTML. JavaScript only adds "Copy link", the device's share menu
and the "Link copied" message, and keeps the title and address right as a visitor moves between pages without
reloading.

## Accessibility

The buttons are a navigation landmark labelled "Share this page". Each has a name that says what it does ("Share
on Facebook", "Share by email", "Copy link"), is at least 44 pixels square, and has a visible focus outline.
"Link copied" is announced through a polite live region. The floating bar is hidden when printing.

## Languages

The fixed words (the labels, "Link copied") are translated into French, Spanish and German and follow the
language of the address; other languages show English. The message is written per language on the settings page.

## For theme builders

The plugin fills a slot named `share`. Place it where you want the buttons, after the page's content (it reads
the page's title once the page has set it):

```vue
<SiteSlot name="share" />
```

or use the component directly: `<ShareButtons />`. Either draws nothing unless the site chose *where the theme
puts it* and the page's kind is ticked, so a theme that places it never gets a second, floating copy. Style it
with the `poly-share*` classes (`poly-share`, `poly-share-heading`, `poly-share-list`, `poly-share-item`,
`poly-share-name`, `poly-share-icon`, and one class per network such as `poly-share-facebook`), or set
`--poly-share-bg`, `--poly-share-fg` and `--poly-share-radius`. The inline buttons take the text colour of
whatever they sit in, so they follow a theme's light and dark colours on their own. The floating bar has its own
surface, light or dark by the visitor's setting unless the theme sets those variables.

When someone follows a link or copies the address, the page dispatches a `polysite:share` event on `window`
(`detail`: `network`, `url`, `title`). Nothing listens for it and it sends nothing; a script of the site's own can
use it, for example to count shares in the analytics tool the site already runs.

## Limits

- The share addresses are the networks' published ones (Facebook's sharer, X's intent, LinkedIn's share-offsite,
  `wa.me`, Telegram's share URL, Reddit's submit page). They have not been tried against live accounts here, and
  networks change them now and then: they live in one place, `web/utils/share.js`. Facebook and LinkedIn take only
  the address, so the title and the message appear on those networks only if the page's own Open Graph tags say so.
- The buttons, the look and the placement are fixed choices (enumerations in the plugin's own table). Adding a network needs a
  migration of the plugin. The kinds of page are plain text, so a content type from another plugin shares "other content types".
- The plugin does not report shares to the analytics plugin: the core has no generic extension point for a
  plugin's own events (its site events are a fixed pair), so there is the plain browser event above instead.
- Shares are not counted. Counting would need a request to each network when the page loads, which this plugin
  never makes.

## Adding the plugin to an install

The plugin keeps its settings in its own table (`share_settings` and the small tables of its lists) and ships the migration
that creates them in `migrations/`; nothing is added to Sites or any other table of the core. The core runs the plugin's
migrations on boot. Removing the plugin keeps every site's settings.

## For developers

```text
polysite.plugin.json         the manifest (per-site, kind site-settings)
migrations/                  the plugin's own database migrations (generated by the core's scripts/pluginMigrations.sh)
src/index.js                 the plugin: the `share-settings` collection (one row per site, its own table)
web/utils/share.js           the rules, in plain JavaScript shared by both halves: the lists of choices, link building, cleaning, settings
web/utils/shareIcons.js      the icons
web/composables/useSharePage.ts   the page's address, title and kind (server and browser)
web/components/ShareButtons.vue   the buttons; ShareFloating.vue is the copy in the app slot
web/plugins/share.ts         registers the slots and the dictionaries
web/locales/                 fr, es, de
test/share.test.js           unit tests (node:test, no Nuxt or Payload needed)
test/e2e/share.e2e.mjs       drives a running stack: settings through the API, the pages the site renders, two sites, languages
```

How the title gets into the links: this component is drawn alongside the page, and the page writes its title only
once its data has arrived, so the server draws each link with a one-off placeholder where the title goes and swaps
the real, percent-encoded title in when the whole page has been rendered and every head tag is final (Nuxt's
`app:rendered` moment). The browser starts from the finished state.

## Tests

```bash
docker exec polysite-cms-1 sh -c 'cd /repo/plugins/share && node --test test/*.test.js'
```

With the plugin installed in a running stack (settings, rendered pages, a second site):

```bash
docker run --rm --network polysite_default -e BASE=http://cms:3001 -e WEB=http://web:3000 \
  -e ADMIN_EMAIL=<a Super Admin> -e ADMIN_PASSWORD=<its password> -e SITE_ID=1 -e SITE_HOST=voidslate.localhost \
  -e OTHER_SITE_ID=2 -e OTHER_HOST=second.localhost -v "$PWD/plugins/share:/w:ro" -w /w node:22 node test/e2e/share.e2e.mjs
```

The core repository's `tests/e2e/run-with-plugins.sh` builds a stack with the plugins and runs this check with the others.
