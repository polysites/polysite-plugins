<script setup lang="ts">
// The "Cookie settings" link, shown where a layout puts the core's footer-links slot (the core's
// <TrackingSettingsLink /> does): reopens the tracking notice so a visitor can change their answer. Renders nothing
// unless the site has a tool that asks, so it is safe on every site.
const ui = useTrackingUi();
</script>

<template>
  <button v-if="ui.available.value" type="button" class="poly-tracking-settings" @click="ui.reopen.value = true">
    <slot>Cookie settings</slot>
  </button>
</template>

<style scoped>
.poly-tracking-settings {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
