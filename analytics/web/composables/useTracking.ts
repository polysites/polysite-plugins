import type { AnalyticsSite } from "../types/analytics";
import type { Consent } from "../utils/tracking";
import { defaultNotice, needsAnswer, plan as planTools, privacySignalOn, validTools } from "../utils/tracking";
import { emitTracking, loadedToolKeys, loadTools } from "../utils/trackingClient";

const STORAGE_KEY = "polysite-tracking-consent";

function readConsent(): Consent {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      ...(typeof parsed.analytics === "boolean" ? { analytics: parsed.analytics } : {}),
      ...(typeof parsed.marketing === "boolean" ? { marketing: parsed.marketing } : {}),
    };
  } catch {
    return {};
  }
}

function writeConsent(consent: Consent) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  } catch {
    /* private mode or blocked storage: the choice just won't be remembered */
  }
}

// Shared between the consent notice and the "Cookie settings" link a theme places in its footer.
export function useTrackingUi() {
  return {
    reopen: useState("polysite-tracking-reopen", () => false),
    // True once there is something a visitor could change their mind about.
    available: useState("polysite-tracking-available", () => false),
  };
}

// Decides, in the visitor's browser only, which of the site's tracking tools load:
// Do Not Track / Global Privacy Control first, then the visitor's saved answers,
// asking only about groups they haven't answered. Server rendering never includes a tool.
export function useTracking(site: Ref<AnalyticsSite | null | undefined>) {
  const ui = useTrackingUi();
  const mounted = ref(false);
  const signalOn = ref(false);
  const consent = ref<Consent>({});

  const tools = computed(() => validTools(site.value?.extensions?.analytics?.tools));
  const respectSignals = computed(() => site.value?.extensions?.analytics?.respectPrivacySignals !== false);
  const result = computed(() =>
    mounted.value ? planTools(tools.value, { signalOn: signalOn.value, respectSignals: respectSignals.value, consent: consent.value }) : { load: [], ask: [], groups: [] },
  );

  const groupsShown = computed(() => (ui.reopen.value ? result.value.groups : result.value.ask));
  const asking = computed(() => groupsShown.value.length > 0);
  const notice = computed(() => site.value?.extensions?.analytics?.consentNotice?.trim() || defaultNotice(tools.value, groupsShown.value));

  watch(
    () => result.value.load,
    (list) => {
      loadTools(list);
    },
    { immediate: true },
  );
  watch(() => result.value.groups.length > 0, (value) => (ui.available.value = value), { immediate: true });

  function answer(choice: boolean) {
    const groups = groupsShown.value;
    const next = { ...consent.value, ...Object.fromEntries(groups.map((g) => [g, choice])) } as Consent;
    consent.value = next;
    writeConsent(next);
    ui.reopen.value = false;
    // Scripts already running can't be switched off from outside; a fresh load is the only clean way to stop them.
    if (!choice) {
      const running = new Set(loadedToolKeys());
      if (tools.value.some((t) => running.has(t.key) && needsAnswer(t) && groups.includes(t.category as "analytics" | "marketing"))) location.reload();
    }
  }

  onMounted(() => {
    consent.value = readConsent();
    signalOn.value = privacySignalOn(navigator as Navigator & { globalPrivacyControl?: boolean });
    mounted.value = true;
    // The page has already loaded; from here on every in-site navigation is a new page view for the tools that don't notice it themselves.
    useRouter().afterEach((to) => {
      setTimeout(() => emitTracking({ name: "page_view", path: to.fullPath, title: document.title }), 0);
    });
  });

  return { asking, notice, groups: groupsShown, accept: () => answer(true), decline: () => answer(false) };
}
