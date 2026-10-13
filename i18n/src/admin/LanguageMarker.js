"use client";
import { useEffect } from "react";

// Draws nothing. Sets data-polysite-multilingual on <html> when the signed-in person can write in more than one language, which
// is what shows the admin's language picker and the language beside each translatable field (the core hides both for one
// language, see custom.scss). Checked on load, when the window regains focus, and every 20 seconds, so switching site picks it up.
export function LanguageMarker() {
  useEffect(() => {
    let stopped = false;
    const check = () =>
      fetch("/api/i18n/status", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { multilingual: false }))
        .then((d) => {
          if (stopped) return;
          if (d.multilingual) document.documentElement.setAttribute("data-polysite-multilingual", "true");
          else document.documentElement.removeAttribute("data-polysite-multilingual");
        })
        .catch(() => {});
    check();
    const timer = setInterval(check, 20000);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);
  return null;
}
