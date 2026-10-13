import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// An admin supplies the URL and this server makes the request, so this is
// the classic SSRF surface: a webhook pointed at 169.254.169.254 (cloud
// metadata) or an internal service would otherwise be a way to probe the
// network from inside it. The check lives in the connection's own DNS
// lookup, not in a separate "resolve then fetch" step -- validating one
// lookup and then letting the HTTP client resolve again would leave a
// DNS-rebinding gap. Redirects are never followed (a redirect to an
// internal host would sidestep the check), and the response body is
// capped. `NOTIFY_ALLOW_PRIVATE_HOSTS=1` lifts the address check for local
// development against a throwaway receiver; https is required whenever
// NODE_ENV is production.
const TIMEOUT_MS = 10_000;
const MAX_BODY = 1024;

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a >= 224 || // multicast and reserved
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (/^fe[89ab]/.test(lower) || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("ff")) return true;
    // NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::) carry an IPv4 address; judge that one.
    const nat64 = lower.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
    if (nat64) return isPrivateAddress(nat64[1]);
    const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(:|$)/);
    if (sixToFour) {
      const hi = parseInt(sixToFour[1], 16);
      const lo = parseInt(sixToFour[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    // IPv4-mapped (::ffff:a.b.c.d). The URL parser normalizes the dotted form
    // to hex (::ffff:7f00:1), so both spellings need to land on the IPv4 rules.
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

function allowPrivate() {
  return process.env.NOTIFY_ALLOW_PRIVATE_HOSTS === "1";
}

// Throws a descriptive error for a URL that should never be saved at all.
export function assertUrlAllowed(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are allowed.");
  if (url.protocol === "http:" && process.env.NODE_ENV === "production") throw new Error("https is required in production.");
  // An IP literal never goes through the connection's DNS lookup, so it has
  // to be judged here. The URL parser keeps the brackets on an IPv6 host
  // ("[::1]"), which net.isIP rejects -- caught by a test, not assumed: every
  // IPv6 literal passed this check until the brackets were stripped.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate() && net.isIP(host) && isPrivateAddress(host)) {
    throw new Error("That address is private or reserved and can't be used as a destination.");
  }
  return url;
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    if (!allowPrivate()) {
      const bad = list.find((a) => isPrivateAddress(a.address));
      if (bad) return callback(new Error(`Blocked: ${hostname} resolves to a private/reserved address`));
    }
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export function safePost(rawUrl, { headers = {}, body }) {
  const url = assertUrlAllowed(rawUrl);
  const transport = url.protocol === "https:" ? https : http;
  const payload = typeof body === "string" ? body : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          if (text.length < MAX_BODY) text += chunk.toString("utf8");
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode });
          reject(new Error(`Destination responded ${res.statusCode}${text ? `: ${text.slice(0, 200)}` : ""}`));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)));
    req.on("error", reject);
    req.end(payload);
  });
}
