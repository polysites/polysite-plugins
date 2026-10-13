# Analytics

Switch on analytics and advertising tools per site without touching code: **Google Analytics 4,
Google Tag Manager, Meta (Facebook) Pixel, TikTok Pixel, LinkedIn Insight Tag, X (Twitter) Pixel,
Plausible, Umami**, or a **custom script** for anything else. Add as many as a site needs.

Polysite doesn't collect visitor data itself. The numbers (visitors, pages, sources) live in the
tools. What the plugin adds is the setup, the consent handling, and a count of form submissions,
which Polysite does hold.

**Scope:** per-site. The plugin is installed once, and each site chooses its own tools (none by
default).

## What it adds

- **A Tracking tools screen** (Administration → Site features → Tracking tools, shown to roles that can manage site settings), one set of settings per site, kept in the plugin's own `analytics-settings` table (nothing is added to Sites). A **Tracking tools** list: click *Add
  tool*, pick one, fill in the ID. Each row has a switch to pause it. IDs are checked when saved
  (a Meta Pixel ID must be digits, a GA4 ID must start `G-`, and so on). Also: *Respect Do Not Track
  and Global Privacy Control*, and optional wording for the consent notice.
- **An Analytics screen** (Content → Analytics): submissions per form, and for each site the tools
  switched on, which consent group each is in, whether it sets cookies, and a link to the tool's
  own dashboard.
- `GET /api/analytics/form-counts` (optionally `?form=ID`) and `GET /api/analytics/overview`, the
  endpoints behind those screens. Signed-in users only, and limited to their own access.

## The ID each tool needs

| Tool | ID to enter |
| --- | --- |
| Google Analytics 4 | Measurement ID, starts `G-` |
| Google Tag Manager | Container ID, starts `GTM-` |
| Meta (Facebook) Pixel | Pixel ID (digits) |
| TikTok Pixel | Pixel ID |
| LinkedIn Insight Tag | Partner ID (digits) |
| X (Twitter) Pixel | Pixel ID |
| Plausible | The domain you added, like `example.org` |
| Umami | The website ID (a UUID) |

A value that doesn't look right is refused with a message, so a typo can't end up on a site. Untick **Switched
on** to pause a tool without losing its settings. If you run Plausible or Umami yourself, enter its address
under **Self-hosted address**, like `https://stats.example.org`. To see the numbers, open **Content ->
Analytics**; each tool has an **Open dashboard** link.

## Custom script

For a tool that isn't in the list, choose **Custom script**, give it a name, choose where it goes
(page head or end of body), and paste the code exactly as the provider gives it: a `<script>` tag,
several tags, or plain JavaScript. It is added after the page loads, in order, and only once its
**consent group** allows it. A pasted script defaults to *Marketing* (asks first). Choose
*Essential* only for something that does no tracking, such as a chat widget.

It runs in every visitor's browser, so paste only what you trust. Only roles that can edit Sites
settings can add one.

Pasting code into a site's **Advanced -> Custom JavaScript** still works, but it runs for every visitor with no
consent step. Tracking tools wait for consent and let you choose where the code goes, so use those instead.

## Consent groups

| Group | Tools | When it loads |
| --- | --- | --- |
| **Essential** | A custom script marked essential | Straight away |
| **Analytics** | GA4 (sets cookies), Plausible and Umami (no cookies) | GA4 after a yes. Plausible and Umami straight away, unless the row says *Ask visitors first* |
| **Marketing** | Meta, TikTok, LinkedIn, X, and by default Tag Manager and custom scripts | After a yes |

Before anything gated loads, the web app checks **Do Not Track and Global Privacy Control**: if the
browser sends either (and the site hasn't turned that off), analytics and marketing tools don't
load and the visitor isn't asked. Otherwise it asks once for each group it hasn't asked about. The
answer is kept in the browser's local storage, not a cookie.

A theme can place `<TrackingSettingsLink />` in its footer: the core's own component shows whatever a plugin has put
in its `footer-links` slot, and this plugin puts "Cookie settings" there. It also puts the consent notice in the
`app` slot and listens for the core's `form_submit` event; the core knows nothing else about analytics, and with
this plugin absent the slots are simply empty. It reopens the
notice so a visitor can change their answer, and rejecting reloads the page so already-running
tools stop. It only appears on sites that have a tool that asks.

## Conversions and form counts

When someone sends a form, every loaded tool is told a form was submitted. It reports the form's ID and nothing
the person typed.

| Tool | What it receives |
| --- | --- |
| Google Analytics 4 | A `generate_lead` event |
| Meta | A `Lead` event |
| TikTok | A `SubmitForm` event |
| LinkedIn, X | A conversion, once you enter the rule's number or event ID on the tool's row |
| Tag Manager | A `polysite_form_submit` event in the data layer, for you to use in a trigger |
| Plausible, Umami | A `form_submit` custom event |

**Content -> Analytics** shows, for each form you can access, submissions in the last 7 days, the last 30 days and
in total, with a link to its submissions. (`GET /api/analytics/form-counts?form=ID` returns one form's counts; no
form edit screen shows them yet.) These are
the submissions Polysite is **holding**: a form set to delete submissions after some days counts only the ones not
yet deleted.

Whether you need consent for a cookieless tool, and what advertising pixels require, depends on where your
visitors are. The plugin gives you the switches; deciding is for you and your privacy advice. Advertising pixels
(Meta, TikTok, LinkedIn, X) share visitor data with those companies, so your privacy policy has to say so.

## How the tags get onto the page

The plugin's CMS part only stores and validates the setting, in its own `analytics-settings` collection (one row per site). The core attaches the row to the site the web app already fetches, as `site.extensions.analytics`; that is the only way the web part reads it. Everything in the row is meant for the visitor's browser (tool IDs, the pasted code of a custom script, the consent wording, the privacy-signal switch), so all of it is public, by name (`PUBLIC_FIELDS` in `src/index.js`); a field added later stays in the admin until it is listed there. Do not paste a secret into a custom script: it is delivered to every visitor. Its **web part** (`web/`, a Nuxt layer the web app
loads like a theme) builds the tags (`web/utils/tracking.ts`, `utils/trackingClient.ts`,
`composables/useTracking.ts`, `components/TrackingConsent.vue`) from the validated values, never from pasted code (the custom
script is the one deliberate exception), and checks them again before adding anything. Nothing is
added during server rendering.

One small browser-side event bus carries two events to every loaded tool: a **page view** on each
in-site navigation (the site navigates without reloading, which pixels would otherwise miss), and a
**form submission** (reported as `generate_lead` in GA4, `Lead` in Meta, `SubmitForm` in TikTok, a
conversion in LinkedIn and X when you give the event ID, and a `polysite_form_submit` event in Tag
Manager's data layer). Events carry the form's ID only, never what the person typed.

## Limits

- The tool snippets are written from the vendors' published setup code and have not been run
  against live accounts. Confirm each with the vendor's own test tool (Meta Pixel Helper, TikTok
  Pixel Helper, GA4 DebugView, LinkedIn Insight Tag Helper) using a real ID before launch.
- Adding a tool means one entry in `src/providers.js` and one in `web/utils/tracking.ts` and
  `trackingClient.ts`. The two catalogues are kept in step by hand.
- Rejecting consent stops tools from loading again; cookies a vendor already set stay until they
  expire.
- Meta, TikTok, LinkedIn and X send visitor information to those companies. Say so in your privacy
  policy, and get advice before using advertising pixels on political or campaign sites.
- Counts are submissions held, not visitors. A form with automatic deletion counts only what hasn't
  expired.
- Client themes that don't use Polysite's footer need to add `<TrackingSettingsLink />` themselves.

## Tests

```bash
docker exec -w /repo/plugins/analytics polysite-cms-1 sh -c "node --test test/*.test.js"
```
