"use client";
import { useDocumentInfo } from "@payloadcms/ui";
import { createElement as h, useCallback, useEffect, useState } from "react";

// Sits at the top of a ticket order's screen. For a payment that could not be confirmed: "Check again" asks the payment provider
// once more; "Mark as paid" settles it by hand (you have seen the money in the provider's own records); "Release the places" lets the
// places go. A paid order only shows its state. Plain React.createElement (no JSX): plugin files are bundled as they are.
const box = (tone) => ({ border: `1px solid var(--theme-${tone}-500)`, background: `var(--theme-${tone}-50)`, color: `var(--theme-${tone}-800, inherit)`, borderRadius: 4, padding: "10px 14px", marginBottom: 12 });
const button = { cursor: "pointer", padding: "6px 12px", borderRadius: 4, border: "1px solid var(--theme-elevation-300)", background: "var(--theme-elevation-50)", color: "inherit" };
const TEXT = {
  pending: ["warning", "Waiting for payment. The places are held for a short while and let go if nobody pays."],
  payment_reported: ["warning", "The buyer says they paid, but the payment provider could not confirm it yet. Polysite keeps checking."],
  payment_problem: ["error", "The payment provider did not confirm this payment (see the note). The places are held for a day while a person decides."],
  paid: ["success", "Paid. The places are confirmed."],
  expired: ["error", "Expired. The places were let go."],
  refunded: ["error", "Refunded."],
};

export function OrderActions() {
  const { id } = useDocumentInfo();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(() => {
    if (!id) return;
    fetch(`/api/event-orders/${id}?depth=0`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d?.status ?? null))
      .catch(() => setStatus(null));
  }, [id]);
  useEffect(load, [load]);

  if (!id || !status) return null;
  const [tone, text] = TEXT[status] ?? ["warning", status];
  const stuck = status === "pending" || status === "payment_reported" || status === "payment_problem";

  const act = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/event-order-admin/${id}/${action}`, { method: "POST", credentials: "include" });
      const d = await res.json();
      setNote(res.ok ? (d.status === "paid" ? "Done: the order is paid." : d.status === "expired" ? "Done: the places were released." : d.message || "Checked; it is not confirmed yet.") : d.message || "That didn't work.");
      load();
    } catch {
      setNote("Couldn't reach the server.");
    }
    setBusy(false);
  };

  return h(
    "div",
    { id: "polysite-order-actions", style: { marginBottom: 16 } },
    h("div", { role: "status", style: box(tone) }, text),
    stuck
      ? h(
          "div",
          { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          status !== "pending" ? h("button", { type: "button", id: "polysite-order-verify", style: button, disabled: busy, onClick: () => act("verify") }, "Check again with the payment provider") : null,
          h("button", { type: "button", id: "polysite-order-paid", style: button, disabled: busy, onClick: () => act("mark-paid", "Mark this order as paid? Only do this once you have seen the payment in the payment provider's own records.") }, "Mark as paid"),
          h("button", { type: "button", id: "polysite-order-release", style: button, disabled: busy, onClick: () => act("release", "Let go of this order's places? If the buyer did pay, they will need to be refunded.") }, "Release the places"),
        )
      : null,
    note ? h("p", { role: "status", style: { marginTop: 8 } }, note) : null,
  );
}
