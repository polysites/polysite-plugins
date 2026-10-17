export async function up({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "pages_create" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "pages_update" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "pages_delete" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "forms_create" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "forms_update" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "forms_delete" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "media_create" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "media_update" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "media_delete" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "sites_create" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "sites_update" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "sites_delete" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "redirects_update" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "redirects_delete" boolean DEFAULT false;
  ALTER TABLE "payload_mcp_api_keys" ADD COLUMN "payload_mcp_tool_polysite_publish_page" boolean DEFAULT true;`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "pages_create";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "pages_update";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "pages_delete";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "forms_create";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "forms_update";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "forms_delete";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "media_create";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "media_update";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "media_delete";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "sites_create";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "sites_update";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "sites_delete";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "redirects_update";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "redirects_delete";
  ALTER TABLE "payload_mcp_api_keys" DROP COLUMN "payload_mcp_tool_polysite_publish_page";`)
}
