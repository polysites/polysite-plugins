"use client";
import { createElement as h, useEffect, useState } from "react";

import { ERRORS } from "../sso/claims.js";
import { box, button, note, problem } from "./shared.js";

// Under the sign-in form: one button for each provider a Super Admin has switched on, and, after a failed attempt, a
// short reason. The reason comes from a fixed list of codes; text in the address bar is never shown.
export function SsoButtons() {
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("sso_error");
    if (code && Object.prototype.hasOwnProperty.call(ERRORS, code)) setError(ERRORS[code]);
    fetch("/api/auth-sso/providers", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d) => setProviders(Array.isArray(d.providers) ? d.providers : []))
      .catch(() => setProviders([]));
  }, []);

  if (!providers.length && !error) return null;

  return h(
    "div",
    { style: { margin: "20px 0 0" } },
    error && h("p", { style: problem, role: "alert" }, error),
    providers.length > 0 && h("p", { style: { ...note, textAlign: "center" } }, "or"),
    ...providers.map((p) =>
      h(
        "a",
        {
          key: p.slug,
          href: `/api/auth-sso/${encodeURIComponent(p.slug)}/start`,
          style: { ...button, display: "block", textAlign: "center", textDecoration: "none", margin: "0 0 8px", background: "transparent", color: "var(--theme-text)", border: "1px solid var(--theme-elevation-300)" },
        },
        p.label,
      ),
    ),
    providers.length > 0 && h("p", { style: { ...box, border: "none", background: "transparent", padding: 0, ...note } }, "You can only sign in this way if an account with your email address already exists."),
  );
}
