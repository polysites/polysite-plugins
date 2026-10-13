export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_analytics_settings_tools_tool" AS ENUM('ga4', 'gtm', 'meta', 'tiktok', 'linkedin', 'x', 'plausible', 'umami', 'custom');
  CREATE TYPE "public"."enum_analytics_settings_tools_category" AS ENUM('essential', 'analytics', 'marketing');
  CREATE TYPE "public"."enum_analytics_settings_tools_placement" AS ENUM('head', 'body');
  CREATE TABLE "analytics_settings_tools" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"tool" "enum_analytics_settings_tools_tool" NOT NULL,
  	"enabled" boolean DEFAULT true,
  	"tool_id" varchar,
  	"script_host" varchar,
  	"ask_first" boolean DEFAULT false,
  	"conversion_id" varchar,
  	"category" "enum_analytics_settings_tools_category" DEFAULT 'marketing',
  	"name" varchar,
  	"placement" "enum_analytics_settings_tools_placement" DEFAULT 'head',
  	"code" varchar
  );
  
  CREATE TABLE "analytics_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"respect_privacy_signals" boolean DEFAULT true,
  	"consent_notice" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "analytics_overview" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "analytics_settings_id" integer;
  ALTER TABLE "analytics_settings_tools" ADD CONSTRAINT "analytics_settings_tools_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."analytics_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "analytics_settings" ADD CONSTRAINT "analytics_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "analytics_settings_tools_order_idx" ON "analytics_settings_tools" USING btree ("_order");
  CREATE INDEX "analytics_settings_tools_parent_id_idx" ON "analytics_settings_tools" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "analytics_settings_site_idx" ON "analytics_settings" USING btree ("site_id");
  CREATE INDEX "analytics_settings_updated_at_idx" ON "analytics_settings" USING btree ("updated_at");
  CREATE INDEX "analytics_settings_created_at_idx" ON "analytics_settings" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_analytics_settings_fk" FOREIGN KEY ("analytics_settings_id") REFERENCES "public"."analytics_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_analytics_settings_id_idx" ON "payload_locked_documents_rels" USING btree ("analytics_settings_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "analytics_settings_tools" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "analytics_settings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "analytics_overview" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "analytics_settings_tools" CASCADE;
  DROP TABLE "analytics_settings" CASCADE;
  DROP TABLE "analytics_overview" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_analytics_settings_fk";
  
  DROP INDEX "payload_locked_documents_rels_analytics_settings_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "analytics_settings_id";
  DROP TYPE "public"."enum_analytics_settings_tools_tool";
  DROP TYPE "public"."enum_analytics_settings_tools_category";
  DROP TYPE "public"."enum_analytics_settings_tools_placement";`)
}
