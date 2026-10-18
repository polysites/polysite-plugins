<script setup lang="ts">
// A list of the languages the page is available in. The links are ordinary addresses: moving to another language is a normal
// page load, so the whole page (menu, labels, text) arrives in that language.
import { switcherLanguages } from "../utils/alternates";

const language = useSiteLanguage();
const t = useT();
const { data: entry } = await usePageTranslations();
const translated = computed(() => entry.value?.languages ?? null);

const choices = computed(() => switcherLanguages(language.setup.value, language.code.value, translated.value));
// The page's address in each language: its own when it has one (/fr/a-propos), else this address under the language's prefix.
const addressOf = (code: string) =>
  entry.value
    ? addressInLanguage(entry.value.path, entry.value.localized, code, language.setup.value)
    : withLanguage(language.path.value ? `/${language.path.value}` : "/", code, language.setup.value);
</script>

<template>
  <nav v-if="language.multilingual.value && choices.length > 1" class="poly-language-switcher" :aria-label="t('language.label', 'Language')">
    <ul>
      <li v-for="code in choices" :key="code">
        <a :href="addressOf(code)" :lang="code" :hreflang="code" :aria-current="code === language.code.value ? 'true' : undefined">
          {{ nameOf(code) }}
        </a>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.poly-language-switcher ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.875rem;
}
.poly-language-switcher a {
  color: inherit;
  text-decoration: none;
  opacity: 0.75;
}
.poly-language-switcher a[aria-current="true"] {
  opacity: 1;
  font-weight: 600;
  text-decoration: underline;
}
.poly-language-switcher a:hover,
.poly-language-switcher a:focus-visible {
  opacity: 1;
  text-decoration: underline;
}
</style>
