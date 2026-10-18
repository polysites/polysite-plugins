import { ProviderError } from "./errors.js";

// Any server that speaks the common `/chat/completions` shape (a self-hosted model, a gateway). The base URL is set by a Super Admin.
export function openaiCompatibleProvider({ apiKey, model, baseUrl, fetchImpl = globalThis.fetch }) {
  return {
    id: "openai-compatible",
    model,
    async complete({ system, user, image, schema, maxTokens }) {
      if (!baseUrl) throw new ProviderError("Set the endpoint address in AI assist settings.", { status: 503 });
      const userContent = image
        ? [{ type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.base64}` } }, { type: "text", text: user }]
        : user;
      let res;
      try {
        res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
            ...(schema ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (error) {
        throw new ProviderError("Could not reach the AI endpoint.", { cause: error });
      }
      if (res.status === 401 || res.status === 403) throw new ProviderError("The AI endpoint rejected the API key.");
      if (res.status === 429) throw new ProviderError("The AI endpoint is rate-limiting this install. Try again in a minute.", { status: 429 });
      if (!res.ok) throw new ProviderError(`The AI endpoint answered ${res.status}.`);
      const json = await res.json().catch(() => null);
      const choice = json?.choices?.[0];
      if (choice?.finish_reason === "length") throw new ProviderError("The answer was cut off because it was too long. Try a smaller piece of text.", { status: 422 });
      return {
        text: choice?.message?.content ?? "",
        usage: { inputTokens: json?.usage?.prompt_tokens ?? 0, outputTokens: json?.usage?.completion_tokens ?? 0 },
        model: json?.model ?? model,
      };
    },
  };
}
