import type { PayloadPost, PayloadPostCategory, PayloadPostList } from "../types/posts";

// Reads a site's news from the CMS, scoped to the site whose domain matches the request, the same
// way usePayloadPage does for pages. Visitors only ever receive published posts: the CMS enforces
// that, not this code. Each call has an explicit key built from the site and the arguments, because
// useFetch's default key is the URL alone and would reuse the first answer across client-side navigation.

function api() {
  const config = useRuntimeConfig();
  return import.meta.server ? config.apiBaseInternal : config.public.apiBase;
}

// Only what the list shows, so a long article body is never sent just to draw a card.
const LIST_FIELDS = ["title", "slug", "excerpt", "publishedAt", "byline", "heroImage", "categories"];

export async function usePostList(opts: { page: number; perPage: number; category?: string }) {
  const hostname = useRequestURL().hostname;
  const lang = useSiteLanguage();
  const query: Record<string, string | number | boolean> = {
    "where[and][0][site.domain][equals]": hostname,
    "where[and][1][_status][equals]": "published",
    sort: "-publishedAt",
    limit: opts.perPage,
    page: opts.page,
    depth: 1,
    ...lang.query(),
  };
  if (opts.category) query["where[and][2][categories.slug][equals]"] = opts.category;
  for (const field of LIST_FIELDS) query[`select[${field}]`] = true;

  const { data } = await useFetch<PayloadPostList>(`${api()}/posts`, {
    key: `posts-${hostname}-${lang.code.value}-${opts.category ?? "all"}-${opts.page}-${opts.perPage}`,
    query,
  });
  return data;
}

export async function usePost(slug: string) {
  const hostname = useRequestURL().hostname;
  const lang = useSiteLanguage();
  const { data } = await useFetch(`${api()}/posts`, {
    key: `post-${hostname}-${lang.code.value}-${slug}`,
    query: {
      "where[and][0][slug][equals]": slug,
      "where[and][1][site.domain][equals]": hostname,
      depth: 1,
      limit: 1,
      ...lang.query(),
    },
    transform: (res: { docs?: PayloadPost[] }) => res?.docs?.[0] ?? null,
  });
  return data;
}

/** Every category of the site, for the list's filter links. */
export async function usePostCategories() {
  const hostname = useRequestURL().hostname;
  const lang = useSiteLanguage();
  const { data } = await useFetch(`${api()}/post-categories`, {
    key: `post-categories-${hostname}-${lang.code.value}`,
    query: { "where[site.domain][equals]": hostname, sort: "name", limit: 100, depth: 0, ...lang.query() },
    transform: (res: { docs?: PayloadPostCategory[] }) => res?.docs ?? [],
  });
  return data;
}
