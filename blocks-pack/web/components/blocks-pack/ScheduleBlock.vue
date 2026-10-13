<script setup lang="ts">
// Plain default for the `schedule` block (an event programme, class timetable). A theme replaces it by shipping a component named
// ScheduleBlock.
import { useId } from "vue";
import { rows, str, timeParts } from "../../utils/blocks.js";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ heading?: unknown; days?: unknown; id?: string; blockType?: string; blockName?: string }>();
const t = useT();
const titleId = useId();
const title = computed(() => str(props.heading));
// A day is a heading one level below the block's own (or directly below the page title when the block has none), and a session
// one level below its day.
const dayLevel = computed(() => (title.value ? "h3" : "h2"));
const sessionLevel = computed(() => (title.value ? "h4" : "h3"));
const days = computed(() =>
  rows(props.days)
    .map((day) => ({
      label: str(day.label),
      sessions: rows(day.sessions)
        .filter((session) => str(session.title))
        .map((session) => ({
          parts: timeParts(session.time),
          title: str(session.title),
          speaker: str(session.speaker),
          room: str(session.room),
          description: str(session.description),
        })),
    }))
    .filter((day) => day.label || day.sessions.length),
);
</script>

<template>
  <section v-if="title || days.length" class="poly-block poly-block--schedule" :aria-labelledby="title ? titleId : undefined">
    <div class="poly-block__inner">
      <h2 v-if="title" :id="titleId" class="poly-block__heading">{{ title }}</h2>
      <div v-if="days.length" class="poly-schedule__days">
        <div v-for="(day, i) in days" :key="i" class="poly-schedule__day">
          <component :is="dayLevel" v-if="day.label" class="poly-block__item-title poly-schedule__label">{{ day.label }}</component>
          <ol v-if="day.sessions.length" class="poly-schedule__sessions">
            <li v-for="(session, j) in day.sessions" :key="j" class="poly-schedule__session">
              <p class="poly-schedule__time">
                <template v-for="(part, k) in session.parts" :key="k"><time v-if="part.datetime" :datetime="part.datetime">{{ part.text }}</time><template v-else>{{ part.text }}</template></template>
              </p>
              <div class="poly-schedule__details">
                <component :is="sessionLevel" class="poly-block__sub-title poly-schedule__title">{{ session.title }}</component>
                <p v-if="session.speaker || session.room" class="poly-schedule__meta">
                  <span v-if="session.speaker" class="poly-schedule__speaker"><span class="poly-sr-only">{{ t("blocks.speaker", "Speaker") }}: </span>{{ session.speaker }}</span>
                  <span v-if="session.room" class="poly-schedule__room"><span class="poly-sr-only">{{ t("blocks.room", "Room") }}: </span>{{ session.room }}</span>
                </p>
                <p v-if="session.description" class="poly-schedule__description">{{ session.description }}</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  </section>
</template>
