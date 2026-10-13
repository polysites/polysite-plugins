<script setup lang="ts">
// Plain default for the `testimonials` block. A theme replaces it by shipping a component named TestimonialsBlock.
import { useId } from "vue";
import { pictureOf, rows, str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; items?: unknown; id?: string; blockType?: string; blockName?: string }>();
const titleId = useId();
const title = computed(() => str(props.heading));
const items = computed(() =>
  rows(props.items)
    .filter((item) => str(item.quote))
    .map((item) => ({
      quote: str(item.quote),
      name: str(item.name),
      role: str(item.role),
      // The name is written next to the photo, so a photo without a description of its own is decoration.
      picture: pictureOf(item.image, ""),
    })),
);
</script>

<template>
  <section v-if="title || items.length" class="poly-block poly-block--testimonials" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <ul v-if="items.length" class="poly-testimonials__list">
        <li v-for="(item, i) in items" :key="i" class="poly-testimonials__li">
          <figure class="poly-testimonials__item">
            <blockquote class="poly-testimonials__quote"><p>{{ item.quote }}</p></blockquote>
            <figcaption v-if="item.name || item.role" class="poly-testimonials__author">
              <img
                v-if="item.picture"
                class="poly-testimonials__image"
                :src="item.picture.src"
                :alt="item.picture.alt"
                width="48"
                height="48"
                loading="lazy"
                decoding="async"
              >
              <span>
                <span v-if="item.name" class="poly-testimonials__name">{{ item.name }}</span>
                <span v-if="item.role" class="poly-testimonials__role">{{ item.role }}</span>
              </span>
            </figcaption>
          </figure>
        </li>
      </ul>
    </div>
  </section>
</template>
