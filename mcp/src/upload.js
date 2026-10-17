import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// Getting a picture from an agent into the media library. Two ways in: the bytes themselves (base64, fine for small images) or a public
// https address the server fetches. The second is a server-side request forgery surface, so the same rules as the webhooks plugin apply:
// https only in production, no credentials in the URL, every address a name resolves to must be public (checked inside the connection's
// own DNS lookup, so a name cannot change its answer between check and connect), redirects are never followed, and the download has a
// size cap and a deadline. The file's real type comes from its first bytes, never from what the sender or the server claims, and SVG is
// refused because it can carry script.

export const MAX_BYTES = () => (Number.parseInt(process.env.MCP_MAX_UPLOAD_MB ?? "", 10) || 8) * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const allowPrivate = () => process.env.MCP_ALLOW_PRIVATE_HOSTS === "1";

export class UploadError extends Error {}

export function sniffImageType(buffer) {
  const b = buffer;
  if (b.length >= 8 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 6 && b.toString("latin1", 0, 3) === "GIF") return { mime: "image/gif", ext: "gif" };
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp" && /avif|avis/.test(b.toString("latin1", 8, 12))) return { mime: "image/avif", ext: "avif" };
  return null;
}

function expandIPv6(address) {
  let a = address.toLowerCase().replace(/%.*$/, "");
  const dotted = a.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const [, head, p, q, r, s] = dotted;
    a = `${head}${((+p << 8) | +q).toString(16)}:${((+r << 8) | +s).toString(16)}`;
  }
  const [left, right] = a.split("::");
  const l = left ? left.split(":") : [];
  const r = right === undefined ? [] : right ? right.split(":") : [];
  const fill = right === undefined ? 0 : 8 - l.length - r.length;
  const groups = [...l, ...Array(Math.max(0, fill)).fill("0"), ...r].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const g = expandIPv6(address);
    if (!g) return true;
    const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateAddress(v4(g[6], g[7]));
    if (g.slice(0, 6).every((x) => x === 0)) return true;
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(v4(g[6], g[7]));
    if (g[0] === 0x2002) return isPrivateAddress(v4(g[1], g[2]));
    if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return true;
    return g[0] === 0x2001 && g[1] === 0x0db8;
  }
  return false;
}

export function assertUrlAllowed(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UploadError("Not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UploadError("Only http(s) addresses are allowed.");
  if (url.protocol === "http:" && process.env.NODE_ENV === "production" && !allowPrivate()) throw new UploadError("https is required in production.");
  if (url.username || url.password) throw new UploadError("Credentials in the address are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate() && net.isIP(host) && isPrivateAddress(host)) throw new UploadError("That address is private or reserved.");
  return url;
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error(`${hostname} resolves to a private or reserved address`), { code: "EBLOCKED" }));
    }
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export function fetchImage(rawUrl) {
  const url = assertUrlAllowed(rawUrl);
  const transport = url.protocol === "https:" ? https : http;
  const max = MAX_BYTES();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    };
    const req = transport.get(url, { lookup: guardedLookup, agent: false, headers: { "User-Agent": "Polysite-MCP/0.1", Accept: "image/*" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.resume();
        return finish(reject, new UploadError(status >= 300 && status < 400 ? `The address redirects (${status}); redirects are not followed. Use the final address.` : `The server answered ${status}.`));
      }
      if (Number(res.headers["content-length"]) > max) {
        res.resume();
        return finish(reject, new UploadError(`The file is larger than ${max / 1024 / 1024} MB.`));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > max) {
          req.destroy();
          return finish(reject, new UploadError(`The file is larger than ${max / 1024 / 1024} MB.`));
        }
        chunks.push(chunk);
      });
      res.on("end", () => finish(resolve, Buffer.concat(chunks)));
      res.on("error", (err) => finish(reject, new UploadError(`Download failed: ${err.code ?? err.message}`)));
    });
    const deadline = setTimeout(() => {
      req.destroy();
      finish(reject, new UploadError("The download timed out."));
    }, TIMEOUT_MS);
    req.on("error", (err) => finish(reject, new UploadError(err.code === "EBLOCKED" ? err.message : `Could not download: ${err.code ?? err.message}`)));
  });
}

const safeName = (name, ext) => {
  const base = String(name ?? "image").replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "image";
  return `${base}.${ext}`;
};

// Returns { data, mimetype, name, size } in the shape Payload's local API wants for `file`.
export async function prepareUpload({ base64, url, filename }) {
  if (Boolean(base64) === Boolean(url)) throw new UploadError("Give either base64 or url, not both and not neither.");
  let buffer;
  if (url) buffer = await fetchImage(url);
  else {
    const raw = String(base64).replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new UploadError("base64 is not valid.");
    if (Math.floor((raw.length * 3) / 4) > MAX_BYTES()) throw new UploadError(`The file is larger than ${MAX_BYTES() / 1024 / 1024} MB.`);
    buffer = Buffer.from(raw, "base64");
  }
  if (!buffer.length) throw new UploadError("The file is empty.");
  const type = sniffImageType(buffer);
  if (!type) throw new UploadError("Only PNG, JPEG, GIF, WebP and AVIF images are accepted (SVG is not).");
  const fallback = url ? new URL(url).pathname.split("/").pop() : "image";
  return { data: buffer, mimetype: type.mime, name: safeName(filename ?? fallback, type.ext), size: buffer.length };
}
