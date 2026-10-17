import { mcpPlugin } from "@payloadcms/plugin-mcp";

import { buildTools } from "./tools.js";

// Lets AI agents (Claude and other MCP clients) work on a Polysite install over MCP at POST /api/mcp.
//
//  - It wraps Payload's official MCP plugin (its API-key collection, server and generic read tools) and adds Polysite-aware tools that
//    build pages from blocks and forms from a plain description. Writes are drafts only; nothing here publishes or deletes.
//  - A key acts as the person it belongs to, so every access rule (roles, assigned sites, publish permission) still applies. Super
//    Admins create keys, for a dedicated account with the "AI Editor" role this plugin seeds (create, read and update; no publish, no delete).
//  - Own table only (payload-mcp-api-keys). Removing the plugin deletes nothing.
const isSuper = ({ req }) => req?.user?.isSuperAdmin === true;
const ROLE = "AI Editor";
const ROLE_MODULES = ["pages", "media", "forms", "redirects"];

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

export default function mcpAgentPlugin(incomingConfig) {
  const configured = mcpPlugin({
    collections: {
      pages: { enabled: { find: true }, description: "Website pages. Build and change them with polysite_create_page / polysite_update_page." },
      forms: { enabled: { find: true }, description: "Forms. Create them with polysite_create_form." },
      media: { enabled: { find: true }, description: "Uploaded images. Add one with polysite_upload_media." },
      sites: { enabled: { find: true }, description: "The sites on this install; use the id as siteId." },
      redirects: { enabled: { find: true, create: true }, description: "Redirects from old addresses." },
    },
    mcp: {
      tools: buildTools(),
    },
    overrideApiKeyCollection: (collection) => ({
      ...collection,
      access: { create: isSuper, read: isSuper, update: isSuper, delete: isSuper, unlock: isSuper },
      admin: { ...collection.admin, group: "Administration", hidden: ({ user }) => user?.isSuperAdmin !== true },
      fields: (collection.fields ?? []).map((field) =>
        field.name === "user" ? { ...field, access: { ...field.access, create: isSuper, update: isSuper } } : field,
      ),
    }),
  })(incomingConfig);

  return {
    ...configured,
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
