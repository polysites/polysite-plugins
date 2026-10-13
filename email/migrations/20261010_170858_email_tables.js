export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_email_logs_kind" AS ENUM('message', 'test', 'settings-change');
  CREATE TYPE "public"."enum_email_logs_status" AS ENUM('sent', 'failed', 'recorded');
  CREATE TABLE "email_logs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"kind" "enum_email_logs_kind" DEFAULT 'message' NOT NULL,
  	"status" "enum_email_logs_status" NOT NULL,
  	"to" varchar,
  	"from" varchar,
  	"subject" varchar,
  	"attempts" numeric,
  	"provider_response" varchar,
  	"message_id" varchar,
  	"error_message" varchar,
  	"error_code" varchar,
  	"response_code" numeric,
  	"actor_id" integer,
  	"details" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "email_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"smtp_host" varchar DEFAULT '',
  	"smtp_port" numeric DEFAULT 587,
  	"smtp_user" varchar DEFAULT '',
  	"smtp_password" varchar DEFAULT '',
  	"from_address" varchar DEFAULT 'no-reply@polysite.local',
  	"from_name" varchar DEFAULT 'Polysite',
  	"log_retention_days" numeric DEFAULT 90,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "email_logs_id" integer;
  ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "email_logs_kind_idx" ON "email_logs" USING btree ("kind");
  CREATE INDEX "email_logs_status_idx" ON "email_logs" USING btree ("status");
  CREATE INDEX "email_logs_to_idx" ON "email_logs" USING btree ("to");
  CREATE INDEX "email_logs_actor_idx" ON "email_logs" USING btree ("actor_id");
  CREATE INDEX "email_logs_updated_at_idx" ON "email_logs" USING btree ("updated_at");
  CREATE INDEX "email_logs_created_at_idx" ON "email_logs" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_email_logs_fk" FOREIGN KEY ("email_logs_id") REFERENCES "public"."email_logs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_email_logs_id_idx" ON "payload_locked_documents_rels" USING btree ("email_logs_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "email_logs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "email_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "email_logs" CASCADE;
  DROP TABLE "email_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_email_logs_fk";
  
  DROP INDEX "payload_locked_documents_rels_email_logs_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "email_logs_id";
  DROP TYPE "public"."enum_email_logs_kind";
  DROP TYPE "public"."enum_email_logs_status";`)
}
