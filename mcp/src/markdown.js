// A small Markdown to Lexical converter, so an agent writes text the way it naturally does and never has to produce Lexical JSON.
// Supports headings, paragraphs, bullet and numbered lists, **bold**, *italic*, `code` and [links](url). Everything else is plain text.
// Links are limited to http, https, mailto, tel and relative addresses; anything else becomes plain text.

const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i;

const textNode = (text, format = 0) => ({ type: "text", text, format, detail: 0, mode: "normal", style: "", version: 1 });
const block = (type, children, extra = {}) => ({ type, children, direction: "ltr", format: "", indent: 0, version: 1, ...extra });

export function inline(source) {
  const nodes = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
    if (m.index > last) nodes.push(textNode(source.slice(last, m.index)));
    if (m[1] !== undefined) nodes.push(textNode(m[1], 1));
    else if (m[2] !== undefined) nodes.push(textNode(m[2], 2));
    else if (m[3] !== undefined) nodes.push(textNode(m[3], 16));
    else if (SAFE_URL.test(m[5])) nodes.push({ type: "link", fields: { url: m[5], newTab: false, linkType: "custom" }, children: [textNode(m[4])], direction: "ltr", format: "", indent: 0, version: 3 });
    else nodes.push(textNode(m[4]));
    last = m.index + m[0].length;
  }
  if (last < source.length) nodes.push(textNode(source.slice(last)));
  return nodes;
}

export function markdownToLexical(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const children = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) children.push(block("paragraph", inline(paragraph.join(" ")), { textFormat: 0, textStyle: "" }));
    paragraph = [];
  };
  const flushList = () => {
    if (list) children.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      children.push(block("heading", inline(heading[2]), { tag: `h${heading[1].length}` }));
    } else if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? "bullet" : "number";
      if (!list || list.listType !== kind) {
        flushList();
        list = block("list", [], { listType: kind, start: 1, tag: bullet ? "ul" : "ol" });
      }
      list.children.push(block("listitem", inline((bullet ?? numbered)[1]), { value: list.children.length + 1 }));
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  if (!children.length) children.push(block("paragraph", [], { textFormat: 0, textStyle: "" }));
  return { root: block("root", children) };
}
