# Posts: news and articles

Each site can publish **posts**: news, updates and articles. Posts are listed newest first on the
site's news page, can be filed under categories, have their own address, appear in an RSS feed, and
carry the same SEO fields as pages. A site that doesn't use them just leaves the module off.

**Scope:** per-site. The plugin is installed once; each site turns the **Posts** module on and sets
its section in **News settings** (the plugin's own table, one row per site). This is a **content-type plugin**, the first and the reference for
building others. See [Content-type plugins](../README.md#content-type-plugins). Remove the folder and
the site keeps working, without posts.

- [Turn it on for a site](#turn-it-on-for-a-site) · [Write a post](#write-a-post) · [What visitors see](#what-visitors-see)
- [Styling it in a theme](#styling-it-in-a-theme) · [How it is put together](#how-it-is-put-together) · [Limits](#known-limits)

## Turn it on for a site

1. Open the site under **Sites**. On **General**, make sure **Posts** is ticked under **Enabled
   Modules**. New sites have it on by default.
2. Open **News settings** (under Administration, Site features) and set:

   | Setting | What it does |
   | --- | --- |
   | **Label** | The heading of the list and what the section is called, like *News* or *Updates* |
   | **Section address** | Where the section lives. `news` puts the list at `/news` and each post at `/news/<slug>`. Lower-case letters, digits and hyphens |
   | **Posts per page** | How many posts each page of the list shows (1 to 50, default 10) |

An address such as `api`, `admin` or `feed` is refused because the site uses it already. If a page
has the same slug as the section address, the list wins.

> **After installing on an existing install:** roles you created earlier don't have the **Posts**
> module. A Super Admin adds it under **Roles → Modules** (and ticks it on each site under **Enabled
> Modules**). New installs get it on the default roles. Super Admins always have access.

## Write a post

**Content → Posts → Create new.**

| Field | Notes |
| --- | --- |
| **Title** and **Slug** | The slug ends the post's address, like `budget-announcement`. It is unique within a site. `page` and `category` can't be used, because they are part of the list addresses |
| **Status** | A new post is a **draft**, visible only to staff. **Publish changes** makes it public. Posts follow the same rules as pages: drafts and **Save draft**, version history with restore (the latest 25 versions), **Schedule publish**, and the **Review** marker in the sidebar. Publishing and unpublishing are separate permissions. The core's guide `docs/guide/publishing.md` describes them |
| **Date** | Shown on the post and used to order the list. Filled in automatically when the post is first published; change it to back-date |
| **Categories** | Topics the post is filed under |
| **Byline** | Who wrote it, shown under the title (optional) |
| **Picture** | Shown at the top of the post and on its card in the list |
| **Excerpt** | A sentence or two for the list and search results. If empty, the SEO description is used |
| **Body** | The article, with headings, lists, quotes, links, bold and italic, and pictures from the media library |
| **SEO** | Title, description and share image, with the same fallbacks as pages |

The **Front-end Link** shows the post's public address, and the editor has **Live Preview**, which
shows the real post beside the form. **Content → Post Categories** manages categories; each site has
its own, and a category gets its own page listing only its posts.

Posts and categories use the **Posts** module on a role, with the usual operations (create, edit,
delete, publish, unpublish). Editors only see their own sites' posts. Drafts, and a post's version history, need the
**read** permission on the Posts module; visitors see only what is published.

## What visitors see

| Address | Shows |
| --- | --- |
| `/news` | The list: cards with the picture, date, categories, title and excerpt, category links and page links |
| `/news/page/2` | The second page of the list |
| `/news/category/policy` | One category |
| `/news/category/policy/page/2` | The second page of a category |
| `/news/budget-announcement` | One post |
| `/feed.xml` | An RSS feed of the latest 20 posts, found automatically by feed readers |

(`news` is the site's own section address.) A missing post or an out-of-range page is a normal 404. If
you rename a post's slug, the old address stops working; add a redirect from the old address (for
example `news/old-slug`) to keep links alive.

Posts carry article details for sharing and a structured-data description (`NewsArticle`) for search
engines. The list and every post link to the feed.

**Safe by design.** An article body is saved as structured text, not HTML, and the site draws it
itself. Only a fixed set of elements can appear (paragraphs, headings, lists, quotes, links, images,
bold, italic and a few others), and links must be web, mail, phone or the site's own addresses. A link
written as `javascript:…` loses its link and keeps its words.

## Styling it in a theme

The list and the article are drawn by this plugin, not by a block, so every theme gets them without
doing anything. They carry class names a theme can restyle; the defaults use the brand colour variable
the layout already sets and plain neutral greys.

| Class | What it is |
| --- | --- |
| `poly-posts`, `poly-posts-header`, `poly-posts-description` | the list page and its heading |
| `poly-posts-categories`, `poly-posts-category`, `poly-posts-category--active` | the category links |
| `poly-posts-list`, `poly-post-card`, `poly-post-card-image`, `poly-post-card-meta`, `poly-post-card-title`, `poly-post-card-excerpt` | one card in the list |
| `poly-pagination`, `poly-pagination-page`, `poly-pagination-page--active`, `poly-pagination-prev`, `poly-pagination-next` | the page links |
| `poly-post`, `poly-post-header`, `poly-post-meta`, `poly-post-byline`, `poly-post-category`, `poly-post-hero`, `poly-post-body`, `poly-post-footer` | one post |
| `poly-richtext` | the article text itself (headings, lists, quotes, links and images) |

## How it is put together

| Where | What |
| --- | --- |
| CMS | `posts` and `post-categories` collections (each belongs to one site), `news-settings`, one row per site (the site shows it as `site.extensions.news`), a front-end link in the Posts list and editor, sidebar icons |
| Roles | A **Posts** module, shared by both collections |
| URL index | Each post at `<section>/<slug>` |
| Web (`web/`, a Nuxt layer) | The list, category and article pages, the rich-text renderer, the article's SEO and structured data, and `/feed.xml` |

```text
plugins/posts/
  polysite.plugin.json     "kind": ["content-type", "site-settings"]
  src/index.js             adds the collections and the news-settings collection
  src/collections.js       posts + post-categories, declared with custom.polysite (module, icon, address)
  src/urls.js              the section address and a post's public address
  src/admin/FrontLink.js   the front-end link (uses Payload's UI hooks)
  src/admin/ResetNewsSettings.js   the "reset news settings" button on the News settings form
  src/seed.js              fictional demo posts and the site's news settings for development (seedDevData)
  migrations/              the plugin's own tables (generated by apps/cms/scripts/pluginMigrations.sh)
  test/                    node:test; test/e2e/posts.e2e.mjs runs against a live stack
  web/
    nuxt.config.ts         feed route rule
    plugins/posts.ts       registers the news addresses with the core's catch-all page
    components/            PostsRoute, PostsListing, PostArticle, RichText
    composables/           usePosts, usePostSeoMeta
    utils/                 postsRoute (address matching), lexical (rich text), rss, with tests
    server/routes/         feed.xml
    types/posts.ts
```

**Tests**

```bash
docker exec polysite-cms-1 sh -c 'cd /repo/plugins/posts && node --test test/*.test.js'
# the web part's tests run with the web app's:
docker exec polysite-web-1 sh -c "cd /repo/apps/web && npx vitest run"
```

**Demo content.** `cd apps/cms && npx payload run scripts/seedDevPlugins.ts` (or a fresh `seedDevData.ts`)
calls this plugin's `seedDevData`, which turns the module on for the dev site, saves its News settings and creates three
categories and twelve fictional posts.

## Removing the plugin, and resetting its settings

Removing or deactivating the plugin (see [Removing or deactivating one](../README.md#removing-or-deactivating-one-keeps-the-data))
**keeps every post, category and News setting**; the news pages and feed simply stop being served. Turn
it back on and they return as they were. Deleting content is never done for you.

To put a site's News settings back to the label `News`, address `news` and ten posts per page, use
**Reset news settings to defaults** at the bottom of the News settings form, then save. It does not touch
posts or categories.

## Known limits

- **The date is not a publish time.** It orders the list. To publish at a time, use **Schedule publish** (the
  same as for pages).
- **Renaming a slug doesn't create a redirect.** Pages do; posts don't yet.
- **The news list page itself isn't in the sitemap.** Each post is (the sitemap is built from the CMS's URL
  index of everything a site answers to), but the list address `/<section>` and its category pages are not. The RSS
  feed is how new posts are announced.
- **Changing the section address does not re-index posts at once.** The URL index (and so the sitemap) keeps the old address for a post until that post is saved again. The pages, links and feed follow the new address immediately.
