export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_share_settings_networks" AS ENUM('facebook', 'x', 'linkedin', 'whatsapp', 'telegram', 'reddit', 'email', 'copy', 'native');
  CREATE TYPE "public"."enum_share_settings_style" AS ENUM('buttons', 'icons', 'text');
  CREATE TYPE "public"."enum_share_settings_placement" AS ENUM('inline', 'floating-bottom', 'floating-side');
  CREATE TABLE "share_settings_networks" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_share_settings_networks",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "share_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"enabled" boolean DEFAULT false,
  	"style" "enum_share_settings_style" DEFAULT 'buttons',
  	"placement" "enum_share_settings_placement" DEFAULT 'floating-bottom',
  	"via" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "share_settings_locales" (
  	"text" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "share_settings_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "share_settings_id" integer;
  ALTER TABLE "share_settings_networks" ADD CONSTRAINT "share_settings_networks_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."share_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "share_settings" ADD CONSTRAINT "share_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "share_settings_locales" ADD CONSTRAINT "share_settings_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."share_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "share_settings_texts" ADD CONSTRAINT "share_settings_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."share_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "share_settings_networks_order_idx" ON "share_settings_networks" USING btree ("order");
  CREATE INDEX "share_settings_networks_parent_idx" ON "share_settings_networks" USING btree ("parent_id");
  CREATE UNIQUE INDEX "share_settings_site_idx" ON "share_settings" USING btree ("site_id");
  CREATE INDEX "share_settings_updated_at_idx" ON "share_settings" USING btree ("updated_at");
  CREATE INDEX "share_settings_created_at_idx" ON "share_settings" USING btree ("created_at");
  CREATE UNIQUE INDEX "share_settings_locales_locale_parent_id_unique" ON "share_settings_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "share_settings_texts_order_parent" ON "share_settings_texts" USING btree ("order","parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_share_settings_fk" FOREIGN KEY ("share_settings_id") REFERENCES "public"."share_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_share_settings_id_idx" ON "payload_locked_documents_rels" USING btree ("share_settings_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "share_settings_networks" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "share_settings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "share_settings_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "share_settings_texts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "share_settings_networks" CASCADE;
  DROP TABLE "share_settings" CASCADE;
  DROP TABLE "share_settings_locales" CASCADE;
  DROP TABLE "share_settings_texts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_share_settings_fk";
  
  DROP INDEX "payload_locked_documents_rels_share_settings_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "share_settings_id";
  DROP TYPE "public"."enum_share_settings_networks";
  DROP TYPE "public"."enum_share_settings_style";
  DROP TYPE "public"."enum_share_settings_placement";`)
}
