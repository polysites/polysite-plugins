<script setup lang="ts">
// The search form. A plain GET form to the results page, so it works without scripts and the result is an address a visitor
// can share. The label is always present (hidden from sight, never from screen readers). Not async on purpose: it is drawn
// inside other async components, which hydrate reliably only one level deep.
import { MIN_QUERY, SEARCH_PATH } from "../utils/search";

const props = defineProps<{ q?: string; label?: string; placeholder?: string | null }>();

const t = useT();
const localePath = useLocalePath();
const id = useId();

const action = computed(() => localePath(`/${SEARCH_PATH}`));
const hint = computed(() => props.placeholder?.trim() || t("search.placeholder", "Search this site"));
const label = computed(() => props.label ?? t("search.label", "Search"));
</script>
<!-- The label is tied to its input with for/id; the lint rule that wants nesting as well adds nothing. -->
<!-- eslint-disable vuejs-accessibility/label-has-for -->
<template>
  <form role="search" :aria-label="label" :action="action" method="get" class="poly-search-form">
    <label :for="`${id}-q`" class="poly-search-hidden">{{ label }}</label>
    <input
      :id="`${id}-q`"
      type="search"
      name="q"
      :value="q ?? ''"
      :placeholder="hint"
      :minlength="MIN_QUERY"
      maxlength="100"
      autocomplete="off"
      enterkeyhint="search"
      class="poly-search-input"
    >
    <button type="submit" class="poly-search-button">{{ t("search.submit", "Search") }}</button>
  </form>
</template>

<style scoped>
.poly-search-form {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}
.poly-search-input {
  flex: 1 1 12rem;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid currentColor;
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  font: inherit;
}
.poly-search-button {
  padding: 0.5rem 1rem;
  border: 1px solid currentColor;
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.poly-search-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
