// Cost and rate rules. Pure functions over numbers so they can be tested without a database.
export const DEFAULTS = {
  maxRequestsPerSitePerDay: 500,
  maxTokensPerSitePerMonth: 3_000_000,
  maxRequestsPerUserPerMinute: 10,
  maxInputChars: 20_000,
  inputPricePerMTok: 4,
  outputPricePerMTok: 20,
  usageRetentionDays: 90,
};

export const limitOf = (settings, name) => {
  const v = Number(settings?.[name]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULTS[name];
};

export const startOfDay = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
export const startOfMonth = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export function estimateCost(settings, inputTokens, outputTokens) {
  return (inputTokens * limitOf(settings, "inputPricePerMTok") + outputTokens * limitOf(settings, "outputPricePerMTok")) / 1_000_000;
}

// Returns null when the request may go ahead, otherwise a message an editor can read.
export function checkSiteLimits(settings, { requestsToday, tokensThisMonth }) {
  if (requestsToday >= limitOf(settings, "maxRequestsPerSitePerDay")) return "This site has used its AI assist requests for today. Try again tomorrow, or ask a Super Admin to raise the limit.";
  if (tokensThisMonth >= limitOf(settings, "maxTokensPerSitePerMonth")) return "This site has used its AI assist budget for this month. A Super Admin can raise it in AI assist settings.";
  return null;
}

// Per-person sliding window, in memory (per CMS process).
export function createRateLimiter() {
  const hits = new Map();
  return {
    take(key, max, now = Date.now(), windowMs = 60_000) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
