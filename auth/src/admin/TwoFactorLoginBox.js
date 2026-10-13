"use client";
import { createElement as h, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Setup, box, button, input, label, note, post, quiet } from "./shared.js";

// Sits inside Payload's sign-in form, just above the Login button. The page stays what it is for most people: email,
// password, Login, and a button per sign-in provider below. Nothing about two-factor shows until it is needed:
//  - if the password is right but the account needs a code, the server says so and the box opens by itself;
//  - if the account's policy requires two-factor and it is not set up yet, the server says so and the setup opens by itself.
// Payload's form carries only email and password, so the code typed here is kept in a two-minute cookie that the sign-in
// request brings along, and a server check reads it (hooks.js).
const COOKIE = "polysite-totp";

function keepCode(value) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (!value) document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Strict${secure}`;
  else document.cookie = `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=120; SameSite=Strict${secure}`;
}

const formValue = (selector) => document.querySelector(selector)?.value ?? "";

function SetupFromSignIn({ onClose }) {
  const [email, setEmail] = useState(() => formValue('form input[type="email"], form input[name="email"]'));
  const [password, setPassword] = useState(() => formValue('form input[type="password"], form input[name="password"]'));
  const [asking, setAsking] = useState(true);
  const [done, setDone] = useState(false);

  if (done) {
    return h("div", { style: box }, h("p", { style: note }, "Done. Now sign in with your password and the code from your app."), h("button", { type: "button", style: button, onClick: onClose }, "Close"));
  }

  if (asking) {
    // A div, not a form: this sits inside Payload's sign-in form, and forms cannot be nested.
    const go = () => setAsking(false);
    return h(
      "div",
      { style: box },
      h("p", { style: note }, "Your account needs two-factor sign-in. Confirm your email and password to set it up."),
      label("Email", h("input", { style: input, type: "email", autoComplete: "username", value: email, onChange: (e) => setEmail(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); if (email && password) go(); } } })),
      label("Password", h("input", { style: input, type: "password", autoComplete: "current-password", value: password, onChange: (e) => setPassword(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); if (email && password) go(); } } })),
      h("button", { type: "button", style: button, disabled: !email || !password, onClick: go }, "Continue"),
      h("button", { type: "button", style: { ...quiet, marginLeft: "8px" }, onClick: onClose }, "Cancel"),
    );
  }

  return h(
    "div",
    { style: box },
    h(Setup, {
      start: () => post("/auth-2fa/enroll/start", { email, password }),
      confirm: (code) => post("/auth-2fa/enroll/confirm", { email, password, code }),
      onFinished: () => setDone(true),
      cancel: () => { setAsking(true); onClose(); },
    }),
  );
}

export function TwoFactorLoginBox() {
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [setup, setSetup] = useState(false);

  useEffect(() => () => keepCode(""), []);

  // Opens the right part when the server answers a sign-in with "code needed" or "two-factor required", without ever
  // asking the server beforehand (so nothing here tells anyone which accounts use two-factor).
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
        if (url.includes("/api/users/login") && !res.ok) {
          const data = await res.clone().json();
          const message = String(data?.errors?.[0]?.message ?? data?.message ?? "");
          if (/two-factor sign-in is required/i.test(message)) setSetup(true);
          else if (/authenticator|6-digit code|code isn't right|recovery code/i.test(message)) setShowCode(true);
        }
      } catch {
        // not JSON or not ours: leave the response alone
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  // Payload draws its own form; this goes just above the Login button once the form exists. If the form can't be found, it
  // simply stays where it is.
  const [slot, setSlot] = useState(null);
  useEffect(() => {
    const submit = document.querySelector("form .form-submit");
    if (!submit?.parentElement) return undefined;
    const holder = document.createElement("div");
    submit.parentElement.insertBefore(holder, submit);
    setSlot(holder);
    return () => holder.remove();
  }, []);

  const content = h(
    "div",
    { style: { margin: "12px 0" } },
    setup
      ? h(SetupFromSignIn, { onClose: () => setSetup(false) })
      : showCode
        ? h(
            "div",
            null,
            h(
              "label",
              { style: { display: "block" } },
              h("span", null, "Authentication code"),
              h("input", {
                style: input,
                inputMode: "text",
                autoComplete: "one-time-code",
                autoFocus: true,
                placeholder: "6-digit code or recovery code",
                value: code,
                onChange: (e) => {
                  setCode(e.target.value);
                  keepCode(e.target.value.trim());
                },
              }),
            ),
          )
        : null,
  );

  return slot ? createPortal(content, slot) : content;
}
