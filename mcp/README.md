# AI agents (MCP)

Lets AI agents such as Claude build pages and forms on a Polysite install over the [Model Context Protocol](https://modelcontextprotocol.io). The endpoint is `POST /api/mcp` on the CMS.

It wraps Payload's official MCP plugin (the key collection, the MCP server and the read tools) and adds Polysite-aware tools. **Agents write drafts only.** Nothing here publishes or deletes.

## What an agent can do

| Tool | What it does |
| --- | --- |
| `polysite_describe_blocks` | Lists the page blocks this install can build pages from, with every field. An agent calls this first. |
| `polysite_create_page` | Creates a **draft** page on a site from blocks. Rich-text fields take Markdown. |
| `polysite_update_page` | Replaces a page's blocks as a new **draft**. A published page's live version is untouched. |
| `polysite_upload_media` | Adds a picture to a site's media library from a public https `url` (preferred) or `base64`, with required alt text. Returns the id to use as a block's `image`. PNG, JPEG, GIF, WebP, AVIF up to 8 MB (`MCP_MAX_UPLOAD_MB`); SVG is refused. |
| `polysite_create_form` | Creates a form (text, email, textarea, number, checkbox, select, date) with a confirmation message and optional consent. |
| `findPages`, `findForms`, `findMedia`, `findSites`, `findRedirects`, `createRedirects` | The generic Payload tools, limited to those operations. |

A page is built from the blocks the install has (the core's, plus any installed by other plugins such as `blocks-pack`). An agent cannot invent a layout the blocks cannot express; a design that needs a new block needs a developer to add one.

## Safety model

- A key **acts as the person it belongs to**, so every role, assigned-site and publish rule still applies.
- On first start the plugin creates a role called **AI Editor**: create, read and update on pages, media, forms and redirects; **no publish, no unpublish, no delete**, no site settings. Make a separate user with that role (assigned only to the sites the agent may touch) and issue the key for that user.
- Only a Super Admin can create keys (**Administration → MCP API Keys**). Each key also ticks which collections and tools it may use.
- Visitors' form answers, users and roles are not exposed.
- Fetching a picture from a `url` is guarded like the webhooks plugin: https only in production, no credentials in the address, every address the name resolves to must be public (so cloud metadata and internal hosts such as `db` are refused), redirects are not followed, 15 s deadline, size cap, and the file type is read from its bytes. `MCP_ALLOW_PRIVATE_HOSTS=1` lifts the address check for tests only; never set it on a real install.
- Everything the agent reads from the site is content, not instructions.

## Connect Claude Code

```bash
claude mcp add --transport http polysite https://<your CMS address>/api/mcp \
  --header "Authorization: Bearer <the key>"
```

Other clients: use `npx mcp-remote https://<your CMS address>/api/mcp --header "Authorization: Bearer <the key>"`.

## Make a key

1. Create a user with the **AI Editor** role and the sites it may use.
2. **Administration → MCP API Keys → Create**: choose that user, tick what it may use, generate the key and copy it (shown once).

## Not built yet

- Uploading files other than images. A 1-pixel image fails in the core's image resizer; real images work.
- Publishing, scheduling and translations by an agent.
- A running install test of the migration on an empty production database (the plugin's `check` passes; booting the production image was not done).
- An audit log of agent calls.

## Database

The migration (`migrations/`) creates one table, `payload_mcp_api_keys`, plus the two relation columns Payload keeps for it. Each collection and tool a key can switch on is a column, so **adding or removing a tool or an enabled collection needs a new migration** (`docker compose exec cms sh scripts/pluginMigrations.sh plugin mcp <name>`).

Checked on the dev stack: the AI Editor account is refused when it tries to publish or delete through the API, and can still edit drafts.

## For developers

```text
src/index.js     the plugin: wraps Payload's MCP plugin, locks the key collection to Super Admins, seeds the AI Editor role
src/tools.js     the four Polysite tools
src/schema.js    describing blocks, validating them, converting Markdown in rich-text fields
src/markdown.js  Markdown to Lexical (headings, lists, bold, italic, code, safe links)
src/forms.js     a plain form description to the form builder's shape
```

Run the tests with `node --test test/*.test.js` inside the CMS container.

The plugin installs its own copy of `payload` (a peer dependency of Payload's MCP plugin) in its `node_modules`. It only supplies helpers; the running CMS uses the core's copy.
