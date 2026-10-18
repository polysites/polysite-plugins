import { ProviderError } from "./errors.js";
import { anthropicProvider } from "./anthropic.js";
import { openaiCompatibleProvider } from "./openai-compatible.js";

// A provider is `{ id, model, complete(request) }`:
//   request  = { system, user, image?: { mediaType, base64 }, schema?: JSON Schema, maxTokens, effort: "low" | "medium" | "high" }
//   returns  = { text, usage: { inputTokens, outputTokens }, model }
// and throws a ProviderError (below) whose message is safe to show an editor. Adding a provider is one file here plus one line in PROVIDERS.
export { ProviderError };

export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", create: anthropicProvider },
  "openai-compatible": { label: "OpenAI-compatible endpoint", create: openaiCompatibleProvider },
};

export const DEFAULT_MODEL = "claude-opus-5-5";

// The environment wins over the stored key, so an install can keep the key out of the database entirely.
export function resolveApiKey(storedKey, env = process.env) {
  return env.AI_ASSIST_API_KEY || env.ANTHROPIC_API_KEY || storedKey || "";
}

export function createProvider(settings, { storedKey = "", env = process.env, overrides = {} } = {}) {
  const id = settings?.provider || "anthropic";
  const entry = PROVIDERS[id];
  if (!entry) throw new ProviderError(`Unknown provider "${id}".`, { status: 500 });
  const apiKey = resolveApiKey(storedKey, env);
  if (!apiKey && id === "anthropic") throw new ProviderError("No API key is set. A Super Admin can add one in AI assist settings, or set AI_ASSIST_API_KEY on the server.", { status: 503 });
  return entry.create({ apiKey, model: settings?.model || DEFAULT_MODEL, baseUrl: settings?.baseUrl || env.AI_ASSIST_BASE_URL || "", refusalFallback: settings?.refusalFallback === true, ...overrides });
}
