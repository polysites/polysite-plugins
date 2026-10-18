"use client";
import { useAllFormFields, useDocumentInfo, useForm, useLocale } from "@payloadcms/ui";
import { createElement as h, useCallback, useEffect, useMemo, useState } from "react";

import { isLexical, lexicalToMarkdown } from "../lexical.js";

// The "AI assist" box at the top of a page, post or image. A `ui` field: no data, no column. Plain React.createElement (no JSX), like the
// other plugins' components. Everything it shows is a suggestion; "Use this" only changes the open form, which the editor still saves.
const LABELS = { rewrite: "Write or rewrite text", seo: "Search title and description", translate: "Translate", page: "Draft a page from a brief", alt: "Alt text" };
const SKIP = new Set(["id", "blockType", "blockName", "site", "slug", "_status", "createdAt", "updatedAt", "aiAssist", "filename", "url", "mimeType", "thumbnailURL", "filesize", "width", "height", "focalX", "focalY"]);
const last = (path) => path.split(".").pop();
// Derived, technical or link-like fields are not text an editor writes (bodyHTML is generated from body).
const TECHNICAL = /(html|href|url|state|link)$/i;

const css = {
  box: { border: "1px solid var(--theme-elevation-150)", borderRadius: 4, background: "var(--theme-elevation-50)", padding: "10px 14px", marginBottom: 20 },
  row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" },
  input: { width: "100%", padding: "6px 8px", border: "1px solid var(--theme-elevation-300)", borderRadius: 4, background: "var(--theme-input-bg, #fff)", color: "inherit", font: "inherit", boxSizing: "border-box" },
  tab: (on) => ({ cursor: "pointer", padding: "4px 10px", borderRadius: 4, border: "1px solid var(--theme-elevation-300)", background: on ? "var(--theme-elevation-800)" : "transparent", color: on ? "var(--theme-elevation-0)" : "inherit" }),
  btn: { cursor: "pointer", padding: "6px 12px", borderRadius: 4, border: "1px solid var(--theme-elevation-300)", background: "var(--theme-elevation-100)", color: "inherit" },
  suggestion: { border: "1px dashed var(--theme-elevation-400)", borderRadius: 4, padding: "8px 10px", margin: "8px 0", whiteSpace: "pre-wrap", background: "var(--theme-bg)" },
  note: { fontSize: 12, opacity: 0.75, margin: "4px 0" },
  error: { color: "var(--theme-error-500, #c62828)", margin: "6px 0" },
};

const readCookie = (name) => {
  try {
    return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? "";
  } catch {
    return "";
  }
};
const idOf = (v) => (v && typeof v === "object" ? v.id : v);

export function AiPanel() {
  const { id, collectionSlug } = useDocumentInfo();
  const [fields] = useAllFormFields();
  const { dispatchFields, setModified } = useForm();
  const locale = useLocale();
  const localeCode = typeof locale === "string" ? locale : locale?.code;

  const siteId = idOf(fields.site?.value) || readCookie("payload-tenant");
  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState(null);
  const [target, setTarget] = useState("");
  const [instruction, setInstruction] = useState("");
  const [language, setLanguage] = useState("");
  const [brief, setBrief] = useState("");

  useEffect(() => {
    if (!siteId || !collectionSlug) return;
    const q = new URLSearchParams({ site: String(siteId), collection: collectionSlug, ...(id ? { id: String(id) } : {}) });
    fetch(`/api/ai-assist/status?${q}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => {
        setInfo(d);
        setTab((t) => t ?? d.actions?.[0] ?? null);
      })
      .catch(() => setInfo({ enabled: false }));
  }, [siteId, collectionSlug, id]);

  // Text fields of this document the editor may point at: plain strings and rich text, not ids or technical values.
  const candidates = useMemo(
    () =>
      Object.entries(fields)
        .filter(([path, f]) => !SKIP.has(last(path)) && !TECHNICAL.test(last(path)) && !path.startsWith("_") && (isLexical(f?.value) || typeof f?.value === "string"))
        .map(([path, f]) => {
          const rich = isLexical(f.value);
          const text = rich ? lexicalToMarkdown(f.value) : f.value;
          return { path, rich, text, label: `${path.replace(/\.(\d+)\./g, " $1 › ").replace(/\./g, " › ")}${text ? ` — ${text.slice(0, 40).replace(/\s+/g, " ")}${text.length > 40 ? "…" : ""}` : " — empty"}` };
        }),
    [fields],
  );
  useEffect(() => {
    if (!candidates.some((c) => c.path === target)) setTarget(candidates.find((c) => c.path === "title")?.path ?? candidates[0]?.path ?? "");
  }, [candidates, target]);
  const chosen = candidates.find((c) => c.path === target);

  const pageText = useMemo(() => candidates.filter((c) => c.text && !c.path.startsWith("meta.")).map((c) => c.text).join("\n\n").slice(0, 18000), [candidates]);

  const call = useCallback(
    async (action, body) => {
      setBusy(true);
      setError("");
      setSuggestion(null);
      try {
        const res = await fetch("/api/ai-assist/run", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, siteId, collection: collectionSlug, docId: id, locale: localeCode, ...body }),
        });
        const data = await res.json().catch(() => ({ ok: false, message: "Unexpected reply." }));
        if (!res.ok || !data.ok) setError(data.message || "Something went wrong.");
        else setSuggestion({ action, ...data });
      } catch {
        setError("Couldn't reach the server.");
      }
      setBusy(false);
    },
    [siteId, collectionSlug, id, localeCode],
  );

  // The rich-text editor only redraws when the field's initial value changes too.
  const set = (path, value) => {
    dispatchFields({ type: "UPDATE", path, value, ...(isLexical(value) ? { initialValue: value } : {}) });
    setModified?.(true);
  };
  const apply = () => {
    const r = suggestion.result;
    if (suggestion.action === "seo") {
      set("meta.title", r.title);
      set("meta.description", r.description);
    } else if (suggestion.action === "alt") set("alt", r.alt);
    else if (suggestion.action === "rewrite" || suggestion.action === "translate") set(target, chosen?.rich && r.lexical ? r.lexical : r.text);
    setSuggestion(null);
  };

  if (!info?.enabled || !info.actions?.length) return null;

  const richNote = chosen?.rich && !info.richText ? "This field is rich text and the suggestion comes as plain text to paste." : "";
  const fieldPicker = h(
    "select",
    { value: target, onChange: (e) => setTarget(e.target.value), style: css.input, "aria-label": "Field" },
    candidates.map((c) => h("option", { key: c.path, value: c.path }, c.label)),
  );
  const go = (label, onClick, disabled) => h("button", { type: "button", style: { ...css.btn, opacity: busy || disabled ? 0.6 : 1 }, disabled: busy || disabled, onClick }, busy ? "Thinking…" : label);

  let body = null;
  if (tab === "rewrite")
    body = h("div", null,
      fieldPicker,
      h("textarea", { rows: 2, style: { ...css.input, marginTop: 8 }, placeholder: "What should it say? e.g. “shorter and friendlier”, or “write an intro about our summer programme”", value: instruction, onChange: (e) => setInstruction(e.target.value) }),
      h("div", { style: css.row }, go("Suggest", () => call("rewrite", { text: chosen?.text ?? "", instruction, richText: chosen?.rich, multiline: chosen?.rich || (chosen?.text ?? "").length > 120, fieldLabel: target, title: fields.title?.value }), !chosen || !instruction.trim())),
      richNote ? h("p", { style: css.note }, richNote) : null);
  else if (tab === "seo")
    body = h("div", { style: css.row }, go("Suggest a title and description", () => call("seo", { title: fields.title?.value, text: pageText }), !pageText), h("span", { style: css.note }, "Fills the SEO fields once you press Use these."));
  else if (tab === "translate")
    body = h("div", null,
      fieldPicker,
      h("div", { style: css.row },
        h("input", { list: "ai-assist-langs", style: { ...css.input, maxWidth: 260 }, placeholder: "Into which language? e.g. French", value: language, onChange: (e) => setLanguage(e.target.value) }),
        h("datalist", { id: "ai-assist-langs" }, (info.locales ?? []).map((l) => h("option", { key: l, value: l }))),
        go("Translate", () => call("translate", { text: chosen?.text ?? "", to: language, richText: chosen?.rich }), !chosen?.text || !language.trim())),
      h("p", { style: css.note }, "Replaces the chosen field with the translation. To fill another language version, switch the language at the top first."));
  else if (tab === "page")
    body = h("div", null,
      h("textarea", { rows: 4, style: css.input, placeholder: "Describe the page: who it is for, what it should say, the sections you want. Facts, dates and names you give are used as they are; nothing is invented.", value: brief, onChange: (e) => setBrief(e.target.value) }),
      h("div", { style: css.row }, go("Create a draft page", () => call("page", { brief, locale: localeCode }), !brief.trim()), h("span", { style: css.note }, "Saves a new draft page. Nothing is published.")));
  else if (tab === "alt")
    body = h("div", { style: css.row }, go("Suggest alt text from the image", () => call("alt", { context: fields.filename?.value }), false), h("span", { style: css.note }, "The image is sent to the AI provider."));

  let shown = null;
  if (suggestion) {
    const r = suggestion.result;
    shown = h("div", null,
      suggestion.action === "seo"
        ? h("div", { style: css.suggestion }, h("strong", null, r.title), h("br"), r.description, h("div", { style: css.note }, `${r.title.length}/60 · ${r.description.length}/155 characters`))
        : suggestion.action === "page"
          ? h("div", { style: css.suggestion }, `Draft “${r.title}” created with ${r.blockCount} blocks. `, h("a", { href: suggestion.created?.adminUrl }, "Open the draft"), ". Add pictures and forms there, then review before publishing.")
          : h("div", { style: css.suggestion }, suggestion.action === "alt" ? r.alt : r.text),
      suggestion.action === "page"
        ? null
        : h("div", { style: css.row }, h("button", { type: "button", style: css.btn, onClick: apply }, suggestion.action === "seo" ? "Use these" : "Use this"), h("button", { type: "button", style: css.btn, onClick: () => setSuggestion(null) }, "Discard")),
      h("p", { style: css.note }, `Suggested by ${suggestion.model}. Check it before you save: AI can be wrong.`));
  }

  return h("details", { open: true, style: css.box, "data-ai-assist": true },
    h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "AI assist"),
    h("div", { style: css.row }, info.actions.map((a) => h("button", { key: a, type: "button", style: css.tab(tab === a), onClick: () => { setTab(a); setSuggestion(null); setError(""); } }, LABELS[a]))),
    body,
    error ? h("p", { role: "alert", style: css.error }, error) : null,
    shown,
    h("p", { style: css.note }, "Only the text you work on here is sent to the AI provider. Nothing is published."),
  );
}
