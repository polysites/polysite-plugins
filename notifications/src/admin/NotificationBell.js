"use client";
import { createElement as h, useCallback, useEffect, useRef, useState } from "react";

// The header bell. Polls the user's unread notifications (every 30s, and when
// the tab regains focus) -- no websockets, matching the one-VM deployment.
// Plain React.createElement for the same reason as WatchToggle.js.
const POLL_MS = 30_000;

const BORDER = "1px solid var(--theme-elevation-150)";

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function BellIcon() {
  return h(
    "svg",
    { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
    h("path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }),
    h("path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0" }),
  );
}

export function NotificationBell() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const root = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?where[readAt][exists]=false&sort=-createdAt&limit=20&depth=0", { credentials: "include" });
      if (!res.ok) return;
      const d = await res.json();
      setItems(d.docs ?? []);
      setTotal(d.totalDocs ?? 0);
      setReady(true);
    } catch {
      /* offline or restarting -- keep what we have */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => root.current && !root.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (id) => {
    await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readAt: new Date().toISOString() }),
    }).catch(() => {});
  };

  const openItem = async (item) => {
    await markRead(item.id);
    setOpen(false);
    if (item.link) window.location.href = item.link;
    else load();
  };

  const markAll = async () => {
    await fetch("/api/notifications/mark-all-read", { method: "POST", credentials: "include" }).catch(() => {});
    load();
  };

  // Not signed in / plugin endpoints unavailable: render nothing rather than a dead bell.
  if (!ready) return null;

  return h(
    "div",
    { ref: root, style: { position: "relative" } },
    h(
      "button",
      {
        type: "button",
        id: "polysite-notification-bell",
        onClick: () => setOpen(!open),
        "aria-label": total ? `Notifications, ${total} unread` : "Notifications",
        "aria-expanded": open,
        style: { position: "relative", width: 34, height: 34, borderRadius: "var(--style-radius-m)", border: BORDER, background: "none", color: "var(--theme-elevation-500)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
      },
      h(BellIcon),
      total > 0 &&
        h(
          "span",
          { style: { position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "#d6453d", color: "#fff", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" } },
          total > 99 ? "99+" : String(total),
        ),
    ),
    open &&
      h(
        "div",
        { style: { position: "absolute", right: 0, top: 42, width: 340, maxWidth: "calc(100vw - 32px)", background: "var(--theme-input-bg)", border: BORDER, borderRadius: "var(--style-radius-l)", boxShadow: "0 12px 32px rgba(0,0,0,0.35)", zIndex: 100, overflow: "hidden" } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: BORDER } },
          h("strong", { style: { fontSize: 13 } }, "Notifications"),
          total > 0 && h("button", { type: "button", onClick: markAll, style: { background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--theme-elevation-500)", textDecoration: "underline" } }, "Mark all read"),
        ),
        h(
          "div",
          { style: { maxHeight: 360, overflowY: "auto" } },
          items.length === 0
            ? h("div", { style: { padding: "18px 14px", fontSize: 13, color: "var(--theme-elevation-500)" } }, "You're all caught up.")
            : items.map((item) =>
                h(
                  "button",
                  { key: item.id, type: "button", onClick: () => openItem(item), style: { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: BORDER, padding: "10px 14px", cursor: "pointer", color: "var(--theme-text)" } },
                  h("div", { style: { fontSize: 13, fontWeight: 500 } }, item.title),
                  item.body && h("div", { style: { fontSize: 12, color: "var(--theme-elevation-500)", marginTop: 2 } }, item.body),
                  h("div", { style: { fontSize: 11, color: "var(--theme-elevation-400)", marginTop: 4 } }, timeAgo(item.createdAt)),
                ),
              ),
        ),
        h(
          "a",
          { href: "/admin/collections/notifications", style: { display: "block", padding: "10px 14px", fontSize: 12, textAlign: "center", color: "var(--theme-elevation-500)" } },
          "View all",
        ),
      ),
  );
}
