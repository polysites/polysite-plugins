import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import { isPrivateAddress, prepareUpload, sniffImageType } from "../src/upload.js";

// A 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

let server;
let base;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/ok.png") return res.end(PNG);
    if (req.url === "/redirect") return res.writeHead(302, { Location: "/ok.png" }).end();
    if (req.url === "/svg") return res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("sniffImageType reads the bytes, not a name", () => {
  assert.equal(sniffImageType(PNG).mime, "image/png");
  assert.equal(sniffImageType(Buffer.from("<svg></svg>")), null);
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])).mime, "image/jpeg");
});

test("private and reserved addresses are recognised", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(a), false, a);
});

test("base64 upload: accepts a PNG, names it safely, strips a data: prefix", async () => {
  const file = await prepareUpload({ base64: `data:image/png;base64,${PNG.toString("base64")}`, filename: "My Hero Image!!.JPG" });
  assert.equal(file.mimetype, "image/png");
  assert.equal(file.name, "my-hero-image.png");
  assert.equal(file.size, PNG.length);
});

test("upload refuses non-images, SVG, bad base64, and both or neither source", async () => {
  await assert.rejects(prepareUpload({ base64: Buffer.from("<svg></svg>").toString("base64") }), /Only PNG/);
  await assert.rejects(prepareUpload({ base64: "***" }), /not valid/);
  await assert.rejects(prepareUpload({}), /either base64 or url/);
  await assert.rejects(prepareUpload({ base64: "AAAA", url: "https://x.org/a.png" }), /either base64 or url/);
});

test("url upload: private addresses are refused unless explicitly allowed", async () => {
  await assert.rejects(prepareUpload({ url: `${base}/ok.png` }), /private or reserved/);
  await assert.rejects(prepareUpload({ url: "http://169.254.169.254/latest/meta-data" }), /private or reserved/);
  await assert.rejects(prepareUpload({ url: "https://user:pw@example.org/a.png" }), /Credentials/);
  await assert.rejects(prepareUpload({ url: "ftp://example.org/a.png" }), /Only http/);
});

test("url upload with the test switch: fetches, sniffs, refuses redirects and SVG", async () => {
  process.env.MCP_ALLOW_PRIVATE_HOSTS = "1";
  try {
    const file = await prepareUpload({ url: `${base}/ok.png` });
    assert.equal(file.mimetype, "image/png");
    assert.equal(file.name, "ok.png");
    await assert.rejects(prepareUpload({ url: `${base}/redirect` }), /redirects/);
    await assert.rejects(prepareUpload({ url: `${base}/svg` }), /Only PNG/);
    await assert.rejects(prepareUpload({ url: `${base}/missing` }), /answered 404/);
  } finally {
    delete process.env.MCP_ALLOW_PRIVATE_HOSTS;
  }
});
