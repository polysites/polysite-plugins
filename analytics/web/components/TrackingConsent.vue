<script setup lang="ts">
import type { AnalyticsSite } from "../types/analytics";

// The notice shown before tracking tools that need a yes (analytics that sets
// cookies, and every marketing or advertising pixel). Deliberately plain and
// unthemed: override the poly-tracking* classes in a theme to restyle it.
const props = defineProps<{ site: AnalyticsSite | null | undefined }>();

const { asking, notice, groups, accept, decline } = useTracking(toRef(props, "site"));

const policyUrl = computed(() => {
  const url = props.site?.privacyPolicyUrl;
  return url && (url.startsWith("/") || /^https?:\/\//i.test(url)) ? url : null;
});
const both = computed(() => groups.value.length > 1);
</script>

<template>
  <div v-if="asking" class="poly-tracking" role="dialog" aria-label="Tracking and cookies" aria-live="polite">
    <p class="poly-tracking-text">
      {{ notice }}
      <a v-if="policyUrl" :href="policyUrl" class="poly-tracking-link">Privacy policy</a>
    </p>
    <div class="poly-tracking-actions">
      <button type="button" class="poly-tracking-decline" @click="decline">{{ both ? "Reject all" : "No thanks" }}</button>
      <button type="button" class="poly-tracking-accept" @click="accept">{{ both ? "Allow all" : "Allow" }}</button>
    </div>
  </div>
</template>

<style scoped>
.poly-tracking {
  position: fixed;
  inset: auto 1rem 1rem 1rem;
  z-index: 1000;
  max-width: 36rem;
  margin-inline: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1rem;
  background: #fff;
  color: #1a1a1a;
  border: 1px solid #d0d0d0;
  border-radius: 0.5rem;
  box-shadow: 0 4px 20px rgb(0 0 0 / 0.15);
  font-size: 0.9rem;
}
.poly-tracking-text {
  margin: 0;
  flex: 1 1 14rem;
}
.poly-tracking-link {
  margin-left: 0.25rem;
  text-decoration: underline;
}
.poly-tracking-actions {
  display: flex;
  gap: 0.5rem;
}
.poly-tracking-actions button {
  padding: 0.45rem 0.9rem;
  border-radius: 0.375rem;
  border: 1px solid #1a1a1a;
  font: inherit;
  cursor: pointer;
}
.poly-tracking-decline {
  background: #fff;
  color: #1a1a1a;
}
.poly-tracking-accept {
  background: #1a1a1a;
  color: #fff;
}
</style>
