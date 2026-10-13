export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TABLE "search_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"title" varchar DEFAULT 'Site search',
  	"enabled" boolean DEFAULT false,
  	"per_page" numeric DEFAULT 10,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "search_settings_locales" (
  	"placeholder" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "search_settings_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "search_settings_id" integer;
  ALTER TABLE "search_settings" ADD CONSTRAINT "search_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "search_settings_locales" ADD CONSTRAINT "search_settings_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."search_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "search_settings_texts" ADD CONSTRAINT "search_settings_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."search_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "search_settings_site_idx" ON "search_settings" USING btree ("site_id");
  CREATE INDEX "search_settings_updated_at_idx" ON "search_settings" USING btree ("updated_at");
  CREATE INDEX "search_settings_created_at_idx" ON "search_settings" USING btree ("created_at");
  CREATE UNIQUE INDEX "search_settings_locales_locale_parent_id_unique" ON "search_settings_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "search_settings_texts_order_parent" ON "search_settings_texts" USING btree ("order","parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_search_settings_fk" FOREIGN KEY ("search_settings_id") REFERENCES "public"."search_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_search_settings_id_idx" ON "payload_locked_documents_rels" USING btree ("search_settings_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "search_settings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "search_settings_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "search_settings_texts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "search_settings" CASCADE;
  DROP TABLE "search_settings_locales" CASCADE;
  DROP TABLE "search_settings_texts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_search_settings_fk";
  
  DROP INDEX "payload_locked_documents_rels_search_settings_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "search_settings_id";`)
}
