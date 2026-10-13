<script setup lang="ts">
// The search box a theme places with <SiteSlot name="search" />. It draws nothing on a site that hasn't switched search on,
// and nothing on the results page itself (which has its own form). Style it from the theme: the form is plain, with the
// classes poly-search-form, poly-search-input and poly-search-button.
import type { SearchSite } from "../types/search";
import { isSearchPath, searchEnabled } from "../utils/search";

const site = await useSite();
const language = useSiteLanguage();
const settings = computed(() => (site.value as SearchSite | null)?.extensions?.search);
const show = computed(() => searchEnabled(site.value as SearchSite | null) && !isSearchPath(language.path.value));
</script>

<template>
  <SearchForm v-if="show" :placeholder="settings?.placeholder" />
</template>
