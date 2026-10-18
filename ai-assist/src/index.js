import { SLUGS, settingsGlobal, usageCollection } from "./collections.js";
import { createService } from "./service.js";

// AI assist in the editor: suggestions inside the admin for drafting and rewriting text, search titles and descriptions, alt text,
// translation, and building a draft page from a brief. See DESIGN.md.
//
//  - OFF until a Super Admin switches it on and ticks the sites (collections.js); the box does not appear otherwise;
//  - every result is a suggestion the editor accepts into the open form; the only record it creates is a DRAFT page, as the signed-in person;
//  - the model call goes through a provider interface (providers/), Anthropic by default; the key comes from the environment or is stored encrypted;
//  - a `ui` field (no column, no table) puts the box on pages, posts and media; the plugin adds nothing else to any core collection;
//  - own tables only (ai_assist_settings, ai_assist_settings_rels, ai_assist_usage). Removing the plugin deletes nothing.
const PANEL = "../../../plugins/ai-assist/src/admin/AiPanel#AiPanel";
const WITH_BOX = new Set(["pages", "posts", "media"]);

const box = { name: "aiAssist", type: "ui", admin: { components: { Field: PANEL } } };

export default function aiAssistPlugin(incomingConfig, kit) {
  const service = createService({ kit });
  const route = (path, method, handler) => ({ path, method, handler });

  return {
    ...incomingConfig,
    collections: [
      ...(incomingConfig.collections ?? []).map((collection) =>
        WITH_BOX.has(collection.slug) && !(collection.fields ?? []).some((f) => f.name === box.name) ? { ...collection, fields: [box, ...(collection.fields ?? [])] } : collection,
      ),
      usageCollection,
    ],
    globals: [...(incomingConfig.globals ?? []), settingsGlobal],
    endpoints: [
      ...(incomingConfig.endpoints ?? []),
      route("/ai-assist/status", "get", service.status),
      route("/ai-assist/run", "post", service.run),
      route("/ai-assist/usage", "get", service.usage),
      route("/ai-assist/test", "post", service.test),
    ],
    onInit: async (payload) => {
      await incomingConfig.onInit?.(payload);
      service.purge(payload);
      setInterval(() => service.purge(payload), 24 * 60 * 60 * 1000).unref?.();
    },
  };
}

export { SLUGS };
