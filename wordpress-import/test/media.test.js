import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import { downloadMedia, hostAllowed, isPrivateAddress, parseAllowList, refusal, sniff } from "../src/media.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
let server;
let base;
let hits;

before(async () => {
  process.env.WORDPRESS_IMPORT_ALLOW_PRIVATE_HOSTS = "1";
  hits = [];
  server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === "/ok.png") return res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
    if (req.url === "/lie.png") return res.writeHead(200, { "Content-Type": "image/png" }).end("<html>not an image</html>");
    if (req.url === "/big.png") return res.writeHead(200, { "Content-Type": "image/png" }).end(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));
    if (req.url === "/missing.png") return res.writeHead(404).end();
    if (req.url === "/hop.png") return res.writeHead(302, { Location: "/ok.png" }).end();
    if (req.url === "/away.png") return res.writeHead(302, { Location: "http://evil.example/x.png" }).end();
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("private, loopback, link-local and metadata addresses are recognised", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) assert.equal(isPrivateAddress(a), false, a);
});

test("the allow-list is the export's own host plus whatever was added", () => {
  const allow = parseAllowList("cdn.example.com, https://img.example.org/path\nBAD_HOST!", "Old.Example");
  for (const h of ["cdn.example.com", "img.example.org", "old.example"]) assert.equal(allow.has(h), true, h);
  assert.equal(allow.has("host!"), false);
  assert.equal(hostAllowed("OLD.example", allow), true);
  assert.equal(hostAllowed("evil.example", allow), false);
  assert.equal(allow.has("bad host!"), false);
});

test("refusals: other hosts, other schemes, credentials", () => {
  const allow = new Set(["old.example"]);
  assert.equal(refusal("https://old.example/a.png", allow), null);
  assert.match(refusal("https://evil.example/a.png", allow), /not on the allow-list/);
  assert.match(refusal("ftp://old.example/a.png", allow), /Only http/);
  assert.match(refusal("https://user:pw@old.example/a.png", allow), /user name/);
  assert.match(refusal("nonsense", allow), /Not a valid/);
});

test("a private address is refused unless the test switch is on", async () => {
  delete process.env.WORDPRESS_IMPORT_ALLOW_PRIVATE_HOSTS;
  try {
    assert.match(refusal("http://127.0.0.1/a.png", new Set(["127.0.0.1"])), /private/);
    await assert.rejects(downloadMedia(`${base}/ok.png`, new Set(["127.0.0.1"])), /private|Blocked|reserved/);
    await assert.rejects(downloadMedia("http://localhost:1/a.png", new Set(["localhost"]), { timeoutMs: 2000 }), /Blocked|private|ECONN/);
  } finally {
    process.env.WORDPRESS_IMPORT_ALLOW_PRIVATE_HOSTS = "1";
  }
});

test("sniffing trusts the bytes, not the server", () => {
  assert.equal(sniff(PNG).mime, "image/png");
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])).mime, "image/jpeg");
  assert.equal(sniff(Buffer.from("GIF89a....")).mime, "image/gif");
  assert.equal(sniff(Buffer.from("%PDF-1.7 x")).mime, "application/pdf");
  assert.equal(sniff(Buffer.from("<svg xmlns=")), null);
  assert.equal(sniff(Buffer.from("<html>")), null);
});

test("a good image downloads with a clean file name", async () => {
  const got = await downloadMedia(`${base}/ok.png`, new Set(["127.0.0.1"]));
  assert.equal(got.mimetype, "image/png");
  assert.equal(got.filename, "ok.png");
  assert.equal(got.buffer.length, PNG.length);
});

test("wrong content, too big, not found: each fails with a plain message", async () => {
  const allow = new Set(["127.0.0.1"]);
  await assert.rejects(downloadMedia(`${base}/lie.png`, allow), /Not an image or PDF/);
  await assert.rejects(downloadMedia(`${base}/big.png`, allow, { maxBytes: 1024 * 1024 }), /limit/);
  await assert.rejects(downloadMedia(`${base}/missing.png`, allow), /404/);
});

test("redirects are followed only inside the allow-list", async () => {
  const allow = new Set(["127.0.0.1"]);
  assert.equal((await downloadMedia(`${base}/hop.png`, allow)).mimetype, "image/png");
  await assert.rejects(downloadMedia(`${base}/away.png`, allow), /Redirected: .*not on the allow-list/);
});

test("an http address is tried over https first, and plain http can be switched off", async () => {
  const allow = new Set(["127.0.0.1"]);
  const before = hits.length;
  await assert.rejects(downloadMedia(`${base}/ok.png`, allow, { httpFallback: false, timeoutMs: 3000 }));
  assert.equal(hits.length, before, "no plain http request was made");
});
