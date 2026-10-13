# Webhooks

Tell other systems when something on your Polysite changes. When a page or post is created, updated, published, unpublished
or deleted, when a form is submitted, or when media is uploaded, Polysite sends a **small signed JSON message** to the web
addresses you choose. A static mirror can rebuild, an automation can run, a deploy can start.

- **Chosen in the admin**: a name, a destination URL, a signing secret, one site or all sites, and which events.
- **Safe by design**: a message holds ids, titles and links, never the content of a document and never what a visitor typed
  into a form. Messages are signed (HMAC-SHA256) with a timestamp, so a receiver can tell they are genuine and not replayed.
- **Reliable**: sent through Payload's job queue with exponential-backoff retries, a delivery log, an automatic switch-off for
  an endpoint that keeps failing (with a notice in the admin), a "Send test event" button and a "Replay" button.
- **Guarded**: https only in production, private and internal addresses refused (the DNS answer is checked on every connection),
  redirects never followed, timeouts on every request. The URL and secret are encrypted at rest and never shown again.
- **Self-contained**: its own two tables, nothing added to any core table. Removing the plugin deletes nothing.

Only **Super Admins** manage webhooks, because a destination URL and a secret are credentials.

## Contents

[Set one up](#set-one-up) · [What is sent](#what-is-sent) · [Verify a message](#verify-a-message) · [When it fails](#when-it-fails) ·
[Recipes](#integration-recipes) · [Settings](#settings-environment) · [Testing it locally](#testing-it-locally) · [Security](#security-notes) ·
[Notifications vs Webhooks](#webhooks-or-the-notifications-plugin)

## Set one up

1. In the admin open **Webhooks → Webhooks → Create new**.
2. **Destination URL**: where Polysite POSTs. It must be `https://` and reachable from the Polysite server. A name that points at a
   private or internal address is refused on purpose.
3. **Signing secret**: at least 16 characters. Click **Generate a secret**, copy it into the receiver *now* (it is write-only
   once saved), or use `openssl rand -hex 32`.
4. **Site**: leave empty for every site, or choose one site to send only its events.
5. **Events**: tick what the receiver cares about (see below). A new webhook starts with published / unpublished / deleted for
   pages and posts.
6. Save, then click **Send test event**. The receiver's answer is shown on the spot and the attempt is logged under
   **Webhooks → Deliveries**.

## What is sent

| Event | Sent when |
| --- | --- |
| `page.created`, `post.created` | A page or post is created (as a draft or published). |
| `page.published`, `post.published` | A draft goes live, or one is created already published. |
| `page.updated`, `post.updated` | A live page or post is saved and stays live (also a saved page that isn't live yet). |
| `page.unpublished`, `post.unpublished` | A live page or post is taken down. |
| `page.deleted`, `post.deleted` | It is deleted. |
| `form.submitted` | A visitor submits a form. **Ids only**: the form and the submission, never the answers. |
| `media.uploaded` | A file is uploaded. |
| `webhook.test` | You click **Send test event**. Always sent to that endpoint, never counted as a failure. |

Events describe the **live site**: saving a draft (or an autosave) of a page sends nothing, and publishing sends
`published`, not `updated` as well. `post.*` events exist only when the posts plugin is installed.

A message looks like this (`POST`, `Content-Type: application/json`):

```json
{
  "id": "evt_8f3c0a52-1d0e-4b53-9f5a-0f1f3a6d2e11",
  "type": "page.published",
  "createdAt": "2026-10-11T09:30:12.481Z",
  "site": { "id": "1", "domain": "example.com" },
  "data": {
    "collection": "pages",
    "id": "12",
    "title": "About us",
    "adminUrl": "https://admin.example.com/admin/collections/pages/12",
    "publicUrl": "https://example.com/about"
  }
}
```

- `publicUrl` is present for pages and posts that have a public address, otherwise `null`. For a deleted item `adminUrl` is the
  list, because the item is gone.
- A `form.submitted` message has `data: { collection: "form-submissions", id, formId, adminUrl, publicUrl: null }`. Nothing else.
- There is no user, email address, page body or form answer in any message. The message is built field by field from a fixed
  list, never copied from the document, and a unit test pins that down.
- Fetch details with the API if you need them (sign in with an API key, which the auth plugin offers once `AUTH_API_KEYS=true`).

Headers on every request:

| Header | Meaning |
| --- | --- |
| `X-Polysite-Event` | The event type, e.g. `page.published`. |
| `X-Polysite-Event-Id` | The event's id. **The same on every retry and replay**: ignore an id you have already handled. |
| `X-Polysite-Delivery` | The delivery's id in the admin log. |
| `X-Polysite-Timestamp` | When this attempt was signed (Unix seconds). A retry carries a new one. |
| `X-Polysite-Signature` | `sha256=` and the hex HMAC-SHA256 of `"<timestamp>.<raw body>"`, keyed with the secret. |

## Verify a message

Do all three in the receiver, in this order:

1. Compute the signature from the **raw body** (the exact bytes, before any JSON parsing) and compare it in constant time.
2. Reject a timestamp more than five minutes from now (this is what stops a captured message being replayed later; the
   timestamp is inside the signature, so it can't be changed).
3. Remember event ids for a while and skip one you have seen (retries and replays reuse the id). Answer `2xx` for a duplicate
   so Polysite stops retrying.

Answer within 10 seconds; do slow work after you reply.

**Node.js** (no dependencies; `rawBody` is a string of the unparsed body)

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyPolysite({ secret, rawBody, headers, toleranceSeconds = 300 }) {
  const timestamp = headers["x-polysite-timestamp"];
  const signature = headers["x-polysite-signature"];
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false; // a replay
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

In Express use `express.raw({ type: "application/json" })` (not `express.json()`) so you still have the raw body.

**Python** (standard library; `raw_body` is `bytes`)

```python
import hashlib, hmac, time

def verify_polysite(secret: str, raw_body: bytes, headers: dict, tolerance_seconds: int = 300) -> bool:
    timestamp = headers.get("X-Polysite-Timestamp")
    signature = headers.get("X-Polysite-Signature")
    if not timestamp or not signature:
        return False
    if abs(time.time() - float(timestamp)) > tolerance_seconds:
        return False  # a replay
    expected = "sha256=" + hmac.new(secret.encode(), timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

**PHP**

```php
function verify_polysite(string $secret, string $rawBody, array $headers, int $tolerance = 300): bool {
    $timestamp = $headers['X-Polysite-Timestamp'] ?? null;   // $_SERVER['HTTP_X_POLYSITE_TIMESTAMP']
    $signature = $headers['X-Polysite-Signature'] ?? null;   // $_SERVER['HTTP_X_POLYSITE_SIGNATURE']
    if (!$timestamp || !$signature) return false;
    if (abs(time() - (int)$timestamp) > $tolerance) return false; // a replay
    $expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    return hash_equals($expected, $signature);
}
// $rawBody = file_get_contents('php://input');
```

These three are in `test/snippets/` and were run (in `node:22`, `python:3-alpine` and `php:8-cli-alpine`) against a fixed
signature vector, which a unit test also pins: each accepts the genuine message, rejects a changed body, and rejects a replay.

## When it fails

Each delivery is one job in Payload's queue. If the receiver is down, slow, overloaded or answers `5xx`, `408` or `429`, it is
retried with a doubling wait: by default six attempts at 30 s, 1 min, 2 min, 4 min and 8 min (about 15 minutes in all). A `4xx`
(other than those), a redirect, or an address that isn't allowed is **not** retried: it would answer the same way every time.
Redirects are never followed; give the final URL.

**Webhooks → Deliveries** shows every message: status (queued, sent, will retry, failed, skipped), number of attempts, the
HTTP status the receiver answered, the last error and when the next attempt is due. It never keeps a secret or the receiver's
reply. Entries older than 30 days are removed.

**Switched off automatically.** After ten failed attempts in a row (any success resets the count) the endpoint is switched off
and stops being sent anything, so a dead receiver doesn't pile up work. The webhook's screen shows a red notice with the reason,
and so does the admin dashboard. Fix the receiver, tick **Switched on** again and save: the count starts from zero.

**Replay.** Open a failed or skipped delivery and click **Replay this delivery**: the same event (same id) goes out again,
signed afresh, through the same queue and retries. A delivery can't be replayed while its endpoint is off.

Messages that were queued when an endpoint was switched off, or deleted, are marked *skipped* with the reason.

## Integration recipes

How "tested" is used below: the signature snippets, the relay and the receiver are exercised by this plugin's tests. The
third-party products (Zapier, Make, n8n, GitHub, Netlify, Vercel, Cloudflare) were **not** called from here; their steps are
written from their documentation as it stood when this was written, so a menu may have moved. The part that is yours to check
is always the same: click **Send test event** and see it arrive.

### Zapier (Catch Hook), and Make or n8n

1. **Zapier**: create a Zap, trigger **Webhooks by Zapier → Catch Hook**, copy the *Custom Webhook URL*
   (`https://hooks.zapier.com/hooks/catch/…`).
   **Make**: add a **Webhooks → Custom webhook** module, *Add* a hook and copy its address.
   **n8n**: add a **Webhook** node, method `POST`, copy its *Production URL* (use *Respond immediately*).
2. In Polysite create a webhook with that URL as the destination, any secret of 16+ characters, and the events you want.
3. Click **Send test event**, then in Zapier "Test trigger" / in Make "Run once" / in n8n "Listen for test event". You get the
   fields of the message (Zapier shows them flattened: `type`, `site__domain`, `data__title`, `data__publicUrl`, …).
4. Build the rest: for example *page.published* → Slack message, Google Sheets row, or email.

These tools' hook URLs are themselves secrets, so Polysite stores the URL encrypted and masks it. **Zapier's Catch Hook does not
let you read headers, so it can't check the signature**: treat the URL as the credential and keep it private. Make can expose
request headers (a webhook setting) and n8n always shows them in `$json.headers`; to verify in n8n use a Code node with the
Node snippet above (the node needs `crypto` allowed, `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, and the webhook node's *Raw body*
option on).

Example filter: only act when `type` is `page.published` and `site.domain` is your main site.

### GitHub Actions (rebuild a static mirror) through a small relay

GitHub starts a workflow from outside with `POST /repos/OWNER/REPO/dispatches` and a bearer token, a request Polysite does not
make. So a tiny relay sits between: it receives the signed Polysite message, verifies it, and makes the GitHub call.
[`examples/github-dispatch-relay.mjs`](examples/github-dispatch-relay.mjs) is that relay, about 50 lines and no dependencies;
`test/relay.test.js` runs it against a stand-in for GitHub (accepts the genuine message, calls GitHub once even when Polysite
retries, refuses a forged or altered one).

1. Create a **fine-grained personal access token** limited to the one repository with **Contents: Read and write** (what
   `repository_dispatch` requires).
2. Run the relay where it has a public https address (a small VM behind Caddy, a container, or the same code in a serverless
   function):

   ```bash
   WEBHOOK_SECRET=<the signing secret> GITHUB_TOKEN=<token> GITHUB_REPO=your-org/static-mirror PORT=8787 \
     node github-dispatch-relay.mjs
   ```
3. In Polysite create a webhook pointing at the relay's https address, with `page.published`, `page.unpublished`,
   `page.deleted` (and the `post.*` ones, `media.uploaded` if the mirror includes files).
4. In the repository add a workflow that listens for it:

   ```yaml
   on:
     repository_dispatch:
       types: [polysite]
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: echo "Polysite said ${{ github.event.client_payload.type }} on ${{ github.event.client_payload.site }}"
         # ...build and publish the static copy here
   ```

The relay answers `502` when GitHub refuses, so Polysite retries. Add `concurrency: { group: mirror, cancel-in-progress: true }`
to the workflow so a burst of publishes builds once.

### Slack: the notifications plugin or this one?

| | Notifications plugin | Webhooks plugin |
| --- | --- | --- |
| For | People: "tell the team in Slack when this page changes" | Machines: automations, builds, other systems |
| Format | Slack's own (a readable message with a link) | Polysite's JSON, signed |
| Chosen by | Anyone, per item or per collection (a *Watch* on a document) | A Super Admin, per site and event type |
| Slack's incoming webhook URL | Works directly | **Does not**: Slack wants `{"text": ...}` and rejects ours |

So for a human-readable Slack alert use **Notifications** with a Slack channel. To get Slack messages from webhook events,
send them to Zapier/Make/n8n (or your own small function) and post to Slack from there.

### Cloudflare Pages, Netlify and Vercel deploy hooks

A deploy hook is a secret URL that starts a build when it receives a `POST`; it ignores the body, so Polysite's message can go
straight to it. Create the hook in the platform, then a Polysite webhook with that URL as the destination (any 16+ character
secret), site-scoped if one platform site mirrors one Polysite site, and the events `page.published`, `page.unpublished`,
`page.deleted` (add `post.*` and `media.uploaded` as needed).

- **Netlify**: Site configuration → Build & deploy → Build hooks → *Add build hook* → copy `https://api.netlify.com/build_hooks/…`.
- **Vercel**: Project Settings → Git → Deploy Hooks → create → copy `https://api.vercel.com/v1/integrations/deploy/…`
  (it answers `201`).
- **Cloudflare Pages**: Settings → Builds → Deploy hooks → add → copy
  `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/…`.

Each publish starts one build. If you publish many pages at once, subscribe to fewer events or put the relay or an
automation in between that waits a minute. Because the platforms don't verify the signature, the URL is the credential;
Polysite stores it encrypted and shows it only as bullets.

## Settings (environment)

Defaults suit a real install; the others exist for tests.

| Variable | Default | Meaning |
| --- | --- | --- |
| `WEBHOOKS_MAX_ATTEMPTS` | `6` | Attempts per delivery, the first send included. |
| `WEBHOOKS_RETRY_DELAY_MS` | `30000` | The first wait; each later wait doubles (capped at six hours). |
| `WEBHOOKS_DISABLE_AFTER` | `10` | Failed attempts in a row that switch an endpoint off. |
| `WEBHOOKS_TIMEOUT_MS` | `10000` | Deadline for one request. |
| `WEBHOOKS_LOG_DAYS` | `30` | How long finished deliveries are kept. |
| `WEBHOOKS_ALLOW_PRIVATE_HOSTS` | unset | **Tests only.** `1` allows private addresses and plain http, so a receiver on a private network can be used. A warning is logged if it is set in production. Never set it on a real install. |

Code that writes many documents (an importer) can skip webhooks for those writes by passing `context: { skipWebhooks: true }`
to the local API call.

## Testing it locally

```bash
PORT=9100 node plugins/webhooks/test/receiver.mjs
```

starts a receiver that verifies the signature and replay window, ignores a repeated event id, keeps a log at
`GET /_log`, and can be told to fail (`POST /_config/<name>` with `{"secret": "...", "status": 500, "failNext": 2}`). Point a
webhook at `http://<host>:9100/hook/<name>`; for a receiver on a private network, start the CMS with
`WEBHOOKS_ALLOW_PRIVATE_HOSTS=1`.

- Unit tests: `docker exec polysite-cms-1 sh -c 'cd /repo/plugins/webhooks && node --test test/*.test.js'`
  (signing and replay, address filtering, event building and the no-personal-data rule, retry and switch-off decisions,
  secrets, the hooks against a stand-in for Payload, the relay).
- End-to-end: `test/e2e/webhooks.e2e.mjs` against a running stack and a running receiver (`test/receiver.mjs`). It needs
  the CMS started with the four test settings listed in the script's header (`WEBHOOKS_ALLOW_PRIVATE_HOSTS=1`,
  `WEBHOOKS_RETRY_DELAY_MS=1000`, `WEBHOOKS_MAX_ATTEMPTS=3`, `WEBHOOKS_DISABLE_AFTER=5`). It leaves behind the form it
  submits to (a form with submissions can't be deleted by hand), so use a throwaway stack. The core's
  `tests/e2e/run-with-plugins.sh` does not run it yet.

## Security notes

- **Server-side request forgery.** An admin supplies the URL and the server makes the request. Saving checks the scheme, refuses
  credentials in the URL, literal private addresses and names that don't resolve or resolve inside the network; sending checks
  **every address the name resolves to in the connection's own DNS lookup** (so a name can't change its answer between the check
  and the connection), refuses loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved ranges
  (IPv4 and IPv6, including addresses embedded in IPv6), never follows a redirect, and never reads the reply.
- **Secrets.** The destination URL and signing secret are encrypted with AES-256-GCM keyed from `PAYLOAD_SECRET` (the same scheme
  as the email and notifications plugins), masked as bullets on every read, and "bullets mean keep" when you save the form.
  Only the host name is shown in the list. They are re-read for every attempt, so they never sit in the job queue.
  Changing `PAYLOAD_SECRET` makes the stored values unreadable: re-enter them.
- **Personal data.** Messages carry ids, titles and links. Titles are what an editor typed as a title; if a title is private,
  don't subscribe a third party to that event.
- **Who.** Only Super Admins can read or change webhooks and deliveries; the Test and Replay routes check it again.

## Webhooks or the notifications plugin

The two plugins stay independent and each has its own copy of the small helpers (encryption, address filtering). The
notifications plugin's "signed webhook" channel is for a person's watch on a document: it signs the body alone, has no event id
or timestamp and has no automatic switch-off. Use **Webhooks** for anything automated.

## Data and removal

Two tables of its own: `webhook_endpoints` (with `webhook_endpoints_events`) and `webhook_deliveries`. Nothing is added to a core
table, enum or collection (the only core change a migration makes is the per-collection bookkeeping column Payload keeps, and the
job queue's task name). Removing the plugin or listing it in `POLYSITE_PLUGINS_OFF` deletes nothing; putting it back finds
everything as it was. Migrations are in `migrations/`.

Not included yet: custom headers on the request, per-endpoint payload templates, events for other collections (redirects,
site settings, users) and email on automatic switch-off.
