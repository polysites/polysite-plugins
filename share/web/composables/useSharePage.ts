import type { Ref } from "vue";
import { resolveTags } from "unhead/utils";
import type { SharePage, ShareSite } from "../types/share";
import { cleanText, cleanUrl, contentKind } from "../utils/share.js";

// What the buttons need to know about the page in front of the visitor: its address, its own title, and what kind of address it is.
// The title and the canonical address are read from the same head tags the page already writes for search engines and social sites
// (og:title, canonical), so the shared title is exactly the page's own title in the page's own language, and the address is the one the
// SEO module worked out for THIS site's domain, never a value baked into the build.
//
// The catch on the server: this component is drawn alongside the page, not after it, and the page writes its title only once its data
// has arrived (and a content type's component later still). So the server draws the links with one-off placeholders where the title and the address go,
// and swaps the real, percent-encoded ones in when the whole page has been rendered and every tag is final (Nuxt's `app:rendered`
// moment). The result is complete links in the HTML itself, with no waiting and no dependence on the order things render in.
// In the browser the page is read again after it loads and after every in-site navigation, because the site moves between pages without
// reloading.

/** A placeholder that survives cleaning and percent-encoding unchanged, and that nothing else on the page can contain. */
function newPlaceholder(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `polysharetitle${random}`;
}

// Same escaping as the link builder uses for the title (see utils/share.js).
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export async function useSharePage(site: Ref<ShareSite | null | undefined>, where: string) {
  const nuxtApp = useNuxtApp();
  const route = useRoute();
  const requestUrl = useRequestURL();
  const language = useSiteLanguage();
  const head = injectHead();
  // One state per place the buttons appear, so the two never overwrite each other's server-rendered value.
  const page = useState<SharePage>(`polysite-share-page-${where}`, () => ({ url: "", title: "", kind: "pages" }));

  function kindOfAddress(): string {
    const slug = language.path.value.replace(/^\/+|\/+$/g, "");
    if (slug === "") return contentKind({ isHome: true, module: null });
    const enabled = site.value?.enabledModules ?? [];
    for (const contentRoute of nuxtApp.$contentRoutes?.all() ?? []) {
      if (!enabled.includes(contentRoute.module)) continue;
      const match = contentRoute.match(slug, { nuxtApp, site: site.value as never });
      if (match !== null && match !== undefined) return contentKind({ isHome: false, module: contentRoute.module });
    }
    return contentKind({ isHome: false, module: null });
  }

  const ownAddress = () => cleanUrl(`${requestUrl.origin}${route.path}`);

  function read(): SharePage {
    let title = "";
    let pageTitle = "";
    let canonical = "";
    try {
      for (const tag of resolveTags(head)) {
        const props = (tag.props ?? {}) as Record<string, string>;
        if (tag.tag === "meta" && props.property === "og:title" && props.content) title = props.content;
        else if (tag.tag === "title") pageTitle = tag.textContent ?? "";
        else if (tag.tag === "link" && props.rel === "canonical" && props.href) canonical = props.href;
      }
    } catch {
      /* the head could not be read: fall back to what the address and the site name tell us */
    }
    const siteName = site.value?.name ?? "";
    const suffix = ` | ${siteName}`;
    if (!title && pageTitle) title = siteName && pageTitle.endsWith(suffix) ? pageTitle.slice(0, -suffix.length) : pageTitle;
    return { url: cleanUrl(canonical) || ownAddress(), title: title || siteName, kind: kindOfAddress() };
  }

  // Registered before anything is awaited: after an await Nuxt no longer knows which component this is.
  if (import.meta.client) {
    let stop: (() => void) | undefined;
    onMounted(() => {
      page.value = read();
      stop = nuxtApp.hook("page:finish", () => void nextTick(() => (page.value = read())));
    });
    onBeforeUnmount(() => stop?.());
  }

  if (import.meta.server) {
    const titleToken = newPlaceholder();
    const linkToken = newPlaceholder();
    // A valid address that only this request uses, so it comes through cleaning and percent-encoding in a form that can be found again.
    const linkPlaceholder = `https://${linkToken}.invalid/`;
    page.value = { url: linkPlaceholder, title: titleToken, kind: kindOfAddress() };
    nuxtApp.hook("app:rendered", ({ renderResult }) => {
      const final = read();
      const title = cleanText(final.title);
      if (renderResult && typeof renderResult.html === "string") {
        renderResult.html = renderResult.html.replaceAll(encode(linkPlaceholder), encode(final.url)).replaceAll(titleToken, encode(title));
      }
      // The browser starts from this state, so the links it draws are the same ones the server sent.
      page.value = { ...final, title };
    });
  }

  return page;
}
