export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_ai_assist_settings_provider" AS ENUM('anthropic', 'openai-compatible');
  CREATE TABLE "ai_assist_usage" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"user_id" integer,
  	"action" varchar,
  	"collection" varchar,
  	"doc_id" varchar,
  	"model" varchar,
  	"input_tokens" numeric DEFAULT 0,
  	"output_tokens" numeric DEFAULT 0,
  	"ok" boolean DEFAULT true,
  	"error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "ai_assist_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"enabled" boolean DEFAULT false,
  	"provider" "enum_ai_assist_settings_provider" DEFAULT 'anthropic',
  	"model" varchar DEFAULT 'claude-opus-5-5',
  	"base_url" varchar,
  	"api_key" varchar,
  	"refusal_fallback" boolean DEFAULT false,
  	"mask_personal_data" boolean DEFAULT true,
  	"max_requests_per_site_per_day" numeric DEFAULT 500,
  	"max_tokens_per_site_per_month" numeric DEFAULT 3000000,
  	"max_requests_per_user_per_minute" numeric DEFAULT 10,
  	"max_input_chars" numeric DEFAULT 20000,
  	"input_price_per_m_tok" numeric DEFAULT 4,
  	"output_price_per_m_tok" numeric DEFAULT 20,
  	"usage_retention_days" numeric DEFAULT 90,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "ai_assist_settings_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"sites_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ai_assist_usage_id" integer;
  ALTER TABLE "ai_assist_usage" ADD CONSTRAINT "ai_assist_usage_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ai_assist_usage" ADD CONSTRAINT "ai_assist_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ai_assist_settings_rels" ADD CONSTRAINT "ai_assist_settings_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ai_assist_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "ai_assist_settings_rels" ADD CONSTRAINT "ai_assist_settings_rels_sites_fk" FOREIGN KEY ("sites_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "ai_assist_usage_site_idx" ON "ai_assist_usage" USING btree ("site_id");
  CREATE INDEX "ai_assist_usage_user_idx" ON "ai_assist_usage" USING btree ("user_id");
  CREATE INDEX "ai_assist_usage_action_idx" ON "ai_assist_usage" USING btree ("action");
  CREATE INDEX "ai_assist_usage_updated_at_idx" ON "ai_assist_usage" USING btree ("updated_at");
  CREATE INDEX "ai_assist_usage_created_at_idx" ON "ai_assist_usage" USING btree ("created_at");
  CREATE INDEX "ai_assist_settings_rels_order_idx" ON "ai_assist_settings_rels" USING btree ("order");
  CREATE INDEX "ai_assist_settings_rels_parent_idx" ON "ai_assist_settings_rels" USING btree ("parent_id");
  CREATE INDEX "ai_assist_settings_rels_path_idx" ON "ai_assist_settings_rels" USING btree ("path");
  CREATE INDEX "ai_assist_settings_rels_sites_id_idx" ON "ai_assist_settings_rels" USING btree ("sites_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ai_assist_usage_fk" FOREIGN KEY ("ai_assist_usage_id") REFERENCES "public"."ai_assist_usage"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_ai_assist_usage_id_idx" ON "payload_locked_documents_rels" USING btree ("ai_assist_usage_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "ai_assist_usage" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "ai_assist_settings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "ai_assist_settings_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "ai_assist_usage" CASCADE;
  DROP TABLE "ai_assist_settings" CASCADE;
  DROP TABLE "ai_assist_settings_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_ai_assist_usage_fk";
  
  DROP INDEX "payload_locked_documents_rels_ai_assist_usage_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "ai_assist_usage_id";
  DROP TYPE "public"."enum_ai_assist_settings_provider";`)
}
