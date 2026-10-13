// A local webhook receiver for trying the Webhooks plugin and for its end-to-end check. It is also the reference for what a real
// receiver does: check the signature, refuse a stale timestamp, ignore an event it has already handled. It uses nothing from the
// plugin (the verification below is the same snippet the README tells you to copy).
//
//   PORT=9100 node plugins/webhooks/test/receiver.mjs
//
// Point a webhook at  http://<this host>:9100/hook/<name>  and give it a signing secret. A name keeps its own secret, replay
// window and behaviour, so one receiver can stand in for several endpoints:
//
//   POST /_config/<name>   {"secret": "...", "toleranceSeconds": 300, "status": 200, "failNext": 0, "delayMs": 0, "replyBody": ""}
//                          status/failNext: answer `status` to the next `failNext` requests, then 200
//   GET  /_log[?name=]     everything received, with whether the signature and the timestamp were good
//   POST /_reset           forget everything
//   POST /hook/<name>      what Polysite calls
//
// The answer to a request that fails verification is 401 (a bad signature) or 409 (outside the replay window or an event id it
// has already handled), so a webhook pointed at a receiver with the wrong secret shows plain failures in the delivery log.
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 9100);
const configs = new Map(); // name -> { secret, toleranceSeconds, status, failNext, delayMs, replyBody }
const seenEvents = new Map(); // name -> Set of event ids already handled
let log = [];

const config = (name) => {
  if (!configs.has(name)) configs.set(name, { secret: process.env.SECRET ?? "", toleranceSeconds: 300, status: 200, failNext: 0, delayMs: 0, replyBody: "" });
  return configs.get(name);
};

// ---- the check a receiver makes ----------------------------------------------------------------------------------------
function verify(secret, headers, rawBody, toleranceSeconds) {
  const timestamp = headers["x-polysite-timestamp"];
  const given = headers["x-polysite-signature"];
  if (!timestamp || !given) return { ok: false, status: 401, reason: "missing headers" };
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  const got = Buffer.from(String(given));
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, status: 401, reason: "signature does not match" };
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!(age <= toleranceSeconds)) return { ok: false, status: 409, reason: "timestamp outside the allowed window" };
  return { ok: true };
}

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://receiver");
    const raw = await readBody(req);

    if (url.pathname === "/_health") return send(res, 200, { ok: true });
    if (url.pathname === "/_log") {
      const name = url.searchParams.get("name");
      return send(res, 200, name ? log.filter((e) => e.name === name) : log);
    }
    if (url.pathname === "/_reset") {
      log = [];
      configs.clear();
      seenEvents.clear();
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/_config/")) {
      Object.assign(config(decodeURIComponent(url.pathname.slice(9))), JSON.parse(raw || "{}"));
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname.startsWith("/hook/")) {
      const name = decodeURIComponent(url.pathname.slice(6));
      const cfg = config(name);
      if (cfg.delayMs) await new Promise((r) => setTimeout(r, cfg.delayMs));
      const checked = verify(cfg.secret, req.headers, raw, cfg.toleranceSeconds);
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {}
      const eventId = req.headers["x-polysite-event-id"] ?? null;
      const handled = seenEvents.get(name) ?? new Set();
      const duplicate = checked.ok && eventId !== null && handled.has(eventId);
      let status = checked.ok ? 200 : checked.status;
      let reason = checked.ok ? null : checked.reason;
      if (checked.ok && duplicate) {
        status = 200; // a duplicate is answered 200 so the sender stops retrying; it just isn't handled twice
        reason = "duplicate event id";
      } else if (checked.ok && cfg.failNext > 0) {
        cfg.failNext -= 1;
        status = cfg.status;
        reason = "told to fail";
      } else if (checked.ok) {
        handled.add(eventId);
        seenEvents.set(name, handled);
      }
      log.push({
        name,
        at: new Date().toISOString(),
        verified: checked.ok,
        reason,
        duplicate,
        answered: status,
        event: req.headers["x-polysite-event"] ?? null,
        eventId,
        deliveryId: req.headers["x-polysite-delivery"] ?? null,
        timestamp: req.headers["x-polysite-timestamp"] ?? null,
        signature: req.headers["x-polysite-signature"] ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        raw,
        body,
      });
      return send(res, status, cfg.replyBody || { ok: status === 200, reason });
    }
    send(res, 404, { error: "not found" });
  })
  .listen(PORT, "0.0.0.0", () => console.log(`webhook receiver on ${PORT}`));
