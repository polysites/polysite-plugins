<script setup lang="ts">
// Share buttons for the page in front of the visitor. Every network is a plain link (rel="noopener noreferrer", no script, no image
// from anywhere else), so they work with JavaScript off and nothing leaves the site until a visitor clicks one. Two extras appear
// only once the page has loaded and only if the browser can do them: "Copy link" and the device's own share menu.
//
// Place it with <SiteSlot name="share" /> or <ShareButtons /> after the page's content (it reads the page's title once the page has
// set it). With the site's placement set to floating, the plugin draws it by itself (ShareFloating).
// Carries `poly-share*` class names, and reads --poly-share-bg, --poly-share-fg and --poly-share-radius, so a theme can restyle it.
import type { Ref } from "vue";
import type { ShareSite } from "../types/share";
import { NETWORKS, readSettings, shareLinks, shouldShow } from "../utils/share.js";
import { ICONS } from "../utils/shareIcons.js";

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ site?: ShareSite | null; where?: "inline" | "floating" }>(), { site: undefined, where: "inline" });

const t = useT();
// A theme that places <ShareButtons /> itself doesn't pass the site; the slot in the app root does.
const siteRef = (props.site === undefined ? await useSite() : toRef(props, "site")) as Ref<ShareSite | null | undefined>;
const settings = computed(() => readSettings(siteRef.value?.extensions?.share));
const page = await useSharePage(siteRef, props.where);

const visible = computed(() => Boolean(page.value.url) && shouldShow(settings.value, page.value.kind, props.where));
const links = computed(() =>
  visible.value ? shareLinks({ url: page.value.url, title: page.value.title, text: settings.value.text, via: settings.value.via, networks: settings.value.networks }) : [],
);
// What the device's share menu is given as text: the same words the links carry.
const message = computed(() => {
  const { text } = settings.value;
  if (!text) return page.value.title;
  return text.includes("{title}") ? text.replaceAll("{title}", page.value.title) : `${text} ${page.value.title}`;
});

// Copy link and the device's menu are browser features: they only exist after the page has loaded, and only if the browser has them.
const mounted = ref(false);
const canNative = ref(false);
onMounted(() => {
  mounted.value = true;
  canNative.value = typeof navigator.share === "function";
});
const wants = (key: string) => settings.value.networks.includes(key);
const showCopy = computed(() => visible.value && mounted.value && wants("copy"));
const showNative = computed(() => visible.value && mounted.value && canNative.value && wants("native"));
const isEmpty = computed(() => !links.value.length && !showCopy.value && !showNative.value);

// A floating bar is always icons only: it has no room for names.
const look = computed(() => (props.where === "floating" ? "icons" : settings.value.style));
const shape = computed(() => (props.where === "floating" ? (settings.value.placement === "floating-bottom" ? "poly-share--bottom" : "poly-share--side") : ""));
const nameOf = (network: string) => (network === "email" ? t("share.emailName", "Email") : NETWORKS[network as keyof typeof NETWORKS].label);
const accessibleName = (network: string) =>
  network === "email" ? t("share.email", "Share by email") : t("share.on", "Share on {network}", { network: NETWORKS[network as keyof typeof NETWORKS].label });
type Icon = { fill?: string; rule?: string; line?: string[] };
const icon = (network: string) => (ICONS as Record<string, Icon>)[network] ?? {};

const status = ref("");
let statusTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string) {
  status.value = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.value = ""), 4000);
}
onBeforeUnmount(() => clearTimeout(statusTimer));

// Sends nothing anywhere: a script of the site's own can listen for it (to count shares in the analytics it already uses, say).
function announce(network: string) {
  window.dispatchEvent(new CustomEvent("polysite:share", { detail: { network, url: page.value.url, title: page.value.title } }));
}

// For browsers without the clipboard API (or a page not served securely).
function legacyCopy(text: string) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(field);
  field.select();
  const done = document.execCommand("copy");
  field.remove();
  if (!done) throw new Error("copy failed");
}

async function copyLink() {
  const url = page.value.url;
  try {
    // The clipboard API refuses on some pages (not served securely, or not focused); the older way still works there.
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      legacyCopy(url);
    }
    say(t("share.copied", "Link copied"));
    announce("copy");
  } catch {
    say(t("share.copyFailed", "The link could not be copied"));
  }
}

async function nativeShare() {
  try {
    await navigator.share({ title: page.value.title, text: message.value || undefined, url: page.value.url });
    announce("native");
  } catch (err) {
    // Closing the menu is not an error.
    if (!(err instanceof DOMException && err.name === "AbortError")) say(t("share.failed", "The page could not be shared"));
  }
}
</script>

<template>
  <nav v-if="visible && !isEmpty" v-bind="$attrs" :class="['poly-share', `poly-share--${look}`, `poly-share--${where}`, shape]" :aria-label="t('share.label', 'Share this page')">
    <p v-if="where === 'inline'" class="poly-share-heading">{{ t("share.heading", "Share") }}</p>
    <ul class="poly-share-list">
      <li v-for="link in links" :key="link.network">
        <a
          class="poly-share-item"
          :class="`poly-share-${link.network}`"
          :href="link.href"
          :target="link.external ? '_blank' : undefined"
          :rel="link.external ? 'noopener noreferrer' : undefined"
          :aria-label="accessibleName(link.network)"
          :title="look === 'icons' ? accessibleName(link.network) : undefined"
          @click="announce(link.network)"
        >
          <svg v-if="look !== 'text'" class="poly-share-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path v-if="icon(link.network).fill" :d="icon(link.network).fill" fill="currentColor" :fill-rule="icon(link.network).rule" />
            <path v-for="d in icon(link.network).line ?? []" :key="d" :d="d" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-if="look !== 'icons'" class="poly-share-name">{{ nameOf(link.network) }}</span>
        </a>
      </li>
      <li v-if="showNative">
        <button
          type="button"
          class="poly-share-item poly-share-native"
          :aria-label="t('share.native', 'Share…')"
          :title="look === 'icons' ? t('share.native', 'Share…') : undefined"
          @click="nativeShare"
        >
          <svg v-if="look !== 'text'" class="poly-share-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path v-for="d in icon('native').line" :key="d" :d="d" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-if="look !== 'icons'" class="poly-share-name">{{ t("share.nativeName", "Share") }}</span>
        </button>
      </li>
      <li v-if="showCopy">
        <button
          type="button"
          class="poly-share-item poly-share-copy"
          :aria-label="t('share.copy', 'Copy link')"
          :title="look === 'icons' ? t('share.copy', 'Copy link') : undefined"
          @click="copyLink"
        >
          <svg v-if="look !== 'text'" class="poly-share-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path v-for="d in icon('copy').line" :key="d" :d="d" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-if="look !== 'icons'" class="poly-share-name">{{ t("share.copy", "Copy link") }}</span>
        </button>
      </li>
    </ul>
    <!-- Always present, so a screen reader is already listening when the words appear. -->
    <p class="poly-share-status" role="status" aria-live="polite">{{ status }}</p>
  </nav>
</template>

<style scoped>
.poly-share {
  --_bg: var(--poly-share-bg, #fff);
  --_fg: var(--poly-share-fg, #1a1a1a);
  --_radius: var(--poly-share-radius, 0.5rem);
  font-size: 0.9rem;
}
.poly-share-heading {
  margin: 0 0 0.4rem;
  font-weight: 600;
}
.poly-share-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.poly-share-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 2.75rem;
  min-width: 2.75rem;
  padding: 0 0.85rem;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: var(--_radius);
  background: color-mix(in srgb, currentColor 6%, transparent);
  color: inherit;
  font: inherit;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
}
.poly-share-item:hover {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.poly-share-item:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.poly-share--icons .poly-share-item {
  padding: 0;
  width: 2.75rem;
}
.poly-share-icon {
  flex: none;
}
/* Visually hidden but read aloud: "Link copied" and the like. */
.poly-share-status {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Floating: its own surface, so it stays legible over any page; light or dark by the visitor's setting unless a theme sets the colours. */
.poly-share--floating {
  position: fixed;
  z-index: 900;
  padding: 0.35rem;
  background: var(--_bg);
  color: var(--_fg);
  border: 1px solid color-mix(in srgb, var(--_fg) 25%, transparent);
  border-radius: calc(var(--_radius) + 0.25rem);
  box-shadow: 0 4px 20px rgb(0 0 0 / 0.18);
}
.poly-share--floating .poly-share-item {
  border-color: transparent;
}
.poly-share--side {
  inset-inline-start: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
}
.poly-share--side .poly-share-list {
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 0.25rem;
}
.poly-share--bottom {
  inset-inline: 0;
  bottom: 0.75rem;
  width: fit-content;
  margin-inline: auto;
}
.poly-share--bottom .poly-share-list {
  gap: 0.25rem;
  justify-content: center;
}
@media (prefers-color-scheme: dark) {
  .poly-share {
    --_bg: var(--poly-share-bg, #1f2125);
    --_fg: var(--poly-share-fg, #f2f2f2);
  }
}
/* Below 80rem a rail at the side would cover the text, so it becomes a bar along the bottom. */
@media (max-width: 79.9375rem) {
  .poly-share--side {
    inset: auto 0 0.75rem 0;
    transform: none;
    width: fit-content;
    margin-inline: auto;
    padding-bottom: calc(0.35rem + env(safe-area-inset-bottom, 0px));
  }
  .poly-share--side .poly-share-list {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.25rem;
  }
}
@media print {
  .poly-share--floating {
    display: none;
  }
}
</style>
