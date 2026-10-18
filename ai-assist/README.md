# AI assist in the editor

Help for an editor **inside the Payload admin**: draft or rewrite a text, suggest a search title and description, suggest alt text for an image, translate a field, or build a draft page from a brief. It is a different thing from the [`mcp`](../mcp/README.md) plugin, which lets an outside AI agent work on the site; the two share the page-block logic and nothing else.

- **Off until a Super Admin switches it on**, and then only for the sites they tick.
- **Every result is a suggestion.** It appears next to the current text; **Use this** only changes the open form, and the editor still has to save. The one thing it creates is a **draft** page (build from a brief), as the signed-in editor. Nothing is ever published.
- The design and the choices still to confirm are in [DESIGN.md](DESIGN.md).

## Turn it on

1. Install the plugin (it is in this folder; restart the CMS). A migration creates three tables of its own.
2. As a Super Admin open **Administration → AI assist settings**.
3. Give it a key, in one of two ways:
   - **Environment variable (preferred):** set `AI_ASSIST_API_KEY` (or `ANTHROPIC_API_KEY`) on the CMS container. When it is set, nothing is stored in the database.
   - **Or** paste the key into the settings. It is **encrypted at rest** (AES-256-GCM, key derived from `PAYLOAD_SECRET`, like the email and webhooks plugins), shown as bullets afterwards, never returned by the API and never sent to a browser. Changing `PAYLOAD_SECRET` makes it unreadable; paste it again.
4. Press **Test the key and model**.
5. Tick **Switched on**, tick the sites that may use it, save.

Editors of those sites now see an **AI assist** box at the top of a page, post or image.

## What an editor can ask for

| Where | Ask | Sent to the model | Comes back |
| --- | --- | --- | --- |
| page, post | **Write or rewrite text** (pick a field, say what you want) | that field's text, your instruction, the page title | replacement text; for a rich-text field, formatted text (Markdown converted for you) |
| page, post | **Search title and description** | the page title and its text | a title (60 characters at most) and a description (155 at most), filled into the SEO fields on **Use these** |
| page, post | **Translate** a field into a language you type | that field's text | the translation, same formatting |
| image (saved) | **Alt text** | the image file | one sentence (125 characters at most) |
| page | **Draft a page from a brief** | the brief and the list of blocks this install has | a **new draft page** built only from those blocks, checked the way the MCP plugin checks them, with a link. Pictures and forms are left for the editor to add |

The box shows only what the person may do: they need permission to *update* what they are working on (to create pages, for the brief), and they must belong to the site.

## What is sent, and what is not

- Only the text you are working on, your instruction, and for alt text the image. Nothing is read in the background, nothing in bulk.
- **Never** form submissions, privacy requests, users, API keys or another site's content: the plugin only reaches pages, posts and media.
- Email addresses and phone-like numbers are masked as `[email]` and `[phone]` before sending (setting **Mask email addresses and phone numbers**, on by default).
- Page text is passed to the model as data, with an instruction not to follow anything inside it. Answers are read as JSON and checked; they are never run, and a page plan that does not fit the site's blocks is refused.
- **The usage log never holds the text or the answer**: only who, which site, which action, the model and the token counts, kept for 90 days (**Administration → AI assist use**).
- The provider receives what is sent, under its own terms. For a model you host yourself, use the OpenAI-compatible provider.

## Provider and model

| Setting | Notes |
| --- | --- |
| Provider | **Anthropic (Claude)**, the default, through the official SDK; or **OpenAI-compatible endpoint** (set the endpoint address) for a self-hosted or other model |
| Model | Default `claude-opus-5-5`. Cheaper: `claude-sonnet-5-5`, `claude-haiku-5-5`. Any id the provider accepts |
| Retry policy refusals on a fallback model | Anthropic's server-side fallback beta. Off by default |

Replies use structured JSON output, low effort for short tasks and medium for page building. A new provider is one file in `src/providers/` plus one line in its index.

## Cost and limits

All editable in the settings.

| Limit | Default |
| --- | --- |
| Requests per site per day | 500 |
| Tokens per site per month (input plus output) | 3,000,000 |
| Requests per person per minute (kept in memory, so per CMS process) | 10 |
| Longest text sent at once | 20,000 characters |

A limit that is reached answers with a plain message and sends nothing to the provider. The settings page shows, per site, today's requests, this month's tokens against the budget, and an **estimated** cost from the per-million-token prices you enter (defaults are the list price of the default model; they are not read from the provider).

## Checked

- Unit tests: `node --test test/*.test.js` inside the CMS container (23 tests: providers with a fake client and fake fetch, prompts and masking, limits, the actions, and the endpoint's rules with a stand-in for Payload).
- In a real browser on the dev stack, against a stand-in model server: the box is absent while off; with it on for a site, rewrite of a plain field and of a rich-text field, SEO suggestion into the SEO fields, build-from-brief (a draft page with 3 blocks), alt text from an image, the settings page (test button, usage table), the key stored encrypted and shown masked, personal data masked in what the model received, and an editor outside the site refused.
- `scripts/pluginMigrations.sh check ai-assist`: the migration matches its tables and touches nothing of the core's.

**Not checked:** a call to the real Anthropic API (no key was available; the request shape follows the SDK documentation and is covered by a test with a fake client), the fallback option, the OpenAI-compatible provider against a real server, the migration on a production-mode boot, and a screen reader pass on the box.

## Not built

Streaming replies; rewriting a selection inside the rich-text editor (a suggestion replaces the whole chosen field); filling another language version of a page automatically; a per-person budget; saving what was sent for audit.

## For developers

```text
src/index.js            the plugin: adds the box (a ui field, no column) to pages, posts and media, the settings global, the usage collection, four endpoints
src/service.js          the endpoints: status, run, usage, test; every rule (site, role, limits, targets) lives here
src/actions.js          one function per action: builds the request, reads and checks the answer
src/prompts.js          the prompts and answer shapes; site text is wrapped as data
src/providers/          the provider interface, the Anthropic and OpenAI-compatible adapters
src/limits.js           limits, cost estimate, per-person rate limit
src/mcp.js              loads schema.js and markdown.js of the sibling mcp plugin (describe, validate, Markdown to Lexical)
src/lexical.js redact.js crypto.js
src/admin/AiPanel.js    the box; SettingsPanel.js the status, test button and usage table
```

The plugin expects the `mcp` folder next to it (it always is in the workspace and the images). Without it, text, SEO and alt-text suggestions still work, rich-text suggestions come back as plain text, and building a page says it needs the folder.

Tables: `ai_assist_settings`, `ai_assist_settings_rels`, `ai_assist_usage`, in `migrations/`. Removing the plugin deletes nothing.
