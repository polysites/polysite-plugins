export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_notification_channels_type" AS ENUM('slack', 'teams', 'webhook', 'email');
  CREATE TYPE "public"."enum_notification_watches_events" AS ENUM('created', 'updated', 'deleted', 'published');
  CREATE TYPE "public"."enum_notification_watches_subscriber_type" AS ENUM('user', 'channel');
  CREATE TYPE "public"."enum_notification_deliveries_status" AS ENUM('queued', 'sent', 'failed', 'skipped');
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'polysite-notify' BEFORE 'schedulePublish';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'polysite-notify' BEFORE 'schedulePublish';
  CREATE TABLE "notification_channels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"type" "enum_notification_channels_type" DEFAULT 'slack' NOT NULL,
  	"url" varchar,
  	"secret" varchar,
  	"recipients" varchar,
  	"enabled" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "notification_watches_events" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_notification_watches_events",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "notification_watches" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"subscriber_type" "enum_notification_watches_subscriber_type" DEFAULT 'user' NOT NULL,
  	"user_id" integer,
  	"channel_id" integer,
  	"collection" varchar NOT NULL,
  	"doc_id" varchar,
  	"site_id" integer,
  	"also_email" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "notification_deliveries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_notification_deliveries_status" DEFAULT 'queued',
  	"subscriber" varchar,
  	"event" varchar,
  	"collection" varchar,
  	"doc_id" varchar,
  	"doc_title" varchar,
  	"attempts" numeric DEFAULT 0,
  	"last_error" varchar,
  	"sent_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "notifications" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar,
  	"link" varchar,
  	"read_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "notification_channels_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "notification_watches_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "notification_deliveries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "notifications_id" integer;
  ALTER TABLE "notification_watches_events" ADD CONSTRAINT "notification_watches_events_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."notification_watches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "notification_watches" ADD CONSTRAINT "notification_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "notification_watches" ADD CONSTRAINT "notification_watches_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "notification_watches" ADD CONSTRAINT "notification_watches_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "notification_channels_updated_at_idx" ON "notification_channels" USING btree ("updated_at");
  CREATE INDEX "notification_channels_created_at_idx" ON "notification_channels" USING btree ("created_at");
  CREATE INDEX "notification_watches_events_order_idx" ON "notification_watches_events" USING btree ("order");
  CREATE INDEX "notification_watches_events_parent_idx" ON "notification_watches_events" USING btree ("parent_id");
  CREATE INDEX "notification_watches_user_idx" ON "notification_watches" USING btree ("user_id");
  CREATE INDEX "notification_watches_channel_idx" ON "notification_watches" USING btree ("channel_id");
  CREATE INDEX "notification_watches_site_idx" ON "notification_watches" USING btree ("site_id");
  CREATE INDEX "notification_watches_updated_at_idx" ON "notification_watches" USING btree ("updated_at");
  CREATE INDEX "notification_watches_created_at_idx" ON "notification_watches" USING btree ("created_at");
  CREATE INDEX "notification_deliveries_updated_at_idx" ON "notification_deliveries" USING btree ("updated_at");
  CREATE INDEX "notification_deliveries_created_at_idx" ON "notification_deliveries" USING btree ("created_at");
  CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");
  CREATE INDEX "notifications_updated_at_idx" ON "notifications" USING btree ("updated_at");
  CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_notification_channels_fk" FOREIGN KEY ("notification_channels_id") REFERENCES "public"."notification_channels"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_notification_watches_fk" FOREIGN KEY ("notification_watches_id") REFERENCES "public"."notification_watches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_notification_deliveries_fk" FOREIGN KEY ("notification_deliveries_id") REFERENCES "public"."notification_deliveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_notifications_fk" FOREIGN KEY ("notifications_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_notification_channels_id_idx" ON "payload_locked_documents_rels" USING btree ("notification_channels_id");
  CREATE INDEX "payload_locked_documents_rels_notification_watches_id_idx" ON "payload_locked_documents_rels" USING btree ("notification_watches_id");
  CREATE INDEX "payload_locked_documents_rels_notification_deliveries_id_idx" ON "payload_locked_documents_rels" USING btree ("notification_deliveries_id");
  CREATE INDEX "payload_locked_documents_rels_notifications_id_idx" ON "payload_locked_documents_rels" USING btree ("notifications_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "notification_channels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "notification_watches_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "notification_watches" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "notification_deliveries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "notifications" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "notification_channels" CASCADE;
  DROP TABLE "notification_watches_events" CASCADE;
  DROP TABLE "notification_watches" CASCADE;
  DROP TABLE "notification_deliveries" CASCADE;
  DROP TABLE "notifications" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_notification_channels_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_notification_watches_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_notification_deliveries_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_notifications_fk";
  
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'schedulePublish');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'schedulePublish');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";
  DROP INDEX "payload_locked_documents_rels_notification_channels_id_idx";
  DROP INDEX "payload_locked_documents_rels_notification_watches_id_idx";
  DROP INDEX "payload_locked_documents_rels_notification_deliveries_id_idx";
  DROP INDEX "payload_locked_documents_rels_notifications_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "notification_channels_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "notification_watches_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "notification_deliveries_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "notifications_id";
  DROP TYPE "public"."enum_notification_channels_type";
  DROP TYPE "public"."enum_notification_watches_events";
  DROP TYPE "public"."enum_notification_watches_subscriber_type";
  DROP TYPE "public"."enum_notification_deliveries_status";`)
}
