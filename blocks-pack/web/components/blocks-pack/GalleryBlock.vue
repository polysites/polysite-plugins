<script setup lang="ts">
// Plain default for the `gallery` block. A theme replaces it by shipping a component named GalleryBlock.
// Block data is not trusted: text is drawn as text, pictures must have a safe address, and a bad row is skipped.
import { useId } from "vue";
import { columnsOf, pictureOf, rows, str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; images?: unknown; columns?: unknown; id?: string; blockType?: string; blockName?: string }>();
const titleId = useId();
const title = computed(() => str(props.heading));
const cols = computed(() => columnsOf(props.columns));
const items = computed(() =>
  rows(props.images)
    .map((row) => ({ picture: pictureOf(row.image, str(row.caption)), caption: str(row.caption) }))
    .filter((item) => item.picture),
);
</script>

<template>
  <section v-if="title || items.length" class="poly-block poly-block--gallery" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <ul v-if="items.length" :class="['poly-gallery__list', `poly-gallery__list--cols-${cols}`]">
        <li v-for="(item, i) in items" :key="i" class="poly-gallery__item">
          <figure class="poly-gallery__figure">
            <img
              class="poly-gallery__image"
              :src="item.picture!.src"
              :alt="item.picture!.alt"
              :width="item.picture!.width"
              :height="item.picture!.height"
              loading="lazy"
              decoding="async"
            >
            <figcaption v-if="item.caption" class="poly-gallery__caption">{{ item.caption }}</figcaption>
          </figure>
        </li>
      </ul>
    </div>
  </section>
</template>
