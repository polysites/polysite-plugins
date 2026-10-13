"use client";
import { createElement as h, useState } from "react";

// A "send a test email" button on Email Settings. Plain React.createElement (no
// JSX), like the plugin's other components; the endpoint re-checks the caller is
// a Super Admin.
export function EmailTest() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/email/test", { method: "POST", credentials: "include" });
      setResult(await res.json().catch(() => ({ ok: false, message: "Unexpected reply." })));
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return h(
    "div",
    { style: { marginBottom: "1.5rem" } },
    h("button", { type: "button", onClick: send, disabled: busy, className: "btn btn--style-secondary btn--size-small" }, busy ? "Sending…" : "Send a test email to me"),
    h("p", { style: { margin: "0.5rem 0 0", fontSize: "0.85rem", opacity: 0.85 } }, "Uses the saved settings. Goes to the address you're signed in with, and the result appears in Email Logs."),
    result
      ? h(
          "p",
          { role: "status", style: { margin: "0.5rem 0 0", color: result.ok ? "#2e7d32" : "#c62828" } },
          result.ok ? `Accepted by the mail server for ${result.to}. ${result.response ?? ""}` : `Not sent: ${result.message}${result.responseCode ? ` (code ${result.responseCode})` : ""}`,
        )
      : null,
  );
}
