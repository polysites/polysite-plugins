# Email

Lets Payload actually send transactional email ("forgot password" and
anything else Payload sends) via real SMTP. Without this plugin no email
adapter is configured at all: Payload's "forgot password" flow runs, but the
reset link has nowhere to go.

**Scope:** global. Email transport is instance-wide; it isn't something an
individual site turns on or off.

Polysite sends email for password resets, form notifications and the notifications plugin. It hands each
message to an ordinary **SMTP** account you set up under **Email Settings** in the admin. Polysite's job ends at
the hand-off. Whether a message then **reaches an inbox** is the sending service's job: it signs the mail,
publishes the records that prove your domain is allowed to use it (SPF, DKIM, DMARC) and manages its
reputation. Polysite doesn't set up, sign or check those.

- [Set up sending](#set-up-sending) · [Reading a failure](#reading-a-failure) · [If mail isn't arriving](#if-mail-isnt-arriving)
- [Configuration](#configuration-the-database-not-just-env) · [Ports and TLS](#ports-and-tls) · [Email Logs](#email-logs-and-audit)

## Set up sending

1. Choose a service that offers SMTP. A transactional email service (Postmark, Amazon SES, Mailgun, SendGrid,
   Brevo and similar) is the safest choice; a business mailbox or your web host's mail also works for low
   volume. Check each one's current limits and price.
2. Follow **the service's own instructions to verify your sending domain**. It will give you DNS records to
   publish. This is where SPF, DKIM and DMARC are handled, and it is the part that decides whether mail is
   trusted.
3. Copy its SMTP **host, port, username and password** into Email Settings (**Administration > Email**, Super
   Admin only), and set the **From address** to an address on the domain you verified.
4. Save, then click **Send a test email to me**. The result shows the provider's answer, and the attempt appears
   in **Email Logs**.

For development, point Email Settings at a local SMTP catcher instead of a real provider (see
[Local verification](#local-verification)). A catcher shows that Polysite builds and sends correctly, not
whether a real inbox would trust the mail.

## Reading a failure

In **Email Logs**, **Sent** means the provider **accepted** the message; it does not mean it reached the inbox.
Bounces, spam placement and complaints appear in your provider's own dashboard. **Failed** keeps the error and,
where there is one, the SMTP reply code. Temporary refusals are retried twice before it is marked failed.

| What you see | Usually means |
| --- | --- |
| Code `535`, "authentication failed" | Wrong username or password, or the provider needs an app password or API key |
| Code `550` or `553`, sender or recipient rejected | The From address isn't verified with the provider, or the recipient address is invalid |
| Code `421`, "too many connections" | A limit on simultaneous connections. Polysite uses one pooled connection and retries; if it persists, use a dedicated service |
| `ESOCKET`, `ECONNREFUSED` or `ETIMEDOUT` | The host or port is wrong, or something is blocking the connection |
| `wrong version number` on port 465 | The provider wants a different port or encryption mode for that port |

## If mail isn't arriving

1. Open **Email Logs**. If there is no entry, the email was never attempted: check Email Settings has an SMTP
   host (with none set, Polysite only prints what it would have sent in the server log).
2. If the entry says **Failed**, read the error against the table above.
3. If it says **Sent** but nothing arrives, look in your provider's dashboard. That is where bounces and spam
   rejections are shown, and where domain verification problems are reported.
4. A reset link with no domain in it means the CMS address isn't set in the environment; links are built from it.

Good to know: every message carries a **plain-text copy** as well as the HTML one (HTML-only mail scores worse
with spam filters); this is for **transactional** mail, since bulk campaigns need unsubscribe handling and bounce
processing that a dedicated marketing service provides; and the SMTP password is encrypted with
`PAYLOAD_SECRET`, so if you change that secret, enter the password again.

## Configuration: the database, not just `.env`

This plugin registers its own Payload Global, **Email Settings**
(Administration > Email, Super-Admin-only), with SMTP host/port/username/
password and from-address/from-name fields. A Super Admin edits these
directly in the CMS admin UI, and the change takes effect on the **very
next email sent** -- no container restart, because the adapter reads the
current settings document fresh on every send rather than fixing a
transport at boot.

Env vars (`SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`,
`EMAIL_FROM_ADDRESS` (default `no-reply@polysite.local`), `EMAIL_FROM_NAME`
(default `Polysite`) -- see the core repo's
`.env.example`) only seed that document's field defaults the first time it's
created. Once it exists, whatever's saved in the database wins; editing
`.env` after that point does nothing until the document's fields are
cleared back to empty. This is the intended behavior, not a bug: it's what
lets an admin manage this entirely from the CMS without redeploying.

An empty `smtpHost` (the out-of-the-box state, whether from an empty env
var or an admin clearing the field) makes `sendEmail` log what it would
have sent and return, instead of erroring -- the same "fully optional,
nothing breaks when unconfigured" contract every other optional piece of
this project follows.

**The SMTP password is write-only.** Once saved, it reads back as
`••••••••` everywhere -- the admin form and the REST/GraphQL API alike, via a
field-level `afterRead` hook -- and only the send adapter (which opts in
through the local API's `context`) sees the real value. Saving the form with
the bullets untouched keeps the stored password; typing replaces it;
clearing the field removes it.

**Encrypted at rest.** The password is stored as AES-256-GCM ciphertext
(`enc:v1:...`), keyed from `PAYLOAD_SECRET` -- the secret this project
already has -- through HKDF with a plugin-specific label, so the raw secret
is never the cipher key. This is the approach WP Mail SMTP (keyed from
`AUTH_SALT`) and GitLab (`db_key_base`) take. The key is derived once per
process; each encrypt/decrypt is a single AES-GCM call on a short string
(microseconds), and only sending an email decrypts.

- **Existing plaintext migrates itself.** A value without the `enc:v1:`
  prefix is read as-is and encrypted the next time Email Settings is saved.
- **Rotating `PAYLOAD_SECRET` invalidates the stored password.** The sender
  logs `could not decrypt the stored SMTP password` and treats it as empty;
  re-enter it in Email Settings. Use a real, long `PAYLOAD_SECRET` in any
  non-local deployment -- the `changeme...` placeholder in `.env.example`
  makes this encryption cosmetic.
- A failed send is logged (`[email] send failed ...`). Payload's own callers
  (e.g. "forgot password") never surface a send error to the client, so
  this log line is the only signal of a bad SMTP setting.

## Ports and TLS

Port **465** is treated as implicit TLS (encrypted from the first byte); any
other port (587, 25, ...) connects in plaintext and upgrades via STARTTLS
when the server offers it. There's no separate "secure" toggle -- the port
decides, matching Nodemailer's own convention. The plugin uses Nodemailer 10.

## Bulk sending

Settings and one pooled SMTP connection (reused for up to 100 messages, with
a 20 s socket timeout) are built once and reused, so sending many emails
doesn't read the database or open a new connection per message. Saving Email
Settings clears the cache immediately, so the next email uses the new values;
a 5-minute TTL backs that up if another process ever edits the settings.

**Why one connection, not ten:** shared mail hosts cap concurrent SMTP
connections per IP very low. One such host answered `421 Too many concurrent
SMTP connections from this IP address` (on port 465 a TLS client sees that
plaintext refusal as `wrong version number`), and an idle pool of 10 held for
Nodemailer's default 10 minutes locked the CMS out of its own mail server,
so a password-reset email was refused. A transient failure (a 4xx reply or a
dropped connection) is retried twice, after 2 s and 6 s; a rejected
recipient or bad credentials (5xx) is not. If your provider allows more
connections and you need parallel bulk throughput, raise `maxConnections` in
`src/index.js`. Real throughput depends on your SMTP provider.

## Local verification

```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Set the Email Settings global's SMTP Host to Mailpit's reachable address
from inside the CMS container (its container name on the same Docker
network, or `host.docker.internal`), port `1025`, leave username/password
empty, save, then trigger "Forgot password?" from the admin login screen
and watch the message land at http://localhost:8025.

## Email Logs and audit

Every send is recorded in the **Email Logs** collection (Administration > Email, Super Admin only;
entries are written by the plugin and can't be created or edited by hand, only deleted by a Super Admin):

- **message**: each email handed to the SMTP server, with recipient, subject, attempts, and either
  the server's reply and message ID (`sent`) or the error, its code and the SMTP reply code
  (`failed`). Message bodies are never stored (reset emails carry live links).
- **test**: the "Send a test email to me" button on Email Settings (`POST /api/email/test`,
  Super Admin only), with the user who pressed it.
- **settings-change**: who changed Email Settings and which fields (`describeSettingsChange` in
  `src/logs.js`). The password is reported as "changed", never shown.

Logging never blocks mail: a failed log write is reported on the console and the send carries on.
Entries older than **Keep email logs for (days)** (default 90) are deleted shortly after boot and
every 6 hours, since recipients and subjects are personal information. HTML mail also gets a
plain-text part generated from it (`src/text.js`).

Domain authentication (SPF, DKIM, DMARC) and bounce handling belong to the sending provider and
are not managed here.

## Database

The plugin owns two tables, `email_settings` and `email_logs`, and ships the migration that creates them
(`migrations/`). Removing the plugin leaves both in place; putting it back finds the settings and logs as they
were (see "The isolation rule" in the [plugins README](../README.md)).

## Tests

```bash
docker exec polysite-cms-1 sh -c 'cd /repo/plugins/email && node --test test/*.test.js'
```
