// Read-only endpoints behind the Analytics screen and the per-form summary.
// Any signed-in user may ask; what comes back is limited by their own access.
import { formSubmissionCounts } from "./counts.js";
import { sitesOverview } from "./overview.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const guarded = (name, run) => async (req) => {
  if (!req.user) return json({ message: "Sign in first." }, 401);
  try {
    return json(await run(req));
  } catch (err) {
    req.payload.logger.error(`[analytics] ${name} failed: ${err.message}`);
    return json({ message: "Couldn't load that." }, 500);
  }
};

// GET /api/analytics/form-counts           every form the user can see
// GET /api/analytics/form-counts?form=ID   one form
export const formCountsEndpoint = {
  path: "/analytics/form-counts",
  method: "get",
  handler: guarded("form counts", (req) => {
    const form = new URL(req.url).searchParams.get("form");
    return formSubmissionCounts(req.payload, req.user, new Date(), form || null);
  }),
};

// GET /api/analytics/overview: form counts plus each site's tracking tools.
export const overviewEndpoint = {
  path: "/analytics/overview",
  method: "get",
  handler: guarded("overview", async (req) => ({
    ...(await formSubmissionCounts(req.payload, req.user)),
    sites: await sitesOverview(req.payload, req.user),
  })),
};

export const analyticsEndpoints = [formCountsEndpoint, overviewEndpoint];
