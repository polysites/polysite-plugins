"use client";
import { createElement as h, useEffect, useState } from "react";

// A document-menu entry: "Watch for changes" / "Stop watching" for the
// signed-in user, on any collection. Plain React.createElement (no JSX) --
// plugin files are bundled as-is, not run through a JSX transform. Reads the
// collection and document from the admin URL
// (/admin/collections/<slug>/<id>) instead of Payload's UI hooks, so the
// plugin has no import dependency on @payloadcms/ui. The server endpoints
// (collections.js) re-validate access; this only renders state.
function target() {
  const m = window.location.pathname.match(/\/collections\/([^/]+)\/([^/?#]+)/);
  if (!m || m[2] === "create") return null;
  return { collection: decodeURIComponent(m[1]), docId: decodeURIComponent(m[2]) };
}

export function WatchToggle() {
  const [t, setT] = useState(null);
  const [watching, setWatching] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const found = target();
    setT(found);
    if (!found) return;
    const qs = new URLSearchParams({ collection: found.collection, docId: found.docId });
    fetch(`/api/notification-watches/status?${qs}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setWatching(d ? Boolean(d.watching) : null))
      .catch(() => setWatching(null));
  }, []);

  if (!t || watching === null) return null;

  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/notification-watches/toggle", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t),
      });
      const d = await res.json();
      if (!res.ok) setError(d?.error || "Couldn't update.");
      else setWatching(Boolean(d.watching));
    } catch {
      setError("Couldn't update.");
    }
    setBusy(false);
  };

  return h(
    "button",
    {
      type: "button",
      id: "polysite-watch-toggle",
      onClick: toggle,
      disabled: busy,
      title: error || "Get a notification in your bell when this changes",
      style: { background: "none", border: "none", width: "100%", textAlign: "left", padding: "8px 16px", cursor: busy ? "wait" : "pointer", color: error ? "var(--theme-error-500)" : undefined },
    },
    error ? error : watching ? "Stop watching" : "Watch for changes",
  );
}
