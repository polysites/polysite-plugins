"use client";
import { createElement as h, useEffect, useState } from "react";

// On AI assist settings: where the key comes from, this month's use per site, and a button that proves the key and model work.
const btn = { cursor: "pointer", padding: "6px 12px", borderRadius: 4, border: "1px solid var(--theme-elevation-300)", background: "var(--theme-elevation-50)", color: "inherit" };
const cell = { textAlign: "left", padding: "4px 12px 4px 0", borderBottom: "1px solid var(--theme-elevation-100)" };
const SOURCE = { environment: "the server's environment (AI_ASSIST_API_KEY)", settings: "the encrypted setting below", none: "nowhere: no key is set yet" };

export function SettingsPanel() {
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch("/api/ai-assist/usage", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai-assist/test", { method: "POST", credentials: "include" });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server." });
    }
    setBusy(false);
  };

  return h("div", { style: { marginBottom: 24 } },
    usage ? h("p", { style: { margin: "0 0 8px" } }, `Status: ${usage.enabled ? "switched on" : "OFF"}. The key is read from ${SOURCE[usage.keySource]}. Saved settings apply to the next request.`) : null,
    h("div", { style: { margin: "8px 0" } },
      h("button", { type: "button", style: btn, onClick: test, disabled: busy }, busy ? "Testing…" : "Test the key and model"),
      " ",
      "Sends one tiny request using the saved settings.",
      result ? h("p", { role: "status", style: { color: result.ok ? "#2e7d32" : "#c62828", margin: "6px 0 0" } }, result.ok ? `Works: ${result.model} (${result.usage?.inputTokens + result.usage?.outputTokens} tokens).` : `Failed: ${result.message}`) : null),
    usage?.rows?.length
      ? h("table", { style: { borderCollapse: "collapse", fontSize: 13 } },
          h("thead", null, h("tr", null, ["Site", "Requests today", "Tokens this month", "Budget", "Estimated cost this month"].map((t) => h("th", { key: t, style: cell }, t)))),
          h("tbody", null, usage.rows.map((r) => h("tr", { key: r.site }, [r.site, `${r.requestsToday} / ${r.dailyLimit}`, r.tokensThisMonth.toLocaleString(), r.tokenBudget.toLocaleString(), `$${r.estimatedCost.toFixed(2)}`].map((t, i) => h("td", { key: i, style: cell }, t))))))
      : usage
        ? h("p", { style: { fontSize: 13, opacity: 0.8 } }, "No site is ticked yet, so there is no use to show.")
        : null);
}
