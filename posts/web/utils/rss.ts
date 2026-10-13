// A site's news as an RSS 2.0 feed (served at /feed.xml, server/routes/feed.xml.get.ts). Everything that
// came from an editor is XML-escaped; nothing is inserted raw.

export interface FeedItem {
  title: string;
  link: string;
  /** ISO date, or empty. */
  date?: string;
  summary?: string;
  author?: string;
  categories?: string[];
}

export interface Feed {
  title: string;
  link: string;
  description: string;
  items: FeedItem[];
}

export function escapeXml(value: string): string {
  // Control characters other than tab, newline and carriage return aren't allowed in XML at all.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const tag = (name: string, value: string | undefined) => (value ? `<${name}>${escapeXml(value)}</${name}>` : "");

function rfc822(iso: string | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toUTCString() : "";
}

export function buildRss(feed: Feed, selfUrl: string): string {
  const items = feed.items
    .map((item) =>
      [
        "<item>",
        tag("title", item.title),
        tag("link", item.link),
        `<guid isPermaLink="true">${escapeXml(item.link)}</guid>`,
        tag("pubDate", rfc822(item.date)),
        tag("description", item.summary),
        tag("dc:creator", item.author),
        ...(item.categories ?? []).map((c) => tag("category", c)),
        "</item>",
      ]
        .filter(Boolean)
        .join(""),
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>` +
    tag("title", feed.title) +
    tag("link", feed.link) +
    tag("description", feed.description) +
    `<atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>` +
    tag("lastBuildDate", rfc822(feed.items.find((i) => i.date)?.date)) +
    items +
    `</channel></rss>`
  );
}
