<script setup lang="ts">
// The floating copy of the buttons, which this plugin's Nuxt plugin puts in the core's `app` slot. It draws nothing unless the site's
// placement is one of the floating ones, so a site whose theme places the buttons itself never gets two sets.
import type { ShareSite } from "../types/share";
import { readSettings } from "../utils/share.js";

const props = defineProps<{ site?: ShareSite | null }>();
const settings = computed(() => readSettings(props.site?.extensions?.share));
const floating = computed(() => settings.value.enabled && settings.value.placement !== "inline");
</script>

<template>
  <ShareButtons v-if="floating" :site="site ?? null" where="floating" />
</template>
