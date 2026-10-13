import type { Component } from "vue";

import "../assets/blocks-pack.css";
import CtaBlock from "../components/blocks-pack/CtaBlock.vue";
import GalleryBlock from "../components/blocks-pack/GalleryBlock.vue";
import HoursContactBlock from "../components/blocks-pack/HoursContactBlock.vue";
import LogosBlock from "../components/blocks-pack/LogosBlock.vue";
import PriceListBlock from "../components/blocks-pack/PriceListBlock.vue";
import PricingBlock from "../components/blocks-pack/PricingBlock.vue";
import ScheduleBlock from "../components/blocks-pack/ScheduleBlock.vue";
import StatsBlock from "../components/blocks-pack/StatsBlock.vue";
import TeamBlock from "../components/blocks-pack/TeamBlock.vue";
import TestimonialsBlock from "../components/blocks-pack/TestimonialsBlock.vue";
import TimelineBlock from "../components/blocks-pack/TimelineBlock.vue";
import de from "../locales/de.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import { BLOCK_NAMES } from "../utils/blockNames";

// Registers the blocks with the core's block renderer (utils/blockTypes.ts) and the dictionaries for the fixed words in French,
// Spanish and German. The name each block is registered under (utils/blockNames.ts) is what a theme calls its own version: a
// theme that ships components/<theme>/GalleryBlock.vue replaces the plain one below for its sites, and a child theme inherits
// its parent's.
const COMPONENTS: Record<string, Component> = {
  gallery: GalleryBlock,
  pricing: PricingBlock,
  testimonials: TestimonialsBlock,
  timeline: TimelineBlock,
  team: TeamBlock,
  cta: CtaBlock,
  "hours-contact": HoursContactBlock,
  "price-list": PriceListBlock,
  schedule: ScheduleBlock,
  stats: StatsBlock,
  logos: LogosBlock,
};

export default defineNuxtPlugin({
  name: "blocks-pack-web",
  dependsOn: ["block-types", "strings"],
  setup(nuxtApp) {
    for (const [slug, name] of Object.entries(BLOCK_NAMES)) nuxtApp.$blockTypes.register({ slug, name, component: COMPONENTS[slug]! });
    nuxtApp.$strings.register("fr", fr);
    nuxtApp.$strings.register("es", es);
    nuxtApp.$strings.register("de", de);
  },
});
