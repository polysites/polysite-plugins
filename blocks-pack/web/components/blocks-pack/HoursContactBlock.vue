<script setup lang="ts">
// Plain default for the `hours-contact` block. A theme replaces it by shipping a component named HoursContactBlock.
import { useId } from "vue";
import { lines, mailHref, rows, str, telHref, timeParts } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  heading?: unknown;
  hours?: unknown;
  address?: unknown;
  phone?: unknown;
  email?: unknown;
  note?: unknown;
  id?: string;
  blockType?: string;
  blockName?: string;
}>();
const t = useT();
const titleId = useId();
const title = computed(() => str(props.heading));
const level = computed(() => (title.value ? "h3" : "h2"));
const hours = computed(() =>
  rows(props.hours)
    .filter((row) => str(row.days) || str(row.time))
    .map((row) => ({ days: str(row.days), parts: timeParts(row.time) })),
);
const addressLines = computed(() => lines(props.address));
const phone = computed(() => ({ text: str(props.phone), href: telHref(props.phone) }));
const email = computed(() => ({ text: str(props.email), href: mailHref(props.email) }));
const note = computed(() => str(props.note));
const hasContact = computed(() => addressLines.value.length > 0 || phone.value.text !== "" || email.value.text !== "");
</script>

<template>
  <section v-if="title || hours.length || hasContact || note" class="poly-block poly-block--hours-contact" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <div class="poly-hours-contact__columns">
        <div v-if="hours.length" class="poly-hours-contact__hours-wrap">
          <component :is="level" class="poly-block__item-title poly-hours-contact__title">{{ t("blocks.hours", "Opening hours") }}</component>
          <dl class="poly-hours-contact__hours">
            <div v-for="(row, i) in hours" :key="i" class="poly-hours-contact__row">
              <dt class="poly-hours-contact__days">{{ row.days }}</dt>
              <dd class="poly-hours-contact__time">
                <template v-for="(part, j) in row.parts" :key="j"><time v-if="part.datetime" :datetime="part.datetime">{{ part.text }}</time><template v-else>{{ part.text }}</template></template>
              </dd>
            </div>
          </dl>
        </div>
        <div v-if="hasContact" class="poly-hours-contact__contact">
          <component :is="level" class="poly-block__item-title poly-hours-contact__title">{{ t("blocks.contact", "Contact") }}</component>
          <address class="poly-hours-contact__address">
            <p v-if="addressLines.length" class="poly-hours-contact__lines">
              <span class="poly-sr-only">{{ t("blocks.address", "Address") }}: </span>
              <template v-for="(line, i) in addressLines" :key="i"><br v-if="i > 0">{{ line }}</template>
            </p>
            <p v-if="phone.text" class="poly-hours-contact__phone">
              <span class="poly-sr-only">{{ t("blocks.phone", "Phone") }}: </span>
              <a v-if="phone.href" :href="phone.href">{{ phone.text }}</a>
              <template v-else>{{ phone.text }}</template>
            </p>
            <p v-if="email.text" class="poly-hours-contact__email">
              <span class="poly-sr-only">{{ t("blocks.email", "Email") }}: </span>
              <a v-if="email.href" :href="email.href">{{ email.text }}</a>
              <template v-else>{{ email.text }}</template>
            </p>
          </address>
        </div>
      </div>
      <p v-if="note" class="poly-hours-contact__note">{{ note }}</p>
    </div>
  </section>
</template>
