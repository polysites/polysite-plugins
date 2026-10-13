# Auth plugin: sign-in security

Single sign-on (Google, Microsoft, GitHub, any OpenID Connect provider), two-factor sign-in with an authenticator app, an optional "required" policy, login lockout settings, API keys and an optional Cloudflare Turnstile check for the Polysite admin.

Everything here is **built in and optional**. Installing the plugin changes nothing for anyone until they, or a Super Admin, switch something on.

## What you get

| Feature | Starting state | Who switches it on |
| --- | --- | --- |
| **Single sign-on**: a button on the sign-in page for each provider you add | No provider, so no buttons | A Super Admin, in **Administration → Sign-in → Sign-in providers** |
| **Two-factor sign-in** (a 6-digit code from Google Authenticator, Microsoft Authenticator, 1Password, Authy and the like) | Off for everyone | Each person, on their own account page (or from the sign-in page) |
| **Policy: required** for Super Admins or for everyone | Optional | A Super Admin, in **Administration → Sign-in → Sign-in security** |
| **Recovery codes** (ten, single use) | Made when a person turns two-factor on | Automatic |
| **Administrator reset** for a lost phone | Available to Super Admins | A button on the person's user screen |
| **Login lockout**: 5 wrong passwords lock an account for 10 minutes | **On** (a Payload default); this plugin only lets you change the numbers | `AUTH_MAX_LOGIN_ATTEMPTS`, `AUTH_LOCK_MINUTES` |
| **API keys** per user, for scripts | Off | `AUTH_API_KEYS=true`; then each person makes their own on their account page |
| **Sign-in check** (Cloudflare Turnstile) on the sign-in and forgot-password pages | Off | A Super Admin, in **Administration → Sign-in → Sign-in security → Sign-in protection**, or `AUTH_TURNSTILE_SITE_KEY` and `AUTH_TURNSTILE_SECRET_KEY` |

## Sign-in check (Cloudflare Turnstile)

A small widget above **Login** (and above **Submit** on the forgot-password page) that proves a visitor is not a script guessing passwords or flooding reset emails. In Turnstile's *managed* mode it usually needs no click: it shows "Success!" by itself. The page stays what it was: email, password, the check, **Login**, and a button per single sign-on provider. It follows the admin's light or dark theme.

**Switch it on (a Super Admin, once):**

1. In the Cloudflare dashboard open **Turnstile**, choose **Add widget**, give it a name, add your admin's host name (for example `admin.example.org`) as the hostname, and choose the widget type **Managed**. Cloudflare shows a **site key** (public) and a **secret key**.
2. In Polysite open **Administration → Sign-in → Sign-in security**, find **Sign-in protection**, tick **Turn the check on**, paste both keys and save. The secret is encrypted at rest and shows as bullets afterwards; leave the bullets alone to keep it. Tick or untick **Applies to: sign-in** and **Applies to: password reset** (both on by default).

**Or from the server's environment** (so a fresh install is protected before anyone can sign in to change settings): set `AUTH_TURNSTILE_SITE_KEY` and `AUTH_TURNSTILE_SECRET_KEY` and restart the CMS. When **both** are set the check is on and they win over what is saved on the screen (one of the two alone does nothing).

**If nobody can sign in** (Cloudflare is unreachable from the server, the keys are wrong, or the widget is blocked for everyone): set `AUTH_CAPTCHA_OFF=1` on the CMS and restart it. It switches the check off whatever else is set. Sign in, fix the keys, then remove the variable.

**What the server does.** On `login` and `forgotPassword` for the users collection, after the per-address throttle, it reads the token the page sends in the header `x-polysite-captcha` and asks Cloudflare's `siteverify` (with the secret, the token and the visitor's address: the last `X-Forwarded-For` entry), waiting at most 5 seconds. It **fails closed**: a missing, spent or refused token, or Cloudflare not answering, refuses the request, with a short message that reveals nothing ("Please complete the check." or "The check could not be completed, try again."). A server log line says why (never a token or a key), with the recovery switch. It is skipped for calls without a forwarded address (the stack calling itself), for this plugin's own sign-in calls (setting up two-factor from the sign-in page), and for API keys and single sign-on, which have their own proof. The two-factor endpoints that already ask for a password are not covered. Because the address comes from `X-Forwarded-For`, keep the CMS port unpublished so only the proxy reaches it (production does).

**What the page does.** It asks `GET /api/auth-captcha/config` (no sign-in needed; answers only whether the check is on and the public site key, never the secret), loads Cloudflare's script once from `challenges.cloudflare.com`, draws the widget and sends the token with the sign-in and reset requests. A token works once, so the widget starts over after every request, right or wrong. If the script cannot load (an ad blocker, a firewall), the page says so and tells operators about `AUTH_CAPTCHA_OFF`. A refused reset request now shows its message instead of "Email sent".

**Content-Security-Policy.** Polysite's own headers do not restrict scripts on the admin (Caddy sends only `frame-ancestors 'none'`). If you add a policy of your own, allow `https://challenges.cloudflare.com` for `script-src`, `frame-src` and `connect-src`.

## Single sign-on

A Super Admin adds a provider under **Administration → Sign-in → Sign-in providers**; each one that is switched on gets a button under the sign-in form.

1. In your provider (Google Cloud console, Microsoft Entra, GitHub OAuth apps, or your own OpenID Connect server), create an app and give it the redirect address `https://<your CMS address>/api/auth-sso/<short name>/callback`, where *short name* is the name you choose below.
2. In Polysite add the provider: a short name (such as `google`), the button text, the type, the client ID and client secret. Microsoft also needs the **directory (tenant) ID**; a generic provider needs its **issuer address** (https). Optionally list the email domains that may use it.
3. Switch it on. People see the button at once.

**Rules that keep it safe**
- **Nobody is created by signing in this way.** The person's email address must already belong to an account (add them as a user first). Otherwise they are told to ask an administrator.
- **The provider must vouch for the address.** Google and generic providers must say the email is verified. For Microsoft, the address counts only when it comes from the directory the provider is bound to. GitHub's primary, verified address is used.
- The first sign-in links the provider's identity to the account; after that the account is matched by that identity, and a different identity from the same provider is refused.
- A locked account (too many wrong passwords) stays locked. The person keeps their role and assigned sites exactly as before.
- The whole exchange is protected against forged and replayed requests (a one-time `state`, a `nonce`, PKCE) and the ID token's signature, issuer, audience and expiry are checked. After signing in a person is only ever sent to a page inside the admin.
- Signing in with a provider does **not** ask for the two-factor code: the provider is responsible for how it verifies someone. If you want everyone to use two-factor, do not enable single sign-on for those accounts, or require it at the provider.
- Client secrets are encrypted at rest and shown as dots after saving. Leaving the dots in place keeps the saved secret.

## For a person

1. Open your account (top right) and find **Two-factor sign-in**, then **Set up**. Scan the picture with your authenticator app (or type the key), enter the 6-digit code it shows, and **save the ten recovery codes**: they are shown once.
2. From then on, sign in as usual. The sign-in page stays email, password and **Login**, with a button per single sign-on provider under it. When your password is right and your account has two-factor on, the code box opens by itself above **Login** and you enter the code and sign in again.
3. Lost your phone? Use a recovery code in the same code box (each works once), then set up again. If you have none left, ask a Super Admin to reset it.

If your administrator requires two-factor and you haven't set it up, sign-in tells you so. The setup opens by itself above the **Login** button: it asks you to confirm your email and password, shows the picture, and finishes with your recovery codes. Then sign in as usual.

## For a Super Admin

- **Administration → Sign-in → Sign-in security**: choose *Optional*, *Required for Super Admins* or *Required for everyone*, and the name your authenticator app shows. Required means a person without it can't sign in until they have set it up (with their password), and can't turn it off.
- **Lost phone and recovery codes:** open the person's user screen and press **Reset two-factor sign-in**. They are signed out everywhere and sign in with their password. The reset is written to the server log.
- **Single sign-on** providers are managed under **Administration → Sign-in → Sign-in providers** (see above).
- **Lockout** and **API keys** are environment settings (above). Restart the CMS after changing them. **Administration → Sign-in → API keys** lists everyone's keys (never the key itself) and a Super Admin can delete any of them to revoke it at once.
- **Single sign-on links** are listed under **Administration → Sign-in → Linked sign-ins**. Delete one to unlink an identity; that person's next sign-in links again by their verified email.

## API keys

Switch them on with `AUTH_API_KEYS=true` (and restart the CMS). Then each person can open their own account page, find **API keys**, and make a key for a script: give it a label and, if you like, a number of days after which it stops working. The key is shown **once**; copy it then. A person can hold ten.

```bash
curl -H "Authorization: Bearer psk_ab12cd34_..." https://<your CMS address>/api/users/me
```

- A key signs in **as its owner**: every access rule that applies to that person applies to the request, so a key can never do more than the person can.
- It is stored only as a keyed hash, so reading the database does not reveal a key. A lost key can't be shown again: delete it and make another.
- It **skips the second factor**, like any token a person makes for a script, and works until it expires or is deleted (by its owner or any Super Admin). A key of a person who is deleted stops working at once, and one of a locked account is refused.
- A key can't make or delete keys, or change anyone's two-factor settings: those need a real sign-in, so a stolen key can't outlive its own deletion or lock the owner out.
- Payload's own API-key feature is not used (it adds columns to the users table); this is the plugin's own, in a table of its own.

## How it protects you

- The authenticator secret is **encrypted at rest** (AES-256-GCM, keyed from `PAYLOAD_SECRET`), and the recovery codes are stored only as hashes. They live in the plugin's own `auth-user-state` table, which nobody can read or write through the API (REST or GraphQL), not even a Super Admin; a Super Admin can only reset it.
- A code can be used **once**: a code that was accepted, or an older one, is refused. Codes from the current 30-second window and one either side are accepted, for clocks that drift.
- **Guessing is limited:** five wrong codes in a row lock that person's second factor for 10 minutes, even for a right code. The count is kept in its own table so a refused sign-in can't undo it.
- **Resetting a password by email does not skip two-factor:** the session that reset would hand out is removed, and the person signs in again with the new password and a code.
- A password alone is never enough for an account with two-factor on: without a valid code or an unused recovery code, the sign-in is refused.

## Things to know

- **Switching the plugin off** keeps everyone's two-factor data (it is in the plugin's own tables) but stops asking for codes, so those accounts go back to password only until the plugin is on again. The data is never deleted. API keys stop working while the plugin is off.
- **Changing `PAYLOAD_SECRET`** makes stored secrets unreadable; affected people (or a Super Admin reset) set two-factor up again.
- **Setting up from the sign-in page** trusts the password: someone who has stolen a password could enrol their own phone on an account that had not set up two-factor yet. Requiring two-factor for everyone, and having people enrol straight after their account is created, closes that window.
- The code travels from the sign-in page in a two-minute, same-site cookie (`polysite-totp`); scripts can send the header `x-polysite-totp` instead.

## For developers

```text
src/index.js        the plugin: collections, the hooks on users, endpoints, settings, lockout and the API key strategy
src/userState.js    the `auth-user-state` collection (two-factor state, one row per user, closed to the API)
src/totp.js         RFC 6238 codes on node:crypto (tested against the RFC vectors)
src/recovery.js     recovery codes, stored as keyed hashes
src/policy.js       who must use it; the wrong-code counter rules
src/twofactor.js    reading and changing a person's state (and why the wrong-code counter has its own table)
src/hooks.js        the sign-in check and the password-reset guard
src/captcha.js      the Turnstile check: which keys are in charge, the siteverify call, the users `beforeOperation` hook, the public config endpoint, the secret field
src/sso/            single sign-on: provider settings (collection.js), linked identities (identities.js), the flow and its state cookie (state.js), reading the
                    provider's answer (claims.js, providers.js) and the three endpoints (endpoints.js)
src/endpoints.js    /api/auth-2fa/*: status, setup, confirm, disable, recovery-codes, admin-reset, enroll/start, enroll/confirm
src/apikeys/        API keys: the collection, the sign-in strategy, the key format, the three /api/auth-keys/* endpoints
src/admin/          the sign-in code box, the single sign-on buttons, the Turnstile widget (CaptchaGate.js, a provider, because the forgot-password page has no slot), the account panel and the "required" banner (no JSX)
test/               unit tests (node --test); test/e2e/ holds checks that need a running stack: a mock identity provider
                    (mock-oidc.mjs) and scripts for two-factor, single sign-on, API keys and the Turnstile check (captcha.e2e.mjs: uses Cloudflare's test keys, needs internet and skips without it, and has three phases for three CMS environments)
```

**Database:** the plugin adds nothing to the users collection's table. Its own tables are `auth-user-state`, `auth-attempts`, `sso-providers`, `sso-identities`, `auth-api-keys` and the `auth-settings` global, created by the plugin's own migrations in `migrations/` (the second one, `auth_captcha`, adds the five `sign_in_protection_*` columns to the plugin's own `auth_settings` table). The only thing on the users screen is a pair of panels (`ui` fields, which have no column). After changing the plugin's collections, generate a new migration with `scripts/pluginMigrations.sh plugin auth <name>` and check it with `scripts/pluginMigrations.sh check auth`.

**Writing to the user row:** only the sessions list is still written there (as Payload does itself). The database layer rewrites *every* array field of a row from what it is given, so a write that names only `sessions` would empty `assignedSites`; `saveWithArrays` hands over the whole document (see Known Issue #60). The two-factor state is written to its own table with `saveState`, and does not touch the user row at all, which also removes the sign-in deadlock that writing to the user row inside the sign-in hook used to risk (Known Issue #59).

**Testing single sign-on without a real provider:** `test/e2e/mock-oidc.mjs` is a small OpenID Connect server, and `test/e2e/sso.e2e.mjs` drives the whole flow against a running stack (set `AUTH_SSO_ALLOW_HTTP=1` on the CMS, which lets it talk to a plain-http provider; never set that in production). Run the tests with `node --test test/*.test.js`.
