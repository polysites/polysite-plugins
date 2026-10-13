<script setup lang="ts">
// Plain default for the `stats` (key figures) block. A theme replaces it by shipping a component named StatsBlock.
import { useId } from "vue";
import { rows, str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; items?: unknown; id?: string; blockType?: string; blockName?: string }>();
const titleId = useId();
const title = computed(() => str(props.heading));
const items = computed(() =>
  rows(props.items)
    .map((item) => ({ value: str(item.value), label: str(item.label) }))
    .filter((item) => item.value && item.label),
);
</script>

<template>
  <section v-if="title || items.length" class="poly-block poly-block--stats" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <!-- A description list: each figure is read as its label and then its value ("Years in business: 15+"), shown value first. -->
      <dl v-if="items.length" class="poly-stats__list">
        <div v-for="(item, i) in items" :key="i" class="poly-stats__item">
          <dt class="poly-stats__label">{{ item.label }}</dt>
          <dd class="poly-stats__value">{{ item.value }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
