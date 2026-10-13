"use client";
import { useDocumentInfo } from "@payloadcms/ui";
import { createElement as h, useEffect, useState } from "react";

// Sits at the top of a delivery's screen: "Replay" for one that failed or was skipped. The same event (same id, so a receiver can
// tell it is the one it missed) goes out again with a fresh signature, through the same queue and retries. Plain
// React.createElement (no JSX): plugin files are bundled as they are.
const button = { cursor: "pointer", padding: "6px 12px", borderRadius: 4, border: "1px solid var(--theme-elevation-300)", background: "var(--theme-elevation-50)", color: "inherit" };

export function DeliveryActions() {
  const { id } = useDocumentInfo();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/webhook-deliveries/${id}?depth=0`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d ? d.status : null))
      .catch(() => setStatus(null));
  }, [id, message]);

  if (!id || (status !== "failed" && status !== "skipped" && !message)) return null;

  const replay = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/webhook-deliveries/${id}/replay`, { method: "POST", credentials: "include" });
      const d = await res.json();
      setMessage(d.ok ? { ok: true, text: "Queued again. Reload in a moment to see the result." } : { ok: false, text: d.error || "Couldn't replay." });
    } catch {
      setMessage({ ok: false, text: "Couldn't reach the server." });
    }
    setBusy(false);
  };

  return h(
    "div",
    { id: "polysite-webhook-replay", style: { marginBottom: 16 } },
    status === "failed" || status === "skipped" ? h("button", { type: "button", id: "polysite-webhook-replay-button", style: button, disabled: busy, onClick: replay }, busy ? "Queueing..." : "Replay this delivery") : null,
    message ? h("p", { role: "status", style: { marginTop: 8, color: message.ok ? "inherit" : "var(--theme-error-500)" } }, message.text) : null,
  );
}
