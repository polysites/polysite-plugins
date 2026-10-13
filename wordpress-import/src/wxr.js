import { StringDecoder } from "node:string_decoder";

import sax from "sax";

// A streaming reader for a WordPress export (WXR, "Tools > Export > All content"). The file is read in chunks and
// handed to a SAX parser, so memory stays at one item (an item's body is the biggest thing held at a time), never the
// whole file. Nothing here touches the network or runs any of the export's content.
//
//   for await (const part of readWxr(stream)) { ... }
//
// yields, in file order:
//   { kind: "channel", channel }   once, before the first item (or at the end if there are none): the site's title and address
//   { kind: "author", author }     { login, displayName, email }
//   { kind: "term", term }         { taxonomy: "category" | "post_tag" | ..., id, slug, name, parent, description }
//   { kind: "item", item }         one page, post, attachment, menu entry or other record
//
// Namespaced names (wp:post_id, content:encoded) are matched as written; WordPress always uses these prefixes.

// A single text node can be very large (a post body with embedded data). sax hands it over in pieces when it passes
// its buffer limit; the pieces are joined here. The limit below is for the other buffers (tag names, attribute values).
sax.MAX_BUFFER_LENGTH = 4 * 1024 * 1024;

const MAX_ERRORS = 200;

const TERM_FRAMES = { "wp:category": "category", "wp:tag": "post_tag", "wp:term": null };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function framesText(frame, name) {
  for (const kid of frame.kids) if (kid.name === name) return kid.text;
  return "";
}

function itemFromFrame(frame) {
  const item = {
    id: null,
    type: "",
    status: "",
    title: "",
    slug: "",
    link: "",
    guid: "",
    date: "",
    dateGmt: "",
    modified: "",
    modifiedGmt: "",
    pubDate: "",
    parent: 0,
    menuOrder: 0,
    password: "",
    creator: "",
    content: "",
    excerpt: "",
    attachmentUrl: "",
    isSticky: false,
    categories: [],
    meta: {},
  };
  for (const kid of frame.kids) {
    switch (kid.name) {
      case "title": item.title = kid.text; break;
      case "link": item.link = kid.text.trim(); break;
      case "guid": item.guid = kid.text.trim(); break;
      case "pubDate": item.pubDate = kid.text.trim(); break;
      case "dc:creator": item.creator = kid.text.trim(); break;
      case "content:encoded": item.content = kid.text; break;
      case "excerpt:encoded": item.excerpt = kid.text; break;
      case "wp:post_id": item.id = num(kid.text.trim()); break;
      case "wp:post_type": item.type = kid.text.trim(); break;
      case "wp:status": item.status = kid.text.trim(); break;
      case "wp:post_name": item.slug = kid.text.trim(); break;
      case "wp:post_date": item.date = kid.text.trim(); break;
      case "wp:post_date_gmt": item.dateGmt = kid.text.trim(); break;
      case "wp:post_modified": item.modified = kid.text.trim(); break;
      case "wp:post_modified_gmt": item.modifiedGmt = kid.text.trim(); break;
      case "wp:post_parent": item.parent = num(kid.text.trim()) ?? 0; break;
      case "wp:menu_order": item.menuOrder = num(kid.text.trim()) ?? 0; break;
      case "wp:post_password": item.password = kid.text; break;
      case "wp:is_sticky": item.isSticky = kid.text.trim() === "1"; break;
      case "wp:attachment_url": item.attachmentUrl = kid.text.trim(); break;
      case "category":
        item.categories.push({ domain: kid.attrs.domain ?? "", nicename: kid.attrs.nicename ?? "", name: kid.text.trim() });
        break;
      case "wp:postmeta": {
        const key = framesText(kid, "wp:meta_key").trim();
        if (key) item.meta[key] = framesText(kid, "wp:meta_value");
        break;
      }
      default:
    }
  }
  return item;
}

function termFromFrame(frame, taxonomy) {
  const t = (n) => framesText(frame, n).trim();
  if (taxonomy === "category") {
    return { taxonomy, id: num(t("wp:term_id")), slug: t("wp:category_nicename"), name: t("wp:cat_name"), parent: t("wp:category_parent"), description: t("wp:category_description") };
  }
  if (taxonomy === "post_tag") {
    return { taxonomy, id: num(t("wp:term_id")), slug: t("wp:tag_slug"), name: t("wp:tag_name"), parent: "", description: t("wp:tag_description") };
  }
  return { taxonomy: t("wp:term_taxonomy"), id: num(t("wp:term_id")), slug: t("wp:term_slug"), name: t("wp:term_name"), parent: t("wp:term_parent"), description: t("wp:term_description") };
}

/**
 * Reads a WXR document from a Node readable (a file stream, or `Readable.from([...])` in tests) or from a string.
 * Throws if it does not look like a WordPress export. Warnings (recoverable XML mistakes) are passed to `onWarning`.
 */
export async function* readWxr(input, { onWarning = () => {} } = {}) {
  const queue = [];
  const channel = { title: "", link: "", baseSiteUrl: "", baseBlogUrl: "", wxrVersion: "", description: "", language: "" };
  let channelSent = false;
  let sawChannel = false;
  let errors = 0;

  const parser = sax.parser(true, { trim: false, normalize: false, lowercase: false, xmlns: false, position: false });
  const stack = [];

  const sendChannel = () => {
    if (channelSent) return;
    channelSent = true;
    queue.push({ kind: "channel", channel: { ...channel } });
  };

  parser.onopentag = (node) => {
    if (node.name === "channel") sawChannel = true;
    stack.push({ name: node.name, attrs: node.attributes, text: "", kids: [] });
  };
  const addText = (t) => {
    const top = stack[stack.length - 1];
    if (top) top.text += t;
  };
  parser.ontext = addText;
  parser.oncdata = addText;
  parser.onclosetag = () => {
    const frame = stack.pop();
    const parent = stack[stack.length - 1];
    if (!frame || !parent) return;
    if (parent.name !== "channel") {
      parent.kids.push(frame);
      return;
    }
    // A direct child of <channel>: a record, or one of the channel's own settings.
    switch (frame.name) {
      case "item":
        sendChannel();
        queue.push({ kind: "item", item: itemFromFrame(frame) });
        break;
      case "wp:author":
        queue.push({ kind: "author", author: { login: framesText(frame, "wp:author_login").trim(), displayName: framesText(frame, "wp:author_display_name").trim(), email: framesText(frame, "wp:author_email").trim() } });
        break;
      case "wp:category":
      case "wp:tag":
      case "wp:term":
        queue.push({ kind: "term", term: termFromFrame(frame, TERM_FRAMES[frame.name]) });
        break;
      case "title": channel.title = frame.text.trim(); break;
      case "link": channel.link = frame.text.trim(); break;
      case "description": channel.description = frame.text.trim(); break;
      case "language": channel.language = frame.text.trim(); break;
      case "wp:base_site_url": channel.baseSiteUrl = frame.text.trim(); break;
      case "wp:base_blog_url": channel.baseBlogUrl = frame.text.trim(); break;
      case "wp:wxr_version": channel.wxrVersion = frame.text.trim(); break;
      default:
    }
  };
  parser.onerror = (err) => {
    errors++;
    if (errors > MAX_ERRORS) throw new Error(`This file is not valid XML (${err.message.split("\n")[0]}).`);
    onWarning(`XML problem: ${err.message.split("\n")[0]}`);
    // Carry on after a recoverable mistake (a stray ampersand, say) instead of losing the rest of the export.
    parser.error = null;
    parser.resume();
  };

  const decoder = new StringDecoder("utf8");
  let first = true;
  const feed = (text) => {
    if (first) {
      first = false;
      text = text.replace(/^﻿/, "");
    }
    parser.write(text);
  };

  if (typeof input === "string") {
    feed(input);
    while (queue.length) yield queue.shift();
  } else {
    for await (const chunk of input) {
      feed(typeof chunk === "string" ? chunk : decoder.write(chunk));
      while (queue.length) yield queue.shift();
    }
    const rest = decoder.end();
    if (rest) feed(rest);
  }
  parser.close();
  if (!sawChannel) throw new Error("This does not look like a WordPress export (no <channel> found). Export with Tools > Export > All content.");
  sendChannel();
  while (queue.length) yield queue.shift();
}
