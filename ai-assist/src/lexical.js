// Lexical (the rich-text editor's saved form) to Markdown, so the model sees text and not editor JSON. Mirrors what src/markdown.js of the
// MCP plugin reads: headings, paragraphs, lists, bold, italic, code and links. Unknown nodes keep their text.
function inline(node) {
  if (node.type === "linebreak") return "\n";
  if (node.type === "link") {
    const text = (node.children ?? []).map(inline).join("");
    return node.fields?.url ? `[${text}](${node.fields.url})` : text;
  }
  const text = node.text ?? (node.children ?? []).map(inline).join("");
  if (!text || node.type !== "text") return text;
  let out = text;
  if (node.format & 16) out = `\`${out}\``;
  if (node.format & 1) out = `**${out}**`;
  if (node.format & 2) out = `*${out}*`;
  return out;
}

function blocks(node, out) {
  for (const child of node.children ?? []) {
    if (child.type === "heading") out.push(`${"#".repeat(Number(String(child.tag ?? "h2").slice(1)) || 2)} ${(child.children ?? []).map(inline).join("")}`);
    else if (child.type === "list") {
      (child.children ?? []).forEach((item, i) => out.push(`${child.listType === "number" ? `${i + 1}.` : "-"} ${(item.children ?? []).map(inline).join("")}`));
    } else if (child.type === "paragraph" || child.type === "quote") out.push((child.children ?? []).map(inline).join(""));
    else blocks(child, out);
    if (out.length && out[out.length - 1] !== "") out.push("");
  }
}

export function isLexical(value) {
  return Boolean(value && typeof value === "object" && value.root && Array.isArray(value.root.children));
}

export function lexicalToMarkdown(value) {
  if (!isLexical(value)) return typeof value === "string" ? value : "";
  const out = [];
  blocks(value.root, out);
  return out.join("\n").trim();
}
