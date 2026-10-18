import fs from "node:fs/promises";
import path from "node:path";

import { InputError, runAction } from "./actions.js";
import { SLUGS } from "./collections.js";
import { checkSiteLimits, createRateLimiter, estimateCost, limitOf, startOfDay, startOfMonth } from "./limits.js";
import { loadMcp } from "./mcp.js";
import { ProviderError, createProvider } from "./providers/index.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Which collections each action may touch. The text and image of anything else are never read: this list is the whole reach of the plugin.
export const TARGETS = {
  rewrite: ["pages", "posts"],
  seo: ["pages", "posts"],
  translate: ["pages", "posts"],
  alt: ["media"],
  page: ["pages"],
};
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const idOf = (v) => String(v && typeof v === "object" ? v.id : v);

export function createService({ kit, mcpLoader = loadMcp, providerFactory = createProvider, limiter = createRateLimiter(), readFile = fs.readFile } = {}) {
  const loadSettings = (payload) => payload.findGlobal({ slug: SLUGS.settings, overrideAccess: true, depth: 0, context: { revealAiSecrets: true } });

  const siteAllowed = (settings, siteId) => settings?.enabled === true && (settings.sites ?? []).some((s) => idOf(s) === String(siteId));

  async function usageTotals(payload, siteId, now = new Date()) {
    const base = { site: { equals: siteId }, ok: { equals: true } };
    const today = await payload.count({ collection: SLUGS.usage, where: { ...base, createdAt: { greater_than_equal: startOfDay(now).toISOString() } }, overrideAccess: true });
    const month = await payload.find({
      collection: SLUGS.usage,
      where: { ...base, createdAt: { greater_than_equal: startOfMonth(now).toISOString() } },
      pagination: false,
      depth: 0,
      select: { inputTokens: true, outputTokens: true },
      overrideAccess: true,
    });
    const inputTokens = month.docs.reduce((n, d) => n + (d.inputTokens ?? 0), 0);
    const outputTokens = month.docs.reduce((n, d) => n + (d.outputTokens ?? 0), 0);
    return { requestsToday: today.totalDocs, requestsThisMonth: month.docs.length, inputTokens, outputTokens, tokensThisMonth: inputTokens + outputTokens };
  }

  const can = (user, collection, docId) => kit.hasCapability(user, collection, docId ? "update" : "create");

  // GET /api/ai-assist/status?site=ID&collection=pages&id=ID: what the box in the admin may offer. No secrets.
  async function status(req) {
    if (!req.user) return json({ enabled: false, message: "Sign in first." }, 401);
    const url = new URL(req.url);
    const siteId = url.searchParams.get("site");
    const collection = url.searchParams.get("collection") ?? "";
    const docId = url.searchParams.get("id");
    const settings = await loadSettings(req.payload);
    if (!siteId || !siteAllowed(settings, siteId)) return json({ enabled: false });
    if (!(await memberOf(req, siteId))) return json({ enabled: false });
    const actions = Object.entries(TARGETS)
      .filter(([action, targets]) => targets.includes(collection) && (action === "alt" ? Boolean(docId) : true))
      .filter(([action]) => (action === "page" ? kit.hasCapability(req.user, "pages", "create") : can(req.user, collection, docId)))
      .map(([action]) => action);
    const mcp = await mcpLoader();
    const locales = (req.payload.config.localization?.locales ?? []).map((l) => (typeof l === "string" ? l : l.code));
    return json({ enabled: actions.length > 0, actions, richText: Boolean(mcp), pageBuilder: Boolean(mcp), locales });
  }

  // Payload checks site membership on the read; a site the person does not belong to is not found.
  const memberOf = (req, siteId) => req.payload.findByID({ collection: "sites", id: siteId, depth: 0, overrideAccess: false, user: req.user, req }).catch(() => null);

  async function imageOf(req, docId, siteId) {
    const doc = await req.payload.findByID({ collection: "media", id: docId, depth: 0, overrideAccess: false, user: req.user, req }).catch(() => null);
    if (!doc) throw new InputError("That image was not found, or you may not use it.", 404);
    if (doc.site && idOf(doc.site) !== String(siteId)) throw new InputError("That image belongs to another site.", 403);
    if (!IMAGE_TYPES.has(doc.mimeType)) throw new InputError("AI assist can describe JPEG, PNG, GIF and WebP images.", 415);
    const staticDir = req.payload.collections.media.config.upload?.staticDir ?? "media";
    const file = path.resolve(staticDir, path.basename(String(doc.filename ?? "")));
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      throw new InputError("The image file could not be read.", 404);
    }
    if (bytes.length > MAX_IMAGE_BYTES) throw new InputError("That image is over 5 MB, too large to send. Use a smaller version.", 413);
    return { mediaType: doc.mimeType, base64: Buffer.from(bytes).toString("base64"), doc };
  }

  async function record(payload, row) {
    try {
      await payload.create({ collection: SLUGS.usage, data: row, overrideAccess: true });
    } catch (error) {
      payload.logger?.warn?.(`[ai-assist] could not write the usage log: ${error?.message ?? error}`);
    }
  }

  // POST /api/ai-assist/run { action, siteId, collection, docId?, ...input }
  async function run(req) {
    if (!req.user) return json({ message: "Sign in first." }, 401);
    const body = (await req.json?.().catch(() => null)) ?? {};
    const { action, siteId, collection, docId, ...input } = body;
    const fail = (message, status) => json({ ok: false, message }, status);

    const targets = TARGETS[action];
    if (!targets) return fail(`Unknown action "${action}".`, 400);
    if (!targets.includes(collection)) return fail("AI assist cannot be used on that kind of content.", 400);
    if (!siteId) return fail("Choose a site first.", 400);

    const settings = await loadSettings(req.payload);
    if (!siteAllowed(settings, siteId)) return fail("AI assist is not switched on for this site.", 403);

    const allowed = action === "page" ? kit.hasCapability(req.user, "pages", "create") : can(req.user, collection, docId);
    if (!allowed) return fail("Your role does not allow this.", 403);
    if (!(await memberOf(req, siteId))) return fail("You do not belong to that site.", 403);

    if (!limiter.take(`${req.user.id}`, limitOf(settings, "maxRequestsPerUserPerMinute"))) return fail("Too many requests in a minute. Wait a little and try again.", 429);
    const totals = await usageTotals(req.payload, siteId);
    const limited = checkSiteLimits(settings, totals);
    if (limited) return fail(limited, 429);

    const row = { site: siteId, user: req.user.id, action, collection, docId: docId ? String(docId) : undefined };
    try {
      const provider = providerFactory(settings, { storedKey: settings.apiKey });
      const mcp = await mcpLoader();
      const maxInputChars = limitOf(settings, "maxInputChars");
      if (action === "alt") {
        const image = await imageOf(req, docId, siteId);
        input.image = { mediaType: image.mediaType, base64: image.base64 };
      }
      const { result, usage, model } = await runAction(action, input, {
        provider,
        maxInputChars,
        mask: settings.maskPersonalData !== false,
        mcp,
        pagesConfig: req.payload.collections.pages.config,
      });

      let created;
      if (action === "page") {
        // Always a draft, saved as the signed-in person: their role and site decide whether it is allowed.
        req.query = { ...req.query, draft: "true" };
        const doc = await req.payload.create({
          collection: "pages",
          data: { site: siteId, title: result.title, slug: result.slug, content: result.blocks, _status: "draft" },
          draft: true,
          overrideAccess: false,
          user: req.user,
          req,
        });
        created = { id: doc.id, adminUrl: `/admin/collections/pages/${doc.id}` };
      }
      await record(req.payload, { ...row, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ok: true });
      const { blocks, ...shown } = result;
      return json({ ok: true, action, result: shown, created, usage, model, estimatedCost: estimateCost(settings, usage.inputTokens, usage.outputTokens) });
    } catch (error) {
      const message = error instanceof InputError || error instanceof ProviderError ? error.message : String(error?.message ?? error).split("\n")[0].slice(0, 300);
      const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
      req.payload.logger?.warn?.(`[ai-assist] ${action} failed: ${message}`);
      await record(req.payload, { ...row, ok: false, error: message.slice(0, 200) });
      return fail(message, status >= 400 && status < 600 ? status : 500);
    }
  }

  // GET /api/ai-assist/usage: this month per site, for the settings page (Super Admin).
  async function usage(req) {
    if (!req.user?.isSuperAdmin) return json({ message: "Forbidden" }, 403);
    const settings = await loadSettings(req.payload);
    const sites = await req.payload.find({ collection: "sites", pagination: false, depth: 0, overrideAccess: true, select: { name: true, domain: true } });
    const rows = [];
    for (const s of sites.docs) {
      if (!siteAllowed(settings, s.id)) continue;
      const t = await usageTotals(req.payload, s.id);
      rows.push({ site: s.name ?? s.domain ?? s.id, ...t, estimatedCost: estimateCost(settings, t.inputTokens, t.outputTokens), tokenBudget: limitOf(settings, "maxTokensPerSitePerMonth"), dailyLimit: limitOf(settings, "maxRequestsPerSitePerDay") });
    }
    const keySource = process.env.AI_ASSIST_API_KEY || process.env.ANTHROPIC_API_KEY ? "environment" : settings.apiKey ? "settings" : "none";
    return json({ enabled: settings.enabled === true, keySource, rows });
  }

  // POST /api/ai-assist/test: one tiny request to prove the key and model work (Super Admin).
  async function test(req) {
    if (!req.user?.isSuperAdmin) return json({ message: "Forbidden" }, 403);
    const settings = await loadSettings(req.payload);
    try {
      const provider = providerFactory(settings, { storedKey: settings.apiKey });
      const reply = await provider.complete({
        system: "Reply with a JSON object only.",
        user: 'Reply with {"ok": true}.',
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
        maxTokens: 50,
        effort: "low",
      });
      return json({ ok: true, model: reply.model, usage: reply.usage });
    } catch (error) {
      return json({ ok: false, message: error instanceof ProviderError ? error.message : String(error?.message ?? error).split("\n")[0] }, 502);
    }
  }

  async function purge(payload) {
    const settings = await loadSettings(payload).catch(() => null);
    const days = limitOf(settings, "usageRetentionDays");
    await payload.delete({ collection: SLUGS.usage, where: { createdAt: { less_than: new Date(Date.now() - days * 86_400_000).toISOString() } }, overrideAccess: true }).catch(() => {});
  }

  return { status, run, usage, test, purge, loadSettings };
}
