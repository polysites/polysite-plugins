import type { PayloadPostCategory, PayloadPost, PayloadPostList, NewsSite } from "../types/posts";
import { matchPostsRoute, sectionOf, type PostsRoute } from "../utils/postsRoute";

// Puts the news addresses on a site. The core's catch-all page (apps/web/pages/[...slug].vue) asks every registered
// route in turn; this one owns <section>, <section>/page/N, <section>/category/x[/page/N] and <section>/<post>,
// where <section> is the site's own setting (News settings), and only for a site with the Posts module on.
interface PostsMatch {
  route: PostsRoute;
  section: string;
}

export default defineNuxtPlugin({
  name: "posts-routes",
  dependsOn: ["content-routes"],
  setup(nuxtApp) {
    nuxtApp.$contentRoutes.register({
      id: "posts",
      module: "posts",
      component: "PostsRoute",
      match(slug, { site }) {
        const section = sectionOf(site as NewsSite | undefined);
        const route = matchPostsRoute(slug, section);
        return route ? ({ route, section } satisfies PostsMatch) : null;
      },
      async load(rawMatch, { nuxtApp: app, site }) {
        const { route, section } = rawMatch as PostsMatch;
        const news = (site as NewsSite | undefined)?.extensions?.news;
        const label = news?.label || "News";
        const perPage = news?.perPage || 10;
        const siteName = (site as NewsSite | undefined)?.name || "Polysite";

        // Every composable below runs through runWithContext: after the first await Nuxt's ambient context is gone.
        if (route.kind === "post") {
          const post = await app.runWithContext(() => usePost(route.slug));
          return post.value ? { view: "post", post: post.value, section, label, siteName } : null;
        }

        const categories = (await app.runWithContext(() => usePostCategories())).value ?? [];
        const activeCategory: PayloadPostCategory | undefined = route.kind === "category" ? categories.find((c) => c.slug === route.category) : undefined;
        if (route.kind === "category" && !activeCategory) return null;

        const list = (await app.runWithContext(() => usePostList({ page: route.page, perPage, category: activeCategory?.slug }))).value as PayloadPostList | null;
        // A page past the end is a 404, not an empty list.
        if (!list || (route.page > 1 && route.page > list.totalPages)) return null;

        return { view: "list", list, categories, activeCategory: activeCategory ?? null, section, label, siteName };
      },
    });
  },
});

// Re-exported only so the shapes are visible next to the route that produces them.
export type { PayloadPost };
