"use client";
import { createElement as h, useEffect, useState } from "react";

import { Setup, box, button, input, note, post, problem, quiet } from "./shared.js";

// On a user's edit screen. On your own account it shows whether two-factor is on and lets you turn it on, off, or get
// new recovery codes. On someone else's, a Super Admin gets one button: reset it (for a lost phone). Everything is
// checked again on the server; this only draws the state.
const idInUrl = () => window.location.pathname.match(/\/collections\/users\/([^/?#]+)/)?.[1];

function OwnAccount() {
  const [state, setState] = useState(null);
  const [mode, setMode] = useState(null);
  const [code, setCode] = useState("");
  const [fresh, setFresh] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/auth-2fa/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setState)
      .catch(() => setState(null));
  useEffect(() => {
    load();
  }, []);

  if (!state) return null;

  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const finish = () => {
    setMode(null);
    setFresh(null);
    setCode("");
    load();
  };

  let body;
  if (fresh) {
    body = h(
      "div",
      null,
      h("p", { style: note }, "Your new recovery codes. The old ones no longer work. Save these; they won't be shown again."),
      h("pre", { style: { ...box, background: "var(--theme-bg)", userSelect: "all", margin: "0 0 10px" } }, fresh.join("\n")),
      h("button", { type: "button", style: button, onClick: finish }, "I have saved them"),
    );
  } else if (mode === "setup") {
    body = h(Setup, { start: () => post("/auth-2fa/setup"), confirm: (c) => post("/auth-2fa/confirm", { code: c }), onFinished: finish, cancel: finish });
  } else if (mode === "disable" || mode === "codes") {
    body = h(
      "div",
      null,
      h("p", { style: note }, mode === "disable" ? "Enter a code from your app (or a recovery code) to turn two-factor sign-in off." : "Enter a code from your app (or a recovery code) to make new recovery codes."),
      h("input", { style: input, inputMode: "text", autoComplete: "one-time-code", value: code, onChange: (e) => setCode(e.target.value) }),
      error && h("p", { style: problem }, error),
      h(
        "button",
        {
          type: "button",
          style: button,
          disabled: busy || !code,
          onClick: () =>
            act(async () => {
              if (mode === "disable") {
                await post("/auth-2fa/disable", { code });
                finish();
              } else {
                setFresh((await post("/auth-2fa/recovery-codes", { code })).recoveryCodes);
              }
            }),
        },
        "Confirm",
      ),
      h("button", { type: "button", style: { ...quiet, marginLeft: "8px" }, onClick: finish }, "Cancel"),
    );
  } else if (state.enabled) {
    body = h(
      "div",
      null,
      h("p", { style: note }, `On. ${state.recoveryCodesLeft} recovery code${state.recoveryCodesLeft === 1 ? "" : "s"} left.`),
      h("button", { type: "button", style: quiet, onClick: () => setMode("codes") }, "New recovery codes"),
      !state.required && h("button", { type: "button", style: { ...quiet, marginLeft: "8px" }, onClick: () => setMode("disable") }, "Turn off"),
    );
  } else {
    body = h(
      "div",
      null,
      h("p", { style: note }, state.required ? "Your administrator requires this. Turn it on to keep signing in." : "Off. Add a code from your phone to every sign-in."),
      h("button", { type: "button", style: button, onClick: () => setMode("setup") }, "Set up"),
    );
  }

  return h("div", { style: { ...box, margin: "0 0 20px" } }, h("strong", { style: { display: "block", marginBottom: "6px" } }, "Two-factor sign-in"), body);
}

function ResetForAdmin({ userId }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  return h(
    "div",
    { style: { ...box, margin: "0 0 20px" } },
    h("strong", { style: { display: "block", marginBottom: "6px" } }, "Two-factor sign-in"),
    h("p", { style: note }, "Each person manages their own. If this person lost their phone and recovery codes, you can reset it: they are signed out everywhere and set it up again."),
    done && h("p", { style: note }, "Reset. They can sign in with their password."),
    error && h("p", { style: problem }, error),
    h(
      "button",
      {
        type: "button",
        style: quiet,
        onClick: async () => {
          if (!window.confirm("Reset this person's two-factor sign-in and sign them out everywhere?")) return;
          try {
            await post("/auth-2fa/admin-reset", { userId });
            setDone(true);
          } catch (err) {
            setError(err.message);
          }
        },
      },
      "Reset two-factor sign-in",
    ),
  );
}

export function TwoFactorPanel() {
  const [me, setMe] = useState(undefined);
  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d?.user ?? null))
      .catch(() => setMe(null));
  }, []);
  if (!me) return null;
  const viewing = idInUrl();
  const own = !viewing || String(viewing) === String(me.id) || window.location.pathname.endsWith("/account");
  if (own) return h(OwnAccount);
  if (me.isSuperAdmin) return h(ResetForAdmin, { userId: viewing });
  return null;
}
