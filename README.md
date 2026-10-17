<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/polysite-logo-reversed.svg">
    <img src=".github/assets/polysite-logo.svg" alt="Polysite CMS" width="280">
  </picture>
</p>

<h3 align="center">Polysite Plugins</h3>

<p align="center">
  Optional, independently versioned capabilities for the Polysite CMS —<br>
  drop a folder in, restart, and it's live.
</p>

<p align="center">
  <a href="LICENSE.md"><img alt="License: Polysite Source-Available" src="https://img.shields.io/badge/license-Source--Available-3E5BA6"></a>
  <img alt="Payload 3" src="https://img.shields.io/badge/for-Payload%203-16213E">
  <img alt="Plain ESM JavaScript" src="https://img.shields.io/badge/code-plain%20ESM%20JS-F7DF1E">
  <img alt="Status: pre-1.0" src="https://img.shields.io/badge/status-pre--1.0-orange">
</p>

<p align="center">
  <a href="#available-plugins">Plugins</a> ·
  <a href="#install">Install</a> ·
  <a href="#build-your-own">Build your own</a> ·
  <a href="#license">License</a>
</p>

---

## What is this?

[Polysite](https://github.com/polysites/polysite) keeps its core
generic on purpose. Everything optional — how email is sent, how editors get
alerted — lives here instead, as plugins you can add, remove or replace
without touching the core app.

Each plugin is a self-contained package with its own `package.json`, version
and README. Polysite's CMS finds them at boot and applies them for you:
there is no config file to edit.

## Available plugins

| Plugin | Scope | What it does |
| --- | --- | --- |
| [`email`](email/README.md) | global | Real SMTP email for password resets and everything else Payload sends. Host, port, user and from-address are edited in the admin; the password is **encrypted at rest** and never shown again. Handles port 465 (implicit TLS) and 587/25 (STARTTLS), keeps a single pooled connection, and retries temporary failures. |
| [`analytics`](analytics/README.md) | per-site | Analytics and advertising tools chosen per site instead of pasted scripts: Google Analytics, Tag Manager, Meta, TikTok, LinkedIn, X, Plausible, Umami or a custom script. Consent handling, Do Not Track, form conversions, and form-submission counts. |
| [`posts`](posts/README.md) | per-site | News and articles: posts and categories with a rich-text body, a per-site news section, an RSS feed and SEO. A **content-type plugin** with its own web part. |
| [`notifications`](notifications/README.md) | global | Tell people when content changes — **opt-in per item, for any collection.** Watch a document from its menu; get a bell in the admin, or route to Slack, Microsoft Teams, a signed webhook or email. Queued with retries, logged per delivery, and guarded against server-side request forgery. |
| [`auth`](auth/README.md) | global | Sign-in security: single sign-on (Google, Microsoft, GitHub, any OpenID Connect provider) that only ever signs in people who already have an account, two-factor sign-in with an authenticator app (recovery codes, an optional "required" policy, an administrator reset), lockout settings, API keys and an optional Cloudflare Turnstile check on the sign-in and forgot-password pages. Secrets are encrypted at rest and never shown. |
| [`i18n`](i18n/README.md) | global | Languages: a site can offer several, each with its own address (`/fr/about`), a language switcher, `hreflang` and `noindex` for search engines, a translated sitemap, a languages column and picker in the admin, and dictionaries for the fixed words. Needs nothing installed to keep working: removing it keeps every translation and sites go back to English only. |
| [`search`](search/README.md) | per-site | Visitor-facing site search: a search box a theme places with one slot and a results page at `/search`, over a site's **published** pages and posts (and any content type that has public addresses), in the visitor's language with the site's default as the fallback. It matches **titles, addresses and body text**. Each site switches it on, sets the placeholder and results per page, and chooses what is searchable. A rate-limited, site-scoped endpoint that never returns drafts or another site's content. |
| [`share`](share/README.md) | per-site | Share buttons for the page a visitor is on: Facebook, X, LinkedIn, WhatsApp, Telegram, Reddit, email, copy link and the device's own share menu. Plain links with `rel="noopener noreferrer"`: no third-party scripts, no tracking pixels, nothing requested until a visitor clicks, and they work without JavaScript. Chosen per site: which buttons, floating or placed by the theme, and which kinds of page. The shared title and canonical address come from the page itself, in the visitor's language. |
| [`webhooks`](webhooks/README.md) | global | Tell other systems when something changes. A page or post is created, updated, published, unpublished or deleted, a form is submitted, or a file is uploaded: Polysite sends a small **signed JSON message** (ids, titles and links, never content or what a visitor typed) to the addresses a Super Admin chooses, for one site or all. Retried through the job queue with backoff, logged per delivery, switched off automatically when an endpoint keeps failing, with **Send test event** and **Replay** buttons and guarded against server-side request forgery. URL and secret are encrypted at rest. |
| [`wordpress-import`](wordpress-import/README.md) | global | Bring a WordPress site into a Polysite site from its export file: pages, posts (with the posts plugin), categories and tags, images, the header menu and 301 redirects from the old addresses. A dry run first, drafts by default, and a re-run updates instead of duplicating. Run by Super Admins and by site-settings managers for their own sites. |
| [`mcp`](mcp/README.md) | global | Lets AI agents such as Claude work on the install over MCP (`/api/mcp`): look up the available page blocks, create and update **draft** pages from them, and create forms from a plain description. Agents never publish or delete: a key acts as a user with the seeded **AI Editor** role, and only a Super Admin can make keys. Wraps Payload's official MCP plugin. |
| [`blocks-pack`](blocks-pack/README.md) | global | Eleven extra page-builder blocks for the kinds of site people build: **gallery, pricing, testimonials, timeline, team, call to action, opening hours and contact, price list** (salon services, menus, catalogues), **schedule, key figures and logos**. Plain, accessible, responsive defaults (semantic lists, `<address>`, `<time>`, AA contrast, no outside requests) that a theme restyles with CSS or replaces by shipping a component of the same name. Text is escaped, links are limited to http, https, mailto, tel and relative, and every field is translatable where it is prose. The blocks keep their data in tables of their own; removing the plugin keeps it. |

**Scope** is `global` (one installation-wide plugin, infrastructure that isn't a
meaningful per-site toggle) or `per-site` (each site chooses for itself, in a
settings row or a module tick: a site that hasn't is exactly as it was). It is
the plugin's own statement in its manifest and is shown for information; the
core loads every installed plugin the same way. Note that `i18n` is `global`
but its languages are chosen per site, and `webhooks` and `wordpress-import`
are `global` administration tools.

## Install

Clone this repository next to the Polysite core and tell the core where it is. In development, `docker-compose.dev.yml` mounts the folder into the
CMS and web containers; the core's README, "Themes and plugins", has the full steps.

```bash
git clone git@github.com:polysites/polysite-plugins.git      # next to the polysite folder
# in polysite/.env:  POLYSITE_PLUGINS_DIR=../polysite-plugins
cd polysite && docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.workspace.yml up -d --build
```

Cloning it into a `plugins/` folder inside the core still works too (`docker compose restart cms web` after adding a plugin).
On start, the dev CMS container installs each plugin's own dependencies,
regenerates the admin import map, and loads whatever it finds in `plugins/`; the
web app loads the `web/` part of the ones that have one. Then configure a
plugin where it lives in the admin (for example *Email Settings* under
*Administration → Email*, or *Site search* under *Administration → Site
features*). Dev databases get each plugin's tables from the schema sync on
boot.

In production plugins are **built into the images** (the CMS and web
Dockerfiles copy `plugins/`, and the CMS one installs each plugin's dependencies), so
installing or removing one means building new images from source; the
published core images hold no plugins (see the core's `docs/guide/plugins.md`
and `docker-compose.prod.yml`). The plugin's own migrations then create its
tables when the CMS starts (see "Database changes").

To use only some plugins, remove the folders you don't want, or list them in
`POLYSITE_PLUGINS_OFF`. A folder without a `polysite.plugin.json` is ignored. A
plugin with an unparsable manifest, no `src/index.js`, or a `package.json` that
lacks `"type": "module"` is skipped with a message in the CMS log (prefixed
`[plugins]`) rather than breaking boot.

## Build your own

A plugin is a directory with three things:

```text
plugins/my-plugin/
  polysite.plugin.json   the manifest the CMS reads at boot
  package.json           a normal package; must contain "type": "module"
  src/index.js           default export: a Payload plugin function
```

`polysite.plugin.json`:

```json
{ "slug": "my-plugin", "label": "My plugin", "scope": "global", "version": "0.1.0" }
```

The manifest can also carry (all optional):

- `"kind"`: `"content-type"` or `"site-settings"`, or an array of both (see the next sections).
- `"migrations"`: the folder holding the plugin's migrations, relative to the plugin (default `migrations`).
- `"requires": { "polysite": ">=0.1.0 <0.3.0" }`: the core versions the plugin works with. Space-separated
  comparators (`>=`, `>`, `<=`, `<`, `=`) that must all hold; no `^`, `~` or `||`. The core compares it with its own
  version (`POLYSITE_VERSION`, set in the released images) and, if the plugin doesn't fit, leaves it out with a message in the
  log (`[plugins] <slug>: not loaded: ...`); nothing of its data is deleted. A development build, which has no version,
  loads every plugin. *This field is read by `apps/cms/src/plugins/requires.ts`, which is new in the core and not yet
  committed at the time of writing.*

`src/index.js` — a plain ES module exporting a standard Payload plugin, which
is just a function that takes the config and returns a new one:

```js
export default function myPlugin(config) {
  return {
    ...config,
    collections: [
      ...(config.collections ?? []),
      { slug: "my-things", fields: [{ name: "title", type: "text", required: true }] },
    ],
  };
}
```

Plugins are applied **last**, after the core and every Payload plugin, so
they can see — and instrument — every collection that exists, including ones
generated by other plugins. (Content-type and site-settings plugins, below, are the
exception: they are applied first, so the core can scope their collections to a site.)

The function also receives a second argument, `kit`: the few helpers a plugin
can't import from the app. Plugins that don't need it ignore it. It has:

| Helper | What it is for |
| --- | --- |
| `hasCapability(user, module, operation)` | The role check every collection's access uses (`create`, `read`, `update`, `delete`, `publish`, `unpublish`, `cloneAcrossSites`); a missing role, module or operation is a no |
| `isSuperAdmin(user)`, `canManageSiteSettings(user)`, `userSiteIds(user)` | Who the person is and which sites they are assigned to |
| `normalizeSlug(value)`, `uniquePerSite(collection, field)` | Slugs, and a `validate` function that keeps a field unique within one site |
| `createSession(...)` | Signs a person in without a password (the same session, token and cookie a password sign-in makes); the caller must already have decided they may. The auth plugin's single sign-on uses it |
| `i18n.localizeNamed(fields, names)` | Makes the named fields translatable, the way the core does for its own; a required one stays required in the default language only |
| `workflow.*` (`publishRules`, `publishAware`, `liveBefore`, `reviewFields`, `isDraftRequest`, `changesLiveSite`, `slugToRedirectFrom`) | The draft, publish, schedule and review rules pages follow (`apps/cms/src/workflow`); posts use them |
| `recordException(err)` | Records an error on the current trace when tracing is on; otherwise does nothing |

Some rules the bundled plugins follow, and yours should too:

- **Stay independent.** Never import from the CMS app's internals. If you need
  a small helper the core also has (an encryption routine, say), copy it —
  that is what keeps a plugin installable on its own.
- **Configure from the database, not just `.env`.** Give admins a Global or
  collection to edit settings in; use environment variables only to seed
  defaults.
- **Encrypt secrets** you store, key them from `PAYLOAD_SECRET`, and return
  them masked from the API.
- **Plain JavaScript.** Next.js does not transpile workspace packages without
  extra setup, so plugins ship as ESM `.js` files rather than TypeScript.
- **Admin components** are referenced by path relative to the CMS app and
  written without JSX (`React.createElement`); see `notifications/src/admin/`.
  They may import Payload's UI hooks (`useConfig`, `useFormFields`, …) from
  `@payloadcms/ui`; the CMS's build config aliases that package for them.

## Content-type plugins

A content type is a set of collections whose items **belong to one site** and usually
have a **public web address**: posts, events, a document library. A plugin becomes one
by saying so in its manifest and in its collections. The core then does the wiring that
would otherwise be written out by hand for each type, the same way a Drupal entity type
declares its own handlers and links.

**Manifest:** add `"kind": "content-type"`. Content-type plugins are applied *before*
the core plugins, so the per-site scoping, SEO and URL-index wiring can see their
collections.

**Collections:** declare each one in Payload's own `custom` slot:

```js
{
  slug: "events",
  // ...fields, access, hooks as usual...
  custom: {
    polysite: {
      module: { label: "Events", value: "events" },   // the role module its permissions use
      icon: { paths: ["M4 5h16v14H4z"] },              // optional: SVG path data (24 x 24, stroked) for the sidebar
      routable: {                                      // only if its items have a public address
        docType: "event",                              // what the URL manager calls it
        urlPath: (doc, { site }) => `events/${doc.slug}`, // the item's address within its site
        previewUrl: (doc, req) => `https://…/events/${doc.slug}`, // for Live Preview
        // seo: false, livePreview: false   — both default to on
      },
    },
  },
}
```

From that the core:

- adds the module to **Roles → Modules** and **Sites → Enabled Modules**, and to the default roles;
- scopes the collection to one site (adds the `site` field and the access filter);
- adds the SEO fields and Live Preview to routable collections;
- adds each routable item to the **Site URLs** index at the path `urlPath` returns.

Collections of one type share a module (posts and post categories are both "posts"). Use the
`kit` for role checks (`kit.hasCapability(user, "events", "update")`) in the access functions.

### The web part

If the type has public addresses, the plugin carries a `web/` folder: a **Nuxt layer**
(with its own `nuxt.config.ts`) found automatically, the way themes are. It can hold
components, composables, utilities and server routes (a feed, say), and it registers its
addresses from a Nuxt plugin:

```ts
// plugins/events/web/plugins/events.ts
export default defineNuxtPlugin({
  name: "events-routes",
  dependsOn: ["content-routes"],
  setup(nuxtApp) {
    nuxtApp.$contentRoutes.register({
      id: "events",
      module: "events",            // only for sites that have this module on
      component: "EventsRoute",    // a component in this layer
      match: (slug, { site }) => (slug.startsWith("events/") ? { slug } : null),
      load: async (match, { nuxtApp }) => ({ /* props for EventsRoute, or null for "not found" */ }),
    });
  },
});
```

The core's catch-all page asks each registered route in turn, so a type needs no change to
the core. A `load` that returns `null` lets the ordinary page lookup (and redirects) take
over. Wrap composables called after an `await` in `nuxtApp.runWithContext`. Tests beside the
layer (`web/**/*.test.ts`) run with the web app's.

### Removing or deactivating one keeps the data

Taking a plugin away never deletes what people created with it. To switch one off without
touching the folder, list it in `POLYSITE_PLUGINS_OFF` (comma separated, for example
`POLYSITE_PLUGINS_OFF=posts`) and restart; deleting the folder works the same. The role module, scoping,
addresses and web part disappear and the rest of the site is unchanged. Its tables, its
posts, categories and per-site settings stay in the database, and so does a site's or
role's tick on the plugin's module (it is kept, not rejected or dropped when the site or
role is saved). Put the plugin back and everything is as it was.

Nothing in Polysite deletes a plugin's content; if you ever want it gone, that is a
deliberate database operation. A plugin can offer a **reset settings** button (the posts
plugin does, on its News settings screen), which puts settings back to their defaults and
leaves content alone.

Two things could still delete the data by accident, and both are guarded:

- **A migration generated while a plugin is missing** sees its tables as removed and
  writes `DROP TABLE`. `payload migrate:create` refuses to run while
  `POLYSITE_PLUGINS_OFF` is set, and `npm run check:migrations` (in the commit hook and CI)
  fails any migration that drops a table, column or type or deletes rows, unless it carries
  a `polysite:allow-destructive` comment. Generate migrations with every plugin present.
- **Local development syncs tables to the config on every boot** and would offer to drop the
  removed plugin's. Answer no, or set `POLYSITE_DB_PUSH=false` in `.env` to stop the sync
  altogether (then a table change needs a migration, as in production).

In production nothing is dropped on boot: tables only change when a migration is run.

The bundled example is [`posts`](posts/README.md).

## The isolation rule

> **The core runs without any plugin. A plugin runs without changing the core. A plugin keeps
> its data in its own tables.**

A plugin may change *behaviour* of the core through its extension points (hooks on a
collection, endpoints, the registries below). It may not change the core's *schema*: it adds
no field, column, enum value or table to a core collection (`sites`, `users`, `pages`, ...).
This is how WordPress plugins (own tables, own options), Drupal modules (own schema, field
storage in separate tables) and Laravel packages (own migrations) stay installable and
removable. It is enforced, not just advised: see "Database changes" below.

What that means in practice:

- **Per-site settings** go in your own collection, one row per site (next section), never as
  a tab of fields on Sites.
- **Per-user state** (a second-factor secret, a preference) goes in your own collection with
  a `user` relationship, never as extra fields on Users. A `ui` field (no data, no column)
  on a core collection is fine.
- **Lists that depend on what is installed** (the modules a role may touch, the content types
  a feature covers) are stored as plain text, never as a `select`: a select is a Postgres
  enum, and installing or removing another plugin would change it.
- Your own collections may use selects, groups, arrays and blocks freely: they are your tables.
- Payload keeps one relationship column per collection in `payload_locked_documents_rels`,
  `payload_preferences_rels` and the URL index's `site_urls_rels`. Adding a collection adds a
  column there, and that is the only change to a core table a plugin migration may contain. (A plugin that registers a
  job-queue task also adds its name to the two task-slug enums of the job queue, which the check allows.)

## Per-site settings

Declare a collection as a site's settings and the core does the rest. Manifest:
`"kind": "site-settings"` (or `["content-type", "site-settings"]`); collection:

```js
{
  slug: "search-settings",
  fields: [{ name: "enabled", type: "checkbox" }, { name: "perPage", type: "number" } /* ... */],
  access: { read: ({ req: { user } }) => Boolean(user), update: ({ req: { user } }) => kit.canManageSiteSettings(user) /* ... */ },
  custom: { polysite: { siteSettings: { key: "search", publicFields: ["enabled", "perPage"] } } },
}
```

The core then:

- scopes the collection to a site and makes it **one row per site**: the admin opens the
  current site's row straight from the sidebar (the multi-tenant plugin's `isGlobal` mode);
- attaches the row's `publicFields` to every site the API returns, as **`site.extensions.<key>`**,
  so the public site reads them with the request it already makes. Nothing else in the row ever
  leaves the admin, so a secret in a settings row cannot reach a visitor by accident;
- refreshes the public site when the row changes or is deleted.

A site with no row yet has no `extensions.<key>`: treat that as your defaults.

To appear where the bundled plugins do, under **Administration → Site features**, set
`admin: { group: "Administration", custom: { navSubgroup: "Site features" }, hidden: ({ user }) => !kit.canManageSiteSettings(user) }`
(the sidebar reads `navSubgroup` from `admin.custom`, not from the collection's own `custom`), and let site editors read the row
but only people who can manage site settings change it. A text shown to visitors that should differ per language goes through
`kit.i18n.localizeNamed`.

## Database changes

Every plugin ships **its own migrations** in `plugins/<slug>/migrations/`: plain ESM files named
`<timestamp>_<name>.js`, exporting `up({ db, sql })` and `down({ db, sql })` (`sql` is handed in so a
plugin needs no database driver). The core runs them on start in production, after its own and
in plugin order, through the database adapter's `prodMigrations`, and records each as
`<slug>__<file>`. The core's own migrations contain core tables only; a fresh install of the
core alone has no plugin table in it. In local development Payload syncs the schema on boot and
the migrations are not used.

Generate and check them inside the CMS container (they never touch your database):

```bash
docker compose exec cms sh scripts/pluginMigrations.sh plugin <slug> <name>   # create a plugin's migration
docker compose exec cms sh scripts/pluginMigrations.sh check [<slug>]         # verify the core and every plugin (or one)
docker compose exec cms sh scripts/pluginMigrations.sh rebase <slug>          # after the core gained a migration
```

(`npm run check:plugin-isolation` in `apps/cms` runs the same check.)

A plugin's migration is the difference between "the core" and "the core plus this one plugin"
(only that plugin is loaded while it is generated), so it contains what the plugin adds and
nothing else, whatever other plugins are installed. `check` runs in CI and fails when a plugin
migration alters a table the plugin did not create (in this migration or an earlier one of its own: a later migration may add a column to its own table; the three bookkeeping tables above are the other exception), drops
anything, or when a plugin's collections have changed without a migration. When the *core* gains a
migration, run `scripts/pluginMigrations.sh rebase <slug>` for each plugin that passed `check` before.

**Removing a plugin never deletes its data**: the tables stay, unused. Putting the plugin back finds
everything as it was.

## Testing

Each plugin's unit tests need no database and run in the CMS container (the plugins folder is mounted there):

```bash
docker exec polysite-cms-1 sh -c 'cd /repo/plugins/<slug> && node --test test/*.test.js'
```

A plugin's `web/` tests (`*.test.ts`) run with the web app's (`npx vitest run` in `apps/web`). Checks that need a
running stack live in `test/e2e/` of the plugin that has them, and most are run together by the core's
`tests/e2e/run-with-plugins.sh`. The dev CMS container sets `NOTIFY_ALLOW_PRIVATE_HOSTS=1`, so run the notifications
tests with `env -u NOTIFY_ALLOW_PRIVATE_HOSTS` in front of `node` (see its README).

## Why a separate repository?

The core is the generic, reusable product; plugins are optional,
separately-maintainable add-ons. Keeping them in their own repo means a
customer can license or a contributor can extend one capability without
needing the whole core codebase. Each plugin is already an independent package,
so splitting any single one into its own repository later is a mechanical
move (`git subtree split`), not a redesign.

## Roadmap

Single sign-on (in `auth`), visitor-facing search, share buttons, webhooks, the
WordPress import and the approval workflow (drafts, scheduled publish and a
review marker, which pages and posts share through the core) are built; they
are not on this list. What is next:

- **Language follow-ups** for the `i18n` plugin: translated addresses (the
  slug is the same in every language today), publishing one language at a time,
  machine translation, and a per-site "language is live / preview only" switch.
- **A command-line tool** for installing, checking and upgrading a server
  (`polysite plugin add|list|remove|purge`, in the core repository,
  pre-release and not yet verified against a real stack) and **versioned
  releases** of the core.
- Smaller items named in a plugin's own README: more webhook events and
  custom headers, a retention job for notification deliveries, a redirect when
  a post's slug changes.

## License

Licensed under the **Polysite Source-Available License, version 1.0**, ©
2026 Quick Support Today Inc. — see [LICENSE.md](LICENSE.md). The license
covers the whole Polysite product, including these plugins. In short, you may use and
modify these plugins for your own internal business purposes — including your own
organization's websites — or for non-commercial purposes, and share them free
of charge for non-commercial purposes, with a copy of the license. Selling them
(or charging for access to a plugin you write), offering them to others as a
hosted or managed service, using them for client work (building or running sites for clients for a fee), or bundling
them into a product you sell needs a separate written agreement, and the
Polysite name and logo are not licensed for your own use. The license text governs. For commercial use, contact the
licensor through the [`polysites`](https://github.com/polysites)
organization on GitHub.
