"use client";
import { createElement as h, useEffect, useState } from "react";

// A notice on the admin dashboard when a webhook has been switched off because its receiver kept failing, so nobody finds out
// weeks later that a mirror stopped updating. Only Super Admins can read webhooks, so for everyone else the request is refused
// and nothing is shown. Plain React.createElement (no JSX): plugin files are bundled as they are.
export function DisabledBanner() {
  const [off, setOff] = useState([]);

  useEffect(() => {
    fetch("/api/webhook-endpoints?where[active][equals]=false&where[disabledReason][exists]=true&depth=0&limit=10", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOff(d?.docs ?? []))
      .catch(() => setOff([]));
  }, []);

  if (off.length === 0) return null;
  return h(
    "div",
    {
      id: "polysite-webhooks-banner",
      role: "alert",
      style: { border: "1px solid var(--theme-error-500)", background: "var(--theme-error-50)", color: "var(--theme-error-800, inherit)", borderRadius: 4, padding: "10px 14px", marginBottom: 16 },
    },
    h("strong", null, off.length === 1 ? "A webhook was switched off because it kept failing: " : `${off.length} webhooks were switched off because they kept failing: `),
    off.map((endpoint, i) => h("span", { key: endpoint.id }, i > 0 ? ", " : "", h("a", { href: `/admin/collections/webhook-endpoints/${endpoint.id}` }, endpoint.name))),
    ". Fix the receiver, switch it on again and replay what was missed.",
  );
}
