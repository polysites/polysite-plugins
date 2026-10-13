# Notifications

Tells people (or a team channel) when content changes -- **opt-in per item,
for any collection.** Nothing notifies until someone watches something.

**Scope:** global. Needs no per-site toggle: a watch row is itself the
opt-in, and site-scoped watches carry their own `site`.

## The model: watches

A **watch** is one row in `notification-watches`:
*(subscriber) watches (target) for (events)*.

- **Target** -- a `collection` plus either
  - a `docId` -> **item scope**: that one document (`updated`, `deleted`,
    `published`), or
  - no `docId` -> **collection scope**: any document in the collection,
    optionally limited to one `site`. This is the only way to hear about
    things that don't exist yet (`created`), e.g. a new form submission.
- **Subscriber** -- a **user** (delivered to their in-admin bell, optionally
  also emailed) or a **channel** (a team destination, below).

Every collection works automatically, including ones added later by other
plugins -- the plugin appends its hooks to whatever is in the config when it
runs (it is applied last).

Users create their own watches from the **"Watch for changes"** entry in any
document's 3-dot menu (it flips to "Stop watching"). A user can only watch
documents they can read, and only for themselves. Collection-scope watches
(no document ID) are made from the **Watches** screen; an ordinary user can
make one for a collection they can read, and only a Super Admin can add a
channel as the subscriber or watch on someone else's behalf.

Everything lives under **Notifications** in the admin sidebar: **Channels**
(Super Admin only), **Watches**, **Deliveries** (Super Admin, read-only) and
**Notifications** (your own inbox).

## Channels (Super Admin only)

`notification-channels` holds team destinations:

| Type | Sends |
| --- | --- |
| `slack` | Incoming-webhook `{text}` (mrkdwn) |
| `teams` | Adaptive Card in the *Workflows* webhook envelope (Microsoft retired the Office 365 connector webhooks; this is the replacement shape) |
| `webhook` | JSON, with `X-Polysite-Event`, `X-Polysite-Delivery` and, if a secret is set, `X-Polysite-Signature: sha256=<HMAC-SHA256 of the raw body>` |
| `email` | One message to the listed recipients, through the Email plugin's transport |

The URL and the signing secret are **encrypted at rest** (AES-256-GCM, key
derived from `PAYLOAD_SECRET` via HKDF with a label specific to this
plugin), returned **masked** over the API, and saving the mask keeps the
stored value -- the same scheme as the Email plugin's SMTP password. A
changed `PAYLOAD_SECRET` makes stored values undecryptable; re-enter them.

## What a notification contains

Only the **minimal event**: collection, document title, event, actor, and a
link. Never document content -- a form-submission alert says "new
submission on form X" with a link, never what was submitted, and an alert
about a deleted page can't resurrect its text.

For user subscribers, **read access is re-checked at delivery time**; if the
subscriber can no longer open the document the delivery is skipped, so a
watch can never leak a title. A deleted document can't be re-read, so a
deletion is announced only to people assigned to the site the document
belonged to (a Super Admin hears of any); a deletion of something with no
site (a user, say) reaches Super Admins only. Channels are not filtered this
way: a channel receives whatever its watches cover.

## Delivery and reliability

Saves are never blocked or failed by notifications. The hook queues a
`polysite-notify` job on Payload's built-in jobs queue (no Redis) **inside
the save's transaction** -- a rolled-back save notifies nobody. Failed
attempts retry with exponential backoff (5 tries, starting at 5 s). Every
attempt is recorded in the read-only `notification-deliveries` log
(status `queued | sent | failed | skipped`, attempts, last error; never the
URL).

The plugin schedules a debounced `jobs.run()` after a save and also
registers a 10-second `autoRun` cron as the retry backstop. Payload only
starts that cron once an admin page has rendered, but the core also runs due
jobs every 30 seconds from server start (`apps/cms/src/jobs/runner.ts`), so
retries resume after a bare reboot without an admin visit. Single-process
runner -- correct for the one-VM deployment, not for horizontally scaled app
servers.

## Outbound safety (SSRF)

Admins give this server URLs to call, so:

- Only `http(s)` URLs are accepted, and `https` is required when
  `NODE_ENV=production`.
- Private, loopback, link-local (including `169.254.169.254`), shared
  (carrier-grade NAT), documentation and benchmarking, multicast and reserved
  IPv4 ranges are refused, and so are their IPv6 counterparts, including
  IPv4-mapped, NAT64 and 6to4 forms that carry such an address. The check runs
  for IP literals when the channel is saved and again **inside the
  connection's own DNS lookup** (no resolve-then-fetch gap for DNS
  rebinding).
- Redirects are never followed; 10 s timeout; response body capped at 1 KB.
- `NOTIFY_ALLOW_PRIVATE_HOSTS=1` lifts the address check -- **local
  development only**, for a throwaway receiver. Do not set it in production.

## The bell

A bell is added to the admin header (`admin.components.actions`): unread
badge, dropdown, mark read / mark all read, polled every 30 s and on tab
focus (no websockets). The inbox is the `notifications` collection; each
user sees and may update only their own rows (and only `readAt`).

## Installing / developing

Drop the folder in `plugins/`, restart the CMS container (see the plugins
README for production). The plugin's own migration creates its tables
(`notification_channels`, `notification_watches`, `notification_deliveries`,
`notifications`) and adds its task to the job queue's task enums. The admin
components are referenced by relative path from `apps/cms/src`, so the core
app needs `turbopack.root` set to the repo root (already in
`apps/cms/next.config.mjs`) and a regenerated import map (the dev container
and production build both do this on start / build).

## Known limits

- No retention job for deliveries or read notifications.
- No auto-watch ("watch pages I edit") and no "page + children" scope.

## Tests

```bash
docker exec polysite-cms-1 sh -c 'cd /repo/plugins/notifications && env -u NOTIFY_ALLOW_PRIVATE_HOSTS node --test test/*.test.js'
```

The address-literal test expects `NOTIFY_ALLOW_PRIVATE_HOSTS` to be unset;
the dev container sets it, so without `env -u` that one test fails.
