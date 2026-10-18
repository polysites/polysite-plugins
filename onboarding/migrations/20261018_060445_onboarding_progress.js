export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TABLE "onboarding_progress" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"title" varchar DEFAULT 'Setup checklist',
  	"dismissed" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "onboarding_progress_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "onboarding_progress_id" integer;
  ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "onboarding_progress_texts" ADD CONSTRAINT "onboarding_progress_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."onboarding_progress"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "onboarding_progress_site_idx" ON "onboarding_progress" USING btree ("site_id");
  CREATE INDEX "onboarding_progress_updated_at_idx" ON "onboarding_progress" USING btree ("updated_at");
  CREATE INDEX "onboarding_progress_created_at_idx" ON "onboarding_progress" USING btree ("created_at");
  CREATE INDEX "onboarding_progress_texts_order_parent" ON "onboarding_progress_texts" USING btree ("order","parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_onboarding_progress_fk" FOREIGN KEY ("onboarding_progress_id") REFERENCES "public"."onboarding_progress"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_onboarding_progress_id_idx" ON "payload_locked_documents_rels" USING btree ("onboarding_progress_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "onboarding_progress" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "onboarding_progress_texts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "onboarding_progress" CASCADE;
  DROP TABLE "onboarding_progress_texts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_onboarding_progress_fk";
  
  DROP INDEX "payload_locked_documents_rels_onboarding_progress_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "onboarding_progress_id";`)
}
