<script setup lang="ts">
// Plain default for the `team` block. A theme replaces it by shipping a component named TeamBlock.
import { useId } from "vue";
import { pictureOf, rows, str } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; intro?: unknown; members?: unknown; id?: string; blockType?: string; blockName?: string }>();
const titleId = useId();
const title = computed(() => str(props.heading));
const intro = computed(() => str(props.intro));
const level = computed(() => (title.value ? "h3" : "h2"));
const members = computed(() =>
  rows(props.members)
    .filter((member) => str(member.name))
    // The name is written beside the photo, so a photo without a description of its own is decoration.
    .map((member) => ({ name: str(member.name), role: str(member.role), bio: str(member.bio), picture: pictureOf(member.image, "") })),
);
</script>

<template>
  <section v-if="title || members.length" class="poly-block poly-block--team" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <p v-if="intro" class="poly-block__intro">{{ intro }}</p>
      <ul v-if="members.length" class="poly-team__list">
        <li v-for="(member, i) in members" :key="i" class="poly-team__item">
          <img
            v-if="member.picture"
            class="poly-team__image"
            :src="member.picture.src"
            :alt="member.picture.alt"
            :width="member.picture.width"
            :height="member.picture.height"
            loading="lazy"
            decoding="async"
          >
          <component :is="level" class="poly-block__item-title poly-team__name">{{ member.name }}</component>
          <p v-if="member.role" class="poly-team__role">{{ member.role }}</p>
          <p v-if="member.bio" class="poly-team__bio">{{ member.bio }}</p>
        </li>
      </ul>
    </div>
  </section>
</template>
