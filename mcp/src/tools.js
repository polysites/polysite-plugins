import { z } from "zod";

import { buildFormData, FIELD_TYPES } from "./forms.js";
import { describeBlocks, prepareBlocks } from "./schema.js";
import { prepareUpload } from "./upload.js";

const reply = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (error) => ({ content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true });

const adminUrl = (collection, id) => `${process.env.CMS_SCHEME ?? "http"}://${process.env.CMS_DOMAIN ?? "localhost:3001"}/admin/collections/${collection}/${id}`;

// Everything here writes DRAFTS only. The key acts as the person it belongs to, so whether that person may publish is decided by their role
// (publishRules in the core), not by this plugin; give agents a role without "publish" and "delete".
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
        "Creates a DRAFT page on a site from a list of blocks. It is not published; a person reviews and publishes it in the admin. Use polysite_describe_blocks for the valid blocks and fields, and find sites to get siteId. Text fields marked rich text take Markdown. Returns the admin link.",
      parameters: {
        siteId: z.union([z.number(), z.string()]).describe("The site's id"),
        title: z.string().min(1),
        slug: z.string().min(1).describe("Address of the page on the site, e.g. 'about' (use 'home' or '/' for the home page)"),
        blocks: z.array(blockSchema).min(1),
      },
      handler: async ({ siteId, title, slug, blocks }, req) => {
        try {
          const content = prepareBlocks(req.payload.collections.pages.config, blocks);
          const doc = await req.payload.create({
            collection: "pages",
            data: { site: siteId, title, slug, content, _status: "draft" },
            draft: true,
            overrideAccess: false,
            user: req.user,
            req,
          });
          return reply({ id: doc.id, status: "draft", slug: doc.slug, adminUrl: adminUrl("pages", doc.id), note: "A draft. Review it in the admin, then publish." });
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "polysite_update_page",
      description:
        "Replaces the blocks (and optionally the title) of an existing page as a new DRAFT. If the page is published, the live version is untouched until a person publishes the draft. Send ALL the blocks the page should have, not only the changed ones.",
      parameters: {
        pageId: z.union([z.number(), z.string()]),
        title: z.string().min(1).optional(),
        blocks: z.array(blockSchema).min(1),
      },
      handler: async ({ pageId, title, blocks }, req) => {
        try {
          const content = prepareBlocks(req.payload.collections.pages.config, blocks);
          const doc = await req.payload.update({
            collection: "pages",
            id: pageId,
            data: { ...(title ? { title } : {}), content },
            draft: true,
            overrideAccess: false,
            user: req.user,
            req,
          });
          return reply({ id: doc.id, status: "draft", adminUrl: adminUrl("pages", doc.id) });
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
