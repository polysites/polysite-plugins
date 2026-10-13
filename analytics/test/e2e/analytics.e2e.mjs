// End-to-end check of the analytics plugin's per-site settings (its own `analytics-settings` collection, the core's
// `site.extensions.analytics`, the overview endpoint) against a RUNNING stack. It writes a settings row for the dev site,
// asks the way a visitor does (no sign-in) and removes the row again.
//
//   BASE=http://cms:3001 WEB=http://web:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... SITE_ID=1 SITE_HOST=voidslate.localhost \
//     node plugins/analytics/test/e2e/analytics.e2e.mjs
//
// Needs the core and the analytics plugin.
import http from "node:http";

const BASE = process.env.BASE;
const WEB = process.env.WEB;
const SITE_ID = Number(process.env.SITE_ID ?? 1);
const SITE_HOST = process.env.SITE_HOST ?? "voidslate.localhost";
const PUBLIC_KEYS = ["tools", "respectPrivacySignals", "consentNotice"];
const results = [];
const ok = (name, cond, extra = "") => {
  results.push(cond);
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + String(extra).slice(0, 400)}`);
};

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `JWT ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

// A page on the public site as a visitor would ask for it (fetch() won't let a script set Host, and the site is picked by it).
function visit(path, host = SITE_HOST) {
  const url = new URL(WEB);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path, method: "GET", headers: { Host: host } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const login = await api("POST", "/api/users/login", { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
const admin = login.json?.token;
ok("admin signs in", Boolean(admin));

const marker = `e2e${Date.now().toString(36)}`;
const SECRET_CODE = `/* ${marker} */ window.__e2eChat = 1;`;
let rowId = null;
const publicSite = async () => (await api("GET", `/api/sites/${SITE_ID}?depth=0`)).json;

try {
  // ---- off until set up ---------------------------------------------------------------------------------------------
  const existing = (await api("GET", `/api/analytics-settings?where[site][equals]=${SITE_ID}&depth=0`, { token: admin })).json?.docs ?? [];
  ok("the dev site has no tracking settings to start with", existing.length === 0, JSON.stringify(existing).slice(0, 200));
  const bare = await publicSite();
  ok("a site without a settings row has no extension and no analytics field on the site", bare?.extensions?.analytics === undefined && !("analytics" in (bare ?? {})), JSON.stringify(bare?.extensions));

  const anon = await api("GET", "/api/analytics-settings");
  ok("the settings collection is not readable without signing in", anon.status === 401 || anon.status === 403, `${anon.status}`);
  const anonWrite = await api("POST", "/api/analytics-settings", { body: { site: SITE_ID, tools: [] } });
  ok("and not writable", anonWrite.status === 401 || anonWrite.status === 403, `${anonWrite.status}`);

  // ---- validation is the plugin's own -------------------------------------------------------------------------------
  const badId = await api("POST", "/api/analytics-settings", { token: admin, body: { site: SITE_ID, tools: [{ tool: "ga4", toolId: "UA-12345-1" }] } });
  ok("a Google Analytics ID in the wrong format is refused", badId.status === 400, `${badId.status} ${JSON.stringify(badId.json)}`);
  const noCode = await api("POST", "/api/analytics-settings", { token: admin, body: { site: SITE_ID, tools: [{ tool: "custom", name: "Empty" }] } });
  ok("a custom script with no code is refused", noCode.status === 400, `${noCode.status}`);
  const badHost = await api("POST", "/api/analytics-settings", { token: admin, body: { site: SITE_ID, tools: [{ tool: "plausible", toolId: "example.org", scriptHost: "http://stats.example.org/x" }] } });
  ok("a self-hosted address that is not a bare https origin is refused", badHost.status === 400, `${badHost.status}`);

  // ---- configured tools reach the public site -----------------------------------------------------------------------
  const created = await api("POST", "/api/analytics-settings", {
    token: admin,
    body: {
      site: SITE_ID,
      respectPrivacySignals: true,
      consentNotice: `Notice ${marker}`,
      tools: [
        { tool: "plausible", toolId: "example.org" },
        { tool: "ga4", toolId: "G-ABC123XYZ9" },
        { tool: "custom", name: "E2E chat", category: "marketing", placement: "body", code: SECRET_CODE },
      ],
    },
  });
  rowId = created.json?.doc?.id ?? null;
  ok("a site administrator can save the tracking tools", created.status === 201 && Boolean(rowId), `${created.status} ${JSON.stringify(created.json)?.slice(0, 300)}`);

  const second = await api("POST", "/api/analytics-settings", { token: admin, body: { site: SITE_ID, tools: [] } });
  if (second.json?.doc?.id) await api("DELETE", `/api/analytics-settings/${second.json.doc.id}`, { token: admin });
  ok("a site cannot have a second settings row", second.status >= 400, `${second.status}`);

  const site = await publicSite();
  const ext = site?.extensions?.analytics;
  ok("the site carries its settings as extensions.analytics", ext?.tools?.length === 3 && ext.consentNotice === `Notice ${marker}` && ext.respectPrivacySignals === true, JSON.stringify(ext)?.slice(0, 300));
  ok("the tools arrive with their ids", ext?.tools?.[0]?.toolId === "example.org" && ext?.tools?.[1]?.toolId === "G-ABC123XYZ9" && ext?.tools?.[2]?.code === SECRET_CODE, JSON.stringify(ext?.tools));
  ok("nothing but the declared public fields comes with it (no site, no row id, no timestamps)", Object.keys(ext ?? {}).every((k) => PUBLIC_KEYS.includes(k)), Object.keys(ext ?? {}).join(","));
  ok("and nothing was added to the site itself", !("analytics" in (site ?? {})), Object.keys(site ?? {}).join(","));

  const list = await api("GET", `/api/sites?where[domain][equals]=${SITE_HOST}&depth=0`);
  const listed = list.json?.docs?.[0];
  ok("the sites list carries the same extension, with only the declared fields", Boolean(listed?.extensions?.analytics) && Object.keys(listed.extensions.analytics).every((k) => PUBLIC_KEYS.includes(k)), JSON.stringify(listed?.extensions));
  const rowAnon = await api("GET", `/api/analytics-settings/${rowId}`);
  ok("and the row itself stays closed to the public", rowAnon.status === 401 || rowAnon.status === 403, `${rowAnon.status}`);

  // The web app renders the page with the settings in the page payload (_payload.json, which the HTML points to); the tools
  // themselves are added in the browser only.
  let html = "";
  let payload = "";
  for (let i = 0; i < 10; i++) {
    html = (await visit("/")).text;
    payload = (await visit("/_payload.json")).text;
    if (payload.includes("G-ABC123XYZ9")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok("the public page is given the configured tools", payload.includes("G-ABC123XYZ9") && payload.includes(`Notice ${marker}`), payload.slice(0, 200));
  ok("but server rendering never adds a tracking script", !/<script[^>]+(googletagmanager|plausible\.io)/i.test(html));

  // ---- the overview endpoint reads the same row ---------------------------------------------------------------------
  const overview = await api("GET", "/api/analytics/overview", { token: admin });
  const mine = overview.json?.sites?.find((s) => s.id === SITE_ID);
  ok("the overview lists the site's tools from the settings collection", overview.status === 200 && mine?.settingsId === rowId && mine.tools.map((t) => t.tool).join() === "plausible,ga4,custom", JSON.stringify(mine));
  ok("and never shows pasted code", !JSON.stringify(overview.json).includes(marker));
  ok("and says which tools ask first", mine?.tools?.find((t) => t.tool === "plausible")?.asksFirst === false && mine?.tools?.find((t) => t.tool === "ga4")?.asksFirst === true);
  ok("the overview needs a sign-in", (await api("GET", "/api/analytics/overview")).status === 401);

  // ---- removing the row switches everything off ---------------------------------------------------------------------
  const del = await api("DELETE", `/api/analytics-settings/${rowId}`, { token: admin });
  rowId = null;
  ok("the settings can be deleted", del.status === 200, `${del.status}`);
  const after = await publicSite();
  ok("and the site goes back to having no extension", after?.extensions?.analytics === undefined, JSON.stringify(after?.extensions));
  let gone = "";
  for (let i = 0; i < 10; i++) {
    gone = (await visit("/_payload.json")).text;
    if (!gone.includes("G-ABC123XYZ9")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok("and the public page stops being given the tools", !gone.includes("G-ABC123XYZ9"));
} finally {
  if (rowId) await api("DELETE", `/api/analytics-settings/${rowId}`, { token: admin });
}

const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
