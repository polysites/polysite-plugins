<script setup lang="ts">
// Plain default for the `logos` block. A theme replaces it by shipping a component named LogosBlock.
import { useId } from "vue";
import { pictureOf, rows, str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; items?: unknown; id?: string; blockType?: string; blockName?: string }>();
const link = useBlockLink();
const titleId = useId();
const title = computed(() => str(props.heading));
const items = computed(() =>
  rows(props.items)
    .filter((item) => str(item.name))
    .map((item) => {
      const name = str(item.name);
      return { name, picture: pictureOf(item.image, name), href: link(item.href) };
    }),
);
</script>

<template>
  <section v-if="title || items.length" class="poly-block poly-block--logos" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <ul v-if="items.length" class="poly-logos__list">
        <li v-for="(item, i) in items" :key="i" class="poly-logos__item">
          <component :is="item.href ? 'a' : 'span'" :href="item.href || undefined" class="poly-logos__link">
            <img
              v-if="item.picture"
              class="poly-logos__image"
              :src="item.picture.src"
              :alt="item.picture.alt"
              :width="item.picture.width"
              :height="item.picture.height"
              loading="lazy"
              decoding="async"
            >
            <span v-else class="poly-logos__name">{{ item.name }}</span>
          </component>
        </li>
      </ul>
    </div>
  </section>
</template>
