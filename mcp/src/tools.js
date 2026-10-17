import { z } from "zod";

import { buildFormData, FIELD_TYPES } from "./forms.js";
import { describeBlocks, prepareBlocks } from "./schema.js";
import { prepareUpload } from "./upload.js";

const reply = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (error) => ({ content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true });

const adminUrl = (collection, id) => `${process.env.CMS_SCHEME ?? "http"}://${process.env.CMS_DOMAIN ?? "localhost:3001"}/admin/collections/${collection}/${id}`;

// The key acts as the person it belongs to, so what an agent may do (publish, unpublish, delete) is decided by that person's role and
// the core's own rules, never by this plugin. Pages are saved as drafts unless the agent asks to publish.
//
// The core's publish rules read `req.query.draft` to tell a draft save (needs no publish permission) from a publishing save.
function withDraft(req, draft) {
  req.query = { ...req.query, draft: draft ? "true" : undefined };
  return req;
}

const blockSchema = z
  .object({ blockType: z.string().describe("The block's type, from polysite_describe_blocks") })
  .passthrough()
  .describe("A block: blockType plus that block's fields. Rich-text fields take Markdown.");

export function buildTools() {
  return [
    {
      name: "polysite_describe_blocks",
      description:
        "Lists the page blocks this Polysite install can build pages from (hero, text, FAQ, feature grid, form embed, ...) with every field, its type and options. Call this FIRST before creating or changing a page: pages can only be built from these blocks.",
      parameters: {},
      handler: async (_args, req) => {
        try {
          return reply(describeBlocks(req.payload.collections.pages.config));
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "polysite_create_page",
      description:
        "Creates a page on a site from a list of blocks. Saved as a draft unless 'publish' is true (publishing needs the key's user to have publish permission). Use polysite_describe_blocks for the valid blocks and fields, and find sites to get siteId. Text fields marked rich text take Markdown. Returns the admin link.",
      parameters: {
        siteId: z.union([z.number(), z.string()]).describe("The site's id"),
        title: z.string().min(1),
        slug: z.string().min(1).describe("Address of the page on the site, e.g. 'about' (use 'home' or '/' for the home page)"),
        blocks: z.array(blockSchema).min(1),
        publish: z.boolean().optional().describe("Publish straight away instead of saving a draft"),
      },
      handler: async ({ siteId, title, slug, blocks, publish }, req) => {
        try {
          const content = prepareBlocks(req.payload.collections.pages.config, blocks);
          const status = publish ? "published" : "draft";
          const doc = await req.payload.create({
            collection: "pages",
            data: { site: siteId, title, slug, content, _status: status },
            draft: !publish,
            overrideAccess: false,
            user: req.user,
            req: withDraft(req, !publish),
          });
          return reply({ id: doc.id, status, slug: doc.slug, adminUrl: adminUrl("pages", doc.id) });
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "polysite_update_page",
      description:
        "Replaces the blocks (and optionally the title) of an existing page. Saved as a new draft unless 'publish' is true; a draft of a published page leaves the live version untouched until it is published. Send ALL the blocks the page should have, not only the changed ones.",
      parameters: {
        pageId: z.union([z.number(), z.string()]),
        title: z.string().min(1).optional(),
        blocks: z.array(blockSchema).min(1),
        publish: z.boolean().optional().describe("Publish the result instead of saving a draft (needs publish permission)"),
      },
      handler: async ({ pageId, title, blocks, publish }, req) => {
        try {
          const content = prepareBlocks(req.payload.collections.pages.config, blocks);
          const doc = await req.payload.update({
            collection: "pages",
            id: pageId,
            data: { ...(title ? { title } : {}), content, ...(publish ? { _status: "published" } : {}) },
            draft: !publish,
            overrideAccess: false,
            user: req.user,
            req: withDraft(req, !publish),
          });
          return reply({ id: doc.id, status: publish ? "published" : "draft", adminUrl: adminUrl("pages", doc.id) });
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "polysite_publish_page",
      description:
        "Publishes a page (its latest draft goes live) or, with publish=false, takes a published page offline. Allowed only if the key's user has publish / unpublish permission for pages.",
      parameters: {
        pageId: z.union([z.number(), z.string()]),
        publish: z.boolean().default(true),
      },
      handler: async ({ pageId, publish }, req) => {
        try {
          const status = publish === false ? "draft" : "published";
          const doc = await req.payload.update({
            collection: "pages",
            id: pageId,
            data: { _status: status },
            draft: false,
            overrideAccess: false,
            user: req.user,
            req: withDraft(req, false),
          });
          return reply({ id: doc.id, status, adminUrl: adminUrl("pages", doc.id) });
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "polysite_upload_media",
      description:
        "Adds a picture to a site's media library and returns its id, to use as an 'image' field in a block (e.g. a hero). Give EITHER 'url' (a public https address of the image; preferred) OR 'base64' (the image bytes, only practical for small files). PNG, JPEG, GIF, WebP and AVIF only, up to 8 MB. 'alt' is required: describe the picture for people who cannot see it.",
      parameters: {
        siteId: z.union([z.number(), z.string()]).describe("The site the picture belongs to"),
        alt: z.string().min(3).describe("Alternative text describing the picture"),
        url: z.string().optional().describe("Public https address of the image"),
        base64: z.string().optional().describe("The image bytes, base64 encoded"),
        filename: z.string().optional(),
      },
      handler: async ({ siteId, alt, url, base64, filename }, req) => {
        try {
          const file = await prepareUpload({ url, base64, filename });
          const doc = await req.payload.create({
            collection: "media",
            data: { site: siteId, alt },
            file,
            overrideAccess: false,
            user: req.user,
            req,
          });
          return reply({ id: doc.id, filename: doc.filename, url: doc.url, width: doc.width, height: doc.height, next: "Use this id as the 'image' of a block." });
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "polysite_create_form",
      description:
        "Creates a form (contact, sign-up, petition, survey) with the given fields. Afterwards put it on a page with a 'formEmbed' block whose 'form' is the returned id. Visitors' answers are personal data: say in 'purpose' what they are used for.",
      parameters: {
        siteId: z.union([z.number(), z.string()]).describe("The site the form belongs to"),
        title: z.string().min(1),
        fields: z
          .array(
            z.object({
              label: z.string().min(1),
              type: z.enum(FIELD_TYPES).default("text"),
              name: z.string().optional().describe("Machine name; made from the label when omitted"),
              required: z.boolean().optional(),
              options: z.array(z.union([z.string(), z.object({ label: z.string(), value: z.string().optional() })])).optional().describe("For select fields"),
            }),
          )
          .min(1),
        submitLabel: z.string().optional().describe("Button text, default 'Send'"),
        confirmation: z.string().optional().describe("Markdown shown after sending"),
        purpose: z.string().optional().describe("Plain-words reason for collecting the data, shown above the button"),
        consentRequired: z.boolean().optional().describe("Add a checkbox people must tick"),
      },
      handler: async ({ siteId, ...args }, req) => {
        try {
          const formsConfig = req.payload.collections.forms.config;
          const fieldsDef = formsConfig.fields.find((f) => f.name === "fields");
          const allowed = (fieldsDef?.blocks ?? []).map((b) => b.slug);
          const doc = await req.payload.create({
            collection: "forms",
            data: { ...buildFormData(args, allowed), site: siteId },
            overrideAccess: false,
            user: req.user,
            req,
          });
          return reply({ id: doc.id, adminUrl: adminUrl("forms", doc.id), next: "Add a formEmbed block with this id as 'form' to a page." });
        } catch (error) {
          return failure(error);
        }
      },
    },
  ];
}
