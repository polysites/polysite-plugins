<script setup lang="ts">
// Plain default for the `cta` (call to action) block. A theme replaces it by shipping a component named CtaBlock.
import { useId } from "vue";
import { str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  heading?: unknown;
  text?: unknown;
  buttonLabel?: unknown;
  buttonHref?: unknown;
  secondaryLabel?: unknown;
  secondaryHref?: unknown;
  id?: string;
  blockType?: string;
  blockName?: string;
}>();
const link = useBlockLink();
const titleId = useId();
const title = computed(() => str(props.heading));
const text = computed(() => str(props.text));
// A button needs both its words and an address that is safe to follow; otherwise it is left out.
const primary = computed(() => {
  const label = str(props.buttonLabel);
  const href = link(props.buttonHref);
  return label && href ? { label, href } : null;
});
const secondary = computed(() => {
  const label = str(props.secondaryLabel);
  const href = link(props.secondaryHref);
  return label && href ? { label, href } : null;
});
</script>

<template>
  <section v-if="title" class="poly-block poly-block--cta" :aria-labelledby="titleId">
    <div class="poly-block__inner">
      <h2 :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <p v-if="text" class="poly-cta__text">{{ text }}</p>
      <p v-if="primary || secondary" class="poly-cta__actions">
        <NuxtLink v-if="primary" :to="primary.href" class="poly-block__button poly-cta__primary">{{ primary.label }}</NuxtLink>
        <NuxtLink v-if="secondary" :to="secondary.href" class="poly-block__button poly-block__button--quiet poly-cta__secondary">{{ secondary.label }}</NuxtLink>
      </p>
    </div>
  </section>
</template>
