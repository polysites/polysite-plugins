/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions, prefer-rest-params, prefer-spread -- the vendors' own snippets are reproduced as published */
// Browser-only: adds a tracking tool to the page and translates Polysite's own
// events (a page view, a form submission) into each tool's own calls. Nothing here
// runs during server rendering, and nothing runs until utils/tracking.ts's plan()
// has said the tool may load for this visitor.
//
// Events carry a name and a form id only, never what a visitor typed.
import type { ValidTool } from "./tracking";

export type TrackEvent = { name: "page_view"; path: string; title: string } | { name: "form_submit"; formId: string | number };

interface Adapter {
  pageView?: (e: Extract<TrackEvent, { name: "page_view" }>) => void;
  formSubmit?: (e: Extract<TrackEvent, { name: "form_submit" }>) => void;
}

const adapters = new Map<string, Adapter>();

// Called by the site's own code (the form block) and the router hook; a no-op when
// nothing has loaded, so callers never need to know whether tracking is on.
export function emitTracking(event: TrackEvent) {
  for (const adapter of adapters.values()) {
    try {
      if (event.name === "page_view") adapter.pageView?.(event);
      else adapter.formSubmit?.(event);
    } catch {
      /* one tool failing must never affect another, or the page */
    }
  }
}

const w = () => window as any;

function addScript(src: string, key: string, attrs: Record<string, string> = {}) {
  const el = document.createElement("script");
  el.src = src;
  el.setAttribute("data-polysite-tool", key);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  (document.head || document.documentElement).appendChild(el);
}

// Pasted code: a <script> tag, several tags, or plain JavaScript. Scripts are
// recreated, because tags inserted through innerHTML never run.
function addCustom(tool: ValidTool) {
  const target = tool.placement === "body" ? document.body : document.head;
  const code = tool.code.trim();
  if (!code.startsWith("<")) {
    const el = document.createElement("script");
    el.setAttribute("data-polysite-tool", tool.key);
    el.textContent = code;
    target.appendChild(el);
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = code;
  for (const node of Array.from(template.content.childNodes)) {
    if (node instanceof HTMLScriptElement) {
      const el = document.createElement("script");
      for (const attr of Array.from(node.attributes)) el.setAttribute(attr.name, attr.value);
      el.setAttribute("data-polysite-tool", tool.key);
      el.textContent = node.textContent;
      // Scripts added this way are async by default; keep a pasted sequence in order unless it asked for async.
      el.async = node.hasAttribute("async");
      target.appendChild(el);
    } else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "NOSCRIPT") {
      continue; // fallback markup for browsers without JavaScript, which this one has
    } else {
      target.appendChild(document.importNode(node, true));
    }
  }
}

function load(tool: ValidTool): Adapter | null {
  const win = w();
  switch (tool.tool) {
    case "ga4": {
      win.dataLayer = win.dataLayer || [];
      win.gtag = function () {
        win.dataLayer.push(arguments);
      };
      win.gtag("js", new Date());
      win.gtag("config", tool.id, { anonymize_ip: true });
      addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tool.id)}`, tool.key, { async: "" });
      // Page changes inside the site are picked up by Google's own history tracking.
      return { formSubmit: (e) => win.gtag("event", "generate_lead", { form_id: String(e.formId) }) };
    }
    case "gtm": {
      win.dataLayer = win.dataLayer || [];
      win.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
      addScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(tool.id)}`, tool.key, { async: "" });
      return {
        pageView: (e) => win.dataLayer.push({ event: "polysite_page_view", page_path: e.path, page_title: e.title }),
        formSubmit: (e) => win.dataLayer.push({ event: "polysite_form_submit", form_id: String(e.formId) }),
      };
    }
    case "meta": {
      if (!win.fbq) {
        const fbq: any = (win.fbq = function () {
          fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
        });
        if (!win._fbq) win._fbq = fbq;
        fbq.push = fbq;
        fbq.loaded = true;
        fbq.version = "2.0";
        fbq.queue = [];
        addScript("https://connect.facebook.net/en_US/fbevents.js", tool.key, { async: "" });
      }
      win.fbq("init", tool.id);
      win.fbq("track", "PageView");
      return {
        pageView: () => win.fbq("track", "PageView"),
        formSubmit: () => win.fbq("track", "Lead"),
      };
    }
    case "tiktok": {
      win.TiktokAnalyticsObject = "ttq";
      const ttq: any = (win.ttq = win.ttq || []);
      ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
      ttq.setAndDefer = function (target: any, method: string) {
        target[method] = function () {
          target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (const method of ttq.methods) ttq.setAndDefer(ttq, method);
      ttq.instance = function (id: string) {
        const inst = ttq._i[id] || [];
        for (const method of ttq.methods) ttq.setAndDefer(inst, method);
        return inst;
      };
      ttq._i = ttq._i || {};
      ttq._i[tool.id] = [];
      ttq._i[tool.id]._u = "https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._t = ttq._t || {};
      ttq._t[tool.id] = Date.now();
      ttq._o = ttq._o || {};
      ttq._o[tool.id] = {};
      addScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(tool.id)}&lib=ttq`, tool.key, { async: "" });
      ttq.page();
      return {
        pageView: () => win.ttq.page(),
        formSubmit: () => win.ttq.track("SubmitForm"),
      };
    }
    case "linkedin": {
      win._linkedin_partner_id = tool.id;
      win._linkedin_data_partner_ids = win._linkedin_data_partner_ids || [];
      win._linkedin_data_partner_ids.push(tool.id);
      if (!win.lintrk) {
        win.lintrk = function (a: unknown, b: unknown) {
          win.lintrk.q.push([a, b]);
        };
        win.lintrk.q = [];
      }
      addScript("https://snap.licdn.com/li.lms-analytics/insight.min.js", tool.key, { async: "" });
      return {
        pageView: () => win.lintrk("track"),
        formSubmit: tool.conversionId ? () => win.lintrk("track", { conversion_id: Number(tool.conversionId) }) : undefined,
      };
    }
    case "x": {
      if (!win.twq) {
        const twq: any = (win.twq = function () {
          twq.exe ? twq.exe.apply(twq, arguments) : twq.queue.push(arguments);
        });
        twq.version = "1.1";
        twq.queue = [];
        addScript("https://static.ads-twitter.com/uwt.js", tool.key, { async: "" });
      }
      win.twq("config", tool.id);
      return {
        pageView: () => win.twq("track", "PageView"),
        formSubmit: tool.conversionId ? () => win.twq("event", tool.conversionId, {}) : undefined,
      };
    }
    case "plausible": {
      win.plausible =
        win.plausible ||
        function () {
          (win.plausible.q = win.plausible.q || []).push(arguments);
        };
      addScript(`${tool.host}/js/script.js`, tool.key, { defer: "", "data-domain": tool.id });
      // The script follows in-site navigation by itself.
      return { formSubmit: (e) => win.plausible("form_submit", { props: { form: String(e.formId) } }) };
    }
    case "umami": {
      addScript(`${tool.host}/script.js`, tool.key, { defer: "", "data-website-id": tool.id });
      return { formSubmit: (e) => win.umami?.track("form_submit", { form: String(e.formId) }) };
    }
    case "custom":
      addCustom(tool);
      return {};
  }
}

// Adds each tool once per page load. Returns the keys it added.
export function loadTools(tools: ValidTool[]): string[] {
  const added: string[] = [];
  for (const tool of tools) {
    if (adapters.has(tool.key)) continue;
    try {
      const adapter = load(tool);
      if (adapter) {
        adapters.set(tool.key, adapter);
        added.push(tool.key);
      }
    } catch {
      /* a tool that fails to start is skipped, never the page */
    }
  }
  return added;
}

export const loadedToolKeys = () => [...adapters.keys()];
