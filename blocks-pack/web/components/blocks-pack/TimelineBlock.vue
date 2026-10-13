<script setup lang="ts">
// Plain default for the `timeline` block. A theme replaces it by shipping a component named TimelineBlock.
import { useId } from "vue";
import { rows, str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; entries?: unknown; id?: string; blockType?: string; blockName?: string }>();
const titleId = useId();
const title = computed(() => str(props.heading));
const level = computed(() => (title.value ? "h3" : "h2"));
const entries = computed(() =>
  rows(props.entries)
    .filter((entry) => str(entry.title))
    .map((entry) => ({ period: str(entry.period), title: str(entry.title), subtitle: str(entry.subtitle), description: str(entry.description) })),
);
</script>

<template>
  <section v-if="title || entries.length" class="poly-block poly-block--timeline" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <ol v-if="entries.length" class="poly-timeline__list">
        <li v-for="(entry, i) in entries" :key="i" class="poly-timeline__item">
          <p v-if="entry.period" class="poly-timeline__period">{{ entry.period }}</p>
          <component :is="level" class="poly-block__item-title poly-timeline__title">{{ entry.title }}</component>
          <p v-if="entry.subtitle" class="poly-timeline__subtitle">{{ entry.subtitle }}</p>
          <p v-if="entry.description" class="poly-timeline__description">{{ entry.description }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>
