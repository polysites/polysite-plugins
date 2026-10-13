<script setup lang="ts">
// Plain default for the `pricing` block. A theme replaces it by shipping a component named PricingBlock.
import { useId } from "vue";
import { rows, str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; intro?: unknown; plans?: unknown; id?: string; blockType?: string; blockName?: string }>();
const t = useT();
const link = useBlockLink();
const titleId = useId();
const title = computed(() => str(props.heading));
const intro = computed(() => str(props.intro));
// Plan names are headings one level below the block's own, or directly below the page title when the block has none.
const level = computed(() => (title.value ? "h3" : "h2"));
const plans = computed(() =>
  rows(props.plans)
    .filter((plan) => str(plan.name))
    .map((plan) => {
      const label = str(plan.buttonLabel);
      const href = link(plan.buttonHref);
      return {
        name: str(plan.name),
        price: str(plan.price),
        period: str(plan.period),
        description: str(plan.description),
        features: rows(plan.features)
          .map((f) => str(f.text))
          .filter(Boolean),
        highlighted: plan.highlighted === true,
        button: label && href ? { label, href } : null,
      };
    }),
);
</script>

<template>
  <section v-if="title || plans.length" class="poly-block poly-block--pricing" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <p v-if="intro" class="poly-block__intro">{{ intro }}</p>
      <ul v-if="plans.length" class="poly-pricing__list">
        <li v-for="(plan, i) in plans" :key="i" :class="['poly-pricing__item', { 'poly-pricing__item--highlighted': plan.highlighted }]">
          <p v-if="plan.highlighted" class="poly-pricing__badge">{{ t("blocks.recommended", "Recommended") }}</p>
          <component :is="level" class="poly-block__item-title poly-pricing__name">{{ plan.name }}</component>
          <p v-if="plan.price" class="poly-pricing__price">
            <span class="poly-pricing__amount">{{ plan.price }}</span>
            <span v-if="plan.period" class="poly-pricing__period">{{ plan.period }}</span>
          </p>
          <p v-if="plan.description" class="poly-pricing__description">{{ plan.description }}</p>
          <ul v-if="plan.features.length" class="poly-pricing__features">
            <li v-for="(feature, j) in plan.features" :key="j" class="poly-pricing__feature">{{ feature }}</li>
          </ul>
          <p v-if="plan.button" class="poly-pricing__action">
            <NuxtLink :to="plan.button.href" class="poly-block__button">{{ plan.button.label }}</NuxtLink>
          </p>
        </li>
      </ul>
    </div>
  </section>
</template>
