<script setup lang="ts">
import type { PayloadPost, PayloadPostCategory } from "../types/posts";
import { formatPostDate, listHref } from "../utils/postsRoute";

// One post. Carries `poly-post*` class names so a theme can restyle it.
const t = useT();
const localePath = useLocalePath();
const props = defineProps<{ post: PayloadPost; section: string; sectionLabel: string }>();

const categories = computed(() => (props.post.categories ?? []).filter((c): c is PayloadPostCategory => typeof c === "object" && c !== null && Boolean(c.slug)));
</script>

<template>
  <article class="poly-post mx-auto max-w-3xl px-4 py-10 sm:px-8">
    <header class="poly-post-header mb-8">
      <h1 class="text-3xl font-bold leading-tight sm:text-4xl">{{ post.title }}</h1>
      <p class="poly-post-meta mt-3 flex flex-wrap gap-x-3 text-sm text-neutral-500">
        <time v-if="post.publishedAt" :datetime="post.publishedAt">{{ formatPostDate(post.publishedAt) }}</time>
        <span v-if="post.byline" class="poly-post-byline">{{ t("posts.by", "By {name}", { name: post.byline }) }}</span>
        <NuxtLink v-for="c in categories" :key="c.slug" :to="localePath(listHref(section, 1, c.slug))" class="poly-post-category underline">{{ c.name }}</NuxtLink>
      </p>
    </header>

    <figure v-if="post.heroImage?.url" class="poly-post-hero mb-8">
      <img :src="post.heroImage.url" :alt="post.heroImage.alt || ''" class="w-full rounded-lg">
    </figure>

    <RichText :data="post.body" class="poly-post-body text-lg leading-relaxed"/>

    <footer class="poly-post-footer mt-10 border-t border-neutral-200 pt-6">
      <NuxtLink :to="localePath(listHref(section))" class="underline"><span class="poly-arrow">&larr;</span> {{ sectionLabel }}</NuxtLink>
    </footer>
  </article>
</template>
