// When to retry, how long to wait, and when an endpoint is given up on. Pure functions of numbers, so each rule is tested on
// its own (test/webhooks.test.js); deliver.js only applies the decision.

const int = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Attempts per delivery (the first send counts), the first wait, and how many failed attempts in a row switch an endpoint off.
// The environment overrides exist so the end-to-end check can run in seconds; the defaults are for real receivers: waits of
// 30 s, 1 min, 2 min, 4 min and 8 min between six attempts (about 15 minutes in all).
export const MAX_ATTEMPTS = int("WEBHOOKS_MAX_ATTEMPTS", 6);
export const BASE_DELAY_MS = int("WEBHOOKS_RETRY_DELAY_MS", 30_000);
export const DISABLE_AFTER = int("WEBHOOKS_DISABLE_AFTER", 10);
export const LOG_DAYS = int("WEBHOOKS_LOG_DAYS", 30);
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

// Wait after the given (1-based) failed attempt: base, 2 x base, 4 x base ... capped at six hours.
export const backoffMs = (attempt, base = BASE_DELAY_MS) => Math.min(base * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);

// Whether sending the same thing again could help. A receiver that is down, slow or overloaded (network error, timeout, 5xx,
// 408, 429) may come back; one that refuses the request (other 4xx), redirects (never followed) or sits at an address that is
// not allowed will answer the same way every time.
export function isRetryable({ kind, status }) {
  if (kind === "network" || kind === "timeout") return true;
  if (kind === "http") return status >= 500 || status === 408 || status === 429;
  return false; // "blocked", "redirect", "invalid"
}

// What to do after a failed attempt. `consecutiveFailures` already includes this one.
export function decideAfterFailure({ attempt, maxAttempts = MAX_ATTEMPTS, retryable, consecutiveFailures, disableAfter = DISABLE_AFTER }) {
  if (consecutiveFailures >= disableAfter) return { disable: true, retry: false, status: "failed" };
  if (retryable && attempt < maxAttempts) return { disable: false, retry: true, status: "retrying", waitMs: backoffMs(attempt) };
  return { disable: false, retry: false, status: "failed" };
}

export const cutoffDate = (now, days = LOG_DAYS) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
