import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { signedHeaders } from "../src/sign.js";

// The GitHub relay in examples/, run against a stand-in for GitHub's dispatch endpoint.
test("the GitHub relay verifies the signature, asks GitHub to run the workflow once, and refuses forgeries", async () => {
  const dispatches = [];
  const github = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      dispatches.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => github.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { WEBHOOK_SECRET: "relay-secret-0123456789", GITHUB_TOKEN: "ghp_test", GITHUB_REPO: "acme/mirror", GITHUB_API: `http://127.0.0.1:${github.address().port}` });
  const { server } = await import("../examples/github-dispatch-relay.mjs");
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const body = JSON.stringify({ id: "evt_1", type: "page.published", site: { id: "1", domain: "example.com" }, data: { id: "12" } });
  const headers = signedHeaders({ secret: "relay-secret-0123456789", type: "page.published", eventId: "evt_1", deliveryId: 1, body });
  const post = (h, b = body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: b });
  try {
    assert.equal((await post(headers)).status, 200);
    assert.deepEqual(dispatches, [{ url: "/repos/acme/mirror/dispatches", auth: "Bearer ghp_test", body: { event_type: "polysite", client_payload: { type: "page.published", site: "example.com", id: "12" } } }]);
    assert.equal((await post(headers)).status, 200, "a retry of the same event is accepted");
    assert.equal(dispatches.length, 1, "but GitHub is only asked once");
    assert.equal((await post({ ...headers, "X-Polysite-Signature": "sha256=" + "0".repeat(64) })).status, 401);
    assert.equal((await post(headers, body + " ")).status, 401);
    assert.equal(dispatches.length, 1);
  } finally {
    server.close();
    github.close();
  }
});

test("the documented verification snippets agree with the plugin's signature (a fixed vector)", async () => {
  const { signature } = await import("../src/sign.js");
  assert.equal(signature("vector-secret-0123456789", "1791697458", '{"id":"evt_1","type":"page.published"}'), "sha256=52ab579ea93af6761e034e735900fd7260445c1595eb759df6bcc082dd6a3e92");
});
