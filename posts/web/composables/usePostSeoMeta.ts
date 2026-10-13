import type { Ref } from "vue";
import type { PayloadPost } from "../types/posts";
import { postHref } from "../utils/postsRoute";

// Head tags for the news screens. A post carries the SEO plugin's own title, description and image
// first, then falls back to its title, excerpt and picture, the same chain pages use. Social sites get
// article details, and search engines get structured data (a NewsArticle).

/** JSON for a <script type="application/ld+json">: "<" is escaped so a title can't close the tag. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function usePostSeoMeta(post: Ref<PayloadPost | undefined>, ctx: { siteName: string; section: string }) {
  const url = useRequestURL();
  const absolute = (path?: string) => (path ? `${url.origin}${path}` : undefined);
  const title = () => post.value?.meta?.title || post.value?.title || "";
  const description = () => post.value?.meta?.description || post.value?.excerpt || undefined;
  const image = () => absolute(post.value?.meta?.image?.url || post.value?.heroImage?.url);

  useSeoMeta({
    title,
    description,
    ogTitle: title,
    ogDescription: description,
    ogImage: image,
    ogType: "article",
    articlePublishedTime: () => post.value?.publishedAt,
    twitterCard: () => (image() ? "summary_large_image" : "summary"),
  });

  useHead({
    script: computed(() => {
      const p = post.value;
      if (!p?.title || !p.slug) return [];
      return [
        {
          type: "application/ld+json",
          innerHTML: jsonLd({
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            headline: title(),
            description: description(),
            datePublished: p.publishedAt,
            image: image(),
            author: p.byline ? { "@type": "Person", name: p.byline } : undefined,
            publisher: { "@type": "Organization", name: ctx.siteName },
            mainEntityOfPage: absolute(postHref(ctx.section, p.slug)),
          }),
        },
      ];
    }),
  });
}

/** Lets feed readers and browsers find the site's RSS feed. */
export function useFeedLink(title: string) {
  useHead({ link: [{ rel: "alternate", type: "application/rss+xml", title, href: "/feed.xml" }] });
}
