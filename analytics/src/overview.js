import { CATEGORIES, TOOLS } from "./providers.js";

// What a site has switched on, in words an admin (and a privacy policy) can use.
// Never includes pasted code, only that a custom script exists.
export function describeTool(row) {
  const def = TOOLS[row?.tool];
  if (!def) return null;
  const category = def.categoryChoosable && row.category ? row.category : def.category;
  // Cookieless analytics loads straight away unless the site chose to ask first.
  const asks = category === "essential" ? false : def.cookies === false && category === "analytics" ? row.askFirst === true : true;
  return {
    tool: row.tool,
    label: row.tool === "custom" ? row.name || def.label : def.label,
    enabled: row.enabled !== false,
    category,
    categoryLabel: CATEGORIES[category],
    cookies: def.cookies,
    asksFirst: asks,
    dashboard: def.dashboard(row.toolId, row.scriptHost),
  };
}

export async function sitesOverview(payload, user) {
  const sites = await payload.find({ collection: "sites", depth: 0, limit: 100, pagination: false, sort: "name", overrideAccess: false, user });
  // One row of settings per site, in the plugin's own collection; a site without a row has set nothing up yet.
  const rows = sites.docs.length
    ? await payload.find({
        collection: "analytics-settings",
        where: { site: { in: sites.docs.map((s) => s.id) } },
        depth: 0,
        limit: 100,
        pagination: false,
        overrideAccess: false,
        user,
      })
    : { docs: [] };
  const settingsOf = new Map(rows.docs.map((r) => [String(typeof r.site === "object" && r.site ? r.site.id : r.site), r]));
  return sites.docs.map((site) => {
    const settings = settingsOf.get(String(site.id));
    return {
      id: site.id,
      name: site.name,
      domain: site.domain,
      settingsId: settings?.id ?? null,
      respectPrivacySignals: settings?.respectPrivacySignals !== false,
      tools: (settings?.tools ?? []).map(describeTool).filter(Boolean),
    };
  });
}
