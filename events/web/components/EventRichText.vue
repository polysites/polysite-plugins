<script setup lang="ts">
import { h, type VNode } from "vue";

import { eventLexicalToNodes, type EventRNode } from "../utils/eventLexical";

// Draws an event's rich-text body. The text goes through utils/lexical.ts, which only lets a
// fixed set of tags and attributes through, and Vue escapes every piece of text, so nothing an
// editor types is ever inserted as raw HTML.
const props = defineProps<{ data: unknown }>();

const nodes = computed(() => eventLexicalToNodes(props.data));

function draw(node: EventRNode): VNode | string {
  if (node.text !== undefined) return node.text;
  return h(node.tag as string, node.attrs, (node.children ?? []).map(draw));
}

const Draw = (p: { nodes: EventRNode[] }) => p.nodes.map(draw);
</script>

<template>
  <div class="poly-event-richtext">
    <Draw :nodes="nodes"/>
  </div>
</template>

<style scoped>
.poly-event-richtext :deep(p),
.poly-event-richtext :deep(ul),
.poly-event-richtext :deep(ol),
.poly-event-richtext :deep(blockquote),
.poly-event-richtext :deep(figure) {
  margin: 0 0 1em;
}
.poly-event-richtext :deep(h2),
.poly-event-richtext :deep(h3),
.poly-event-richtext :deep(h4) {
  margin: 1.6em 0 0.5em;
  line-height: 1.25;
}
.poly-event-richtext :deep(ul) {
  list-style: disc;
  padding-inline-start: 1.4em;
}
.poly-event-richtext :deep(ol) {
  list-style: decimal;
  padding-inline-start: 1.4em;
}
.poly-event-richtext :deep(blockquote) {
  border-inline-start: 4px solid var(--brand-primary, currentColor);
  padding-inline-start: 1em;
  font-style: italic;
}
.poly-event-richtext :deep(a) {
  text-decoration: underline;
}
.poly-event-richtext :deep(img) {
  max-width: 100%;
  height: auto;
}
.poly-event-richtext :deep(hr) {
  margin: 1.5em 0;
}
.poly-event-richtext :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.92em;
}
</style>
