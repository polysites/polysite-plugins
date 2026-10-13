<script setup lang="ts">
// Draws nothing. Tells search engines which languages this page exists in (alternate links, with x-default), and asks them not to
// index a page that is only showing the default language's text under another language's address.
import { alternateLinks, pageLanguages, shouldNoindex } from "../utils/alternates";

const language = useSiteLanguage();
const origin = useRequestURL().origin;
const { data: translated } = await usePageTranslations();

const have = computed(() => pageLanguages(language.setup.value, translated.value));
const addressOf = (code: string) => withLanguage(language.path.value ? `/${language.path.value}` : "/", code, language.setup.value);

useHead({
  link: computed(() => (language.multilingual.value ? alternateLinks(language.setup.value, have.value, origin, addressOf) : [])),
  meta: computed(() =>
    language.multilingual.value && shouldNoindex(language.setup.value, language.code.value, translated.value)
      ? [{ name: "robots", content: "noindex, follow" }]
      : [],
  ),
});
</script>

<template>
  <span hidden />
</template>
