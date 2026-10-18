// Finds the prose of a document that still needs a translation, and puts the translation back. Pure functions over a collection's
// field configuration and two plain objects (the document read in the source language, and in the target language with no fallback),
// so each rule is tested without Payload.
//
// Only fields the core marked `localized` and whose type is prose (text, textarea, rich text) are touched. Everything else (links,
// addresses, pictures, the order and shape of blocks) is shared by every language and left exactly as it is.

const PROSE = new Set(["text", "textarea", "richText"]);

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isBlank = (value) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

// The text nodes of a Lexical rich-text value, in reading order. Code is left alone.
export function lexicalTextNodes(value) {
  const nodes = [];
  const visit = (node) => {
    if (!isObject(node) || node.type === "code") return;
    if (node.type === "text" && typeof node.text === "string") nodes.push(node);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(value?.root);
  return nodes;
}

const richTextEmpty = (value) => !isObject(value) || !lexicalTextNodes(value).some((n) => n.text.trim() !== "");

/**
 * Plans the translation of one document. `source` is the document in the source language, `target` in the target language read
 * without fallback. Returns:
 *   texts   the strings to translate, in order (only text that has something to translate and no translation yet, unless `overwrite`)
 *   apply   (translated: string[]) => patch, the top-level fields to save in the target language (a copy; nothing is mutated)
 */
export function planTranslation(fields, source, target, { overwrite = false } = {}) {
  const copy = clone(target) ?? {};
  const texts = [];
  const setters = [];

  const take = (text, set) => {
    texts.push(text);
    setters.push(set);
  };

  const leaf = (field, src, tgt, key) => {
    const value = src?.[key];
    if (field.type === "richText") {
      if (richTextEmpty(value) || !(overwrite || richTextEmpty(tgt[key]))) return;
      // The translation is the source's structure (marks, links, headings) with its text replaced, node by node.
      const rebuilt = clone(value);
      for (const node of lexicalTextNodes(rebuilt)) {
        if (node.text.trim() === "") continue;
        take(node.text, (translated) => {
          node.text = translated;
        });
      }
      tgt[key] = rebuilt;
      return;
    }
    if (typeof value !== "string" || value.trim() === "" || !(overwrite || isBlank(tgt[key]))) return;
    take(value, (translated) => {
      tgt[key] = translated;
    });
  };

  const walk = (list, src, tgt) => {
    if (!Array.isArray(list) || !isObject(src) || !isObject(tgt)) return;
    for (const field of list) {
      switch (field.type) {
        case "row":
        case "collapsible":
          walk(field.fields, src, tgt);
          break;
        case "tabs":
          for (const tab of field.tabs ?? []) {
            if (tab.name) {
              if (!isObject(src[tab.name])) continue;
              if (!isObject(tgt[tab.name])) tgt[tab.name] = {};
              walk(tab.fields, src[tab.name], tgt[tab.name]);
            } else walk(tab.fields, src, tgt);
          }
          break;
        case "group":
          if (field.name && isObject(src[field.name])) {
            if (!isObject(tgt[field.name])) tgt[field.name] = {};
            walk(field.fields, src[field.name], tgt[field.name]);
          }
          break;
        case "array":
        case "blocks": {
          const items = src[field.name];
          if (!field.name || !Array.isArray(items) || !Array.isArray(tgt[field.name])) break;
          for (const [i, item] of items.entries()) {
            // The structure is shared, so the same item has the same id in every language.
            const other = tgt[field.name].find((t) => item.id && t?.id === item.id) ?? tgt[field.name][i];
            if (!isObject(item) || !isObject(other)) continue;
            const inner = field.type === "blocks" ? field.blocks?.find((b) => b.slug === item.blockType)?.fields : field.fields;
            walk(inner, item, other);
          }
          break;
        }
        default:
          if (field.name && field.localized && PROSE.has(field.type) && !field.hasMany && !field.virtual) leaf(field, src, tgt, field.name);
      }
    }
  };

  walk(fields, source, copy);

  return {
    texts,
    apply(translated) {
      if (!Array.isArray(translated) || translated.length !== setters.length) throw new Error("The translation does not match what was sent.");
      setters.forEach((set, i) => set(translated[i]));
      // Only the top-level fields that changed are saved.
      const patch = {};
      for (const key of Object.keys(copy)) if (JSON.stringify(copy[key]) !== JSON.stringify(target?.[key])) patch[key] = copy[key];
      return patch;
    },
  };
}

export const totalCharacters = (texts) => texts.reduce((n, t) => n + t.length, 0);
