import { cleanQuery, MIN_QUERY, pageNumber } from "./query.js";
import { clientKey, createLimiter } from "./ratelimit.js";
import { readSettings, searchSite } from "./search.js";

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

// Searches per address per minute. Each search reads the index and the matching documents, so the budget is modest: a person
// searching by hand never reaches it. POLYSITE_SEARCH_RATE_LIMIT changes it (0 or less switches the limit off, for tests).
const perMinute = () => {
  const n = Number.parseInt(process.env.POLYSITE_SEARCH_RATE_LIMIT ?? "", 10);
  return Number.isFinite(n) ? n : 30;
};

const siteByDomain = (payload, domain) =>
  payload
    .find({
      collection: "sites",
      where: { domain: { equals: domain } },
      depth: 0,
      limit: 1,
      pagination: false,
      overrideAccess: true,
      select: { domain: true, enabledModules: true },
    })
    .then((res) => res.docs?.[0] ?? null);

// GET /api/site-search?domain=example.org&q=budget[&lang=fr][&page=2]
//
// Public. It answers only for the site whose `domain` is given, only with published items of that site, in the language asked
// for (when the site offers it) with the site's default as the fallback. Drafts and other sites' content never appear: the
// index only says where to look, and every result is re-read from its live document as an anonymous visitor (search.js).
export function searchEndpoint(options = {}) {
  const limiter = options.limiter ?? createLimiter({ max: Math.max(1, perMinute()) });
  return {
    path: "/site-search",
    method: "get",
    handler: async (req) => {
      if (perMinute() > 0) {
        const verdict = limiter.hit(clientKey(req.headers));
        if (!verdict.ok) return json({ message: "Too many searches. Try again in a moment.", retryAfter: verdict.retryAfter }, 429, { "Retry-After": String(verdict.retryAfter) });
      }
      const params = new URL(req.url).searchParams;
      const domain = String(params.get("domain") ?? "").trim().toLowerCase().slice(0, 253);
      if (!domain) return json({ message: "Say which site to search (domain)." }, 400);
      try {
        const site = await siteByDomain(req.payload, domain);
        if (!site || !readSettings(site).enabled) return json({ message: "Search is not available on this site." }, 404);
        const { q, terms, tooShort } = cleanQuery(params.get("q"));
        if (tooShort) return json({ q, tooShort: true, minLength: MIN_QUERY, total: 0, totalPages: 0, page: 1, results: [] });
        const found = await searchSite(req.payload, { site, q, terms, lang: params.get("lang"), page: pageNumber(params.get("page")) });
        return json({ q, tooShort: false, ...found });
      } catch (err) {
        req.payload.logger.error(`[search] search failed: ${err.message}`);
        return json({ message: "Search is not working right now." }, 500);
      }
    },
  };
}
