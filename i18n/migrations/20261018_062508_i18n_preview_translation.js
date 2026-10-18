export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TABLE "machine_translations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"collection_slug" varchar NOT NULL,
  	"doc_id" varchar NOT NULL,
  	"locale" varchar NOT NULL,
  	"provider" varchar,
  	"reviewed" boolean DEFAULT false,
  	"reviewed_by" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "site_languages" ADD COLUMN "translation_enabled" boolean DEFAULT false;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "machine_translations_id" integer;
  CREATE INDEX "machine_translations_collection_slug_idx" ON "machine_translations" USING btree ("collection_slug");
  CREATE INDEX "machine_translations_doc_id_idx" ON "machine_translations" USING btree ("doc_id");
  CREATE INDEX "machine_translations_reviewed_idx" ON "machine_translations" USING btree ("reviewed");
  CREATE INDEX "machine_translations_updated_at_idx" ON "machine_translations" USING btree ("updated_at");
  CREATE INDEX "machine_translations_created_at_idx" ON "machine_translations" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_machine_translations_fk" FOREIGN KEY ("machine_translations_id") REFERENCES "public"."machine_translations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_machine_translations_id_idx" ON "payload_locked_documents_rels" USING btree ("machine_translations_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "machine_translations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "machine_translations" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_machine_translations_fk";
  
  DROP INDEX "payload_locked_documents_rels_machine_translations_id_idx";
  ALTER TABLE "site_languages" DROP COLUMN "translation_enabled";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "machine_translations_id";`)
}
