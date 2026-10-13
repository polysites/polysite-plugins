"use client";
import { createElement as h, useState } from "react";

// Small pieces shared by the sign-in box and the account panel. Plain React.createElement (no JSX), as for every plugin
// admin component: plugin files are bundled as they are. Styling uses Payload's own CSS variables so it follows the
// light and dark themes.
export const box = {
  border: "1px solid var(--theme-elevation-150)",
  borderRadius: "4px",
  padding: "12px 14px",
  background: "var(--theme-elevation-50)",
  fontSize: "14px",
};
export const input = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  margin: "4px 0 10px",
  border: "1px solid var(--theme-elevation-200)",
  borderRadius: "4px",
  background: "var(--theme-input-bg, var(--theme-bg))",
  color: "var(--theme-text)",
  font: "inherit",
};
export const button = {
  padding: "8px 14px",
  border: "1px solid var(--theme-elevation-800)",
  borderRadius: "4px",
  background: "var(--theme-elevation-800)",
  color: "var(--theme-elevation-0)",
  font: "inherit",
  cursor: "pointer",
};
export const quiet = { ...button, background: "transparent", color: "var(--theme-text)", border: "1px solid var(--theme-elevation-300)" };
export const note = { margin: "0 0 10px", color: "var(--theme-elevation-600)" };
export const problem = { margin: "0 0 10px", color: "var(--theme-error-500)" };

export async function post(path, payload) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // an empty or non-JSON answer: fall through to the generic message
  }
  if (!res.ok) throw new Error(data?.message || data?.errors?.[0]?.message || "Something went wrong. Try again.");
  return data;
}

export const label = (text, control) => h("label", { style: { display: "block" } }, h("span", null, text), control);

function RecoveryCodes({ codes, onDone }) {
  return h(
    "div",
    null,
    h("p", { style: note }, "Two-factor sign-in is on. Save these recovery codes somewhere safe. Each works once if you lose your phone, and they won't be shown again."),
    h("pre", { style: { ...box, background: "var(--theme-bg)", userSelect: "all", margin: "0 0 10px" } }, codes.join("\n")),
    h("button", { type: "button", style: button, onClick: onDone }, "I have saved them"),
  );
}

// The three steps of switching it on: ask for a key, scan it, prove it with a code. `api` says how to call the server
// (signed in, or with email and password from the sign-in page).
export function Setup({ start, confirm, onFinished, cancel }) {
  const [step, setStep] = useState("idle");
  const [key, setKey] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  if (codes) return h(RecoveryCodes, { codes, onDone: onFinished });

  if (step === "idle") {
    return h(
      "div",
      null,
      error && h("p", { style: problem }, error),
      h("button", { type: "button", style: button, disabled: busy, onClick: () => run(async () => { setKey(await start()); setStep("scan"); }) }, "Start"),
      cancel && h("button", { type: "button", style: { ...quiet, marginLeft: "8px" }, onClick: cancel }, "Cancel"),
    );
  }

  return h(
    "div",
    null,
    h("p", { style: note }, "1. Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy) and scan this picture, or type the key."),
    key?.qr && h("div", { style: { width: "200px", background: "#fff", margin: "0 0 8px" }, dangerouslySetInnerHTML: { __html: key.qr } }),
    h("code", { style: { display: "block", margin: "0 0 12px", wordBreak: "break-all", userSelect: "all" } }, key?.secret),
    h("p", { style: note }, "2. Enter the 6-digit code the app shows now."),
    h("input", { style: input, inputMode: "numeric", autoComplete: "one-time-code", placeholder: "123456", value: code, onChange: (e) => setCode(e.target.value) }),
    error && h("p", { style: problem }, error),
    h("button", { type: "button", style: button, disabled: busy || !code, onClick: () => run(async () => setCodes((await confirm(code)).recoveryCodes)) }, "Turn on"),
    cancel && h("button", { type: "button", style: { ...quiet, marginLeft: "8px" }, onClick: cancel }, "Cancel"),
  );
}
