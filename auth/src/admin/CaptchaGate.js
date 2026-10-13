"use client";
import { Fragment, createElement as h, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { problem } from "./shared.js";

// The Cloudflare Turnstile check on the sign-in and forgot-password pages. It is a provider (it wraps every admin page and
// renders its children untouched) because the forgot-password page has no slot of its own; on those two pages it puts a small
// widget just above the submit button, and sends the token the widget hands out with the sign-in and reset requests, in the
// header `x-polysite-captcha` (the server checks it: src/captcha.js). Everywhere else it does nothing.
//
// Turnstile's "managed" mode usually needs no click. A token works once, so the widget starts over after every request, whatever
// the answer. Single sign-on is not touched: its buttons are links that leave the page, and the provider does the checking.
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const HEADER = "x-polysite-captcha";
const WAIT_MS = 10000;
const BLOCKED =
  "The security check did not load, so signing in will be refused. Make sure this browser can reach challenges.cloudflare.com (an ad blocker or a firewall may be blocking it). Site operators: set AUTH_CAPTCHA_OFF=1 on the server and restart the CMS to switch the check off.";

// Shared by every copy of this module (a hot reload evaluates it again), so the page is only ever wrapped once.
const S = typeof window === "undefined" ? null : (window.__polysiteCaptcha = window.__polysiteCaptcha || { token: "", status: "idle", kind: null, widgetId: null, waiters: [], scriptPromise: null, configPromise: null, patched: false });

const pageKind = () => {
  const path = window.location.pathname;
  if (/\/login\/?$/.test(path)) return "signIn";
  if (/\/forgot\/?$/.test(path)) return "reset";
  return null;
};
const currentTheme = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

function settle(token) {
  S.token = token;
  if (token) S.status = "ready";
  const waiting = S.waiters.splice(0);
  for (const done of waiting) done(token);
}

// A request that leaves while the widget is still checking waits for it (up to a few seconds) instead of going out empty.
function takeToken() {
  if (S.token) return Promise.resolve(S.token);
  if (S.status !== "verifying") return Promise.resolve("");
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(""), WAIT_MS);
    const finish = (token) => {
      clearTimeout(timer);
      resolve(token);
    };
    S.waiters.push(finish);
  });
}

// Tokens are single use: after any request, the widget goes back to checking.
function startOver() {
  S.token = "";
  if (S.widgetId === null) return;
  S.status = "verifying";
  try {
    window.turnstile.reset(S.widgetId);
  } catch {
    S.status = "failed";
  }
}

const requestKind = (input) => {
  try {
    const path = new URL(typeof input === "string" ? input : (input?.url ?? String(input)), window.location.href).pathname;
    if (/\/users\/login\/?$/.test(path)) return "signIn";
    if (/\/users\/forgot-password\/?$/.test(path)) return "reset";
  } catch {
    // not a URL: not ours
  }
  return null;
};

const messageOf = async (res) => {
  try {
    const data = await res.clone().json();
    return String(data?.errors?.[0]?.message ?? data?.message ?? "Something went wrong. Try again.");
  } catch {
    return "Something went wrong. Try again.";
  }
};

// Wraps fetch once for the life of the page, as soon as this file is loaded (see the last line: it must be underneath the sign-in
// code box's own wrapper, which puts fetch back as it found it when it closes, so wrapping later would be undone by it). While the
// widget is on this page, the two requests carry the token. Payload's
// forgot-password form treats ANY JSON answer as "email sent", even a refusal; throwing here makes it show the real message instead.
function patchFetch() {
  if (S.patched) return;
  S.patched = true;
  const original = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const kind = requestKind(input);
    if (!kind || S.kind !== kind) return original(input, init);
    const token = await takeToken();
    const headers = new Headers(init?.headers ?? (typeof input === "object" ? input?.headers : undefined));
    if (token) headers.set(HEADER, token);
    let res;
    try {
      res = await original(input, { ...init, headers });
    } finally {
      startOver();
    }
    if (kind === "reset" && !res.ok) throw new Error(await messageOf(res));
    return res;
  };
}

function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!S.scriptPromise) {
    S.scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = SCRIPT;
      el.async = true;
      el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
      el.onerror = () => {
        S.scriptPromise = null;
        el.remove();
        reject(new Error("blocked"));
      };
      document.head.appendChild(el);
    });
  }
  return S.scriptPromise;
}

function loadConfig() {
  if (!S.configPromise) {
    S.configPromise = fetch("/api/auth-captcha/config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .catch(() => {
        S.configPromise = null;
        return { enabled: false };
      });
  }
  return S.configPromise;
}

export function CaptchaGate({ children }) {
  const [config, setConfig] = useState(null);
  const [kind, setKind] = useState(null);
  const [slot, setSlot] = useState(null);
  const [theme, setTheme] = useState("light");
  const [message, setMessage] = useState("");
  const holder = useRef(null);
  const box = useRef(null);

  // Notices the sign-in and forgot-password pages (a client-side move between them does not reload anything) and keeps a place
  // for the widget just above the submit button. Payload draws the form; if it can't be found, nothing is drawn.
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      const next = pageKind();
      setKind(next);
      setTheme(currentTheme());
      // The widget goes above the button that sends the form: Login, Submit, or (once a reset email was sent) Resend, which sends the same
      // form again and needs a fresh check of its own.
      const submit = next ? document.querySelector("form .form-submit, form .forgot-password__form__actions") : null;
      const anchor = submit?.classList.contains("form-submit") ? "submit" : "resend";
      let el = holder.current;
      if (el && (!submit || !el.isConnected || el.parentElement !== submit.parentElement || el.dataset.anchor !== anchor)) {
        el.remove();
        holder.current = null;
        setSlot(null);
        el = null;
      }
      if (!el && submit?.parentElement) {
        el = document.createElement("div");
        el.dataset.anchor = anchor;
        submit.parentElement.insertBefore(el, submit);
        holder.current = el;
        setSlot(el);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.setTimeout(sync, 30);
    };
    const observer = new MutationObserver(() => {
      if (pageKind() || holder.current) schedule();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("popstate", schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", schedule);
      if (frame) window.clearTimeout(frame);
      holder.current?.remove();
      holder.current = null;
    };
  }, []);

  useEffect(() => {
    if (!kind || config) return undefined;
    let live = true;
    loadConfig().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, [kind, config]);

  const active = Boolean(slot && kind && config?.enabled && config[kind] && config.siteKey);
  // A page with the check on but no site key cannot show a widget; the server then refuses, so say so.
  const unusable = Boolean(slot && kind && config?.enabled && config[kind] && !config.siteKey);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let id = null;
    S.kind = kind;
    S.status = "verifying";
    S.token = "";
    setMessage("");
    loadScript()
      .then((turnstile) => {
        if (cancelled || !box.current) return;
        id = turnstile.render(box.current, {
          sitekey: config.siteKey,
          theme,
          size: "flexible",
          callback: (token) => {
            setMessage("");
            settle(token);
          },
          "expired-callback": () => {
            S.token = "";
            S.status = "verifying";
          },
          "timeout-callback": () => {
            S.token = "";
            S.status = "verifying";
          },
          "error-callback": (code) => {
            S.status = "failed";
            settle("");
            setMessage(`The security check could not run${code ? ` (error ${code})` : ""}, so signing in will be refused. Try again in a moment; if it keeps happening, the site's Turnstile settings need attention. Site operators: set AUTH_CAPTCHA_OFF=1 on the server and restart the CMS to switch the check off.`);
            return true;
          },
        });
        S.widgetId = id;
      })
      .catch(() => {
        if (cancelled) return;
        S.status = "failed";
        settle("");
        setMessage(BLOCKED);
      });
    return () => {
      cancelled = true;
      if (id !== null) {
        try {
          window.turnstile.remove(id);
        } catch {
          // already gone
        }
      }
      S.widgetId = null;
      if (S.kind === kind) S.kind = null;
      settle("");
    };
  }, [active, slot, kind, config, theme]);

  return h(
    Fragment,
    null,
    children,
    (active || unusable) && slot
      ? createPortal(
          h(
            "div",
            { style: { margin: "16px 0 12px" } },
            active && h("div", { ref: box, style: { minHeight: "65px" } }),
            unusable && h("p", { style: { ...problem, fontSize: "13px" }, role: "alert" }, "The security check is switched on but has no site key, so signing in will be refused. Site operators: set AUTH_CAPTCHA_OFF=1 on the server and restart the CMS to switch it off."),
            message && h("p", { style: { ...problem, fontSize: "13px", margin: "6px 0 0" }, role: "alert" }, message),
          ),
          slot,
        )
      : null,
  );
}

// Before any component runs, so every later wrapper (the two-factor code box) sits on top of this one and puts back exactly this.
if (S) patchFetch();
