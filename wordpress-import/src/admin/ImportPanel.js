"use client";
import { useConfig, useDocumentInfo, useFormModified } from "@payloadcms/ui";
import { createElement as h, useCallback, useEffect, useRef, useState } from "react";

// The working screen of an import: upload the export file, run the dry run, read what would happen, import, watch the
// progress, read the result. It talks to the collection's own endpoints (src/collections.js) and polls while a job runs.

const BUSY = ["queued", "analysing", "running"];
const box = { border: "1px solid var(--theme-elevation-150)", borderRadius: "var(--style-radius-m, 4px)", padding: "calc(var(--base) * 0.75)", marginBottom: "var(--base)", background: "var(--theme-elevation-50)" };
const small = { fontSize: "0.85em", opacity: 0.75 };
const th = { textAlign: "left", padding: "2px 12px 2px 0", fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "2px 12px 2px 0", verticalAlign: "top" };

const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Section({ title, children }) {
  return h("div", { style: { marginBottom: "calc(var(--base) * 0.75)" } }, h("div", { style: { fontWeight: 600, marginBottom: 4 } }, title), children);
}

function Table({ rows }) {
  return h("table", { style: { borderCollapse: "collapse" } }, h("tbody", null, rows.map(([k, v], i) => h("tr", { key: i }, h("td", { style: th }, k), h("td", { style: td }, String(v))))));
}

function List({ items, empty }) {
  if (!items.length) return empty ? h("div", { style: small }, empty) : null;
  return h("ul", { style: { margin: "0 0 0 1.2em", padding: 0 } }, items.map((t, i) => h("li", { key: i }, t)));
}

const SKIP_WORDS = {
  password: "protected by a password (never imported)",
  "status-draft": "drafts, pending or scheduled",
  "status-private": "private",
  "status-trash": "in the trash",
  "status-other": "with another status",
  conflict: "whose address is already taken",
  "no-posts-plugin": "posts (the posts plugin is not installed)",
  "type-off": "of a kind switched off above",
};

function DryRun({ a }) {
  const skipped = Object.entries(a.skipped ?? {}).filter(([code]) => code !== "type-off");
  return h(
    "div",
    { style: box },
    h("div", { style: { fontWeight: 700, marginBottom: 8 } }, `Dry run: ${a.source?.title || "WordPress export"}`),
    h("div", { style: small }, `From ${a.source?.url || a.source?.host || "an unknown address"}. Nothing has been changed.`),
    h(
      Section,
      { title: "In the file" },
      h(Table, { rows: [["Pages", a.totals.pages], ["Posts", a.totals.posts], ["Categories", a.totals.categories], ["Tags", a.totals.tags], ["Media items", a.totals.media], ["Menus", `${a.totals.menus} (${a.totals.menuItems} items)`]] }),
    ),
    h(
      Section,
      { title: "An import with these settings will" },
      h(Table, { rows: [["Add or update pages", a.willImport.pages], ["Add or update posts", a.willImport.posts], ["Categories and tags", a.willImport.categories + a.willImport.tags], ["Redirects from old addresses", a.willImport.redirects], ["Images to download", `${a.media.fetchable} of ${a.media.referenced} referenced`], ["Menu", a.chosenMenu ? a.chosenMenu.name : "none"]] }),
    ),
    skipped.length ? h(Section, { title: "Left out" }, h(List, { items: skipped.map(([code, n]) => `${n} ${SKIP_WORDS[code] ?? code}`) })) : null,
    Object.keys(a.media.blockedHosts ?? {}).length
      ? h(Section, { title: "Images on other hosts (not downloaded unless allowed in the settings)" }, h(List, { items: Object.entries(a.media.blockedHosts).map(([host, n]) => `${host}: ${n}`) }))
      : null,
    (a.conflicts ?? []).length
      ? h(Section, { title: "Address conflicts" }, h(List, { items: a.conflicts.map((c) => `${c.title || c.wanted} (${c.wanted}): ${c.reason === "exists" ? "the site already has this address" : c.reason === "reserved" ? "a reserved news address" : "used twice in the file"}${c.renamedTo ? `, will be imported as ${c.renamedTo}` : ", will be skipped"}`) }))
      : null,
    (a.unsupported ?? []).length
      ? h(Section, { title: "Cannot be imported" }, h(List, { items: a.unsupported.slice(0, 30).map((u) => `${u.title ? `${u.title}: ` : ""}${u.message}`) }))
      : null,
    (a.constructs ?? []).length
      ? h(Section, { title: "Dropped or changed on the way (also written to the log)" }, h(List, { items: a.constructs.map((c) => `${c.message} (${c.count}${c.samples?.length ? `, for example ${c.samples[0]}` : ""})`) }))
      : null,
    !a.postsPluginInstalled ? h("div", { style: { color: "var(--theme-warning-500, #b36b00)" } }, "The posts plugin is not installed, so posts will be skipped.") : null,
    (a.warnings ?? []).length ? h(Section, { title: "The file had some problems" }, h(List, { items: a.warnings })) : null,
    (a.samples?.pages ?? []).length || (a.samples?.posts ?? []).length
      ? h(
          Section,
          { title: "New addresses (first few)" },
          h(Table, { rows: [...a.samples.pages, ...a.samples.posts].slice(0, 12).map((s) => [s.title || "(no title)", `${s.from ? `/${s.from}  →  ` : ""}/${s.to}${s.status === "draft" ? "  (draft)" : ""}`]) }),
        )
      : null,
  );
}

function Result({ r, logHref }) {
  return h(
    "div",
    { style: box },
    h("div", { style: { fontWeight: 700, marginBottom: 8 } }, "Result"),
    h(Table, {
      rows: [
        ["Pages", `${r.created.pages} added, ${r.updated.pages} updated`],
        ["Posts", `${r.created.posts} added, ${r.updated.posts} updated`],
        ["Categories", `${r.created.categories} added`],
        ["Images", `${r.created.media} downloaded${r.mediaFailed ? `, ${r.mediaFailed} could not be` : ""}`],
        ["Redirects", `${r.created.redirects} added, ${r.updated.redirects} updated`],
        ["Menu", r.menu ? `${r.menu.items} items from "${r.menu.name}"${r.menu.changed ? "" : " (already there)"}` : "not imported"],
        ["Left alone", `${r.skipped.edited} edited here, ${r.skipped.deleted} deleted here, ${r.skipped.conflict} address conflicts, ${r.skipped.other} other`],
        ["Failed", r.failed],
        ["Log", `${r.log.info} notes, ${r.log.warn} warnings, ${r.log.error} errors`],
      ],
    }),
    h("div", { style: { marginTop: 8 } }, h("a", { href: logHref }, "Open the log")),
  );
}

export function ImportPanel() {
  const { id } = useDocumentInfo();
  const { config } = useConfig();
  const modified = useFormModified();
  const api = `${config.serverURL ?? ""}${config.routes.api}`;
  const admin = `${config.serverURL ?? ""}${config.routes.admin}`;
  const [doc, setDoc] = useState(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!id) return null;
    try {
      const res = await fetch(`${api}/wordpress-imports/${id}?depth=0`, { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setDoc(d);
        return d;
      }
    } catch {
      // try again on the next tick
    }
    return null;
  }, [api, id]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!doc || !BUSY.includes(doc.status)) return undefined;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [doc, load]);

  if (!id) return h("div", { style: box }, "Choose the site and the settings below, save, then upload the export file here.");

  const busy = doc ? BUSY.includes(doc.status) : false;
  const post = async (path, init) => {
    setMessage("");
    setWorking(true);
    try {
      const res = await fetch(`${api}/wordpress-imports/${id}/${path}`, { method: "POST", credentials: "include", ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(body.error || `Something went wrong (${res.status}).`);
      await load();
    } catch {
      setMessage("The request did not go through.");
    } finally {
      setWorking(false);
    }
  };
  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setMessage("Choose the export file first.");
    await post(`file?name=${encodeURIComponent(file.name)}`, { body: file, headers: { "Content-Type": "application/xml" } });
    if (fileRef.current) fileRef.current.value = "";
  };
  const start = (phase) => post("start", { body: JSON.stringify({ phase }), headers: { "Content-Type": "application/json" } });

  const p = doc?.progress;
  const pct = p && p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  const hasFile = Boolean(doc?.fileName);
  const logHref = `${admin}/collections/wordpress-import-log?where[or][0][and][0][job][equals]=${id}`;

  return h(
    "div",
    { style: { marginBottom: "var(--base)" } },
    h(
      "div",
      { style: box },
      h("div", { style: { fontWeight: 700, marginBottom: 8 } }, "1. The export file"),
      hasFile ? h("div", { style: { marginBottom: 8 } }, `Uploaded: ${doc.originalName} (${mb(doc.fileSize ?? 0)})`) : h("div", { style: small }, "In WordPress: Tools, Export, All content, Download Export File. Upload that .xml file here."),
      h("input", { type: "file", accept: ".xml,application/xml,text/xml", ref: fileRef, disabled: busy || working, "data-testid": "wp-file" }),
      " ",
      h("button", { type: "button", className: "btn btn--style-secondary btn--size-small", onClick: upload, disabled: busy || working }, hasFile ? "Replace file" : "Upload"),
    ),
    h(
      "div",
      { style: box },
      h("div", { style: { fontWeight: 700, marginBottom: 8 } }, "2. Dry run, then import"),
      modified ? h("div", { style: { color: "var(--theme-warning-500, #b36b00)", marginBottom: 8 } }, "You have unsaved changes to the settings. Save them first: the dry run and the import use the saved settings.") : null,
      h("button", { type: "button", className: "btn btn--style-primary btn--size-small", onClick: () => start("analyse"), disabled: !hasFile || busy || working || modified }, "Run dry run"),
      " ",
      h("button", { type: "button", className: "btn btn--style-secondary btn--size-small", onClick: () => start("import"), disabled: !hasFile || !doc?.analysis || busy || working || modified }, "Import now"),
      h("div", { style: { ...small, marginTop: 6 } }, "The dry run changes nothing. Importing again later is safe: it updates what it made and leaves anything you edited here alone."),
      busy
        ? h(
            "div",
            { style: { marginTop: 12 }, "data-testid": "wp-progress" },
            h("div", null, `${doc.status === "queued" ? "Waiting to start" : doc.status === "analysing" ? "Reading the file" : "Importing"}${p?.message ? `: ${p.message}` : ""}`),
            h("div", { style: { height: 8, background: "var(--theme-elevation-150)", borderRadius: 4, marginTop: 6, overflow: "hidden" } }, h("div", { style: { height: "100%", width: `${pct ?? 5}%`, background: "var(--theme-success-500, #2c7a4b)", transition: "width .3s" } })),
          )
        : null,
      message ? h("div", { style: { color: "var(--theme-error-500, #b00020)", marginTop: 8 }, role: "alert" }, message) : null,
      doc?.status === "failed" && doc.error ? h("div", { style: { color: "var(--theme-error-500, #b00020)", marginTop: 8 }, role: "alert" }, `It stopped: ${doc.error}`) : null,
    ),
    doc?.analysis ? h(DryRun, { a: doc.analysis }) : null,
    doc?.result ? h(Result, { r: doc.result, logHref }) : null,
  );
}
