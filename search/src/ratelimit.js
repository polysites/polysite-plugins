// A fixed-window request limiter kept in this process's memory. Search is public and each request reads the database, so one
// address (and the whole server) gets a budget per window; past it the answer is "try again in N seconds", not a database read.
// Memory only is enough here: the budget is about protecting the database from a burst, not about exact accounting, and each
// CMS process counts for itself.

export function createLimiter({ max, windowMs = 60_000, globalMax = max * 20, now = () => Date.now(), maxKeys = 10_000 }) {
  const windows = new Map();
  let all = { start: now(), count: 0 };

  function prune(at) {
    for (const [key, w] of windows) if (at - w.start >= windowMs) windows.delete(key);
    // Under a flood of distinct addresses, drop the oldest rather than grow without bound.
    while (windows.size > maxKeys) windows.delete(windows.keys().next().value);
  }

  return {
    /** Counts one request. `ok` is false when the budget is spent; `retryAfter` is then whole seconds until the window ends. */
    hit(key) {
      const at = now();
      if (at - all.start >= windowMs) all = { start: at, count: 0 };
      if (all.count >= globalMax) return { ok: false, retryAfter: Math.max(1, Math.ceil((all.start + windowMs - at) / 1000)) };
      let w = windows.get(key);
      if (!w || at - w.start >= windowMs) {
        if (windows.size >= maxKeys) prune(at);
        w = { start: at, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((w.start + windowMs - at) / 1000)) };
      w.count += 1;
      all.count += 1;
      return { ok: true, retryAfter: 0 };
    },
  };
}

/**
 * Who is asking. The reverse proxy appends the address it saw to X-Forwarded-For, so the LAST entry is the one a visitor
 * cannot choose; anything before it may have been typed by the visitor.
 */
export function clientKey(headers) {
  const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]);
  const forwarded = String(get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return forwarded.at(-1) || String(get("x-real-ip") ?? "").trim() || "unknown";
}
