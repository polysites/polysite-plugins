<script setup lang="ts">
// Plain default for the `price-list` block (salon services, a menu, a shop catalogue). A theme replaces it by shipping a component
// named PriceListBlock.
import { useId } from "vue";
import { rows, str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; intro?: unknown; sections?: unknown; id?: string; blockType?: string; blockName?: string }>();
const titleId = useId();
const title = computed(() => str(props.heading));
const intro = computed(() => str(props.intro));
// Group names are headings one level below the block's own, or directly below the page title when the block has none.
const level = computed(() => (title.value ? "h3" : "h2"));
const sections = computed(() =>
  rows(props.sections)
    .map((section) => ({
      title: str(section.title),
      items: rows(section.items)
        .filter((item) => str(item.name))
        .map((item) => ({ name: str(item.name), description: str(item.description), price: str(item.price), tag: str(item.tag) })),
    }))
    .filter((section) => section.title || section.items.length),
);
</script>

<template>
  <section v-if="title || sections.length" class="poly-block poly-block--price-list" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <p v-if="intro" class="poly-block__intro">{{ intro }}</p>
      <div v-if="sections.length" class="poly-price-list__sections">
        <div v-for="(section, i) in sections" :key="i" class="poly-price-list__section">
          <component :is="level" v-if="section.title" class="poly-block__item-title poly-price-list__title">{{ section.title }}</component>
          <ul v-if="section.items.length" class="poly-price-list__items">
            <li v-for="(item, j) in section.items" :key="j" class="poly-price-list__item">
              <div class="poly-price-list__row">
                <span class="poly-price-list__name">{{ item.name }}</span>
                <span v-if="item.tag" class="poly-price-list__tag">{{ item.tag }}</span>
                <span v-if="item.price" class="poly-price-list__leader" aria-hidden="true" />
                <span v-if="item.price" class="poly-price-list__price">{{ item.price }}</span>
              </div>
              <p v-if="item.description" class="poly-price-list__description">{{ item.description }}</p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>
