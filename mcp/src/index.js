import { mcpPlugin } from "@payloadcms/plugin-mcp";

import { buildTools } from "./tools.js";

// Lets AI agents (Claude and other MCP clients) work on a Polysite install over MCP at POST /api/mcp.
//
//  - It wraps Payload's official MCP plugin (its API-key collection, server and generic tools) and adds Polysite-aware tools that build
//    pages from blocks, create forms from a plain description, upload images and publish.
//  - MCP is only the connection. A key acts as the person it belongs to, so what an agent may do (create, edit, publish, delete) is exactly
//    what that person's role allows: every access rule, assigned site and publish permission still applies. The plugin adds no limit of its
//    own beyond what each key switches on.
//  - Anyone signed in can make keys for their own account; a Super Admin can make one for another account. The "AI Editor" role this plugin
//    seeds (no publish, no delete) is an optional account to give an agent less than a person has.
//  - Own table only (payload_mcp_api_keys). Removing the plugin deletes nothing.
const isSuper = (user) => user?.isSuperAdmin === true;
const signedIn = ({ req }) => Boolean(req?.user);
const ownOrSuper = ({ req }) => (isSuper(req?.user) ? true : req?.user ? { user: { equals: req.user.id } } : false);
const superOnly = ({ req }) => isSuper(req?.user);

const ROLE = "AI Editor";
const ROLE_MODULES = ["pages", "media", "forms", "redirects"];
const ALL = { find: true, create: true, update: true, delete: true };

async function seedRole(payload) {
  const found = await payload.find({ collection: "roles", where: { name: { equals: ROLE } }, limit: 1, overrideAccess: true });
  if (found.totalDocs > 0) return;
  await payload.create({
    collection: "roles",
    data: {
      name: ROLE,
      isDefaultDeployed: false,
      modules: ROLE_MODULES,
      operations: { create: true, read: true, update: true, delete: false, publish: false, unpublish: false, cloneAcrossSites: false },
      manageSiteSettings: false,
    },
    overrideAccess: true,
  });
}

const PANEL = "../../../plugins/mcp/src/admin/McpPanel#McpPanel";

export default function mcpAgentPlugin(incomingConfig) {
  const configured = mcpPlugin({
    collections: {
      pages: { enabled: ALL, description: "Website pages. Build and change them with polysite_create_page / polysite_update_page; publish with polysite_publish_page." },
      forms: { enabled: ALL, description: "Forms. Create them with polysite_create_form." },
      media: { enabled: ALL, description: "Uploaded images. Add one with polysite_upload_media." },
      sites: { enabled: ALL, description: "The sites on this install; use the id as siteId." },
      redirects: { enabled: ALL, description: "Redirects from old addresses." },
    },
    mcp: {
      tools: buildTools(),
    },
    overrideApiKeyCollection: (collection) => ({
      ...collection,
      access: { create: signedIn, read: ownOrSuper, update: ownOrSuper, delete: ownOrSuper, unlock: ownOrSuper },
      admin: { ...collection.admin, group: "Administration" },
      fields: (collection.fields ?? []).map((field) =>
        field.name === "user" ? { ...field, access: { ...field.access, create: superOnly, update: superOnly } } : field,
      ),
    }),
  })(incomingConfig);

  return {
    ...configured,
    admin: {
      ...configured.admin,
      components: { ...configured.admin?.components, beforeDashboard: [...(configured.admin?.components?.beforeDashboard ?? []), PANEL] },
    },
    onInit: async (payload) => {
      await configured.onInit?.(payload);
      try {
        await seedRole(payload);
      } catch (error) {
        payload.logger?.warn?.(`[mcp] could not create the "${ROLE}" role: ${error instanceof Error ? error.message : error}`);
      }
    },
  };
}
