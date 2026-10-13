import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// Fetching an image or document from the old site. The only network access this plugin has, and the classic server-side
// request forgery surface, so:
//  - only hosts on the allow-list are contacted (by default the export's own site; an administrator can add more per import);
//  - the host's addresses are checked inside the connection's own DNS lookup, so a name that resolves to a private,
//    loopback or link-local address (cloud metadata, internal services) is refused, with no gap between check and connect;
//  - redirects are followed by hand, at most three, and every hop must pass the same checks;
//  - https is tried first for an http address; plain http is used only if allowed;
//  - size is capped while streaming, the type is checked by its first bytes (not the server's word), and only images and
//    PDFs are accepted; nothing is executed or parsed.
// WORDPRESS_IMPORT_ALLOW_PRIVATE_HOSTS=1 lifts the address check, for a throwaway local fixture server in tests. Never set it on a real install.

const MAX_REDIRECTS = 3;

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
  }
  return false;
}

const allowPrivate = () => process.env.WORDPRESS_IMPORT_ALLOW_PRIVATE_HOSTS === "1";

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    if (!allowPrivate()) {
      const bad = list.find((a) => isPrivateAddress(a.address));
      if (bad) return callback(new Error(`Blocked: ${hostname} resolves to a private or reserved address`));
    }
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/** Parses the per-import allow-list (one host per line or comma separated) into a lower-case Set of host names. */
export function parseAllowList(text, siteHost) {
  const hosts = new Set();
  if (siteHost) hosts.add(String(siteHost).toLowerCase());
  for (const raw of String(text ?? "").split(/[\s,]+/)) {
    const h = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
    if (h && /^[a-z0-9.-]+$/.test(h)) hosts.add(h);
  }
  return hosts;
}

export const hostAllowed = (hostname, allow) => allow.has(String(hostname).toLowerCase());

// What the first bytes say the file is.
export function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return { mime: "image/gif", ext: "gif" };
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp" && /^(avif|avis)$/.test(buf.subarray(8, 12).toString("latin1"))) return { mime: "image/avif", ext: "avif" };
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

function requestOnce(url, { timeoutMs, maxBytes, headers }) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, { method: "GET", lookup: guardedLookup, timeout: timeoutMs, headers: { "User-Agent": "Polysite-WordPress-Import/0.1", Accept: "image/*,application/pdf,*/*;q=0.1", ...headers } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url).toString() });
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`The server answered ${status}.`));
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        return reject(new Error(`The file is ${Math.round(declared / 1048576)} MB, over the ${Math.round(maxBytes / 1048576)} MB limit.`));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          res.destroy(new Error(`The file is over the ${Math.round(maxBytes / 1048576)} MB limit.`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ buffer: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s.`)));
    req.on("error", reject);
    req.end();
  });
}

/** Why a media address may not be fetched, or null. */
export function refusal(rawUrl, allow) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "Not a valid address.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Only http and https addresses are fetched.";
  if (url.username || url.password) return "Addresses with a user name or password are not fetched.";
  if (!hostAllowed(url.hostname, allow)) return `The host ${url.hostname} is not on the allow-list for this import.`;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate() && net.isIP(host) && isPrivateAddress(host)) return "That address is private or reserved.";
  return null;
}

function fileNameFor(url, ext) {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "").replace(/\.[a-z0-9]{2,5}$/i, "");
  const base = last.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
  return `${base}.${ext}`;
}

/**
 * Downloads one file. Resolves { buffer, mimetype, filename, finalUrl } or throws an Error with a message fit for the log.
 * @param allow     Set of allowed host names
 * @param options   { maxBytes, timeoutMs, httpFallback (default true) }
 */
export async function downloadMedia(rawUrl, allow, { maxBytes = 20 * 1048576, timeoutMs = 20000, httpFallback = true } = {}) {
  const first = refusal(rawUrl, allow);
  if (first) throw new Error(first);
  const original = new URL(rawUrl);
  // https first for an http address; the plain address only if that is allowed.
  const attempts = [];
  if (original.protocol === "http:") {
    const secure = new URL(original);
    secure.protocol = "https:";
    attempts.push(secure);
    if (httpFallback) attempts.push(original);
  } else attempts.push(original);

  let lastError;
  for (const start of attempts) {
    try {
      let url = start;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const result = await requestOnce(url, { timeoutMs: start.protocol === "https:" && original.protocol === "http:" ? Math.min(timeoutMs, 8000) : timeoutMs, maxBytes, headers: {} });
        if (result.redirect) {
          if (hop === MAX_REDIRECTS) throw new Error("Too many redirects.");
          const why = refusal(result.redirect, allow);
          if (why) throw new Error(`Redirected: ${why}`);
          url = new URL(result.redirect);
          if (url.protocol === "http:" && !httpFallback) throw new Error("Redirected to plain http, which is not allowed for this import.");
          continue;
        }
        const type = sniff(result.buffer);
        if (!type) throw new Error("Not an image or PDF (its content does not match a supported type).");
        return { buffer: result.buffer, mimetype: type.mime, filename: fileNameFor(url, type.ext), finalUrl: url.toString() };
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("Could not be fetched.");
}
