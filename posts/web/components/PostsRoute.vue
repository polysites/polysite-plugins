<script setup lang="ts">
import { useLivePreview } from "@payloadcms/live-preview-vue";

import type { PayloadPost, PayloadPostCategory, PayloadPostList } from "../types/posts";

// What the posts route (plugins/posts.ts) hands to the core's catch-all page to draw: either the list (the whole
// section, one category, or a later page of either) or one article. It also owns the page's head tags and, for an
// article, the page's single Live Preview call (the live-preview package keeps one cache per page, so the core page
// doesn't make a second one when a plugin owns the address).
const props = defineProps<{
  view: "post" | "list";
  section: string;
  label: string;
  siteName: string;
  post?: PayloadPost;
  list?: PayloadPostList;
  categories?: PayloadPostCategory[];
  activeCategory?: PayloadPostCategory | null;
}>();

const config = useRuntimeConfig();

const livePost =
  props.view === "post"
    ? useLivePreview<PayloadPost>({ initialData: props.post ?? {}, serverURL: config.public.cmsServerUrl, depth: 1 }).data
    : ref<PayloadPost | undefined>();

useFeedLink(`${props.siteName}: ${props.label}`);
if (props.view === "post") {
  usePostSeoMeta(livePost, { siteName: props.siteName, section: props.section });
} else {
  const heading = props.activeCategory?.name ? `${props.activeCategory.name}: ${props.label}` : props.label;
  useSeoMeta({ title: heading, ogTitle: heading, description: props.activeCategory?.description || undefined });
}
</script>

<template>
  <PostArticle v-if="view === 'post' && livePost?.title" :post="livePost" :section="section" :section-label="label" />
  <PostsListing
    v-else-if="view === 'list' && list"
    :heading="activeCategory?.name || label"
    :description="activeCategory?.description"
    :section="section"
    :posts="list.docs"
    :categories="categories ?? []"
    :active-category="activeCategory?.slug"
    :page="list.page"
    :total-pages="list.totalPages"
  />
</template>
