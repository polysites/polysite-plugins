"use client";
import { useDocumentInfo } from "@payloadcms/ui";
import { createElement as h, useCallback, useEffect, useState } from "react";

// Sits at the top of an event's edit screen: how many places are taken, the waiting list, a link to the RSVPs, the attendee list as
// a spreadsheet, and a "Count again" repair button. Plain React.createElement (no JSX): plugin files are bundled as they are.
const box = { border: "1px solid var(--theme-elevation-150)", borderRadius: 4, padding: "10px 14px", marginBottom: 16, background: "var(--theme-elevation-50)" };
const button = { cursor: "pointer", padding: "6px 12px", borderRadius: 4, border: "1px solid var(--theme-elevation-300)", background: "var(--theme-elevation-0)", color: "inherit", textDecoration: "none", display: "inline-block" };

export function RsvpSummary() {
  const { id } = useDocumentInfo();
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(() => {
    if (!id) return;
    fetch(`/api/event-summary/${id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [id]);
  useEffect(load, [load]);

  if (!id) return null;

  const recount = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/event-recount/${id}`, { method: "POST", credentials: "include" });
      const d = await res.json();
      setNote(d.ok ? `Counted again: ${d.confirmedGuests} confirmed, ${d.waitlistedGuests} waiting.${d.promoted ? ` ${d.promoted} moved up from the waiting list.` : ""}` : d.message || "Couldn't count again.");
      load();
    } catch {
      setNote("Couldn't reach the server.");
    }
    setBusy(false);
  };

  const capacity = summary?.capacity;
  return h(
    "div",
    { id: "polysite-events-summary", style: box },
    summary
      ? h(
          "p",
          { style: { margin: "0 0 8px" } },
          h("strong", null, `${summary.confirmedGuests} ${summary.confirmedGuests === 1 ? "person" : "people"} confirmed`),
          capacity ? ` of ${capacity} places (${summary.spotsLeft} left)` : " (no limit)",
          summary.waitlistedGuests ? `, ${summary.waitlistedGuests} on the waiting list` : "",
          ".",
        )
      : h("p", { style: { margin: "0 0 8px", opacity: 0.7 } }, "Loading the numbers..."),
    h(
      "div",
      { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
      h("a", { href: `/admin/collections/event-rsvps?where[event][equals]=${id}`, style: button, id: "polysite-events-list" }, "See the RSVPs"),
      h("a", { href: `/api/event-export/${id}`, style: button, id: "polysite-events-export" }, "Download as a spreadsheet (CSV)"),
      h("button", { type: "button", style: button, disabled: busy, onClick: recount, id: "polysite-events-recount", title: "Counts the RSVPs again if the numbers above look wrong" }, busy ? "Counting..." : "Count again"),
    ),
    note ? h("p", { role: "status", style: { margin: "8px 0 0" } }, note) : null,
  );
}
