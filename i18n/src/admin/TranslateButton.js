"use client";
import { useDocumentInfo } from "@payloadcms/ui";
import { createElement as h, useCallback, useEffect, useState } from "react";

// The machine-translation helper on a page or post: choose a language, press Translate, and the text of this one document is
// translated from the site's default language into it and saved as a draft. A language translated this way is marked until
// someone has read it and chosen "Mark as reviewed"; the server refuses to publish the document before that. Drawn only when the
// site has switched the helper on (and the server has a provider), or when a machine-made language is waiting for review.
// Plain React.createElement (no JSX), like every plugin admin component.
const box = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginInlineEnd: "12px", fontSize: "13px" };

async function call(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
  return json;
}

export function TranslateButton() {
  const { id, collectionSlug } = useDocumentInfo();
  const [status, setStatus] = useState(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!id || !collectionSlug) return;
    try {
      const next = await call("GET", `/i18n/translate/status?collection=${encodeURIComponent(collectionSlug)}&id=${encodeURIComponent(id)}`);
      setStatus(next);
      setTarget((current) => current || next.languages?.[0] || "");
    } catch {
      setStatus(null);
    }
  }, [id, collectionSlug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!id || !status || (!status.available && !(status.unreviewed?.length > 0))) return null;

  const translate = async () => {
    setBusy(true);
    setMessage("");
    try {
      const done = await call("POST", "/i18n/translate", { collection: collectionSlug, id, to: target });
      setMessage(done.translated ? `Translated ${done.translated} pieces of text into ${target} as a draft. Reload to see them, read them, then mark them reviewed.` : done.message);
      await refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  const review = async (locale) => {
    setBusy(true);
    try {
      await call("POST", "/i18n/translate/review", { collection: collectionSlug, id, locale });
      setMessage(`${locale} marked as reviewed.`);
      await refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return h(
    "div",
    { style: box, "data-polysite-translate": "true" },
    status.available
      ? [
          h(
            "select",
            { key: "to", value: target, onChange: (e) => setTarget(e.target.value), disabled: busy, "aria-label": "Translate into", style: { padding: "4px" } },
            status.languages.map((code) => h("option", { key: code, value: code }, code)),
          ),
          h("button", { key: "go", type: "button", className: "btn btn--style-secondary btn--size-small", disabled: busy || !target, onClick: translate }, busy ? "Translating…" : `Translate from ${status.from}`),
        ]
      : null,
    (status.unreviewed ?? []).map((locale) =>
      h("button", { key: `r-${locale}`, type: "button", className: "btn btn--style-secondary btn--size-small", disabled: busy, onClick: () => review(locale), title: "Machine-translated and not yet read by a person" }, `Mark ${locale} as reviewed`),
    ),
    message ? h("span", { key: "msg", role: "status" }, message) : null,
  );
}
