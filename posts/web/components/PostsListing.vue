<script setup lang="ts">
import type { PayloadPost, PayloadPostCategory } from "../types/posts";
import { formatPostDate, listHref, postHref } from "../utils/postsRoute";

// A site's list of posts, or the posts of one category: cards, category links and page links.
// Plain by design: it carries `poly-posts*` class names so a theme can restyle it, and uses the
// brand colour variable the layouts already set.
const t = useT();
const localePath = useLocalePath();
const props = defineProps<{
  heading: string;
  description?: string;
  section: string;
  posts: PayloadPost[];
  categories: PayloadPostCategory[];
  activeCategory?: string;
  page: number;
  totalPages: number;
}>();

const categoryNames = (post: PayloadPost) =>
  (post.categories ?? []).filter((c): c is PayloadPostCategory => typeof c === "object" && c !== null && Boolean(c.name));

// Page numbers to link: the first, the last, and a few around the current one.
const pageLinks = computed(() => {
  const shown = new Set([1, props.totalPages, props.page - 1, props.page, props.page + 1].filter((n) => n >= 1 && n <= props.totalPages));
  return [...shown].sort((a, b) => a - b);
});
</script>

<template>
  <section class="poly-posts mx-auto max-w-5xl px-4 py-10 sm:px-8">
    <header class="poly-posts-header mb-8">
      <h1 class="text-3xl font-bold">{{ heading }}</h1>
      <p v-if="description" class="poly-posts-description mt-2 max-w-2xl text-neutral-600">{{ description }}</p>
    </header>

    <nav v-if="categories.length" class="poly-posts-categories mb-8 flex flex-wrap gap-2" :aria-label="t('posts.categories', 'Categories')">
      <NuxtLink
        :to="localePath(listHref(section))"
        class="poly-posts-category rounded-full border border-neutral-300 px-3 py-1 text-sm"
        :class="{ 'poly-posts-category--active bg-neutral-900 text-white': !activeCategory }"
        :aria-current="!activeCategory ? 'page' : undefined"
      >
        {{ t("posts.all", "All") }}
      </NuxtLink>
      <NuxtLink
        v-for="c in categories"
        :key="c.slug"
        :to="localePath(listHref(section, 1, c.slug))"
        class="poly-posts-category rounded-full border border-neutral-300 px-3 py-1 text-sm"
        :class="{ 'poly-posts-category--active bg-neutral-900 text-white': activeCategory === c.slug }"
        :aria-current="activeCategory === c.slug ? 'page' : undefined"
      >
        {{ c.name }}
      </NuxtLink>
    </nav>

    <p v-if="!posts.length" class="poly-posts-empty text-neutral-600">{{ t("posts.empty", "Nothing has been posted here yet.") }}</p>

    <ul v-else class="poly-posts-list grid gap-8 sm:grid-cols-2">
      <li v-for="post in posts" :key="post.slug" class="poly-post-card flex flex-col gap-3">
        <NuxtLink v-if="post.heroImage?.url" :to="localePath(postHref(section, post.slug as string))" class="poly-post-card-image block overflow-hidden rounded-lg" tabindex="-1" aria-hidden="true">
          <img :src="post.heroImage.url" :alt="post.heroImage.alt || ''" loading="lazy" class="aspect-[16/9] w-full object-cover">
        </NuxtLink>
        <div class="poly-post-card-meta flex flex-wrap gap-x-3 text-sm text-neutral-500">
          <time v-if="post.publishedAt" :datetime="post.publishedAt">{{ formatPostDate(post.publishedAt) }}</time>
          <span v-for="c in categoryNames(post)" :key="c.slug">{{ c.name }}</span>
        </div>
        <h2 class="poly-post-card-title text-xl font-semibold leading-snug">
          <NuxtLink :to="localePath(postHref(section, post.slug as string))" class="hover:underline">{{ post.title }}</NuxtLink>
        </h2>
        <p v-if="post.excerpt" class="poly-post-card-excerpt text-neutral-700">{{ post.excerpt }}</p>
      </li>
    </ul>

    <nav v-if="totalPages > 1" class="poly-pagination mt-10 flex flex-wrap items-center gap-2" :aria-label="t('posts.more', 'More posts')">
      <NuxtLink v-if="page > 1" :to="localePath(listHref(section, page - 1, activeCategory))" rel="prev" class="poly-pagination-prev rounded border border-neutral-300 px-3 py-1">{{ t("posts.newer", "Newer") }}</NuxtLink>
      <NuxtLink
        v-for="n in pageLinks"
        :key="n"
        :to="localePath(listHref(section, n, activeCategory))"
        class="poly-pagination-page rounded border border-neutral-300 px-3 py-1"
        :class="{ 'poly-pagination-page--active bg-neutral-900 text-white': n === page }"
        :aria-current="n === page ? 'page' : undefined"
      >
        {{ n }}
      </NuxtLink>
      <NuxtLink v-if="page < totalPages" :to="localePath(listHref(section, page + 1, activeCategory))" rel="next" class="poly-pagination-next rounded border border-neutral-300 px-3 py-1">{{ t("posts.older", "Older") }}</NuxtLink>
    </nav>
  </section>
</template>
