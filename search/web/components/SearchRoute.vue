<script setup lang="ts">
// The results page (/search?q=...). What the search plugin's route (plugins/search.ts) hands to the core's catch-all page to
// draw. The results are in the page itself, built on the server, so it works without scripts and a search is an address.
import type { SearchOutcome } from "../types/search";
import { highlight, MIN_QUERY, resultHref, resultsQuery, SEARCH_PATH, termsOf, typeFallback } from "../utils/search";

const props = defineProps<{ q: string; page: number; outcome: SearchOutcome | null; placeholder?: string | null }>();

const t = useT();
const localePath = useLocalePath();
const id = useId();

const response = computed(() => (props.outcome?.status === "ok" ? props.outcome.data : null));
const terms = computed(() => termsOf(props.q));
const shortQuery = computed(() => props.q.length > 0 && props.q.length < MIN_QUERY);
const base = computed(() => localePath(`/${SEARCH_PATH}`));
const pageHref = (n: number) => `${base.value}${resultsQuery(props.q, n)}`;
const typeLabel = (type: string) => t(`search.type.${type}`, typeFallback(type));

const title = computed(() => (props.q ? t("search.titleFor", "Search: {q}", { q: props.q }) : t("search.title", "Search")));
// A search is a view of the site, not content of its own: it shouldn't be indexed (and a page of results isn't cacheable either).
useSeoMeta({ title, robots: "noindex, follow" });
</script>

<template>
  <div class="poly-search">
    <h1>{{ t("search.title", "Search") }}</h1>
    <SearchForm :q="q" :placeholder="placeholder" />

    <section :aria-labelledby="`${id}-status`" class="poly-search-results">
      <!-- One live region says what happened: a screen reader hears the count (or the problem) when a search finishes. -->
      <p :id="`${id}-status`" class="poly-search-status" role="status">
        <template v-if="!q">{{ t("search.start", "Type a word or two to find pages and articles on this site.") }}</template>
        <template v-else-if="shortQuery || response?.tooShort">{{ t("search.short", "Type at least {min} characters to search.", { min: MIN_QUERY }) }}</template>
        <template v-else-if="outcome?.status === 'limited'">{{ t("search.limited", "Too many searches in a short time. Wait a moment and try again.") }}</template>
        <template v-else-if="outcome?.status === 'error' || !outcome">{{ t("search.error", "Search isn't working right now. Please try again in a moment.") }}</template>
        <template v-else-if="response && response.total === 0">{{ t("search.none", "No results for “{q}”.", { q }) }}</template>
        <template v-else-if="response && response.total === 1">{{ t("search.count.one", "1 result for “{q}”", { q }) }}</template>
        <template v-else-if="response">{{ t("search.count.other", "{count} results for “{q}”", { count: response.total, q }) }}</template>
      </p>

      <p v-if="response && response.total === 0 && !response.tooShort" class="poly-search-hint">
        {{ t("search.none.hint", "Check the spelling, or try fewer or different words.") }}
      </p>

      <ol v-if="response && response.results.length" class="poly-search-list">
        <li v-for="result in response.results" :key="`${result.collection}-${result.id}`" class="poly-search-item">
          <h2>
            <NuxtLink :to="localePath(resultHref(result.path))">
              <template v-for="(part, i) in highlight(result.title, terms)" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
            </NuxtLink>
          </h2>
          <p class="poly-search-type">{{ typeLabel(result.type) }}</p>
          <p v-if="result.snippet" class="poly-search-snippet">
            <template v-for="(part, i) in highlight(result.snippet, terms)" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
          </p>
        </li>
      </ol>

      <nav v-if="response && response.totalPages > 1" :aria-label="t('search.pages', 'Search result pages')" class="poly-search-pages">
        <NuxtLink v-if="response.page > 1" :to="pageHref(response.page - 1)" rel="prev">{{ t("search.prev", "Previous") }}</NuxtLink>
        <span>{{ t("search.page", "Page {page} of {total}", { page: response.page, total: response.totalPages }) }}</span>
        <NuxtLink v-if="response.page < response.totalPages" :to="pageHref(response.page + 1)" rel="next">{{ t("search.next", "Next") }}</NuxtLink>
      </nav>
    </section>
  </div>
</template>

<style scoped>
.poly-search {
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}
.poly-search-results {
  margin-top: 1.5rem;
}
.poly-search-list {
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}
.poly-search-item {
  padding: 1rem 0;
  border-top: 1px solid rgb(128 128 128 / 0.3);
}
.poly-search-item h2 {
  margin: 0;
  font-size: 1.125rem;
}
.poly-search-type {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}
.poly-search-snippet {
  margin: 0.5rem 0 0;
}
.poly-search-pages {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  margin-top: 1.5rem;
}
</style>
