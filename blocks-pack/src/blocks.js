// The block types this plugin adds to the page builder. The slugs and field names are a contract other packages rely on (themes,
// demo content, the README): never rename them, only add.
//
// Every block lives in its own tables (pages_blocks_<slug> and its version and language tables), created by this plugin's own
// migration; nothing is added to a core table. Text an editor writes is translatable (see index.js); links, numbers, pictures and
// choices are shared between languages.

const text = (name, description, extra = {}) => ({ name, type: "text", admin: { description }, ...extra });
const area = (name, description, extra = {}) => ({ name, type: "textarea", admin: { description }, ...extra });
const picture = (name, description, extra = {}) => ({ name, type: "upload", relationTo: "media", admin: { description }, ...extra });
const list = (name, description, fields, extra = {}) => ({ name, type: "array", admin: { description, initCollapsed: true }, fields, ...extra });

const HEADING = text("heading", "The title shown above this section. Leave it empty for no title.");
const LINK_HELP = "Where the button goes: a page on this site like /contact, or a full address like https://example.org. Links that run scripts are ignored.";

const gallery = {
  slug: "gallery",
  labels: { singular: "Gallery", plural: "Galleries" },
  fields: [
    HEADING,
    list(
      "images",
      "The pictures, in the order they appear.",
      [
        picture("image", "Choose a picture from the media library. Its description (alt text) is read aloud to people who cannot see it.", { required: true }),
        text("caption", "A short line shown under the picture (optional)."),
      ],
      { labels: { singular: "Picture", plural: "Pictures" } },
    ),
    {
      name: "columns",
      type: "select",
      defaultValue: "3",
      options: [
        { label: "2 columns", value: "2" },
        { label: "3 columns", value: "3" },
        { label: "4 columns", value: "4" },
      ],
      admin: { description: "How many pictures sit side by side on a wide screen. Small screens always show fewer." },
    },
  ],
};

const pricing = {
  slug: "pricing",
  labels: { singular: "Pricing plans", plural: "Pricing plans" },
  fields: [
    HEADING,
    area("intro", "A sentence or two shown under the title (optional)."),
    list(
      "plans",
      "One card per plan, package or service level.",
      [
        text("name", "The plan's name, like Starter or Monthly.", { required: true }),
        text("price", "The price exactly as you want it shown, like $45 or Free.", { required: true }),
        text("period", "What the price covers, like per month or per visit (optional)."),
        area("description", "A short line about who the plan is for (optional)."),
        list("features", "What is included, one line each.", [text("text", "One thing the plan includes.")], { labels: { singular: "Feature", plural: "Features" } }),
        text("buttonLabel", "The words on the button, like Choose plan (optional; the button needs an address too)."),
        text("buttonHref", LINK_HELP),
        {
          name: "highlighted",
          type: "checkbox",
          defaultValue: false,
          admin: { description: "Tick to make this the recommended plan. It is marked in words as well as by its look." },
        },
      ],
      { labels: { singular: "Plan", plural: "Plans" } },
    ),
  ],
};

const testimonials = {
  slug: "testimonials",
  labels: { singular: "Testimonials", plural: "Testimonials" },
  fields: [
    HEADING,
    list(
      "items",
      "What people say about you.",
      [
        area("quote", "What the person said, in their words (without quotation marks).", { required: true }),
        text("name", "Who said it.", { required: true }),
        text("role", "Their job, company or relationship to you, like Regular client (optional)."),
        picture("image", "A photo of the person (optional)."),
      ],
      { labels: { singular: "Testimonial", plural: "Testimonials" } },
    ),
  ],
};

const timeline = {
  slug: "timeline",
  labels: { singular: "Timeline", plural: "Timelines" },
  fields: [
    HEADING,
    list(
      "entries",
      "The steps in order, from first to last as you want them read.",
      [
        text("period", "When it happened, like 2019 or 2021 - 2023.", { required: true }),
        text("title", "What happened, like a job title, a school or a milestone.", { required: true }),
        text("subtitle", "Where, or with whom, like the company or school (optional)."),
        area("description", "A few sentences of detail (optional)."),
      ],
      { labels: { singular: "Entry", plural: "Entries" } },
    ),
  ],
};

const team = {
  slug: "team",
  labels: { singular: "Team", plural: "Teams" },
  fields: [
    HEADING,
    area("intro", "A sentence or two shown under the title (optional)."),
    list(
      "members",
      "The people, in the order they appear.",
      [
        text("name", "The person's name.", { required: true }),
        text("role", "Their job or title (optional)."),
        area("bio", "A short introduction (optional)."),
        picture("image", "A photo (optional)."),
      ],
      { labels: { singular: "Person", plural: "People" } },
    ),
  ],
};

const cta = {
  slug: "cta",
  labels: { singular: "Call to action", plural: "Calls to action" },
  fields: [
    text("heading", "The main message, like Ready to book?", { required: true }),
    area("text", "A sentence of supporting text (optional)."),
    text("buttonLabel", "The words on the main button, like Book now.", { required: true }),
    text("buttonHref", LINK_HELP, { required: true }),
    text("secondaryLabel", "The words on a second, quieter button (optional; it needs an address too)."),
    text("secondaryHref", LINK_HELP),
  ],
};

const hoursContact = {
  slug: "hours-contact",
  labels: { singular: "Opening hours and contact", plural: "Opening hours and contact" },
  fields: [
    HEADING,
    list(
      "hours",
      "One line per day or group of days.",
      [
        text("days", "The day or days, like Monday - Friday.", { required: true }),
        text("time", "The hours, like 9am - 5pm. Write Closed for a day off.", { required: true }),
      ],
      { labels: { singular: "Opening hours", plural: "Opening hours" } },
    ),
    area("address", "Your address. A new line in the box becomes a new line on the page."),
    text("phone", "Your phone number. Visitors on a phone can tap it to call."),
    text("email", "Your email address. It becomes a link visitors can click to write to you."),
    area("note", "Anything else worth saying, like holiday closures or how to find the door (optional)."),
  ],
};

const priceList = {
  slug: "price-list",
  labels: { singular: "Price list", plural: "Price lists" },
  fields: [
    HEADING,
    area("intro", "A sentence or two shown under the title (optional)."),
    list(
      "sections",
      "Groups of items, like Haircuts or Starters.",
      [
        text("title", "The name of the group.", { required: true }),
        list(
          "items",
          "The items in this group.",
          [
            text("name", "The item's name, like Cut and finish or Mushroom soup.", { required: true }),
            area("description", "A line about it (optional), like what is in the dish or how long it takes."),
            text("price", "The price as you want it shown, like $45 or from $20 (optional)."),
            text("tag", "A small label such as vegan, new or popular (optional)."),
          ],
          { labels: { singular: "Item", plural: "Items" } },
        ),
      ],
      { labels: { singular: "Group", plural: "Groups" } },
    ),
  ],
};

const schedule = {
  slug: "schedule",
  labels: { singular: "Schedule", plural: "Schedules" },
  fields: [
    HEADING,
    list(
      "days",
      "One entry per day (or per track).",
      [
        text("label", "The day, like Friday 14 June or Day 1.", { required: true }),
        list(
          "sessions",
          "What happens that day, in time order.",
          [
            text("time", "When it starts, like 09:30, or a range like 09:30 - 10:15.", { required: true }),
            text("title", "The name of the session.", { required: true }),
            text("speaker", "Who is giving it (optional)."),
            text("room", "Where it is held (optional)."),
            area("description", "A sentence or two about it (optional)."),
          ],
          { labels: { singular: "Session", plural: "Sessions" } },
        ),
      ],
      { labels: { singular: "Day", plural: "Days" } },
    ),
  ],
};

const stats = {
  slug: "stats",
  labels: { singular: "Key figures", plural: "Key figures" },
  fields: [
    HEADING,
    list(
      "items",
      "Big numbers with a short label.",
      [
        text("value", "The figure itself, like 15+ or 98%.", { required: true }),
        text("label", "What it measures, like Years in business.", { required: true }),
      ],
      { labels: { singular: "Figure", plural: "Figures" } },
    ),
  ],
};

const logos = {
  slug: "logos",
  labels: { singular: "Logos", plural: "Logos" },
  fields: [
    HEADING,
    list(
      "items",
      "The logos, in the order they appear.",
      [
        text("name", "The name of the company or partner. Used as the picture's description if the picture has none.", { required: true }),
        picture("image", "The logo (optional; without one, the name is shown as text)."),
        text("href", "Where a click goes, like https://example.org (optional). Links that run scripts are ignored."),
      ],
      { labels: { singular: "Logo", plural: "Logos" } },
    ),
  ],
};

// For each block, the top-level fields that hold words a person writes in a language (the others are shared between languages).
// Text inside a list is translatable too, except addresses and email addresses, which the core never translates.
export const BLOCKS = [
  { block: gallery, words: ["heading", "images"] },
  { block: pricing, words: ["heading", "intro", "plans"] },
  { block: testimonials, words: ["heading", "items"] },
  { block: timeline, words: ["heading", "entries"] },
  { block: team, words: ["heading", "intro", "members"] },
  { block: cta, words: ["heading", "text", "buttonLabel", "secondaryLabel"] },
  { block: hoursContact, words: ["heading", "hours", "address", "note"] },
  { block: priceList, words: ["heading", "intro", "sections"] },
  { block: schedule, words: ["heading", "days"] },
  { block: stats, words: ["heading", "items"] },
  { block: logos, words: ["heading", "items"] },
];

export const BLOCK_SLUGS = BLOCKS.map(({ block }) => block.slug);

/** The blocks, with their words made translatable when the core offers that (`kit.i18n.localizeNamed`). */
export function buildBlocks(kit) {
  const localize = kit?.i18n?.localizeNamed;
  return BLOCKS.map(({ block, words }) => (localize ? { ...block, fields: localize(block.fields, words) } : block));
}
