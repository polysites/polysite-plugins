export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_wordpress_imports_options_target_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_wordpress_imports_options_on_slug_conflict" AS ENUM('skip', 'rename');
  CREATE TYPE "public"."enum_wordpress_imports_options_byline_mode" AS ENUM('author', 'fixed', 'none');
  CREATE TYPE "public"."enum_wordpress_imports_options_menu_mode" AS ENUM('append', 'replace', 'none');
  CREATE TYPE "public"."enum_wordpress_imports_status" AS ENUM('new', 'uploaded', 'queued', 'analysing', 'analysed', 'running', 'done', 'failed');
  CREATE TYPE "public"."enum_wordpress_import_log_level" AS ENUM('info', 'warn', 'error');
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'wordpress-import' BEFORE 'schedulePublish';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'wordpress-import' BEFORE 'schedulePublish';
  CREATE TABLE "wordpress_imports" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"title" varchar DEFAULT 'WordPress import' NOT NULL,
  	"options_target_status" "enum_wordpress_imports_options_target_status" DEFAULT 'draft',
  	"options_import_pages" boolean DEFAULT true,
  	"options_import_posts" boolean DEFAULT true,
  	"options_import_tags" boolean DEFAULT true,
  	"options_import_media" boolean DEFAULT true,
  	"options_include_drafts" boolean DEFAULT false,
  	"options_include_private" boolean DEFAULT false,
  	"options_include_trashed" boolean DEFAULT false,
  	"options_overwrite" boolean DEFAULT false,
  	"options_on_slug_conflict" "enum_wordpress_imports_options_on_slug_conflict" DEFAULT 'skip',
  	"options_create_redirects" boolean DEFAULT true,
  	"options_byline_mode" "enum_wordpress_imports_options_byline_mode" DEFAULT 'author',
  	"options_byline_text" varchar,
  	"options_author_map" varchar,
  	"options_allowed_media_hosts" varchar,
  	"options_media_max_mb" numeric DEFAULT 15,
  	"options_allow_http_media" boolean DEFAULT true,
  	"options_menu_mode" "enum_wordpress_imports_options_menu_mode" DEFAULT 'append',
  	"options_menu_name" varchar,
  	"status" "enum_wordpress_imports_status" DEFAULT 'new',
  	"file_name" varchar,
  	"original_name" varchar,
  	"file_size" numeric,
  	"requested_by_id" integer,
  	"started_at" timestamp(3) with time zone,
  	"finished_at" timestamp(3) with time zone,
  	"progress" jsonb,
  	"analysis" jsonb,
  	"result" jsonb,
  	"error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "wordpress_import_map" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"kind" varchar NOT NULL,
  	"key" varchar NOT NULL,
  	"collection" varchar NOT NULL,
  	"doc_id" varchar NOT NULL,
  	"written_at" numeric,
  	"hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "wordpress_import_log" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"job_id" integer NOT NULL,
  	"level" "enum_wordpress_import_log_level" NOT NULL,
  	"code" varchar,
  	"wp_type" varchar,
  	"wp_id" varchar,
  	"title" varchar,
  	"message" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "wordpress_imports_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "wordpress_import_map_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "wordpress_import_log_id" integer;
  ALTER TABLE "wordpress_imports" ADD CONSTRAINT "wordpress_imports_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wordpress_imports" ADD CONSTRAINT "wordpress_imports_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wordpress_import_map" ADD CONSTRAINT "wordpress_import_map_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wordpress_import_log" ADD CONSTRAINT "wordpress_import_log_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wordpress_import_log" ADD CONSTRAINT "wordpress_import_log_job_id_wordpress_imports_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."wordpress_imports"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "wordpress_imports_site_idx" ON "wordpress_imports" USING btree ("site_id");
  CREATE INDEX "wordpress_imports_requested_by_idx" ON "wordpress_imports" USING btree ("requested_by_id");
  CREATE INDEX "wordpress_imports_updated_at_idx" ON "wordpress_imports" USING btree ("updated_at");
  CREATE INDEX "wordpress_imports_created_at_idx" ON "wordpress_imports" USING btree ("created_at");
  CREATE INDEX "wordpress_import_map_site_idx" ON "wordpress_import_map" USING btree ("site_id");
  CREATE INDEX "wordpress_import_map_kind_idx" ON "wordpress_import_map" USING btree ("kind");
  CREATE INDEX "wordpress_import_map_key_idx" ON "wordpress_import_map" USING btree ("key");
  CREATE INDEX "wordpress_import_map_updated_at_idx" ON "wordpress_import_map" USING btree ("updated_at");
  CREATE INDEX "wordpress_import_map_created_at_idx" ON "wordpress_import_map" USING btree ("created_at");
  CREATE INDEX "wordpress_import_log_site_idx" ON "wordpress_import_log" USING btree ("site_id");
  CREATE INDEX "wordpress_import_log_job_idx" ON "wordpress_import_log" USING btree ("job_id");
  CREATE INDEX "wordpress_import_log_level_idx" ON "wordpress_import_log" USING btree ("level");
  CREATE INDEX "wordpress_import_log_code_idx" ON "wordpress_import_log" USING btree ("code");
  CREATE INDEX "wordpress_import_log_updated_at_idx" ON "wordpress_import_log" USING btree ("updated_at");
  CREATE INDEX "wordpress_import_log_created_at_idx" ON "wordpress_import_log" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_wordpress_imports_fk" FOREIGN KEY ("wordpress_imports_id") REFERENCES "public"."wordpress_imports"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_wordpress_import_map_fk" FOREIGN KEY ("wordpress_import_map_id") REFERENCES "public"."wordpress_import_map"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_wordpress_import_log_fk" FOREIGN KEY ("wordpress_import_log_id") REFERENCES "public"."wordpress_import_log"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_wordpress_imports_id_idx" ON "payload_locked_documents_rels" USING btree ("wordpress_imports_id");
  CREATE INDEX "payload_locked_documents_rels_wordpress_import_map_id_idx" ON "payload_locked_documents_rels" USING btree ("wordpress_import_map_id");
  CREATE INDEX "payload_locked_documents_rels_wordpress_import_log_id_idx" ON "payload_locked_documents_rels" USING btree ("wordpress_import_log_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "wordpress_imports" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "wordpress_import_map" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "wordpress_import_log" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "wordpress_imports" CASCADE;
  DROP TABLE "wordpress_import_map" CASCADE;
  DROP TABLE "wordpress_import_log" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_wordpress_imports_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_wordpress_import_map_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_wordpress_import_log_fk";
  
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'schedulePublish');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'schedulePublish');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";
  DROP INDEX "payload_locked_documents_rels_wordpress_imports_id_idx";
  DROP INDEX "payload_locked_documents_rels_wordpress_import_map_id_idx";
  DROP INDEX "payload_locked_documents_rels_wordpress_import_log_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "wordpress_imports_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "wordpress_import_map_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "wordpress_import_log_id";
  DROP TYPE "public"."enum_wordpress_imports_options_target_status";
  DROP TYPE "public"."enum_wordpress_imports_options_on_slug_conflict";
  DROP TYPE "public"."enum_wordpress_imports_options_byline_mode";
  DROP TYPE "public"."enum_wordpress_imports_options_menu_mode";
  DROP TYPE "public"."enum_wordpress_imports_status";
  DROP TYPE "public"."enum_wordpress_import_log_level";`)
}
