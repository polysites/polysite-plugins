export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TABLE "site_languages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"default_language" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "site_languages_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "site_languages_id" integer;
  ALTER TABLE "site_languages" ADD CONSTRAINT "site_languages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_languages_texts" ADD CONSTRAINT "site_languages_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."site_languages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "site_languages_site_idx" ON "site_languages" USING btree ("site_id");
  CREATE INDEX "site_languages_updated_at_idx" ON "site_languages" USING btree ("updated_at");
  CREATE INDEX "site_languages_created_at_idx" ON "site_languages" USING btree ("created_at");
  CREATE INDEX "site_languages_texts_order_parent" ON "site_languages_texts" USING btree ("order","parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_site_languages_fk" FOREIGN KEY ("site_languages_id") REFERENCES "public"."site_languages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_site_languages_id_idx" ON "payload_locked_documents_rels" USING btree ("site_languages_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "site_languages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_languages_texts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "site_languages" CASCADE;
  DROP TABLE "site_languages_texts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_site_languages_fk";
  
  DROP INDEX "payload_locked_documents_rels_site_languages_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "site_languages_id";`)
}
