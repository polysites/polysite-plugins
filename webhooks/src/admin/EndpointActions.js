"use client";
import { useDocumentInfo, useForm } from "@payloadcms/ui";
import { createElement as h, useCallback, useEffect, useState } from "react";

// Sits at the top of a webhook's edit screen (a `ui` field: no data, no column). Plain React.createElement (no JSX): plugin files
// are bundled as they are, not run through a JSX transform.
//  - a clear notice when Polysite switched the endpoint off by itself;
//  - "Send test event": one signed message right now, answered on the spot (the server logs it and never retries it);
//  - "Generate a secret": fills the signing secret with a random one and shows it once, because it is write-only afterwards.
const box = (tone) => ({
  border: `1px solid var(--theme-${tone}-500)`,
  background: `var(--theme-${tone}-50)`,
  color: `var(--theme-${tone}-800, inherit)`,
  borderRadius: 4,
  padding: "10px 14px",
  marginBottom: 12,
});
const button = { cursor: "pointer", padding: "6px 12px", borderRadius: 4, border: "1px solid var(--theme-elevation-300)", background: "var(--theme-elevation-50)", color: "inherit" };

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function EndpointActions() {
  const { id } = useDocumentInfo();
  const { dispatchFields, setModified, modified } = useForm();
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [generated, setGenerated] = useState("");

  const load = useCallback(() => {
    if (!id) return;
    fetch(`/api/webhook-endpoints/${id}?depth=0`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHealth(d ? { active: d.active, reason: d.disabledReason, failures: d.consecutiveFailures } : null))
      .catch(() => setHealth(null));
  }, [id]);
  useEffect(load, [load, modified]);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/webhook-endpoints/${id}/test`, { method: "POST", credentials: "include" });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: "Couldn't reach the server." });
    }
    setBusy(false);
  };

  const generate = () => {
    const value = randomSecret();
    dispatchFields({ type: "UPDATE", path: "secret", value });
    setModified?.(true);
    setGenerated(value);
  };

  return h(
    "div",
    { id: "polysite-webhook-actions", style: { marginBottom: 16 } },
    health && health.active === false && health.reason
      ? h("div", { role: "alert", style: box("error") }, h("strong", null, "Switched off. "), health.reason, " Fix the receiver, then tick \"Switched on\" and save. Failed deliveries can be replayed from the Deliveries list.")
      : null,
    h(
      "div",
      { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
      id ? h("button", { type: "button", id: "polysite-webhook-test", style: button, disabled: busy || modified, onClick: test, title: modified ? "Save your changes first" : "Sends one signed test message now" }, busy ? "Sending..." : "Send test event") : null,
      h("button", { type: "button", id: "polysite-webhook-generate", style: button, onClick: generate }, "Generate a secret"),
      health && health.failures > 0 && health.active !== false ? h("span", { style: { color: "var(--theme-warning-500)" } }, `${health.failures} failed attempt${health.failures === 1 ? "" : "s"} in a row`) : null,
    ),
    generated
      ? h(
          "p",
          { id: "polysite-webhook-generated", style: { marginTop: 8 } },
          "Copy this secret into the receiver now. After you save it is never shown again: ",
          h("code", { style: { wordBreak: "break-all" } }, generated),
        )
      : null,
    result
      ? h(
          "div",
          { id: "polysite-webhook-test-result", role: "status", style: { ...box(result.ok ? "success" : "error"), marginTop: 8, marginBottom: 0 } },
          result.ok ? `The receiver accepted the test event (HTTP ${result.status}). See Deliveries for the record.` : `The test failed: ${result.error}`,
        )
      : null,
  );
}
