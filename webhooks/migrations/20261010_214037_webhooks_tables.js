export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_webhook_endpoints_events" AS ENUM('page.created', 'page.updated', 'page.published', 'page.unpublished', 'page.deleted', 'post.created', 'post.updated', 'post.published', 'post.unpublished', 'post.deleted', 'form.submitted', 'media.uploaded');
  CREATE TYPE "public"."enum_webhook_deliveries_status" AS ENUM('queued', 'sent', 'retrying', 'failed', 'skipped');
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'polysite-webhook-deliver' BEFORE 'schedulePublish';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'polysite-webhook-deliver' BEFORE 'schedulePublish';
  CREATE TABLE "webhook_endpoints_events" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_webhook_endpoints_events",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "webhook_endpoints" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"url" varchar,
  	"host" varchar,
  	"secret" varchar,
  	"site_id" integer,
  	"active" boolean DEFAULT true,
  	"consecutive_failures" numeric DEFAULT 0,
  	"disabled_reason" varchar,
  	"disabled_at" timestamp(3) with time zone,
  	"last_success_at" timestamp(3) with time zone,
  	"last_failure_at" timestamp(3) with time zone,
  	"last_response_code" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "webhook_deliveries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_webhook_deliveries_status" DEFAULT 'queued',
  	"event_type" varchar,
  	"endpoint_id" integer,
  	"endpoint_name" varchar,
  	"event_id" varchar,
  	"attempts" numeric DEFAULT 0,
  	"response_code" numeric,
  	"last_error" varchar,
  	"next_attempt_at" timestamp(3) with time zone,
  	"sent_at" timestamp(3) with time zone,
  	"replays" numeric DEFAULT 0,
  	"is_test" boolean DEFAULT false,
  	"event" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "webhook_endpoints_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "webhook_deliveries_id" integer;
  ALTER TABLE "webhook_endpoints_events" ADD CONSTRAINT "webhook_endpoints_events_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "webhook_endpoints_events_order_idx" ON "webhook_endpoints_events" USING btree ("order");
  CREATE INDEX "webhook_endpoints_events_parent_idx" ON "webhook_endpoints_events" USING btree ("parent_id");
  CREATE INDEX "webhook_endpoints_site_idx" ON "webhook_endpoints" USING btree ("site_id");
  CREATE INDEX "webhook_endpoints_updated_at_idx" ON "webhook_endpoints" USING btree ("updated_at");
  CREATE INDEX "webhook_endpoints_created_at_idx" ON "webhook_endpoints" USING btree ("created_at");
  CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");
  CREATE INDEX "webhook_deliveries_event_type_idx" ON "webhook_deliveries" USING btree ("event_type");
  CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id");
  CREATE INDEX "webhook_deliveries_event_id_idx" ON "webhook_deliveries" USING btree ("event_id");
  CREATE INDEX "webhook_deliveries_updated_at_idx" ON "webhook_deliveries" USING btree ("updated_at");
  CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_webhook_endpoints_fk" FOREIGN KEY ("webhook_endpoints_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_webhook_deliveries_fk" FOREIGN KEY ("webhook_deliveries_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_webhook_endpoints_id_idx" ON "payload_locked_documents_rels" USING btree ("webhook_endpoints_id");
  CREATE INDEX "payload_locked_documents_rels_webhook_deliveries_id_idx" ON "payload_locked_documents_rels" USING btree ("webhook_deliveries_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "webhook_endpoints_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "webhook_endpoints" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "webhook_deliveries" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "webhook_endpoints_events" CASCADE;
  DROP TABLE "webhook_endpoints" CASCADE;
  DROP TABLE "webhook_deliveries" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_webhook_endpoints_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_webhook_deliveries_fk";
  
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'schedulePublish');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'schedulePublish');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";
  DROP INDEX "payload_locked_documents_rels_webhook_endpoints_id_idx";
  DROP INDEX "payload_locked_documents_rels_webhook_deliveries_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "webhook_endpoints_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "webhook_deliveries_id";
  DROP TYPE "public"."enum_webhook_endpoints_events";
  DROP TYPE "public"."enum_webhook_deliveries_status";`)
}
