import { parseDocument } from "htmlparser2";

// WordPress body HTML -> sanitised Lexical (the rich text the Pages and Posts editors store).
//
// Why not Payload's own convertHTMLToLexical: it needs a DOM implementation (JSDOM, about 30 MB and not in the CMS image),
// and this conversion has to do three things around the conversion itself: drop everything unsafe, turn images into
// uploads of media that was downloaded first, and report what could not be carried over. So one pass over a parsed tree
// does all of it and builds the same node shapes the editor stores. Nothing here runs or fetches anything in the content.
//
// Safety is by construction: only the tags listed below produce anything, attributes are never copied except a link's
// address (checked) and an image's source and alt text, and the output contains no HTML at all, only Lexical nodes.

// ---- reports -------------------------------------------------------------------------------------------------------

/** Collects "this was dropped or changed" notes, merged by code. */
export function createReport() {
  const map = new Map();
  return {
    note(code, message, sample) {
      let entry = map.get(code);
      if (!entry) map.set(code, (entry = { code, message, count: 0, samples: [] }));
      entry.count++;
      if (sample && entry.samples.length < 3 && !entry.samples.includes(sample)) entry.samples.push(String(sample).slice(0, 120));
    },
    merge(entries) {
      for (const e of entries ?? []) {
        let entry = map.get(e.code);
        if (!entry) map.set(e.code, (entry = { code: e.code, message: e.message, count: 0, samples: [] }));
        entry.count += e.count;
        for (const s of e.samples ?? []) if (entry.samples.length < 3 && !entry.samples.includes(s)) entry.samples.push(s);
      }
    },
    entries: () => [...map.values()],
  };
}

// ---- classic-editor paragraphs and shortcodes -----------------------------------------------------------------------

const BLOCK_START = /^<(?:h[1-6]|ul|ol|li|blockquote|table|pre|div|section|figure|hr|iframe|form|dl|p|!--)/i;

/** WordPress stores classic-editor text without <p> tags (blank lines separate paragraphs). Adds them; leaves block-editor HTML alone. */
export function autop(html) {
  const text = String(html ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  if (/<p[\s>]/i.test(text) || /<!--\s*wp:/.test(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((chunk) => {
      const c = chunk.trim();
      if (!c) return "";
      if (BLOCK_START.test(c)) return c;
      return `<p>${c.replace(/\n/g, "<br>\n")}</p>`;
    })
    .join("\n");
}

const KNOWN_SHORTCODES = new Set([
  "caption", "wp_caption", "gallery", "embed", "audio", "video", "playlist", "contact-form-7", "contact-form", "wpforms", "gravityform", "ninja_form",
  "mc4wp_form", "rev_slider", "layerslider", "tablepress", "products", "woocommerce_cart", "woocommerce_checkout", "recent_posts", "latest_posts",
]);
// Dynamic block-editor blocks save no HTML (the server draws them), so there is nothing to carry over.
const QUIET_BLOCKS = new Set(["more", "nextpage", "spacer", "separator", "paragraph", "heading", "list", "list-item", "image", "quote", "gallery", "embed", "html", "freeform", "group", "columns", "column", "buttons", "button", "cover", "media-text", "table", "code", "preformatted", "pullquote", "verse", "audio", "video", "file", "details", "separator"]);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function attrOf(attrs, name) {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`, "i").exec(attrs ?? "");
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

/**
 * Replaces the shortcodes that have a sensible plain-HTML meaning ([caption], [gallery ids], [embed]) and strips the rest,
 * keeping whatever text they enclose, and noting each kind that is lost. Text in square brackets that is not a shortcode stays.
 */
export function handleShortcodes(html, { attachmentsById, report }) {
  let out = String(html ?? "");

  out = out.replace(/\[(?:wp_)?caption([^\]]*)\]([\s\S]*?)\[\/(?:wp_)?caption\]/gi, (_m, attrs, inner) => {
    const caption = attrOf(attrs, "caption");
    return `${inner}${caption ? `<p>${esc(caption)}</p>` : ""}`;
  });

  out = out.replace(/\[gallery([^\]]*)\]/gi, (_m, attrs) => {
    const ids = attrOf(attrs, "ids").split(",").map((s) => s.trim()).filter(Boolean);
    const imgs = ids.map((id) => attachmentsById?.get?.(Number(id))).filter(Boolean);
    if (!imgs.length) {
      report.note("shortcode:gallery", "A [gallery] shortcode with no images that could be found was dropped.", "[gallery]");
      return "";
    }
    report.note("gallery", "A [gallery] shortcode was turned into a list of its images.", "[gallery]");
    return imgs.map((a) => `<p><img src="${esc(a.url)}" alt="${esc(a.alt ?? "")}"></p>`).join("");
  });

  out = out.replace(/\[embed[^\]]*\]\s*(https?:\/\/[^\s\[]+)\s*\[\/embed\]/gi, (_m, url) => `<p><a href="${esc(url)}">${esc(url)}</a></p>`);

  const closing = new Set();
  for (const m of out.matchAll(/\[\/([a-z][a-z0-9_-]*)\]/gi)) closing.add(m[1].toLowerCase());
  out = out.replace(/\[(\/?)([a-z][a-z0-9_-]*)((?:\s[^\]]*)?)\]/gi, (m, slash, name, attrs) => {
    const lower = name.toLowerCase();
    const looksLikeShortcode = KNOWN_SHORTCODES.has(lower) || /=/.test(attrs ?? "") || /[_-]/.test(lower) || closing.has(lower);
    if (!looksLikeShortcode) return m;
    if (!slash) report.note(`shortcode:${lower}`, `The shortcode [${lower}] is not imported (its text, if any, is kept).`, m.slice(0, 80));
    return "";
  });

  // Block-editor blocks that save no markup: nothing to import, so say so.
  for (const m of out.matchAll(/<!--\s*wp:([a-z0-9/-]+)(?:\s[^>]*?)?\s*\/-->/g)) {
    const name = m[1];
    if (!QUIET_BLOCKS.has(name)) report.note(`dynamic-block:${name}`, `The block "${name}" is drawn by WordPress from live data and has no content to import.`, name);
  }
  return out;
}

/** Names the page builder a page was made with, if any: its layout cannot be carried over, only its text. */
export function detectPageBuilder({ meta = {}, html = "" } = {}) {
  if (meta._elementor_data || meta._elementor_edit_mode || /\belementor-(?:section|widget|element|column)\b/.test(html)) return "Elementor";
  if (meta._et_pb_use_builder === "on" || /\[et_pb_|\bet_pb_(?:section|row|module)\b/.test(html)) return "Divi";
  if (meta._wpb_vc_js_status === "true" || /\[vc_(?:row|column|section)\b/.test(html)) return "WPBakery";
  if (meta._fl_builder_enabled === "1" || meta._fl_builder_data || /\bfl-(?:row|module|col)\b/.test(html)) return "Beaver Builder";
  if (/\bbrxe-|\boxy-|\bwp-block-kadence-/.test(html)) return "a page builder";
  return null;
}

// ---- links ---------------------------------------------------------------------------------------------------------

/** A link address that is safe to keep, or null. http(s), mailto, tel, same-page anchors and site-relative paths pass. */
export function cleanHref(href, baseUrl) {
  const h = String(href ?? "").trim();
  if (!h) return null;
  const probe = h.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (/^(?:https?|mailto|tel):/i.test(probe)) return h;
  if (probe.startsWith("//")) return `https:${probe}`;
  if (probe.startsWith("#") || probe.startsWith("/")) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(probe)) return null; // javascript:, data:, vbscript:, file: ...
  if (baseUrl) {
    try {
      return new URL(h, baseUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/** Makes a WordPress image address comparable: scheme and host case, no "-300x200" size suffix, no query. */
export function imageKey(src) {
  let url;
  try {
    url = new URL(src);
  } catch {
    return String(src ?? "").trim();
  }
  const path = url.pathname.replace(/-\d{2,4}x\d{2,4}(\.[a-z0-9]+)$/i, "$1").replace(/-scaled(\.[a-z0-9]+)$/i, "$1");
  return `${url.hostname.toLowerCase()}${path}`;
}

// ---- parsing -------------------------------------------------------------------------------------------------------

const DROP = {
  script: ["script", "A script was removed."],
  noscript: ["script", "A script was removed."],
  style: ["style", "Inline styles were removed."],
  template: ["script", "A script was removed."],
  form: ["form", "A form was removed (forms are built with Polysite's own form builder)."],
  input: ["form", "A form was removed (forms are built with Polysite's own form builder)."],
  button: ["form", "A form was removed (forms are built with Polysite's own form builder)."],
  select: ["form", "A form was removed (forms are built with Polysite's own form builder)."],
  textarea: ["form", "A form was removed (forms are built with Polysite's own form builder)."],
  object: ["embed", "An embedded object (object, embed, svg or canvas) was removed."],
  embed: ["embed", "An embedded object (object, embed, svg or canvas) was removed."],
  applet: ["embed", "An embedded object (object, embed, svg or canvas) was removed."],
  svg: ["embed", "An embedded object (object, embed, svg or canvas) was removed."],
  canvas: ["embed", "An embedded object (object, embed, svg or canvas) was removed."],
  math: ["embed", "An embedded object (object, embed, svg or canvas) was removed."],
  head: [null],
  meta: [null],
  link: [null],
  base: [null],
  title: [null],
  source: [null],
  track: [null],
  map: [null],
  area: [null],
};

const FORMATS = { b: 1, strong: 1, i: 2, em: 2, cite: 2, dfn: 2, var: 2, s: 4, strike: 4, del: 4, u: 8, ins: 8, code: 16, kbd: 16, samp: 16, tt: 16, sub: 32, sup: 64 };
const BLOCKS = new Set(["div", "section", "article", "main", "header", "footer", "aside", "nav", "figure", "figcaption", "address", "details", "summary", "center", "body", "html", "dl", "dt", "dd", "fieldset", "legend", "hgroup", "caption", "tbody", "thead", "tfoot", "picture"]);

/**
 * Prepares a body: classic paragraphs, shortcodes, then the parsed tree. Returns the tree, the images it references (in
 * order, with alt text) and what was dropped. Cheap enough to run on every item of a dry run.
 */
export function parseContent(html, { attachmentsById, report = createReport() } = {}) {
  const prepared = handleShortcodes(autop(html), { attachmentsById, report });
  const dom = parseDocument(prepared, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true });
  const images = [];
  const seen = new Set();
  const visit = (nodes) => {
    for (const n of nodes) {
      if (n.type === "tag" || n.type === "script" || n.type === "style") {
        if (n.name === "img") {
          const src = imageSource(n);
          if (src && !seen.has(src)) {
            seen.add(src);
            images.push({ src, alt: (n.attribs.alt ?? "").trim() });
          }
        } else if (DROP[n.name]) {
          // Counted once, where it is converted; nothing inside it is looked at.
          continue;
        }
        if (n.children) visit(n.children);
      }
    }
  };
  visit(dom.children);
  return { dom, images, report };
}

function imageSource(node) {
  const a = node.attribs ?? {};
  let src = (a["data-src"] || a["data-lazy-src"] || a.src || "").trim();
  if (!src || src.startsWith("data:")) {
    const first = (a.srcset || a["data-srcset"] || "").split(",")[0]?.trim().split(/\s+/)[0];
    if (first) src = first;
  }
  return /^https?:\/\//i.test(src) ? src : "";
}

// ---- Lexical node builders -----------------------------------------------------------------------------------------

const node = {
  text: (text, format = 0) => ({ type: "text", version: 1, text, format, mode: "normal", style: "", detail: 0 }),
  br: () => ({ type: "linebreak", version: 1 }),
  paragraph: (children) => ({ type: "paragraph", version: 1, format: "", indent: 0, direction: "ltr", textFormat: 0, textStyle: "", children }),
  heading: (tag, children) => ({ type: "heading", version: 1, tag, format: "", indent: 0, direction: "ltr", children }),
  quote: (children) => ({ type: "quote", version: 1, format: "", indent: 0, direction: "ltr", children }),
  list: (ordered, children) => ({ type: "list", version: 1, listType: ordered ? "number" : "bullet", start: 1, tag: ordered ? "ol" : "ul", format: "", indent: 0, direction: "ltr", children }),
  item: (value, children) => ({ type: "listitem", version: 1, value, format: "", indent: 0, direction: "ltr", children }),
  link: (url, children) => ({ type: "link", version: 3, fields: { url, newTab: false, linkType: "custom" }, format: "", indent: 0, direction: "ltr", children }),
  upload: (id) => ({ type: "upload", version: 3, format: "", id: randomHex(), relationTo: "media", value: id, fields: null }),
  hr: () => ({ type: "horizontalrule", version: 1 }),
};

function randomHex() {
  let out = "";
  for (let i = 0; i < 24; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export function lexicalRoot(children) {
  return { root: { type: "root", format: "", indent: 0, version: 1, direction: "ltr", children } };
}

/** A body that holds just this text: used when an item has no body at all, because the editor's body field is required. */
export const lexicalOfText = (text) => lexicalRoot([node.paragraph([node.text(String(text || " "))])]);

// ---- the conversion ------------------------------------------------------------------------------------------------

function tidyInline(items) {
  // Collapse runs of spaces across node boundaries, trim the ends, drop what is left empty.
  let lastSpace = true;
  const walk = (list) => {
    for (const it of list) {
      if (it.t === "text") {
        let s = it.text.replace(/[ \t\r\n\f ]+/g, " ");
        if (lastSpace && s.startsWith(" ")) s = s.slice(1);
        it.text = s;
        if (s) lastSpace = s.endsWith(" ");
      } else if (it.t === "br") {
        lastSpace = true;
      } else if (it.t === "link") {
        walk(it.children);
      }
    }
  };
  walk(items);
  // trailing space of the last text leaf
  const trimEnd = (list) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t === "link") {
        trimEnd(it.children);
        if (it.children.some((c) => c.t !== "text" || c.text)) return true;
      } else if (it.t === "text") {
        it.text = it.text.replace(/ +$/, "");
        if (it.text) return true;
      } else if (it.t === "br") {
        list.splice(i, 1);
      }
    }
    return false;
  };
  trimEnd(items);
  return items;
}

function inlineToLexical(items) {
  const out = [];
  for (const it of items) {
    if (it.t === "text") {
      if (!it.text) continue;
      const prev = out[out.length - 1];
      if (prev && prev.type === "text" && prev.format === it.fmt) prev.text += it.text;
      else out.push(node.text(it.text, it.fmt));
    } else if (it.t === "br") {
      out.push(node.br());
    } else if (it.t === "link") {
      const kids = inlineToLexical(it.children);
      if (kids.length) out.push(node.link(it.url, kids));
    }
  }
  return out;
}

const hasContent = (items) => items.some((i) => (i.t === "text" ? i.text : i.t === "link" ? hasContent(i.children) : false));

/**
 * @param parsed   the result of parseContent
 * @param options  images: Map of imageKey -> { id } for images already in the media library;
 *                 rewriteLink(href) -> a new href for an address inside the old site, or undefined;
 *                 baseUrl: resolves relative links; report: where drops are noted (defaults to parsed.report)
 * @returns        { lexical, empty } where empty is true when nothing readable came out
 */
export function toLexical(parsed, { images = new Map(), rewriteLink, baseUrl, report } = {}) {
  const rep = report ?? parsed.report ?? createReport();
  const note = (code, message, sample) => rep.note(code, message, sample);
  let tablesSeen = 0;

  const newBuilder = () => ({ blocks: [], inline: [] });
  const takeInline = (b) => {
    const items = tidyInline(b.inline);
    b.inline = [];
    return hasContent(items) ? items : [];
  };
  const flush = (b) => {
    const items = takeInline(b);
    if (items.length) b.blocks.push({ type: "p", items });
  };

  function pushText(b, text, st) {
    if (!text) return;
    const item = { t: "text", text, fmt: st.fmt };
    if (!st.link) return void b.inline.push(item);
    const last = b.inline[b.inline.length - 1];
    if (last && last.t === "link" && last.token === st.link.token) last.children.push(item);
    else b.inline.push({ t: "link", url: st.link.url, token: st.link.token, children: [item] });
  }
  function pushBreak(b, st) {
    const item = { t: "br" };
    const last = b.inline[b.inline.length - 1];
    if (st.link && last && last.t === "link" && last.token === st.link.token) last.children.push(item);
    else b.inline.push(item);
  }
  function plainLinkParagraph(b, url, label) {
    flush(b);
    b.blocks.push({ type: "p", items: [{ t: "link", url, token: {}, children: [{ t: "text", text: label, fmt: 0 }] }] });
  }

  function walk(nodes, b, st) {
    for (const n of nodes) {
      if (n.type === "text") {
        pushText(b, st.pre ? n.data.replace(/ /g, " ") : n.data.replace(/[ \t\r\n\f ]+/g, " "), st);
        continue;
      }
      if (n.type === "script" || n.type === "style") {
        note(DROP[n.name][0], DROP[n.name][1]);
        continue;
      }
      if (n.type !== "tag") continue;
      const name = n.name;

      if (DROP[name]) {
        if (DROP[name][0]) note(DROP[name][0], DROP[name][1], name);
        continue;
      }
      if (FORMATS[name] !== undefined) {
        walk(n.children, b, { ...st, fmt: st.fmt | FORMATS[name] });
        continue;
      }
      switch (name) {
        case "br":
          pushBreak(b, st);
          break;
        case "a": {
          let href = cleanHref(n.attribs.href, baseUrl);
          if (href) href = rewriteLink?.(href) ?? href;
          if (!href) {
            if (n.attribs.href && /^[a-z][a-z0-9+.-]*:/i.test(n.attribs.href.replace(/[\u0000- \u007f-\u009f]/g, ""))) note("unsafe-link", "A link with an unsafe address was kept as plain text.", n.attribs.href.slice(0, 40));
            walk(n.children, b, st);
          } else {
            walk(n.children, b, { ...st, link: { url: href, token: n } });
          }
          break;
        }
        case "img": {
          const src = imageSource(n);
          flush(b);
          const found = src ? images.get(imageKey(src)) : undefined;
          if (found?.id !== undefined && found?.id !== null) b.blocks.push({ type: "upload", id: found.id });
          else if (src) {
            const alt = (n.attribs.alt ?? "").trim();
            b.blocks.push({ type: "p", items: [{ t: "link", url: src, token: {}, children: [{ t: "text", text: alt || "Image", fmt: 0 }] }] });
            note("image-link", "An image that was not imported was left as a link to the original.", src.slice(0, 100));
          }
          break;
        }
        case "p":
          flush(b);
          walk(n.children, b, st);
          flush(b);
          break;
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
          flush(b);
          walk(n.children, b, st);
          const items = takeInline(b);
          if (items.length) b.blocks.push({ type: "h", tag: name, items });
          break;
        }
        case "blockquote": {
          flush(b);
          const sub = newBuilder();
          walk(n.children, sub, st);
          flush(sub);
          const quoteItems = [];
          const after = [];
          for (const blk of sub.blocks) {
            if (blk.type === "p" || blk.type === "h") {
              if (quoteItems.length) quoteItems.push({ t: "br" });
              quoteItems.push(...blk.items);
            } else after.push(blk);
          }
          if (quoteItems.length) b.blocks.push({ type: "q", items: quoteItems });
          b.blocks.push(...after);
          break;
        }
        case "ul": case "ol": {
          flush(b);
          const entries = [];
          const hoisted = [];
          for (const li of n.children) {
            if (li.type !== "tag" || li.name !== "li") continue;
            const sub = newBuilder();
            walk(li.children, sub, st);
            flush(sub);
            const own = [];
            const nested = [];
            for (const blk of sub.blocks) {
              if (blk.type === "p" || blk.type === "h" || blk.type === "q") {
                if (own.length) own.push({ t: "br" });
                own.push(...blk.items);
              } else if (blk.type === "list") nested.push(blk);
              else hoisted.push(blk);
            }
            entries.push({ own, nested });
          }
          if (entries.length) b.blocks.push({ type: "list", ordered: name === "ol", entries });
          b.blocks.push(...hoisted);
          break;
        }
        case "li":
          flush(b);
          walk(n.children, b, st);
          flush(b);
          break;
        case "hr":
          flush(b);
          b.blocks.push({ type: "hr" });
          break;
        case "pre": {
          flush(b);
          const text = textOfNode(n).replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
          const items = [];
          text.split("\n").forEach((line, i) => {
            if (i) items.push({ t: "br" });
            if (line) items.push({ t: "text", text: line, fmt: 16 });
          });
          if (items.length) b.blocks.push({ type: "p", items, raw: true });
          break;
        }
        case "table": {
          flush(b);
          const rows = [];
          collectRows(n, rows);
          tablesSeen++;
          if (tablesSeen === 1) note("table", "A table was turned into one line per row, with cells separated by \" | \" (the editor has no tables).", "");
          for (const row of rows) {
            const cells = [];
            for (const c of row.children) {
              if (c.type !== "tag" || (c.name !== "td" && c.name !== "th")) continue;
              const text = textOfNode(c).replace(/\s+/g, " ").trim();
              if (text) cells.push(text);
            }
            if (cells.length) b.blocks.push({ type: "p", items: [{ t: "text", text: cells.join(" | "), fmt: 0 }], raw: true });
          }
          break;
        }
        case "iframe": {
          flush(b);
          const src = (n.attribs.src ?? "").trim();
          if (/^(?:https?:)?\/\//i.test(src)) {
            const url = src.startsWith("//") ? `https:${src}` : src;
            plainLinkParagraph(b, url, url);
            note("iframe", "An embedded frame (video, map, widget) was replaced by a link to its address.", url.slice(0, 100));
          } else note("iframe", "An embedded frame was removed.", "");
          break;
        }
        case "video": case "audio": {
          flush(b);
          let src = (n.attribs.src ?? "").trim();
          if (!src) for (const c of n.children) if (c.type === "tag" && c.name === "source" && c.attribs.src) { src = c.attribs.src.trim(); break; }
          if (/^https?:\/\//i.test(src)) {
            plainLinkParagraph(b, src, src);
            note("media", `An ${name} player was replaced by a link to the file.`, src.slice(0, 100));
          } else note("media", `An ${name} player was removed.`, "");
          break;
        }
        default:
          // Anything else (div, span, section, font, figure, ...) is only a wrapper: its content is kept, its markup is not.
          if (BLOCKS.has(name)) {
            flush(b);
            walk(n.children, b, st);
            flush(b);
          } else {
            walk(n.children, b, st);
          }
      }
    }
  }

  const root = newBuilder();
  walk(parsed.dom.children, root, { fmt: 0, link: null, pre: false });
  flush(root);

  // ---- blocks -> Lexical
  const toNodes = (blocks) =>
    blocks.flatMap((blk) => {
      switch (blk.type) {
        case "p": {
          const kids = inlineToLexical(blk.items);
          return kids.length ? [node.paragraph(kids)] : [];
        }
        case "h": {
          const kids = inlineToLexical(blk.items);
          return kids.length ? [node.heading(blk.tag, kids)] : [];
        }
        case "q": {
          const kids = inlineToLexical(blk.items);
          return kids.length ? [node.quote(kids)] : [];
        }
        case "hr": return [node.hr()];
        case "upload": return [node.upload(blk.id)];
        case "list": {
          const children = [];
          let value = 1;
          for (const e of blk.entries) {
            const kids = inlineToLexical(e.own);
            if (kids.length) children.push(node.item(value++, kids));
            for (const nested of e.nested) {
              const inner = toNodes([nested])[0];
              if (inner) children.push(node.item(value++, [inner]));
            }
          }
          return children.length ? [node.list(blk.ordered, children)] : [];
        }
        default: return [];
      }
    });

  const children = toNodes(root.blocks);
  return { lexical: lexicalRoot(children), empty: children.length === 0, report: rep };
}

function collectRows(n, rows) {
  for (const c of n.children ?? []) {
    if (c.type !== "tag") continue;
    if (c.name === "tr") rows.push(c);
    else if (["thead", "tbody", "tfoot"].includes(c.name)) collectRows(c, rows);
  }
}

function textOfNode(n) {
  if (n.type === "text") return n.data;
  if (n.name === "br") return "\n";
  if (n.type === "script" || n.type === "style" || !n.children) return "";
  return n.children.map(textOfNode).join("");
}

/** Plain text of a body (for an excerpt): no markup, whitespace collapsed. */
export function htmlToText(html) {
  const dom = parseDocument(handleShortcodes(String(html ?? ""), { report: createReport() }), { decodeEntities: true });
  return textOfNode({ type: "root", children: dom.children }).replace(/\s+/g, " ").trim();
}

/** One call for the common case. */
export function convertHtml(html, options = {}) {
  const parsed = parseContent(html, options);
  return { ...toLexical(parsed, { ...options, report: parsed.report }), images: parsed.images, report: parsed.report };
}
