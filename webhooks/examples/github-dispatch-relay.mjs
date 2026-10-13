// A tiny relay: Polysite webhook in, GitHub `repository_dispatch` out. GitHub's API needs a bearer token and a particular body,
// neither of which Polysite sends, so something has to sit between them. This is that something: about 50 lines, no dependencies.
// It checks the signature and the replay window, ignores an event it has already handled, and asks GitHub to run the workflows
// that listen for `repository_dispatch` of type "polysite".
//
//   WEBHOOK_SECRET=<the webhook's signing secret> GITHUB_TOKEN=<fine-grained token: Contents (read and write) on the repo> \
//   GITHUB_REPO=your-org/static-mirror PORT=8787 node github-dispatch-relay.mjs
//
// Point the Polysite webhook at https://<where this runs>/ (https is required in production). Run it anywhere that has a public
// https address: a small VM behind Caddy, a container, or the same code in a serverless function.
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

const { WEBHOOK_SECRET, GITHUB_TOKEN, GITHUB_REPO, PORT = "8787", GITHUB_API = "https://api.github.com" } = process.env;
const handled = new Set(); // event ids already passed on (a restart forgets them; the window below still stops old replays)

function verified(headers, raw) {
  const ts = headers["x-polysite-timestamp"];
  const given = headers["x-polysite-signature"];
  if (!ts || !given || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(`${ts}.${raw}`).digest("hex"));
  const got = Buffer.from(String(given));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (req.method !== "POST" || !verified(req.headers, raw)) return res.writeHead(401).end("bad signature");

  const event = JSON.parse(raw);
  if (handled.has(event.id)) return res.writeHead(200).end("already handled");
  const answer = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "polysite-relay" },
    body: JSON.stringify({ event_type: "polysite", client_payload: { type: event.type, site: event.site?.domain ?? null, id: event.data?.id ?? null } }),
  });
  if (answer.status !== 204) return res.writeHead(502).end(`GitHub answered ${answer.status}`); // Polysite will retry
  handled.add(event.id);
  res.writeHead(200).end("dispatched");
});

if (import.meta.url === `file://${process.argv[1]}`) server.listen(Number(PORT), () => console.log(`relay on ${PORT}`));
