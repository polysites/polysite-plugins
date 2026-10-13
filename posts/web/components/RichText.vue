<script setup lang="ts">
import { h, type VNode } from "vue";

import { lexicalToNodes, type RNode } from "../utils/lexical";

// Draws a post's rich-text body. The text goes through utils/lexical.ts, which only lets a
// fixed set of tags and attributes through, and Vue escapes every piece of text, so nothing an
// editor types is ever inserted as raw HTML.
const props = defineProps<{ data: unknown }>();

const nodes = computed(() => lexicalToNodes(props.data));

function draw(node: RNode): VNode | string {
  if (node.text !== undefined) return node.text;
  return h(node.tag as string, node.attrs, (node.children ?? []).map(draw));
}

const Draw = (p: { nodes: RNode[] }) => p.nodes.map(draw);
</script>

<template>
  <div class="poly-richtext">
    <Draw :nodes="nodes"/>
  </div>
</template>

<style scoped>
.poly-richtext :deep(p),
.poly-richtext :deep(ul),
.poly-richtext :deep(ol),
.poly-richtext :deep(blockquote),
.poly-richtext :deep(figure) {
  margin: 0 0 1em;
}
.poly-richtext :deep(h2),
.poly-richtext :deep(h3),
.poly-richtext :deep(h4) {
  margin: 1.6em 0 0.5em;
  line-height: 1.25;
}
.poly-richtext :deep(ul) {
  list-style: disc;
  padding-left: 1.4em;
}
.poly-richtext :deep(ol) {
  list-style: decimal;
  padding-left: 1.4em;
}
.poly-richtext :deep(blockquote) {
  border-left: 4px solid var(--brand-primary, currentColor);
  padding-left: 1em;
  font-style: italic;
}
.poly-richtext :deep(a) {
  text-decoration: underline;
}
.poly-richtext :deep(img) {
  max-width: 100%;
  height: auto;
}
.poly-richtext :deep(hr) {
  margin: 1.5em 0;
}
.poly-richtext :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.92em;
}
</style>
