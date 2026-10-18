import { ProviderError } from "./providers/errors.js";
import { ACTIONS, buildRequest } from "./prompts.js";

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "InputError";
    this.status = status;
  }
}

export function parseJson(text) {
  const s = String(text ?? "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new ProviderError("The model's answer could not be read. Try again.", { status: 502 });
  }
}

// Cuts at a word boundary, so a limit never leaves half a word.
export function clip(text, max) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

export const slugify = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

const add = (a, b) => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });

function requireText(input, name, max) {
  const v = input?.[name];
  if (typeof v !== "string" || !v.trim()) throw new InputError(`Nothing to work with: ${name} is empty.`);
  if (v.length > max) throw new InputError(`That text is too long for AI assist (${v.length} characters; the limit is ${max}). Work on a shorter piece.`, 413);
  return v;
}

// Runs one action. Returns { result, usage, model }; `result` is what the admin shows as a suggestion.
// ctx: { provider, maxInputChars, mask, mcp, pagesConfig }
export async function runAction(action, input, ctx) {
  if (!ACTIONS.includes(action)) throw new InputError(`Unknown action "${action}".`);
  const { provider, maxInputChars, mask = true } = ctx;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let model = provider.model;
  const call = async (request) => {
    const reply = await provider.complete(request);
    usage = add(usage, reply.usage);
    model = reply.model || model;
    return reply;
  };
  const toLexical = (markdown) => (input.richText && ctx.mcp ? ctx.mcp.markdownToLexical(markdown) : undefined);

  if (action === "rewrite") {
    if (input.text) requireText(input, "text", maxInputChars);
    requireText(input, "instruction", 2000);
    const { text } = parseJson((await call(buildRequest("rewrite", input, { mask }))).text);
    if (typeof text !== "string" || !text.trim()) throw new ProviderError("The model returned no text. Try again.");
    return { result: { text: text.trim(), lexical: toLexical(text) }, usage, model };
  }
  if (action === "translate") {
    requireText(input, "text", maxInputChars);
    requireText(input, "to", 80);
    const { text } = parseJson((await call(buildRequest("translate", input, { mask }))).text);
    if (typeof text !== "string" || !text.trim()) throw new ProviderError("The model returned no text. Try again.");
    return { result: { text: text.trim(), lexical: toLexical(text) }, usage, model };
  }
  if (action === "seo") {
    requireText(input, "text", maxInputChars);
    const parsed = parseJson((await call(buildRequest("seo", input, { mask }))).text);
    return { result: { title: clip(parsed.title, 60), description: clip(parsed.description, 155) }, usage, model };
  }
  if (action === "alt") {
    if (!input.image?.base64) throw new InputError("No image to describe.");
    const parsed = parseJson((await call(buildRequest("alt", input, { mask }))).text);
    return { result: { alt: clip(String(parsed.alt ?? "").replace(/^(an? )?(image|picture|photo) of /i, ""), 125) }, usage, model };
  }

  // action === "page"
  if (!ctx.mcp) throw new InputError("Building a page needs the MCP plugin's folder (plugins/mcp) next to this one.", 503);
  requireText(input, "brief", maxInputChars);
  const described = ctx.mcp.describeBlocks(ctx.pagesConfig);
  const skip = (type) => type === "upload" || type === "relationship";
  const offered = described.map((b) => ({ ...b, fields: b.fields.filter((f) => !skip(f.type)) }));
  const dropMedia = (block) => {
    const def = described.find((d) => d.blockType === block?.blockType);
    if (!def) return block;
    const out = { ...block };
    for (const f of def.fields) if (skip(f.type)) delete out[f.name];
    return out;
  };

  let request = buildRequest("page", input, { mask, blocks: offered });
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = parseJson((await call(request)).text);
    try {
      if (!Array.isArray(parsed.blocks) || !parsed.blocks.length) throw new Error("No blocks were returned.");
      const blocks = ctx.mcp.prepareBlocks(ctx.pagesConfig, parsed.blocks.map(dropMedia));
      const title = clip(parsed.title || input.title || "New page", 120);
      return {
        result: { title: input.title?.trim() || title, slug: slugify(input.slug || parsed.slug || title) || "new-page", blocks, blockCount: blocks.length },
        usage,
        model,
      };
    } catch (error) {
      lastError = error;
      request = { ...request, user: `${request.user}\n\nYour previous reply was rejected: ${error.message}\nReply again with corrected JSON.` };
    }
  }
  throw new ProviderError(`The model's page plan did not fit this site's blocks: ${lastError?.message ?? "unknown problem"}`, { status: 422 });
}
