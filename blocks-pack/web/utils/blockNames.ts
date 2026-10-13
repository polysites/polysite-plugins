// The blocks this plugin draws: the slug in the page data and the component name a theme uses to override it
// (components/<theme>/GalleryBlock.vue -> the theme's own gallery). Kept apart from the Nuxt plugin so it can be tested on its own.
export const BLOCK_NAMES: Record<string, string> = {
  gallery: "GalleryBlock",
  pricing: "PricingBlock",
  testimonials: "TestimonialsBlock",
  timeline: "TimelineBlock",
  team: "TeamBlock",
  cta: "CtaBlock",
  "hours-contact": "HoursContactBlock",
  "price-list": "PriceListBlock",
  schedule: "ScheduleBlock",
  stats: "StatsBlock",
  logos: "LogosBlock",
};
