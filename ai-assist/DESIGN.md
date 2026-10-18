# AI assist in the editor: design

Status: built as `ai-assist` 0.1.0. Items marked **Owner to confirm** are defaults chosen so the feature works; each is one setting or one constant to change.

## What an editor can ask for

All of it happens inside the Payload admin, on the edit screen of a page, a post or an image, in an **AI assist** box at the top. Every result is a *suggestion* shown next to the current text; nothing is written until the editor presses **Use this**, and even then it only changes the open form, which the editor still has to save. Nothing ever publishes.

| Ask | Where | What the model gets | What comes back |
| --- | --- | --- | --- |
| Draft or rewrite a text | page, post | the chosen field's current text (if any), the instruction, the page title | replacement text (Markdown for rich-text fields) |
| SEO title and description | page, post | the page title and its text | a title (60 characters at most) and a description (155 at most) |
| Translate a field | page, post | the chosen field's text, the target language | the translated text, same formatting |
| Suggest alt text | image | the image file itself | one sentence of alt text (125 characters at most) |
| Build a page from a brief | page (new or existing) | the brief, the list of blocks this install has (`polysite_describe_blocks` logic) | a **new draft page**, checked against the blocks exactly as the MCP `polysite_create_page` does, opened for review |

Build-from-brief is the only action that creates a record. It creates a **draft** page, as the signed-in editor (their role and site assignment decide whether it is allowed), and links to it.

## Provider and key

- The model call goes through a small provider interface (`src/providers/`). Two adapters ship: **Anthropic** (the official SDK, the default) and an **OpenAI-compatible endpoint** (any server that speaks `/chat/completions`, for a self-hosted or other model). A new provider is one file.
- Default model: `claude-opus-5-5`, effort `low` for short tasks and `medium` for page building, structured JSON output, refusals handled. **Owner to confirm:** a cheaper default (`claude-sonnet-5-5` is half the price, `claude-haiku-5-5` a twentieth) is a one-field change in the settings.
- The key: the environment variable `AI_ASSIST_API_KEY` (or `ANTHROPIC_API_KEY`) wins when set, and never touches the database. Otherwise a Super Admin pastes it into **AI assist settings**; it is encrypted at rest (AES-256-GCM, key derived from `PAYLOAD_SECRET`, the scheme of the email and webhooks plugins), masked on every read, "mask means keep" on save. It is never in git and never reaches the browser.

## Off until a Super Admin switches it on

`enabled` defaults to **off**, and a site must also be ticked in the settings. Only Super Admins can see or change the settings. Until both are true the box does not appear and the endpoint answers "not switched on".

## Who can use it

Any signed-in editor who may *update* the thing they are working on (the core's `hasCapability`), on a site they belong to. Editors cannot reach the key, the settings or the usage log. Build-from-brief additionally needs the permission to create pages (Payload checks it, not this plugin).

## What is sent to the provider

- Only the text of the field or page the editor is working on, the instruction they typed, and for alt text the image they chose. Nothing is read in the background; there is no bulk or scheduled use.
- **Never** form submissions, privacy requests, users, API keys or other sites' content: the endpoint has no code path that reads those collections. The client sends the text, so the server also enforces a character cap and a collection allow-list (pages, posts, media).
- Email addresses and phone-like numbers in the outgoing text are masked (`[email]`, `[phone]`) before sending (on by default; setting `maskPersonalData`). Page text is public content, so this is a guard against someone pasting a private note, not the main control.
- Page text is treated as data, not instructions (the prompt says so, and the reply is parsed as JSON and validated, never executed). A reply can only ever become text in a form the editor reviews, or a draft page whose blocks are validated.
- The usage log keeps who, which site, which action, model and token counts. **Never the prompt, the text or the reply.** Kept 90 days.

## Cost and rate limits

Per site: a daily request cap (default 500) and a monthly token budget (default 3,000,000). Per person: a per-minute cap (default 10, kept in memory per CMS process). A cap that is reached answers with a plain message and sends nothing to the provider. The settings page shows this month's use and an estimated cost per site from editable per-million-token prices. **Owner to confirm** the defaults.

## Reuse of the MCP plugin

Build-from-brief reuses `mcp/src/schema.js` (describing and validating blocks) and `mcp/src/markdown.js` (Markdown to Lexical, also used for rich-text suggestions) by importing them from the sibling folder at run time. Those two files have no dependencies. **Owner to confirm:** the cost is that `ai-assist` expects the `mcp` folder to sit beside it (it always does in the workspace and in the images); without it, text, SEO and alt-text suggestions still work, and rich-text suggestions come back as plain text to paste, and build-from-brief says it needs the folder. The alternative is copying the two files (they would drift). The page-creation code is not reused: `tools.js` is bound to the MCP server and its `zod` schemas, so the small draft-creating step (about ten lines) is written again here.

## Data

Own tables only (`ai_assist_settings`, `ai_assist_settings_rels`, `ai_assist_usage`), own migration in `migrations/`. Nothing is added to any core table. Removing the plugin deletes nothing.

## Not built

Streaming replies; editing several fields in one go; rewriting a selection inside the rich-text editor (the suggestion replaces the whole chosen field); translating from another language version of the same page automatically; a per-user budget; an audit of the text sent.

## Reuse or build: community plugins considered

- **`payload-ai-agent` 0.5.1** (community, MIT, a chat assistant that turns natural language into admin actions): **not used, not reviewed in depth.** Reasons from what its listing says, not from its code: it is very young (eight releases in four days, nothing since), it is a free-form chat that performs actions, where Polysite needs fixed, reviewable suggestions that never write on their own; and it cannot be assumed to meet the plugin contract (own tables and migrations, off until a Super Admin switches it on, drafts only, no personal data sent, the key encrypted, per-site limits). Treat it as inspiration. **Owner to confirm** if a review of its code is wanted before the decision is final.
- **`@payloadcms/plugin-mcp`** is already wrapped by the `mcp` plugin; `ai-assist` reuses that plugin's block description, validation and Markdown conversion rather than the Payload plugin directly.
- **`@payloadcms/plugin-seo`** supplies the `meta.title` and `meta.description` fields the SEO suggestion fills in; `plugin-form-builder` is not involved.
