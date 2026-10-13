import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// An admin supplies the URL and this server makes the request: the classic server-side request forgery surface. A webhook
// pointed at 169.254.169.254 (cloud metadata) or an internal service would otherwise be a way to probe the network from inside
// it. So:
//  - https only in production;
//  - no credentials in the URL;
//  - the check sits in the connection's own DNS lookup, not in a separate "resolve, then fetch" step (validating one lookup and
//    letting the HTTP client resolve again would leave a DNS-rebinding gap), and every address a name resolves to must be public;
//  - an IP literal never goes through DNS, so it is judged up front;
//  - redirects are never followed (a redirect to an internal host would sidestep the check);
//  - the whole attempt has a deadline, and the response body is never read, kept or logged.
// WEBHOOKS_ALLOW_PRIVATE_HOSTS=1 lifts the address check and the https requirement, for an end-to-end test against a throwaway
// receiver on a private network. Never set it on a real install.
const timeoutMs = () => Number.parseInt(process.env.WEBHOOKS_TIMEOUT_MS ?? "", 10) || 10_000;
export const allowPrivate = () => process.env.WEBHOOKS_ALLOW_PRIVATE_HOSTS === "1";

// A failure with a kind the retry policy understands: "blocked" | "invalid" | "network" | "timeout" | "redirect" | "http".
export class DeliveryError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

function expandIPv6(address) {
  let a = address.toLowerCase().replace(/%.*$/, "");
  // A trailing dotted IPv4 part (::ffff:1.2.3.4) becomes two hex groups.
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

// Loopback, private, link-local, carrier-grade NAT, documentation, benchmarking, multicast and reserved ranges.
export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const g = expandIPv6(address);
    if (!g) return true; // cannot be read: refuse
    const embeddedV4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateAddress(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d
    if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and the old IPv4-compatible form
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(embeddedV4(g[6], g[7])); // 64:ff9b::/96 (NAT64)
    if (g[0] === 0x2002) return isPrivateAddress(embeddedV4(g[1], g[2])); // 6to4 embeds an IPv4 address
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    return false;
  }
  return false;
}

// Throws a descriptive error for a URL that should never be saved at all. Returns the parsed URL.
export function assertUrlAllowed(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DeliveryError("invalid", "Not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new DeliveryError("invalid", "Only http(s) URLs are allowed.");
  if (url.protocol === "http:" && process.env.NODE_ENV === "production" && !allowPrivate()) throw new DeliveryError("invalid", "https is required in production.");
  if (url.username || url.password) throw new DeliveryError("invalid", "Put credentials in the signing secret, not in the URL.");
  // The URL parser keeps the brackets on an IPv6 host ("[::1]"), which net.isIP rejects: strip them first.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate() && net.isIP(host) && isPrivateAddress(host)) throw new DeliveryError("blocked", "That address is private or reserved and can't be used as a destination.");
  return url;
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    if (!allowPrivate()) {
      const bad = list.find((a) => isPrivateAddress(a.address));
      if (bad) return callback(Object.assign(new Error(`Blocked: ${hostname} resolves to a private or reserved address`), { code: "EBLOCKED" }));
    }
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

// For saving an endpoint: resolve the name now and refuse one that points inside the network, or that doesn't exist.
export async function checkHostResolves(rawUrl) {
  const url = assertUrlAllowed(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return;
  let list;
  try {
    list = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new DeliveryError("network", `Can't find a server called ${host}. Check the address for a typo.`);
  }
  if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) throw new DeliveryError("blocked", `${host} points to a private or reserved address and can't be used as a destination.`);
}

// POSTs the body and resolves { status } for any 2xx; rejects with a DeliveryError otherwise.
export function postJson(rawUrl, { headers = {}, body }) {
  let url;
  try {
    url = assertUrlAllowed(rawUrl);
  } catch (err) {
    return Promise.reject(err);
  }
  const transport = url.protocol === "https:" ? https : http;
  const limit = timeoutMs();

  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    };
    const req = transport.request(
      url,
      {
        method: "POST",
        lookup: guardedLookup,
        agent: false,
        headers: { "Content-Type": "application/json", "User-Agent": "Polysite-Webhooks/0.1", "Content-Length": Buffer.byteLength(body), ...headers },
      },
      (res) => {
        res.resume(); // the answer is never read or kept
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) return done(resolve, { status });
          if (status >= 300 && status < 400) return done(reject, new DeliveryError("redirect", `The receiver answered ${status} (redirects are never followed). Use the final address.`, status));
          done(reject, new DeliveryError("http", `The receiver answered ${status}.`, status));
        });
        res.on("error", (err) => done(reject, new DeliveryError("network", `Connection error: ${err.code ?? err.message}`)));
      },
    );
    deadline = setTimeout(() => {
      req.destroy();
      done(reject, new DeliveryError("timeout", `Timed out after ${Math.round(limit / 1000)} s.`));
    }, limit);
    req.on("error", (err) => {
      if (err.code === "EBLOCKED") return done(reject, new DeliveryError("blocked", err.message));
      done(reject, new DeliveryError("network", `Could not connect: ${err.code ?? err.message}`));
    });
    req.end(body);
  });
}
