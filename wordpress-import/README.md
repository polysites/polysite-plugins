# WordPress import

Bring a WordPress site into a Polysite site: its **pages**, **posts**, **categories and tags**, **images**, **header menu**, and **redirects from the old addresses**, with a dry run first and a re-run that updates instead of duplicating.

It reads a WordPress export file (WXR, the file *Tools, Export* makes). It never runs WordPress or PHP, never contacts the old site except to download the images the content uses, and never touches anything outside the one site you pick.

- **Scope:** global (an administration tool; nothing to switch on per site). Needs the **posts** plugin to import posts; without it the pages still import and the log says the posts were skipped.
- **Who:** Super Admins, and Site Admins (anyone with the *manage site settings* permission) for the sites they are assigned to. A Site User sees nothing of it.
- **Where:** *Administration → Site features → WordPress imports* in the admin; the log is *WordPress import log*, in the same place.
- **Modules:** the manifest says `"kind": "content-type"`, so the core also lists a **WordPress import** module under *Roles → Modules* and *Sites → Enabled Modules*. Access does not depend on it: only the *manage site settings* permission (above) decides who can use the plugin.

## How to use it

### 1. Export from WordPress

In the WordPress admin of the old site: **Tools → Export → All content → Download Export File**. You get one `.xml` file. (Choosing *Pages* or *Posts* only works too.) Media files are not inside it; only their addresses are, which is why the old site should still be online while you import.

### 2. Create the import

*WordPress imports → Create new.* Pick the **site** it goes into (the site selector at the top of the admin), give it a name, and look through the settings. The defaults are the cautious ones: everything arrives as a **draft**, nothing is overwritten.

### 3. Upload, dry run, import

Save, then on the same screen choose the `.xml` file and **Upload**. It is streamed to the server, so a large file is fine (default limit 512 MB, `WORDPRESS_IMPORT_MAX_MB` to change). Then:

1. **Run dry run.** It changes nothing. It shows what is in the file, what an import with the current settings will add, what it will leave out and why (drafts, private and trashed items, password-protected pages, other post types such as products), address conflicts with content already on the site, which images it can fetch and from which hosts it will refuse to, what it will drop on the way (shortcodes, scripts, page-builder layout, tables), and the old and new address of the first items.
2. Change the settings if you like (save first), run the dry run again.
3. **Import now.** It runs in the background; the screen shows progress. When it finishes you get a result and a link to the log.

Review the pages as drafts, publish the ones you want. Run the import again whenever the WordPress site changes: it updates what it made.

## What is imported

| WordPress | Becomes |
| --- | --- |
| Pages | Pages. The slug is kept; a child page keeps its parent in the address (`about-us/team`). The text goes in one text block. Original date kept. |
| Posts | Posts (posts plugin): slug, date, excerpt, featured image, categories. The byline is the WordPress author's name, a fixed name, or none (setting). |
| Categories and tags | Post categories (only those a post uses). A category with the same address that already exists is reused, not duplicated. |
| Featured image and images in the text | Media library. Fetched from the old site only (see Safety), as images or PDFs, once each; resized copies (`photo-300x200.jpg`) resolve to the original. `[gallery ids]` becomes its images. |
| The text | Rich text: headings, paragraphs, bold/italic/underline/strike/code, links, lists (nested too), quotes, rules, images. Links to other pages of the old site are rewritten to the new addresses. |
| A navigation menu | The site's header menu (top level only; the header has one level). Add to the existing menu or replace it. |
| Old addresses | A 301 redirect wherever the new address differs (`/2024/03/spring-day/` to `/news/spring-day`). Never over a page that exists, never over a redirect someone else made. |

Slugs and dates are kept. WordPress drafts, pending, scheduled, private and trashed items are **skipped unless you tick them**, and always arrive as drafts. With *Publish as: Published*, only what was live on WordPress goes live.

## What is not imported (and how you find out)

Nothing is dropped silently. Everything below is counted in the dry run and listed in the log.

- **Comments, users, plugin and theme settings, widgets, custom fields**, and any other post type (products, events, portfolio items...). Reported by type and number.
- **Password-protected pages and posts.** Never imported (they would become public).
- **Page-builder layouts** (Elementor, Divi, WPBakery, Beaver Builder): the text in the saved page is imported, the layout is not. Each such page is listed.
- **Shortcodes** (`[contact-form-7]`, sliders, shop shortcodes...): removed, the text inside them is kept, each kind is counted. `[caption]`, `[gallery ids]` and `[embed]` are converted.
- **Dynamic blocks** from the block editor (latest posts, query loops, navigation): nothing to import; reported.
- **Scripts, styles, forms, object/embed/svg**: removed for safety. An **iframe** or video/audio player becomes a link to its address. A **table** becomes one line per row (the editor has no tables). An image that could not be imported stays as a link to the original.
- **Sub-menus** (the header menu has one level), menu items pointing at something not imported.
- **Categories' hierarchy** (post categories are flat).

## Safety

- **Images only from the old site by default.** The host is read from the export. Other hosts (a CDN) must be listed per import under *Also download images from*. Anything else is refused and logged.
- **Server-side request forgery guard.** Every connection's address is checked at connect time: private, loopback, link-local and cloud-metadata addresses are refused, even if a name resolves to one. Redirects are followed by hand (at most three) and each hop must pass the same checks. `https` is tried first for an `http` address; plain http can be switched off.
- **Size and type limits.** A file larger than the per-import limit (default 15 MB) is refused while downloading. The type is decided by the file's first bytes (JPEG, PNG, GIF, WebP, AVIF, PDF), not by the server's word. SVG and everything else is refused.
- **Nothing runs.** The export is parsed as text. The body HTML is turned into editor nodes by a parser; scripts, event handlers, styles and unsafe link addresses (`javascript:`, `data:`) never make it through. Only the listed tags produce anything.
- **Permissions.** The import runs for one site; people can only import into sites they are assigned to, and need the site-settings permission. The upload is private (stored under the media volume, served by no route) and is deleted with the import.
- **Edits are protected.** A page or post edited here since the last import (a saved draft counts) is left alone and listed in the log. Tick *Overwrite changes made here* to replace it. An item deleted here is not brought back unless you tick it.

## Settings

Publish as · pages / posts / tags / images on or off · include drafts, private, trashed · overwrite · when an address is taken (skip, or add a number) · redirect old addresses · post byline (author, fixed name, none; optional `login = Name` list) · extra image hosts · largest file · allow plain http for images · which menu, and add or replace.

## Limits and notes

- Re-running is idempotent. The plugin remembers which WordPress item became which document (per site and per source address) in its own table, so a second run updates in place, downloads no image twice, and adds no redirect twice.
- The old site's home page is not detected (an export does not say which page is the front page); set the home page here.
- Each page and post in the file needs the old site only for its images. If the old site is gone, import with *Download images* off and fix them by hand.
- Very large imports run item by item (a few per second); the screen shows progress and the job can be started again if the server restarts in the middle.
- Removing the plugin deletes nothing: its tables stay in the database (`wordpress_imports`, `wordpress_import_map`, `wordpress_import_log`). Content it created is ordinary content.

## Developing

```text
src/wxr.js        streaming WXR reader (SAX; no whole-file DOM)
src/html.js       HTML to Lexical, sanitiser, shortcodes, page-builder detection
src/media.js      guarded download (allow-list, SSRF, size, type)
src/paths.js      slugs, addresses, redirects, dates
src/importer.js   the dry run and the import, against a small store interface
src/store.js      that store over Payload's local API
src/collections.js, task.js, index.js   collections, endpoints, background job, plugin
src/admin/ImportPanel.js   the working screen
```

Unit tests (no database): `docker exec polysite-cms-1 sh -c 'cd /repo/plugins/wordpress-import && node --test test/*.test.js'`.
End to end (needs the stack; also `WORDPRESS_IMPORT_ALLOW_PRIVATE_HOSTS=1` on the CMS so it may fetch from the test's local server, and the runner reachable as `e2e-runner`): `test/e2e/wordpress-import.e2e.mjs`.
Migrations: `docker compose exec cms sh scripts/pluginMigrations.sh plugin wordpress-import <name>`.
