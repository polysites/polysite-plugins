// Turns a post's rich-text body (Payload's Lexical editor state, JSON) into a small tree the page
// draws with Vue, so editors' text is never inserted as raw HTML: only the tags and attributes
// named here can ever appear. Used by components/RichText.vue. Unknown parts are skipped, not guessed at.

export interface EventRNode {
  /** An element's tag. Absent for a text node. */
  tag?: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: EventRNode[];
}

interface LexicalNode {
  type?: string;
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  children?: LexicalNode[];
  fields?: { url?: string; newTab?: boolean; linkType?: string };
  value?: unknown;
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const ALIGN = new Set(["left", "center", "right", "justify"]);

// Lexical's text-format bit flags.
const FORMATS: [number, string][] = [
  [1, "strong"],
  [2, "em"],
  [4, "s"],
  [8, "u"],
  [16, "code"],
  [32, "sub"],
  [64, "sup"],
];

/** Only addresses that can't run script: web, mail and phone links, and the site's own paths. */
export function eventSafeHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const value = url.trim();
  if (!value) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (value.startsWith("#")) return value;
  return null;
}

function safeImageSrc(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const value = url.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") && !value.startsWith("//") ? value : null;
}

function textNode(node: LexicalNode): EventRNode | null {
  if (typeof node.text !== "string" || node.text === "") return null;
  let out: EventRNode = { text: node.text };
  const format = typeof node.format === "number" ? node.format : 0;
  for (const [bit, tag] of FORMATS) {
    if (format & bit) out = { tag, children: [out] };
  }
  return out;
}

function blockAttrs(node: LexicalNode): Record<string, string> | undefined {
  return typeof node.format === "string" && ALIGN.has(node.format) ? { style: `text-align:${node.format}` } : undefined;
}

function convertAll(nodes: unknown): EventRNode[] {
  return Array.isArray(nodes) ? nodes.flatMap(convert) : [];
}

function convert(node: LexicalNode): EventRNode[] {
  if (!node || typeof node !== "object") return [];
  switch (node.type) {
    case "text": {
      const t = textNode(node);
      return t ? [t] : [];
    }
    case "linebreak":
      return [{ tag: "br" }];
    case "tab":
      return [{ text: "    " }];
    case "paragraph": {
      const children = convertAll(node.children);
      // Empty paragraphs are the editor's spacing; the page has its own.
      return children.length ? [{ tag: "p", attrs: blockAttrs(node), children }] : [];
    }
    case "heading": {
      const tag = HEADINGS.has(node.tag ?? "") ? (node.tag as string) : "h2";
      return [{ tag, attrs: blockAttrs(node), children: convertAll(node.children) }];
    }
    case "quote":
      return [{ tag: "blockquote", children: convertAll(node.children) }];
    case "list":
      return [{ tag: node.listType === "number" ? "ol" : "ul", children: convertAll(node.children) }];
    case "listitem":
      return [{ tag: "li", children: convertAll(node.children) }];
    case "horizontalrule":
      return [{ tag: "hr" }];
    case "link":
    case "autolink": {
      const href = node.fields?.linkType === "internal" ? null : eventSafeHref(node.fields?.url);
      const children = convertAll(node.children);
      if (!href) return children; // an unsafe or unresolved link keeps its words, loses the link
      const attrs: Record<string, string> = { href };
      if (node.fields?.newTab) {
        attrs.target = "_blank";
        attrs.rel = "noopener noreferrer";
      }
      return [{ tag: "a", attrs, children }];
    }
    case "upload": {
      const file = node.value && typeof node.value === "object" ? (node.value as { url?: unknown; alt?: unknown; width?: unknown; height?: unknown }) : null;
      const src = safeImageSrc(file?.url);
      if (!file || !src) return [];
      const attrs: Record<string, string> = { src, alt: typeof file.alt === "string" ? file.alt : "", loading: "lazy" };
      if (typeof file.width === "number") attrs.width = String(file.width);
      if (typeof file.height === "number") attrs.height = String(file.height);
      return [{ tag: "figure", children: [{ tag: "img", attrs }] }];
    }
    default:
      // Anything else (embedded blocks, relationships) is skipped, but words inside it are kept.
      return node.children ? convertAll(node.children) : [];
  }
}

export function eventLexicalToNodes(state: unknown): EventRNode[] {
  const root = state && typeof state === "object" ? (state as { root?: LexicalNode }).root : null;
  return convertAll(root?.children);
}
