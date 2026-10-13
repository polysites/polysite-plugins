import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The sample export, with {{SITE}} replaced by the address of the pretend old site. */
export function sampleWxr(site = "https://garden.example") {
  return fs.readFileSync(path.join(here, "fixtures", "sample.wxr.xml"), "utf8").replaceAll("{{SITE}}", site);
}

export async function collect(iterable) {
  const out = { channel: null, authors: [], terms: [], items: [] };
  for await (const part of iterable) {
    if (part.kind === "channel") out.channel = part.channel;
    else if (part.kind === "author") out.authors.push(part.author);
    else if (part.kind === "term") out.terms.push(part.term);
    else out.items.push(part.item);
  }
  return out;
}
