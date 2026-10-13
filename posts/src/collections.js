import { newsPath, postUrlFromDoc } from "./urls.js";

// The role module both collections are filed under.
const MODULE = { label: "Posts", value: "posts" };

// Sidebar icons, as SVG path data on a 24 x 24 grid (the core draws them; see AdminNav/icons.tsx).
const POSTS_ICON = { paths: ["M4 5h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M19 9h2v9a2 2 0 0 1-2 2", "M8 9h7", "M8 13h7", "M8 17h4"] };
const CATEGORIES_ICON = { paths: ["M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z", "M7.5 6.3a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 0 0 0-2.4z"] };

// The posts and post-categories collections. Built from the toolkit the core passes to every plugin
// (`apply(config, kit)`), because a plugin is independent code and can't import from the app.
//
// `site` is added to both by the core, which scopes every collection a content-type plugin declares to one site.

// "page" and "category" are part of the news addresses (/news/page/2, /news/category/policy), so a post can't be named
// after them.
const RESERVED_SLUGS = ["page", "category"];

export function buildCollections(kit) {
  const { hasCapability, normalizeSlug, uniquePerSite, recordException, workflow, i18n } = kit;
  const slugIsFreePerSite = uniquePerSite("posts", "slug");

  // Anyone with the posts:read capability sees drafts too; everyone else (visitors included) sees only what is published.
  const readAccess = ({ req: { user } }) => (hasCapability(user, "posts", "read") ? true : { _status: { equals: "published" } });

  const validateSlug = (value, options) =>
    typeof value === "string" && RESERVED_SLUGS.includes(value) ? `"${value}" is part of the news addresses. Choose another slug.` : slugIsFreePerSite(value, options);

  async function revalidateSite() {
    const url = process.env.NUXT_REVALIDATE_URL;
    if (!url) return;
    try {
      await fetch(url, { method: "POST", headers: { "x-revalidate-secret": process.env.REVALIDATE_SECRET || "" } });
    } catch (err) {
      // Non-fatal: the save still succeeds, and the cache catches up on the next publish.
      console.error("Failed to trigger frontend revalidation", err);
      recordException(err);
    }
  }

  const posts = {
    slug: "posts",
    labels: { singular: "Post", plural: "Posts" },
    // What the core reads to wire this collection up (apps/cms/src/plugins/contentTypes.ts): the "posts" role module,
    // per-site scoping, SEO fields, Live Preview, and an entry in the URL index at <section>/<slug>.
    custom: {
      polysite: {
        module: MODULE,
        icon: POSTS_ICON,
        routable: {
          docType: "post",
          urlPath: (doc, { site }) => `${newsPath(site)}/${doc.slug}`,
          previewUrl: (doc, req) => postUrlFromDoc(doc, req),
        },
      },
    },
    admin: {
      useAsTitle: "title",
      defaultColumns: ["title", "_status", "reviewState", "publishedAt", "categories", "frontLink"],
      group: "Content",
      description: "News and articles. Each site shows its own, newest first, under the section address set in the News settings.",
    },
    defaultSort: "-publishedAt",
    access: {
      read: readAccess,
      create: ({ req: { user } }) => hasCapability(user, "posts", "create"),
      // Setting a post to published needs the publish permission as well (core workflow rules).
      update: workflow.publishAware("posts", ({ req: { user } }) => hasCapability(user, "posts", "update")),
      delete: ({ req: { user } }) => hasCapability(user, "posts", "delete"),
      // Payload's default is "any signed-in user", which would show the drafts of their sites to a role that cannot read posts.
      readVersions: ({ req: { user } }) => hasCapability(user, "posts", "read"),
    },
    // Drafts, version history with restore, and scheduled publish and unpublish are Payload's own machinery.
    versions: { maxPerDoc: 25, drafts: { autosave: false, schedulePublish: true, validate: false } },
    // The list builds each row's link from `site` and `slug`, which aren't always columns.
    forceSelect: { site: true, slug: true },
    fields: [
      {
        name: "title",
        type: "text",
        required: true,
        hooks: { beforeDuplicate: [({ value }) => (typeof value === "string" && value ? `${value} (Copy)` : value)] },
      },
      {
        name: "slug",
        type: "text",
        required: true,
        hooks: { beforeValidate: [({ value }) => (typeof value === "string" ? normalizeSlug(value) : value)] },
        validate: validateSlug,
        admin: { description: "The end of the post's address, like budget-announcement" },
      },
      {
        name: "frontLink",
        type: "ui",
        label: "Front-end Link",
        admin: { components: { Cell: "../../../plugins/posts/src/admin/FrontLink#PostFrontLinkCell", Field: "../../../plugins/posts/src/admin/FrontLink#PostFrontLinkField" } },
      },
      ...workflow.reviewFields("posts"),
      {
        // Legacy: before drafts were native this held draft/published. Kept (hidden, unused) so no column is dropped; the
        // migration copied it into `_status`.
        name: "status",
        type: "select",
        hidden: true,
        admin: { hidden: true },
        options: [
          { label: "Draft", value: "draft" },
          { label: "Published", value: "published" },
        ],
      },
      {
        name: "publishedAt",
        type: "date",
        label: "Date",
        admin: {
          position: "sidebar",
          date: { pickerAppearance: "dayAndTime" },
          description: "Shown on the post and used to order the list, newest first. Filled in when the post is first published.",
        },
        hooks: {
          beforeChange: [({ value, siblingData }) => value || (siblingData?._status === "published" ? new Date().toISOString() : value)],
        },
      },
      {
        name: "categories",
        type: "relationship",
        relationTo: "post-categories",
        hasMany: true,
        admin: { position: "sidebar", description: "Topics this post is filed under." },
      },
      { name: "byline", type: "text", admin: { position: "sidebar", description: "Who wrote it, shown under the title. Optional." } },
      { name: "heroImage", type: "upload", relationTo: "media", label: "Picture", admin: { description: "Shown at the top of the post and in the list." } },
      {
        name: "excerpt",
        type: "textarea",
        maxLength: 400,
        admin: { description: "A sentence or two for the list and for search results. Leave empty to use the SEO description." },
      },
      { name: "body", type: "richText", required: true },
    ],
    hooks: {
      // Records the live version and enforces publish / unpublish permission (core workflow rules).
      beforeChange: [workflow.publishRules("posts", "posts")],
      // Visitors see a cached copy of the site; tell it something changed. Covers publishing, editing a published
      // post, taking one down; saving a draft changes nothing visitors can see, so it doesn't.
      afterChange: [
        async ({ req }) => {
          if (workflow.changesLiveSite({ isDraftSave: workflow.isDraftRequest(req.query) })) await revalidateSite();
        },
      ],
      afterDelete: [
        async ({ doc }) => {
          if (doc?._status === "published") await revalidateSite();
        },
      ],
    },
  };

  // A topic a site's posts can be filed under. Readable by anyone: the public site shows category names on posts.
  const categories = {
    slug: "post-categories",
    labels: { singular: "Post Category", plural: "Post Categories" },
    custom: { polysite: { module: MODULE, icon: CATEGORIES_ICON } },
    admin: {
      useAsTitle: "name",
      defaultColumns: ["name", "slug", "site"],
      group: "Content",
      description: "Topics that posts are filed under. Each site has its own.",
    },
    access: {
      read: () => true,
      create: ({ req: { user } }) => hasCapability(user, "posts", "create"),
      update: ({ req: { user } }) => hasCapability(user, "posts", "update"),
      delete: ({ req: { user } }) => hasCapability(user, "posts", "delete"),
    },
    fields: [
      { name: "name", type: "text", required: true },
      {
        name: "slug",
        type: "text",
        required: true,
        hooks: { beforeValidate: [({ value }) => (typeof value === "string" ? normalizeSlug(value) : value)] },
        validate: uniquePerSite("post-categories", "slug"),
        admin: { description: "Used in the category's address, like policy" },
      },
      { name: "description", type: "textarea", admin: { description: "Shown at the top of the category's page." } },
    ],
  };

  // The prose is translatable; the address, date, picture and categories are shared by every language.
  posts.fields = i18n.localizeNamed(posts.fields, ["title", "excerpt", "byline", "body"]);
  categories.fields = i18n.localizeNamed(categories.fields, ["name"]);

  return [posts, categories];
}
