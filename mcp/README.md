# AI agents (MCP)

Lets AI agents such as Claude work on a Polysite install over the [Model Context Protocol](https://modelcontextprotocol.io). The endpoint is `POST /api/mcp` on the CMS.

It wraps Payload's official MCP plugin (the key collection, the MCP server and generic tools) and adds Polysite-aware tools.

## How access works

MCP is only the connection. **A key acts as the person it belongs to**, so an agent can do exactly what that person's role allows: every role, assigned-site and publish rule still applies, and the plugin adds no limit of its own. A key for a Super Admin can publish and delete; a key for a Site User can do what a Site User can.

- Anyone signed in can make keys for their own account (**Administration → MCP API Keys**). A Super Admin can make one for another account.
- Each key also switches on the collections and tools it may use (all off until ticked), like a scope on an API token.
- To give an agent **less** than a person has, make it its own account. On first start the plugin seeds an optional role, **AI Editor** (create, read, update on pages, media, forms and redirects; no publish, no delete); put an account on it and make the key for that account.
- Visitors' form answers, users and roles are not exposed over MCP.

Treat everything an agent reads from the site (page text, form entries) as data, not instructions.

## Where you see it and how to connect

1. After the plugin is installed and the CMS restarted, the admin **dashboard** shows an **AI agents (MCP) is on** card with the server address, a link to create a key, and copy-ready connection commands. It is shown to anyone who may make keys.
2. **Create a key** for your account, tick what it may use, generate it and copy it (shown once).
3. Add the server to your agent. Claude Code:

```bash
claude mcp add --transport http polysite https://<your CMS address>/api/mcp \
  --header "Authorization: Bearer <the key>"
```

Other clients that support HTTP servers: `{"mcpServers":{"polysite":{"type":"http","url":"https://<your CMS address>/api/mcp","headers":{"Authorization":"Bearer <the key>"}}}}`. Clients that only run local commands can use `npx mcp-remote https://<your CMS address>/api/mcp --header "Authorization: Bearer <the key>"`.

Nothing else is needed on the agent side: it lists the tools itself.

## What an agent can do

| Tool | What it does |
| --- | --- |
| `polysite_describe_blocks` | Lists the page blocks this install can build pages from, with every field. An agent calls this first. |
| `polysite_create_page` | Creates a page on a site from blocks. Rich-text fields take Markdown. A draft unless `publish` is true. |
| `polysite_update_page` | Replaces a page's blocks. A new draft unless `publish` is true; a draft of a published page leaves the live version untouched. |
| `polysite_publish_page` | Publishes a page, or with `publish: false` takes it offline. |
| `polysite_upload_media` | Adds a picture to a site's media library from a public https `url` (preferred) or `base64`, with required alt text. Returns the id to use as a block's `image`. PNG, JPEG, GIF, WebP, AVIF up to 8 MB (`MCP_MAX_UPLOAD_MB`); SVG is refused. |
| `polysite_create_form` | Creates a form (text, email, textarea, number, checkbox, select, date) with a confirmation message and optional consent. |
| `find…`, `create…`, `update…`, `delete…` for pages, forms, media, sites and redirects | Payload's generic tools, each gated by the key's ticks and the user's role. |

A page is built from the blocks the install has (the core's, plus any installed by other plugins such as `blocks-pack`). An agent cannot invent a layout the blocks cannot express; a design that needs a new block needs a developer to add one.

Fetching a picture from a `url` is guarded like the webhooks plugin: https only in production, no credentials in the address, every address the name resolves to must be public (so cloud metadata and internal hosts such as `db` are refused), redirects are not followed, 15 s deadline, size cap, and the file type is read from its bytes. `MCP_ALLOW_PRIVATE_HOSTS=1` lifts the address check for tests only; never set it on a real install.

## Database

The migrations (`migrations/`) create one table, `payload_mcp_api_keys`, plus the two relation columns Payload keeps for it. Each collection operation and tool a key can switch on is a column, so **adding or removing a tool or an enabled collection needs a new migration** (`docker compose exec cms sh scripts/pluginMigrations.sh plugin mcp <name>`).

## Checked on the dev stack

- A key for a Super Admin published and unpublished a page through `polysite_publish_page`; a key for an **AI Editor** account was refused.
- The AI Editor account is refused when it publishes or deletes through the API, and can still edit drafts.
- Unit tests: `node --test test/*.test.js` inside the CMS container.

Not checked: the migrations on an empty production database (the plugin's `check` passes; the production image was not booted), the dashboard card in a browser, and a real MCP client other than direct calls.

## Not built yet

- Uploading files other than images. A 1-pixel image fails in the core's image resizer; real images work.
- Form submissions over MCP (they hold visitors' personal data).
- An audit log of agent calls.

## For developers

```text
src/index.js            the plugin: wraps Payload's MCP plugin, key access rules, dashboard card, seeds the AI Editor role
src/tools.js            the Polysite tools
src/schema.js           describing blocks, validating them, converting Markdown in rich-text fields
src/markdown.js         Markdown to Lexical (headings, lists, bold, italic, code, safe links)
src/forms.js            a plain form description to the form builder's shape
src/upload.js           image intake: base64 or a guarded URL fetch, type read from the bytes
src/admin/McpPanel.js   the dashboard card
```

The plugin installs its own copy of `payload` (a peer dependency of Payload's MCP plugin) in its `node_modules`. It only supplies helpers; the running CMS uses the core's copy. The core's publish rules read `req.query.draft`, so the page tools set it to tell a draft save from a publishing save.
