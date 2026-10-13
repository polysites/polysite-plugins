"use client";
import { createElement as h, useEffect, useState } from "react";

import { box, button, input, note, post, problem, quiet } from "./shared.js";

// On your own user screen, when API keys are switched on (AUTH_API_KEYS=true): the keys you made, a form for a new one,
// and the text of a new key, shown once. Nothing is drawn when the feature is off or on someone else's screen.
const idInUrl = () => window.location.pathname.match(/\/collections\/users\/([^/?#]+)/)?.[1];
const when = (value) => (value ? new Date(value).toLocaleString() : "never");

export function ApiKeysPanel() {
  const [keys, setKeys] = useState(undefined);
  const [me, setMe] = useState(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("");
  const [fresh, setFresh] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/auth-keys/list", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKeys(d ? d.keys : null))
      .catch(() => setKeys(null));

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d?.user ?? null))
      .catch(() => setMe(null));
    load();
  }, []);

  if (!me || !keys) return null;
  const viewing = idInUrl();
  if (viewing && String(viewing) !== String(me.id) && !window.location.pathname.endsWith("/account")) return null;

  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return h(
    "div",
    { style: { ...box, margin: "0 0 20px" } },
    h("strong", { style: { display: "block", marginBottom: "6px" } }, "API keys"),
    h("p", { style: note }, "A key signs in as you, for a script. Treat it like a password: it skips the two-factor code, and works until you delete it or it expires."),
    fresh &&
      h(
        "div",
        null,
        h("p", { style: note }, "Your new key. Copy it now; it won't be shown again."),
        h("pre", { style: { ...box, background: "var(--theme-bg)", userSelect: "all", margin: "0 0 10px", whiteSpace: "pre-wrap", wordBreak: "break-all" } }, fresh),
        h("button", { type: "button", style: button, onClick: () => setFresh(null) }, "I have copied it"),
      ),
    !fresh &&
      h(
        "div",
        null,
        keys.length === 0 && h("p", { style: note }, "No keys yet."),
        ...keys.map((k) =>
          h(
            "div",
            { key: k.id, style: { display: "flex", gap: "12px", alignItems: "center", margin: "0 0 6px" } },
            h("span", { style: { flex: 1 } }, `${k.label} (${k.prefix}…) · last used ${when(k.lastUsedAt)} · expires ${k.expiresAt ? when(k.expiresAt) : "never"}`),
            h("button", { type: "button", style: quiet, disabled: busy, onClick: () => window.confirm(`Delete the key "${k.label}"? Anything using it stops working.`) && act(() => post("/auth-keys/revoke", { id: k.id })) }, "Delete"),
          ),
        ),
        h("input", { style: input, placeholder: "What it is for, such as nightly export", value: label, onChange: (e) => setLabel(e.target.value) }),
        h("input", { style: input, inputMode: "numeric", placeholder: "Expires after this many days (empty: never)", value: days, onChange: (e) => setDays(e.target.value) }),
        error && h("p", { style: problem }, error),
        h(
          "button",
          {
            type: "button",
            style: button,
            disabled: busy || !label.trim(),
            onClick: () =>
              act(async () => {
                const made = await post("/auth-keys/issue", { label, expiresInDays: days.trim() === "" ? null : Number(days) });
                setFresh(made.key);
                setLabel("");
                setDays("");
              }),
          },
          "Make a key",
        ),
      ),
  );
}
