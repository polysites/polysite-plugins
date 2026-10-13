// Turns a site's "Tracking tools" setting (the plugin's `analytics-settings` row, public as `site.extensions.analytics`) into
// a validated list, and decides which tools may load for a given visitor. The CMS
// already checked these values; they are checked again here because this is the
// last step before anything is added to a visitor's browser. Kept in step with
// plugins/analytics/src/providers.js by hand; the plugin's tests cover that side.

export type Category = "essential" | "analytics" | "marketing";
export type ToolId = "ga4" | "gtm" | "meta" | "tiktok" | "linkedin" | "x" | "plausible" | "umami" | "custom";

export interface RawTool {
  tool?: string | null;
  enabled?: boolean | null;
  toolId?: string | null;
  scriptHost?: string | null;
  askFirst?: boolean | null;
  conversionId?: string | null;
  category?: string | null;
  name?: string | null;
  placement?: string | null;
  code?: string | null;
}

export interface ValidTool {
  key: string;
  tool: ToolId;
  label: string;
  category: Category;
  cookies: boolean | null;
  id: string;
  host: string;
  conversionId: string;
  askFirst: boolean;
  placement: "head" | "body";
  code: string;
}

interface Def {
  label: string;
  category: Category;
  cookies: boolean | null;
  idPattern?: RegExp;
  conversionPattern?: RegExp;
  defaultHost?: string;
  choosable?: boolean;
}

const DEFS: Record<ToolId, Def> = {
  ga4: { label: "Google Analytics 4", category: "analytics", cookies: true, idPattern: /^G-[A-Z0-9]{4,14}$/ },
  gtm: { label: "Google Tag Manager", category: "marketing", cookies: true, idPattern: /^GTM-[A-Z0-9]{4,12}$/, choosable: true },
  meta: { label: "Meta (Facebook) Pixel", category: "marketing", cookies: true, idPattern: /^\d{10,20}$/ },
  tiktok: { label: "TikTok Pixel", category: "marketing", cookies: true, idPattern: /^[A-Z0-9]{10,30}$/i },
  linkedin: { label: "LinkedIn Insight Tag", category: "marketing", cookies: true, idPattern: /^\d{4,12}$/, conversionPattern: /^\d{3,12}$/ },
  x: { label: "X (Twitter) Pixel", category: "marketing", cookies: true, idPattern: /^[a-z0-9]{4,12}$/i, conversionPattern: /^tw-[a-z0-9]+-[a-z0-9]+$/i },
  plausible: {
    label: "Plausible",
    category: "analytics",
    cookies: false,
    idPattern: /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
    defaultHost: "https://plausible.io",
  },
  umami: {
    label: "Umami",
    category: "analytics",
    cookies: false,
    idPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    defaultHost: "https://cloud.umami.is",
  },
  custom: { label: "Custom script", category: "marketing", cookies: null, choosable: true },
};

const CATEGORIES: Category[] = ["essential", "analytics", "marketing"];
const MAX_CODE = 20000;

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const clean = url.origin === value.trim().replace(/\/$/, "");
    return url.protocol === "https:" && clean && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function validOne(raw: RawTool, index: number): ValidTool | null {
  if (!raw || raw.enabled === false) return null;
  const tool = raw.tool as ToolId;
  const def = DEFS[tool];
  if (!def) return null;

  const id = (raw.toolId ?? "").trim();
  if (def.idPattern && !def.idPattern.test(id)) return null;

  let host = "";
  if (def.defaultHost) {
    host = raw.scriptHost ? (httpsOrigin(raw.scriptHost) ?? "") : def.defaultHost;
    if (!host) return null;
  }

  const conversionId = (raw.conversionId ?? "").trim();
  const conversionOk = def.conversionPattern && conversionId ? def.conversionPattern.test(conversionId) : false;

  const category = def.choosable && CATEGORIES.includes(raw.category as Category) ? (raw.category as Category) : def.category;

  let code = "";
  if (tool === "custom") {
    code = (raw.code ?? "").trim();
    if (!code || code.length > MAX_CODE) return null;
  }

  return {
    key: `${tool}-${index}`,
    tool,
    label: tool === "custom" ? (raw.name ?? "").trim() || def.label : def.label,
    category,
    cookies: def.cookies,
    id,
    host,
    conversionId: conversionOk ? conversionId : "",
    askFirst: raw.askFirst === true,
    placement: raw.placement === "body" ? "body" : "head",
    code,
  };
}

// Anything unset, unknown, switched off or malformed is dropped: it simply doesn't load.
export function validTools(raw: unknown): ValidTool[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => validOne(r as RawTool, i)).filter((t): t is ValidTool => t !== null);
}

// Needs the visitor's yes before loading. Essential tools never do. A cookieless
// analytics tool doesn't either, unless the site chose to ask first.
export function needsAnswer(t: ValidTool): boolean {
  if (t.category === "essential") return false;
  if (t.category === "analytics" && t.cookies === false) return t.askFirst;
  return true;
}

export interface Consent {
  analytics?: boolean;
  marketing?: boolean;
}

export interface Plan {
  load: ValidTool[];
  // The groups the visitor hasn't answered yet.
  ask: Array<"analytics" | "marketing">;
  // Every group with a tool that needs an answer (for reopening the notice).
  groups: Array<"analytics" | "marketing">;
}

// A visitor whose browser says "don't track me" (Do Not Track, or Global Privacy Control).
export function privacySignalOn(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean } | undefined): boolean {
  return nav?.doNotTrack === "1" || nav?.globalPrivacyControl === true;
}

// Which tools load for this visitor, and which groups still need asking about.
export function plan(tools: ValidTool[], opts: { signalOn: boolean; respectSignals: boolean; consent: Consent }): Plan {
  const blocked = opts.respectSignals && opts.signalOn;
  const load: ValidTool[] = [];
  const ask = new Set<"analytics" | "marketing">();
  const groups = new Set<"analytics" | "marketing">();

  for (const t of tools) {
    if (t.category === "essential") {
      load.push(t);
      continue;
    }
    if (blocked) continue;
    const group = t.category;
    if (!needsAnswer(t)) {
      load.push(t);
      continue;
    }
    groups.add(group);
    const answer = opts.consent[group];
    if (answer === true) load.push(t);
    else if (answer === undefined) ask.add(group);
  }
  return { load, ask: [...ask], groups: [...groups] };
}

// What the notice says when the site hasn't written its own.
export function defaultNotice(tools: ValidTool[], groups: Array<"analytics" | "marketing">): string {
  const names = tools.filter(needsAnswer).filter((t) => groups.includes(t.category as "analytics" | "marketing")).map((t) => t.label);
  const what = groups.length === 2 ? "analytics and marketing tools" : groups[0] === "marketing" ? "marketing tools" : "analytics tools";
  return `This site would like to use ${what}${names.length ? ` (${[...new Set(names)].join(", ")})` : ""}. They may set cookies or share your visit with other companies.`;
}
