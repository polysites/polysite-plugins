"use client";
import { createElement as h, useEffect, useState } from "react";

// The Analytics screen. Polysite doesn't measure visitors itself, so this shows
// the two things it does know: how many people have sent each form, and which
// tracking tools each site has switched on (with a link to each tool's own
// dashboard, where visits and sources are). Plain React.createElement, like the
// plugin's other components.
const BORDER = "1px solid var(--theme-elevation-150)";
const cell = { padding: "0.5rem 0.75rem", textAlign: "right" };
const left = { padding: "0.5rem 0.75rem", textAlign: "left" };
const muted = { opacity: 0.65 };

function Badge(text) {
  return h("span", { key: text, style: { fontSize: "0.75rem", padding: "0.1rem 0.5rem", border: BORDER, borderRadius: "999px", marginRight: "0.4rem", whiteSpace: "nowrap" } }, text);
}

function cookiesText(tool) {
  if (tool.cookies === null) return "Cookies: depends on the code";
  return tool.cookies ? "Sets cookies" : "No cookies";
}

function FormTable({ data }) {
  if (data.rows.length === 0) return h("p", { style: muted }, "No forms yet, or none your role can see.");
  return h(
    "table",
    { style: { borderCollapse: "collapse", width: "100%", maxWidth: "52rem" } },
    h(
      "thead",
      null,
      h(
        "tr",
        { style: { borderBottom: BORDER } },
        h("th", { style: left }, "Form"),
        h("th", { style: cell }, "Last 7 days"),
        h("th", { style: cell }, "Last 30 days"),
        h("th", { style: cell }, "Held in total"),
      ),
    ),
    h(
      "tbody",
      null,
      ...data.rows.map((row) =>
        h(
          "tr",
          { key: row.id, style: { borderBottom: BORDER } },
          h(
            "td",
            { style: left },
            h("a", { href: `/admin/collections/forms/${row.id}` }, row.title),
            row.site ? h("span", { style: muted }, ` · ${row.site}`) : null,
          ),
          h("td", { style: cell }, row.last7),
          h("td", { style: cell }, row.last30),
          h("td", { style: cell }, h("a", { href: `/admin/collections/form-submissions?where[form][equals]=${encodeURIComponent(row.id)}` }, row.total)),
        ),
      ),
    ),
  );
}

function SiteTools({ site }) {
  return h(
    "div",
    { key: site.id, style: { marginBottom: "1.5rem" } },
    h(
      "div",
      { style: { display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.4rem" } },
      h("strong", null, site.name),
      h("span", { style: muted }, site.domain),
      h("a", { href: `/admin/collections/analytics-settings${site.settingsId == null ? "" : `/${site.settingsId}`}`, style: { marginLeft: "auto", fontSize: "0.85rem" } }, "Manage tools"),
    ),
    site.tools.length === 0
      ? h("p", { style: { ...muted, margin: 0 } }, "No tracking tools. Add them under Administration -> Tracking tools.")
      : h(
          "ul",
          { style: { listStyle: "none", margin: 0, padding: 0, border: BORDER, borderRadius: "4px" } },
          ...site.tools.map((tool, i) =>
            h(
              "li",
              { key: `${tool.tool}-${i}`, style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem 0.75rem", padding: "0.6rem 0.75rem", borderTop: i ? BORDER : "none", opacity: tool.enabled ? 1 : 0.5 } },
              h("span", { style: { minWidth: "11rem", fontWeight: 600 } }, tool.label, tool.enabled ? "" : " (off)"),
              [Badge(tool.categoryLabel), Badge(cookiesText(tool)), Badge(tool.asksFirst ? "Asks visitors first" : "Loads without asking")],
              tool.dashboard ? h("a", { href: tool.dashboard, target: "_blank", rel: "noopener noreferrer", style: { marginLeft: "auto", fontSize: "0.85rem" } }, "Open dashboard") : null,
            ),
          ),
        ),
    !site.respectPrivacySignals && site.tools.length > 0
      ? h("p", { style: { fontSize: "0.8rem", margin: "0.4rem 0 0" } }, "This site ignores Do Not Track and Global Privacy Control.")
      : null,
  );
}

export function AnalyticsOverview() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/analytics/overview", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("bad reply"))))
      .then((body) => live && setData(body))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return h(
    "div",
    { style: { padding: "calc(var(--base) * 1.5)", maxWidth: "60rem" } },
    h("h1", { style: { marginTop: 0 } }, "Analytics"),
    h(
      "p",
      { style: { maxWidth: "46rem" } },
      "Polysite doesn't measure visitors itself. Page views, visitors and where they came from are in the tools each site has switched on, below. Form submissions are counted here because Polysite holds them.",
    ),
    failed ? h("p", { role: "alert" }, "Couldn't load this screen. Reload to try again.") : null,
    !data && !failed ? h("p", { style: muted }, "Loading…") : null,
    data
      ? h(
          "div",
          null,
          h("h2", null, "Form submissions"),
          h("p", { style: { ...muted, fontSize: "0.85rem" } }, "What Polysite is holding. A form set to delete submissions after some days counts only what hasn't expired."),
          h(FormTable, { data }),
          data.truncated ? h("p", { style: muted }, "Showing the first 100 forms.") : null,
          h("h2", { style: { marginTop: "2.5rem" } }, "Tracking tools"),
          data.sites.length === 0 ? h("p", { style: muted }, "No sites your role can see.") : data.sites.map((site) => h(SiteTools, { key: site.id, site })),
        )
      : null,
  );
}
