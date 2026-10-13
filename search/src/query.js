// What a visitor types, made safe and comparable. Everything here is plain data in, plain data out, so each rule is
// tested without a database.

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;
export const MAX_TERMS = 6;
export const DEFAULT_PER_PAGE = 10;
export const MAX_PER_PAGE = 50;
// The most results one search can reach, however many pages: it bounds the work a single request can ask of the database.
export const MAX_RESULTS = 200;
export const SYSTEM_DEFAULT = "en";

/**
 * The words to look for. Control characters go, whitespace collapses, and the characters a database treats as wildcards in a
 * "contains" match (% _ \) are dropped so a visitor cannot turn a search into "match everything". At most MAX_TERMS words
 * of MAX_QUERY characters; each word must appear (in any order).
 */
export function cleanQuery(raw) {
  const text = String(raw ?? "")
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY)
    .trim();
  const seen = new Set();
  const terms = [];
  for (const word of text.split(" ")) {
    const key = word.toLocaleLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    terms.push(word);
    if (terms.length === MAX_TERMS) break;
  }
  return { q: terms.join(" "), terms, tooShort: terms.join(" ").length < MIN_QUERY };
}

/** A page number from the address: a whole number from 1 up, anything else is the first page. */
export function pageNumber(raw) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_RESULTS) : 1;
}

/** The setting for results per page, kept in range. */
export function clampPerPage(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PER_PAGE) : DEFAULT_PER_PAGE;
}

const has = (text, term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase());

const startsAWord = (text, term) => new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu").test(text);

/**
 * How well a result matches, bigger first. A title that is exactly the search beats one that starts with it, then one with
 * every word starting a word of the title, then one that merely contains them (1000 down to 400). Otherwise each word scores
 * by where it is found, so more words in better places rank higher: in the title (40 at the start of a word, 30 inside one),
 * else in the address (15), else only in the body text (4; the index returns an entry only when every word is somewhere in it).
 */
export function relevance(title, path, terms, q) {
  const t = String(title ?? "");
  if (!terms.length) return 0;
  if (t.toLocaleLowerCase() === q.toLocaleLowerCase()) return 1000;
  if (t.toLocaleLowerCase().startsWith(q.toLocaleLowerCase())) return 800;
  if (terms.every((term) => startsAWord(t, term))) return 600;
  if (terms.every((term) => has(t, term))) return 400;
  const address = String(path ?? "");
  let score = 0;
  for (const term of terms) {
    if (startsAWord(t, term)) score += 40;
    else if (has(t, term)) score += 30;
    else if (has(address, term)) score += 15;
    else score += 4;
  }
  return score;
}

export const SNIPPET_LENGTH = 220;

/** Whether the text contains any of the words (any case). */
export const mentions = (text, terms) => terms.some((term) => term && has(String(text ?? ""), term));

/**
 * A short stretch of the body that shows the search words: the window of about SNIPPET_LENGTH characters holding the most
 * different words (the earliest on a tie), cut at word edges, with … where text was left out. Plain text in, plain text out; the
 * page marks the words and escapes everything. Empty when the body has none of the words.
 */
export function bodySnippet(text, terms) {
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  const words = [...new Set(terms.filter(Boolean).map((w) => w.toLocaleLowerCase()))];
  if (!body || words.length === 0) return "";
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const hits = [];
  for (const m of body.matchAll(new RegExp(escaped.join("|"), "giu"))) {
    hits.push({ at: m.index, word: m[0].toLocaleLowerCase() });
    if (hits.length >= 300) break;
  }
  if (hits.length === 0) return "";
  let best = { score: -1, at: hits[0].at };
  for (const h of hits) {
    const score = new Set(hits.filter((x) => x.at >= h.at && x.at < h.at + SNIPPET_LENGTH - 40).map((x) => x.word)).size;
    if (score > best.score) best = { score, at: h.at };
    if (best.score >= words.length) break;
  }
  let from = Math.max(0, best.at - 40);
  if (from > 0) {
    const space = body.indexOf(" ", from);
    from = space >= 0 && space < best.at ? space + 1 : from;
  }
  let to = Math.min(body.length, from + SNIPPET_LENGTH);
  if (to < body.length) {
    const space = body.lastIndexOf(" ", to);
    to = space > best.at ? space : to;
  }
  return `${from > 0 ? "…" : ""}${body.slice(from, to).trim()}${to < body.length ? "…" : ""}`;
}

/** The short text under a result: the first of the document's own summaries, trimmed to a sentence-ish length. */
export function snippetOf(doc) {
  const candidates = [doc?.excerpt, doc?.meta?.description, doc?.description, doc?.summary];
  const found = candidates.find((c) => typeof c === "string" && c.trim());
  if (!found) return "";
  const text = found.replace(/\s+/g, " ").trim();
  if (text.length <= 220) return text;
  const cut = text.slice(0, 220);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 160))}…`;
}
