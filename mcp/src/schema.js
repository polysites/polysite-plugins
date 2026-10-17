import { markdownToLexical } from "./markdown.js";

const hidden = (field) => field.admin?.hidden === true || field.virtual === true;

// A compact description of a field list, for an agent to read: names, types, options, and what a relationship points at.
export function describeFields(fields = []) {
  const out = [];
  for (const field of fields) {
    if (!field.name || hidden(field) || field.type === "ui") continue;
    const entry = { name: field.name, type: field.type };
    if (field.required) entry.required = true;
    if (field.type === "richText") entry.note = "Send Markdown text; it is converted for you.";
    if (field.type === "upload" || field.type === "relationship") entry.relationTo = field.relationTo;
    if (field.options) entry.options = field.options.map((o) => (typeof o === "string" ? o : o.value));
    if (field.type === "array" || field.type === "group") entry.fields = describeFields(field.fields);
    out.push(entry);
  }
  return out;
}

export function blocksOf(pagesConfig) {
  const content = (pagesConfig.fields ?? []).find((f) => f.type === "blocks" && f.name === "content");
  return content?.blocks ?? [];
}

export function describeBlocks(pagesConfig) {
  return blocksOf(pagesConfig).map((b) => ({
    blockType: b.slug,
    label: b.labels?.singular ?? b.slug,
    fields: describeFields(b.fields),
  }));
}

// Walks data alongside its field definitions and turns every Markdown string in a richText field into Lexical.
export function convertRichText(fields = [], data) {
  if (!data || typeof data !== "object") return data;
  const next = { ...data };
  for (const field of fields) {
    if (!field.name || !(field.name in next)) continue;
    const value = next[field.name];
    if (field.type === "richText" && typeof value === "string") next[field.name] = markdownToLexical(value);
    else if (field.type === "array" && Array.isArray(value)) next[field.name] = value.map((row) => convertRichText(field.fields, row));
    else if (field.type === "group" && value && typeof value === "object") next[field.name] = convertRichText(field.fields, value);
  }
  return next;
}

// Validates and converts a list of blocks against the Pages blocks field. Throws a message an agent can act on.
export function prepareBlocks(pagesConfig, blocks = []) {
  const known = new Map(blocksOf(pagesConfig).map((b) => [b.slug, b]));
  return blocks.map((block, i) => {
    const def = known.get(block?.blockType);
    if (!def) throw new Error(`Block ${i + 1}: unknown blockType "${block?.blockType}". Known: ${[...known.keys()].join(", ")}. Call polysite_describe_blocks first.`);
    const { blockType, ...rest } = block;
    const names = new Set(def.fields.map((f) => f.name));
    const stray = Object.keys(rest).filter((k) => !names.has(k));
    if (stray.length) throw new Error(`Block ${i + 1} (${blockType}): unknown field(s) ${stray.join(", ")}. Valid: ${[...names].join(", ")}.`);
    return { blockType, ...convertRichText(def.fields, rest) };
  });
}
