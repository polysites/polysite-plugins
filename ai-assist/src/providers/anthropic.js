import { ProviderError } from "./errors.js";

// The default provider: Claude through the official SDK. Notes from the API reference this was written against:
//  - no `thinking` and no sampling parameters (current models reject the old ones); depth is controlled with `output_config.effort`;
//  - JSON replies use `output_config.format` (structured outputs), so a reply always parses;
//  - `stop_reason: "refusal"` and `"max_tokens"` are reported, not read as an answer;
//  - `refusalFallback` (off by default, a setting) retries a policy refusal on a fallback model server-side (beta `server-side-fallback-2026-07-01`).
export function anthropicProvider({ apiKey, model, baseUrl, refusalFallback, clientFactory }) {
  let client;
  const getClient = async () => {
    if (client) return client;
    if (clientFactory) return (client = clientFactory({ apiKey, baseUrl }));
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return (client = new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}), maxRetries: 1, timeout: 90_000 }));
  };

  return {
    id: "anthropic",
    model,
    async complete({ system, user, image, schema, maxTokens, effort }) {
      const content = [];
      if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
      content.push({ type: "text", text: user });
      const body = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
        output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
      };
      let response;
      try {
        const c = await getClient();
        response = refusalFallback ? await c.beta.messages.create({ ...body, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }) : await c.messages.create(body);
      } catch (error) {
        const status = error?.status;
        if (status === 401 || status === 403) throw new ProviderError("The provider rejected the API key. A Super Admin can replace it in AI assist settings.", { status: 502, cause: error });
        if (status === 429) throw new ProviderError("The provider is rate-limiting this install. Try again in a minute.", { status: 429, cause: error });
        if (status === 400 || status === 404) throw new ProviderError(`The provider refused the request (${status}): ${String(error?.message ?? "").slice(0, 300)}`, { status: 502, cause: error });
        throw new ProviderError("Could not reach the provider. Try again shortly.", { status: 502, cause: error });
      }
      if (response.stop_reason === "refusal") throw new ProviderError("The model declined this request. Reword it and try again.", { status: 422 });
      if (response.stop_reason === "max_tokens") throw new ProviderError("The answer was cut off because it was too long. Try a smaller piece of text.", { status: 422 });
      const text = (response.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      return { text, usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 }, model: response.model ?? model };
    },
  };
}
