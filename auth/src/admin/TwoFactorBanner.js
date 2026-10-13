"use client";
import { createElement as h, useEffect, useState } from "react";

// A strip across the top of the admin for someone the policy now requires to use two-factor but who has not set it up
// (for example, the policy was tightened while they were signed in). They can't sign in again without it, so this is
// the nudge to do it now. Nothing is drawn for everyone else.
export function TwoFactorBanner() {
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    fetch("/api/auth-2fa/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setNeeded(Boolean(d && d.required && !d.enabled)))
      .catch(() => setNeeded(false));
  }, []);
  if (!needed) return null;
  return h(
    "div",
    { role: "status", style: { padding: "8px 16px", background: "var(--theme-warning-100, #fff4d6)", color: "var(--theme-warning-900, #5c4300)", fontSize: "14px" } },
    "Your administrator requires two-factor sign-in. ",
    h("a", { href: "/admin/account", style: { color: "inherit", fontWeight: 600 } }, "Set it up on your account page"),
    " before you next sign in.",
  );
}
