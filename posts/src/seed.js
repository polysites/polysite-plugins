// Local development only: fictional demo news posts for a site. The core's dev seed scripts (apps/cms/scripts/
// devPlugins.ts) call `seedDevData` for every installed plugin that has this file. Nothing here is a real person,
// party or event.

const text = (value, format = 0) => ({ type: "text", text: value, format, detail: 0, mode: "normal", style: "", version: 1 });
const block = (type, children, extra = {}) => ({ type, children, direction: "ltr", format: "", indent: 0, version: 1, ...extra });
const paragraph = (...children) => block("paragraph", children.map((c) => (typeof c === "string" ? text(c) : c)), { textFormat: 0 });
const heading = (value, tag = "h2") => block("heading", [text(value)], { tag });
const quote = (value) => block("quote", [text(value)]);
const list = (items, listType = "bullet") =>
  block(
    "list",
    items.map((item, i) => block("listitem", [text(item)], { value: i + 1 })),
    { listType, start: 1, tag: listType === "bullet" ? "ul" : "ol" },
  );
const link = (label, url) => ({ type: "link", children: [text(label)], direction: "ltr", format: "", indent: 0, version: 3, fields: { url, newTab: false, linkType: "custom" } });
const richText = (...children) => ({ root: { type: "root", children, direction: "ltr", format: "", indent: 0, version: 1 } });

const CATEGORIES = [
  { name: "Policy", slug: "policy", description: "Plans and positions from the fictional Polysite Party." },
  { name: "Events", slug: "events", description: "Meetings, rallies and open evenings." },
  { name: "Community", slug: "community", description: "Stories from volunteers and neighbours." },
];

const TOPICS = [
  { title: "A plain-language guide to our housing plan", category: "policy", excerpt: "Three ideas to make homes easier to find and keep, explained without the jargon." },
  { title: "Open evening at the community hall", category: "events", excerpt: "Come and meet the volunteer team over tea. Everyone is welcome." },
  { title: "Volunteer of the month: Alex Morgan", category: "community", excerpt: "How one neighbour turned a free Saturday into a weekly food drive." },
  { title: "What our transit proposal would change", category: "policy", excerpt: "Shorter waits, clearer fares, and a night service that runs when people need it." },
  { title: "Spring town hall: questions and answers", category: "events", excerpt: "A recap of what people asked, and what we promised to look into." },
  { title: "Neighbours tidy the riverside path", category: "community", excerpt: "Forty people, one morning, and a path that finally feels cared for." },
  { title: "Why we want clearer local budgets", category: "policy", excerpt: "A budget everyone can read is a budget everyone can question." },
  { title: "Join the summer walking tour", category: "events", excerpt: "Six short walks through six neighbourhoods, led by the people who live there." },
  { title: "A school garden grows a community", category: "community", excerpt: "Parents, pupils and a very patient caretaker planted something that outlasts a term." },
  { title: "Our approach to small-business support", category: "policy", excerpt: "Fewer forms, faster answers and one named contact at city hall." },
  { title: "Thank you to our canvassers", category: "community", excerpt: "A thousand doors, a lot of conversations, and a few good dogs." },
  { title: "Date set for the autumn policy forum", category: "events", excerpt: "Save the date and tell us which topics should be on the agenda." },
];

/** Creates 3 categories and 12 posts on the site. Returns how many posts it made (0 when the site already has some). */
export async function seedDemoPosts(payload, siteId) {
  const existing = await payload.count({ collection: "posts", where: { site: { equals: siteId } }, overrideAccess: true });
  if (existing.totalDocs > 0) return 0;

  const categoryIds = new Map();
  for (const c of CATEGORIES) {
    const found = await payload.find({ collection: "post-categories", where: { and: [{ slug: { equals: c.slug } }, { site: { equals: siteId } }] }, limit: 1, overrideAccess: true });
    const doc = found.docs[0] ?? (await payload.create({ collection: "post-categories", data: { ...c, site: siteId }, overrideAccess: true }));
    categoryIds.set(c.slug, doc.id);
  }

  const media = await payload.find({ collection: "media", where: { site: { equals: siteId } }, limit: 1, overrideAccess: true });
  const hero = media.docs[0]?.id;

  let created = 0;
  for (const [i, topic] of TOPICS.entries()) {
    const slug = topic.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const day = new Date(Date.UTC(2026, 8, 28) - i * 3 * 86_400_000); // newest first, three days apart
    await payload.create({
      collection: "posts",
      data: {
        site: siteId,
        title: topic.title,
        slug,
        _status: "published",
        publishedAt: day.toISOString(),
        byline: i % 3 === 0 ? "The Polysite Party team" : "Alex Morgan",
        categories: [categoryIds.get(topic.category)],
        excerpt: topic.excerpt,
        ...(hero && i % 2 === 0 ? { heroImage: hero } : {}),
        body: richText(
          paragraph(topic.excerpt),
          heading("Why it matters"),
          paragraph("Plain language matters. ", text("This is a demo post", 1), " written for a fictional party, so ", text("none of it is real", 2), ". It exists to show how headings, lists, quotes and ", link("links", "https://example.org"), " look on the page."),
          list(["A short first point", "A second point with a little more to say", "A third, to make it a proper list"]),
          quote("A site is only as useful as the things people can find on it."),
          paragraph("Questions? Write to us any time through the contact form."),
        ),
      },
      overrideAccess: true,
    });
    created += 1;
  }
  return created;
}

/** The hook the core's dev seed scripts call: turns the Posts module on for the site, gives it its news settings, then adds the demo content. */
export async function seedDevData(payload, { site }) {
  const modules = Array.from(new Set([...(Array.isArray(site.enabledModules) ? site.enabledModules : []), "posts"]));
  await payload.update({ collection: "sites", id: site.id, data: { enabledModules: modules }, overrideAccess: true });
  const settings = await payload.count({ collection: "news-settings", where: { site: { equals: site.id } }, overrideAccess: true });
  if (settings.totalDocs === 0) await payload.create({ collection: "news-settings", data: { site: site.id }, overrideAccess: true });
  const made = await seedDemoPosts(payload, site.id);
  return made ? `Created ${made} demo posts and 3 categories on ${site.domain}.` : "Demo posts already there.";
}
