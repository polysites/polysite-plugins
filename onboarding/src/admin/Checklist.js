"use client";
import { createElement as h, useCallback, useEffect, useState } from "react";

import { evaluate, siteIdFromCookie } from "../checklist.js";

// The dashboard card (plain React.createElement, no JSX: plugin files are bundled as they are). It reads with the signed-in person's
// own session, so it can only show what they may see, and it stays hidden until it knows which site they are working on.
const box = { border: "1px solid var(--theme-elevation-150)", background: "var(--theme-elevation-50)", borderRadius: 4, padding: "14px 16px", marginBottom: 16 };
const row = { display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0" };
const link = { color: "var(--theme-text)", textDecoration: "underline" };
const quiet = { background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--theme-elevation-600)", textDecoration: "underline", font: "inherit", fontSize: 13 };
const small = { fontSize: 13, color: "var(--theme-elevation-600)", margin: "2px 0 0" };
const hidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

const getJson = (url) => fetch(url, { credentials: "include" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
// A count the person is not allowed to read is "unknown", and the step then simply stays unticked.
const count = (path, where) => getJson(`/api/${path}?limit=1&depth=0&${where}`).then((r) => r.totalDocs).catch(() => undefined);

async function load(siteId) {
  const me = await getJson("/api/users/me?depth=1");
  const person = me.user;
  if (!person) return undefined;
  // Only a Super Admin gets the role filled in; anyone else may read their own role by its id (and no other).
  if (person.role != null && typeof person.role !== "object") {
    person.role = await getJson(`/api/roles/${person.role}?depth=0`).catch(() => undefined);
  }
  const site = await getJson(`/api/sites/${siteId}?depth=0`).catch(() => undefined);
  if (!site) return undefined;
  const [ownPages, forms, media, editors, progress] = await Promise.all([
    count("pages", `where[and][0][site][equals]=${siteId}&where[and][1][slug][not_equals]=/`),
    count("forms", `where[site][equals]=${siteId}`),
    count("media", `where[site][equals]=${siteId}`),
    person.isSuperAdmin ? count("users", `where[and][0][assignedSites.site][equals]=${siteId}&where[and][1][isSuperAdmin][not_equals]=true`) : Promise.resolve(undefined),
    getJson(`/api/onboarding-progress?limit=1&depth=0&where[site][equals]=${siteId}`).then((r) => r.docs[0]).catch(() => undefined),
  ]);
  return { person, facts: { siteId, site, ownPages, forms, media, editors }, progress };
}

export function Checklist() {
  const [state, setState] = useState({ status: "loading" });

  const refresh = useCallback(() => {
    const show = (siteId) => load(siteId).then((data) => setState(data ? { status: "ready", siteId, ...data } : { status: "none" }), () => setState({ status: "none" }));
    const chosen = siteIdFromCookie(document.cookie);
    if (chosen) {
      show(chosen);
      return;
    }
    // No site picked in the switcher: a person who has only one site is working on it; anyone else is asked to pick.
    getJson("/api/sites?limit=2&depth=0&select[id]=true").then(
      (r) => (r.totalDocs === 1 ? show(String(r.docs[0].id)) : setState({ status: r.totalDocs > 1 ? "choose" : "none" })),
      () => setState({ status: "none" }),
    );
  }, []);

  // A block, so the effect returns nothing (a returned promise would be taken for a cleanup function and crash on unmount).
  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = (patch) => {
    const { progress, siteId } = state;
    const json = { "Content-Type": "application/json" };
    const request = progress
      ? fetch(`/api/onboarding-progress/${progress.id}?depth=0`, { method: "PATCH", credentials: "include", headers: json, body: JSON.stringify(patch) })
      : fetch("/api/onboarding-progress?depth=0", { method: "POST", credentials: "include", headers: json, body: JSON.stringify({ site: Number(siteId), ...patch }) });
    return request.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(({ doc }) => setState((s) => ({ ...s, progress: doc })));
  };

  if (state.status === "choose") {
    return h("p", { id: "polysite-onboarding", style: { margin: "0 0 16px", fontSize: 13, color: "var(--theme-elevation-600)" } }, "Choose a site in the sidebar to see its setup checklist.");
  }
  if (state.status !== "ready") return null;
  const dismissed = state.progress?.dismissed === true;
  const byHand = state.progress?.doneByHand ?? [];
  const { items, done, total, complete } = evaluate({ person: state.person, facts: state.facts, byHand });
  if (total === 0) return null;

  if (dismissed) {
    return h("p", { id: "polysite-onboarding", style: { margin: "0 0 16px" } }, h("button", { type: "button", style: quiet, onClick: () => save({ dismissed: false }) }, "Show the setup checklist"));
  }

  const toggle = (id) => save({ doneByHand: byHand.includes(id) ? byHand.filter((x) => x !== id) : [...byHand, id] });
  const external = { target: "_blank", rel: "noopener noreferrer" };

  return h(
    "section",
    { id: "polysite-onboarding", "aria-labelledby": "polysite-onboarding-title", style: box },
    h("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" } },
      h("strong", { id: "polysite-onboarding-title" }, complete ? "Your site is ready" : "Get your site ready"),
      h("span", { style: small }, `${done} of ${total} done`),
    ),
    h("div", { role: "progressbar", "aria-label": "Setup progress", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": done, style: { height: 6, background: "var(--theme-elevation-150)", borderRadius: 3, margin: "8px 0 6px", overflow: "hidden" } },
      h("div", { style: { width: `${Math.round((done / total) * 100)}%`, height: "100%", background: "var(--theme-success-500, #2f9e44)" } }),
    ),
    h("ul", { style: { listStyle: "none", margin: 0, padding: 0 } },
      items.map((item) =>
        h("li", { key: item.id, "data-step": item.id, "data-done": item.done ? "true" : "false", style: row },
          h("span", { "aria-hidden": "true", style: { width: 18, textAlign: "center", color: item.done ? "var(--theme-success-500, #2f9e44)" : "var(--theme-elevation-400)" } }, item.done ? "✓" : "○"),
          h("div", { style: { flex: 1 } },
            h("div", null,
              item.href ? h("a", { href: item.href, style: link }, item.label) : item.docs ? h("a", { href: item.docs, style: link, ...external }, item.label) : item.label,
              h("span", { style: hidden }, item.done ? " (done)" : " (to do)"),
            ),
            h("p", { style: small }, item.hint, item.docs && item.href ? [" ", h("a", { key: "docs", href: item.docs, style: link, ...external }, "How")] : null),
          ),
          item.manual ? h("button", { type: "button", style: quiet, "aria-pressed": item.done, onClick: () => toggle(item.id) }, item.done ? "Undo" : "Mark done") : null,
        ),
      ),
    ),
    h("p", { style: { margin: "8px 0 0" } }, h("button", { type: "button", style: quiet, onClick: () => save({ dismissed: true }) }, complete ? "Close the checklist" : "Dismiss the checklist")),
  );
}
