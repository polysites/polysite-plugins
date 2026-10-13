export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_sso_providers_type" AS ENUM('google', 'microsoft', 'github', 'oidc');
  CREATE TYPE "public"."enum_auth_settings_two_factor_policy" AS ENUM('off', 'super-admins', 'everyone');
  CREATE TABLE "auth_attempts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" varchar NOT NULL,
  	"failures" numeric DEFAULT 0,
  	"locked_until" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "auth_user_state" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"totp_enabled" boolean DEFAULT false,
  	"totp_secret" varchar,
  	"totp_pending_secret" varchar,
  	"totp_last_step" numeric,
  	"recovery_code_hashes" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sso_providers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" varchar NOT NULL,
  	"label" varchar DEFAULT 'Continue with Google' NOT NULL,
  	"type" "enum_sso_providers_type" DEFAULT 'google' NOT NULL,
  	"enabled" boolean DEFAULT true,
  	"client_id" varchar NOT NULL,
  	"client_secret" varchar NOT NULL,
  	"tenant" varchar,
  	"issuer" varchar,
  	"allowed_domains" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sso_identities" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"provider" varchar NOT NULL,
  	"subject" varchar NOT NULL,
  	"identity_key" varchar,
  	"account_key" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "auth_api_keys" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" integer NOT NULL,
  	"label" varchar NOT NULL,
  	"key_prefix" varchar NOT NULL,
  	"key_hash" varchar NOT NULL,
  	"last_used_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "auth_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"two_factor_policy" "enum_auth_settings_two_factor_policy" DEFAULT 'off',
  	"issuer_name" varchar DEFAULT 'Polysite',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "auth_attempts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "auth_user_state_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sso_providers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "sso_identities_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "auth_api_keys_id" integer;
  ALTER TABLE "auth_user_state" ADD CONSTRAINT "auth_user_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sso_identities" ADD CONSTRAINT "sso_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "auth_api_keys" ADD CONSTRAINT "auth_api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "auth_attempts_user_id_idx" ON "auth_attempts" USING btree ("user_id");
  CREATE INDEX "auth_attempts_updated_at_idx" ON "auth_attempts" USING btree ("updated_at");
  CREATE INDEX "auth_attempts_created_at_idx" ON "auth_attempts" USING btree ("created_at");
  CREATE UNIQUE INDEX "auth_user_state_user_idx" ON "auth_user_state" USING btree ("user_id");
  CREATE INDEX "auth_user_state_updated_at_idx" ON "auth_user_state" USING btree ("updated_at");
  CREATE INDEX "auth_user_state_created_at_idx" ON "auth_user_state" USING btree ("created_at");
  CREATE UNIQUE INDEX "sso_providers_slug_idx" ON "sso_providers" USING btree ("slug");
  CREATE INDEX "sso_providers_updated_at_idx" ON "sso_providers" USING btree ("updated_at");
  CREATE INDEX "sso_providers_created_at_idx" ON "sso_providers" USING btree ("created_at");
  CREATE INDEX "sso_identities_user_idx" ON "sso_identities" USING btree ("user_id");
  CREATE UNIQUE INDEX "sso_identities_identity_key_idx" ON "sso_identities" USING btree ("identity_key");
  CREATE UNIQUE INDEX "sso_identities_account_key_idx" ON "sso_identities" USING btree ("account_key");
  CREATE INDEX "sso_identities_updated_at_idx" ON "sso_identities" USING btree ("updated_at");
  CREATE INDEX "sso_identities_created_at_idx" ON "sso_identities" USING btree ("created_at");
  CREATE INDEX "auth_api_keys_user_idx" ON "auth_api_keys" USING btree ("user_id");
  CREATE UNIQUE INDEX "auth_api_keys_key_hash_idx" ON "auth_api_keys" USING btree ("key_hash");
  CREATE INDEX "auth_api_keys_updated_at_idx" ON "auth_api_keys" USING btree ("updated_at");
  CREATE INDEX "auth_api_keys_created_at_idx" ON "auth_api_keys" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_auth_attempts_fk" FOREIGN KEY ("auth_attempts_id") REFERENCES "public"."auth_attempts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_auth_user_state_fk" FOREIGN KEY ("auth_user_state_id") REFERENCES "public"."auth_user_state"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sso_providers_fk" FOREIGN KEY ("sso_providers_id") REFERENCES "public"."sso_providers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sso_identities_fk" FOREIGN KEY ("sso_identities_id") REFERENCES "public"."sso_identities"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_auth_api_keys_fk" FOREIGN KEY ("auth_api_keys_id") REFERENCES "public"."auth_api_keys"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_auth_attempts_id_idx" ON "payload_locked_documents_rels" USING btree ("auth_attempts_id");
  CREATE INDEX "payload_locked_documents_rels_auth_user_state_id_idx" ON "payload_locked_documents_rels" USING btree ("auth_user_state_id");
  CREATE INDEX "payload_locked_documents_rels_sso_providers_id_idx" ON "payload_locked_documents_rels" USING btree ("sso_providers_id");
  CREATE INDEX "payload_locked_documents_rels_sso_identities_id_idx" ON "payload_locked_documents_rels" USING btree ("sso_identities_id");
  CREATE INDEX "payload_locked_documents_rels_auth_api_keys_id_idx" ON "payload_locked_documents_rels" USING btree ("auth_api_keys_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "auth_attempts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "auth_user_state" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sso_providers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sso_identities" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "auth_api_keys" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "auth_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "auth_attempts" CASCADE;
  DROP TABLE "auth_user_state" CASCADE;
  DROP TABLE "sso_providers" CASCADE;
  DROP TABLE "sso_identities" CASCADE;
  DROP TABLE "auth_api_keys" CASCADE;
  DROP TABLE "auth_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_auth_attempts_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_auth_user_state_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sso_providers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_sso_identities_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_auth_api_keys_fk";
  
  DROP INDEX "payload_locked_documents_rels_auth_attempts_id_idx";
  DROP INDEX "payload_locked_documents_rels_auth_user_state_id_idx";
  DROP INDEX "payload_locked_documents_rels_sso_providers_id_idx";
  DROP INDEX "payload_locked_documents_rels_sso_identities_id_idx";
  DROP INDEX "payload_locked_documents_rels_auth_api_keys_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "auth_attempts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "auth_user_state_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sso_providers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "sso_identities_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "auth_api_keys_id";
  DROP TYPE "public"."enum_sso_providers_type";
  DROP TYPE "public"."enum_auth_settings_two_factor_policy";`)
}
