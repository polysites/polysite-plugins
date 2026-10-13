// GET /feed.xml: the requesting site's latest posts as RSS. Which site is decided by the host, like
// every other page; a site without the Posts module has no feed (404). Visitors can only ever see
// published posts, because the CMS answers this request without any login.
import { postHref, sectionOf } from "../../utils/postsRoute";
import { buildRss, type FeedItem } from "../../utils/rss";

interface SiteDoc {
  name?: string;
  enabledModules?: string[];
  extensions?: { news?: { label?: string | null; path?: string | null } };
}

interface PostDoc {
  title?: string;
  slug?: string;
  excerpt?: string;
  byline?: string;
  publishedAt?: string;
  categories?: Array<{ name?: string } | string | number>;
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const url = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true });
  const api = config.apiBaseInternal as string;

  const sites = await $fetch<{ docs?: SiteDoc[] }>(`${api}/sites`, { query: { "where[domain][equals]": url.hostname, limit: 1, depth: 0 } }).catch(() => null);
  const site = sites?.docs?.[0];
  if (!site || !site.enabledModules?.includes("posts")) throw createError({ statusCode: 404, statusMessage: "This site has no feed" });

  const section = sectionOf(site);
  const posts = await $fetch<{ docs?: PostDoc[] }>(`${api}/posts`, {
    query: {
      "where[and][0][site.domain][equals]": url.hostname,
      "where[and][1][_status][equals]": "published",
      sort: "-publishedAt",
      limit: 20,
      depth: 1,
      "select[title]": true,
      "select[slug]": true,
      "select[excerpt]": true,
      "select[byline]": true,
      "select[publishedAt]": true,
      "select[categories]": true,
    },
  }).catch(() => null);
  if (!posts) throw createError({ statusCode: 502, statusMessage: "The feed couldn't be built right now" });

  const items: FeedItem[] = (posts.docs ?? [])
    .filter((p) => p.title && p.slug)
    .map((p) => ({
      title: p.title as string,
      link: `${url.origin}${postHref(section, p.slug as string)}`,
      date: p.publishedAt,
      summary: p.excerpt,
      author: p.byline,
      categories: (p.categories ?? []).flatMap((c) => (typeof c === "object" && c?.name ? [c.name] : [])),
    }));

  setHeader(event, "content-type", "application/rss+xml; charset=utf-8");
  setHeader(event, "cache-control", "public, max-age=300");
  const label = site.extensions?.news?.label || "News";
  return buildRss(
    { title: `${site.name ?? "Polysite"}: ${label}`, link: `${url.origin}/${section}`, description: `The latest from ${site.name ?? "this site"}.`, items },
    `${url.origin}/feed.xml`,
  );
});
