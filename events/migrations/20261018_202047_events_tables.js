export async function up({ db, sql }) {
  await db.execute(sql`
   CREATE TYPE "public"."enum_events_review_state" AS ENUM('none', 'in-review', 'changes-requested');
  CREATE TYPE "public"."enum_events_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__events_v_version_review_state" AS ENUM('none', 'in-review', 'changes-requested');
  CREATE TYPE "public"."enum__events_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__events_v_published_locale" AS ENUM('en', 'fr', 'es', 'de', 'it', 'pt', 'pt-BR', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'sk', 'sl', 'hr', 'sr', 'hu', 'ro', 'bg', 'el', 'et', 'lv', 'lt', 'ca', 'cy', 'ga', 'tr', 'ru', 'uk', 'ar', 'he', 'fa', 'ur', 'hi', 'bn', 'ta', 'id', 'ms', 'vi', 'th', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'sw', 'af');
  CREATE TYPE "public"."enum_event_rsvps_status" AS ENUM('confirmed', 'waitlisted', 'pending_payment', 'cancelled');
  CREATE TYPE "public"."enum_event_orders_status" AS ENUM('pending', 'paid', 'payment_reported', 'payment_problem', 'expired', 'refunded');
  CREATE TABLE "events_tickets" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar,
  	"label" varchar,
  	"description" varchar,
  	"price" numeric,
  	"non_receiptable" numeric,
  	"sponsorship" boolean DEFAULT false,
  	"max_per_order" numeric
  );
  
  CREATE TABLE "events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"slug" varchar,
  	"review_state" "enum_events_review_state" DEFAULT 'none',
  	"review_note" varchar,
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"time_zone" varchar,
  	"address" varchar,
  	"online_url" varchar,
  	"hero_image_id" integer,
  	"rsvp_open" boolean DEFAULT true,
  	"rsvp_opens_at" timestamp(3) with time zone,
  	"rsvp_closes_at" timestamp(3) with time zone,
  	"rsvp_capacity" numeric,
  	"rsvp_max_guests" numeric DEFAULT 1,
  	"rsvp_waitlist" boolean DEFAULT false,
  	"rsvp_ask_phone" boolean DEFAULT false,
  	"rsvp_phone_required" boolean DEFAULT false,
  	"rsvp_consent_label" varchar,
  	"rsvp_submit_label" varchar DEFAULT 'Register',
  	"rsvp_confirmation_message" varchar,
  	"rsvp_redirect_url" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_events_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "events_locales" (
  	"title" varchar,
  	"venue_name" varchar,
  	"summary" varchar,
  	"body" jsonb,
  	"meta_title" varchar,
  	"meta_description" varchar,
  	"meta_image_id" integer,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "_events_v_version_tickets" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar,
  	"label" varchar,
  	"description" varchar,
  	"price" numeric,
  	"non_receiptable" numeric,
  	"sponsorship" boolean DEFAULT false,
  	"max_per_order" numeric,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_events_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_site_id" integer,
  	"version_slug" varchar,
  	"version_review_state" "enum__events_v_version_review_state" DEFAULT 'none',
  	"version_review_note" varchar,
  	"version_starts_at" timestamp(3) with time zone,
  	"version_ends_at" timestamp(3) with time zone,
  	"version_time_zone" varchar,
  	"version_address" varchar,
  	"version_online_url" varchar,
  	"version_hero_image_id" integer,
  	"version_rsvp_open" boolean DEFAULT true,
  	"version_rsvp_opens_at" timestamp(3) with time zone,
  	"version_rsvp_closes_at" timestamp(3) with time zone,
  	"version_rsvp_capacity" numeric,
  	"version_rsvp_max_guests" numeric DEFAULT 1,
  	"version_rsvp_waitlist" boolean DEFAULT false,
  	"version_rsvp_ask_phone" boolean DEFAULT false,
  	"version_rsvp_phone_required" boolean DEFAULT false,
  	"version_rsvp_consent_label" varchar,
  	"version_rsvp_submit_label" varchar DEFAULT 'Register',
  	"version_rsvp_confirmation_message" varchar,
  	"version_rsvp_redirect_url" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__events_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"snapshot" boolean,
  	"published_locale" "enum__events_v_published_locale",
  	"latest" boolean
  );
  
  CREATE TABLE "_events_v_locales" (
  	"version_title" varchar,
  	"version_venue_name" varchar,
  	"version_summary" varchar,
  	"version_body" jsonb,
  	"version_meta_title" varchar,
  	"version_meta_description" varchar,
  	"version_meta_image_id" integer,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "event_rsvps" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"event_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"guests" numeric DEFAULT 1,
  	"status" "enum_event_rsvps_status" DEFAULT 'confirmed' NOT NULL,
  	"notes" varchar,
  	"consent_given" boolean,
  	"consent_statement" varchar,
  	"dedupe_key" varchar,
  	"reminder_sent_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_orders" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"reference" varchar NOT NULL,
  	"status" "enum_event_orders_status" DEFAULT 'pending' NOT NULL,
  	"event_id" integer NOT NULL,
  	"rsvp_id" integer,
  	"name" varchar,
  	"email" varchar,
  	"phone" varchar,
  	"provider" varchar,
  	"provider_ref" varchar,
  	"items" jsonb,
  	"total_cents" numeric,
  	"receiptable_cents" numeric,
  	"non_receiptable_cents" numeric,
  	"sponsorship_cents" numeric,
  	"attendee_units" numeric,
  	"currency" varchar,
  	"hold_expires_at" timestamp(3) with time zone,
  	"paid_at" timestamp(3) with time zone,
  	"attempts" numeric DEFAULT 0,
  	"next_check_at" timestamp(3) with time zone,
  	"note" varchar,
  	"last_transaction" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_stats" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" integer NOT NULL,
  	"confirmed_guests" numeric DEFAULT 0 NOT NULL,
  	"waitlisted_guests" numeric DEFAULT 0 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_id" integer,
  	"label" varchar DEFAULT 'Events',
  	"path" varchar DEFAULT 'events',
  	"per_page" numeric DEFAULT 12,
  	"default_time_zone" varchar,
  	"sender_name" varchar,
  	"payment_provider" varchar,
  	"currency" varchar DEFAULT 'CAD',
  	"reminders" boolean DEFAULT true,
  	"retention_days" numeric DEFAULT 180,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "site_urls_rels" ADD COLUMN "events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_rsvps_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_orders_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_stats_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_settings_id" integer;
  ALTER TABLE "events_tickets" ADD CONSTRAINT "events_tickets_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_hero_image_id_media_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events_locales" ADD CONSTRAINT "events_locales_meta_image_id_media_id_fk" FOREIGN KEY ("meta_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events_locales" ADD CONSTRAINT "events_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_events_v_version_tickets" ADD CONSTRAINT "_events_v_version_tickets_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_events_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_events_v" ADD CONSTRAINT "_events_v_parent_id_events_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_events_v" ADD CONSTRAINT "_events_v_version_site_id_sites_id_fk" FOREIGN KEY ("version_site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_events_v" ADD CONSTRAINT "_events_v_version_hero_image_id_media_id_fk" FOREIGN KEY ("version_hero_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_events_v_locales" ADD CONSTRAINT "_events_v_locales_version_meta_image_id_media_id_fk" FOREIGN KEY ("version_meta_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_events_v_locales" ADD CONSTRAINT "_events_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_events_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_orders" ADD CONSTRAINT "event_orders_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_orders" ADD CONSTRAINT "event_orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_orders" ADD CONSTRAINT "event_orders_rsvp_id_event_rsvps_id_fk" FOREIGN KEY ("rsvp_id") REFERENCES "public"."event_rsvps"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_stats" ADD CONSTRAINT "event_stats_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_settings" ADD CONSTRAINT "event_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "events_tickets_order_idx" ON "events_tickets" USING btree ("_order");
  CREATE INDEX "events_tickets_parent_id_idx" ON "events_tickets" USING btree ("_parent_id");
  CREATE INDEX "events_site_idx" ON "events" USING btree ("site_id");
  CREATE INDEX "events_hero_image_idx" ON "events" USING btree ("hero_image_id");
  CREATE INDEX "events_updated_at_idx" ON "events" USING btree ("updated_at");
  CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");
  CREATE INDEX "events__status_idx" ON "events" USING btree ("_status");
  CREATE INDEX "events_meta_meta_image_idx" ON "events_locales" USING btree ("meta_image_id","_locale");
  CREATE UNIQUE INDEX "events_locales_locale_parent_id_unique" ON "events_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_events_v_version_tickets_order_idx" ON "_events_v_version_tickets" USING btree ("_order");
  CREATE INDEX "_events_v_version_tickets_parent_id_idx" ON "_events_v_version_tickets" USING btree ("_parent_id");
  CREATE INDEX "_events_v_parent_idx" ON "_events_v" USING btree ("parent_id");
  CREATE INDEX "_events_v_version_version_site_idx" ON "_events_v" USING btree ("version_site_id");
  CREATE INDEX "_events_v_version_version_hero_image_idx" ON "_events_v" USING btree ("version_hero_image_id");
  CREATE INDEX "_events_v_version_version_updated_at_idx" ON "_events_v" USING btree ("version_updated_at");
  CREATE INDEX "_events_v_version_version_created_at_idx" ON "_events_v" USING btree ("version_created_at");
  CREATE INDEX "_events_v_version_version__status_idx" ON "_events_v" USING btree ("version__status");
  CREATE INDEX "_events_v_created_at_idx" ON "_events_v" USING btree ("created_at");
  CREATE INDEX "_events_v_updated_at_idx" ON "_events_v" USING btree ("updated_at");
  CREATE INDEX "_events_v_snapshot_idx" ON "_events_v" USING btree ("snapshot");
  CREATE INDEX "_events_v_published_locale_idx" ON "_events_v" USING btree ("published_locale");
  CREATE INDEX "_events_v_latest_idx" ON "_events_v" USING btree ("latest");
  CREATE INDEX "_events_v_version_meta_version_meta_image_idx" ON "_events_v_locales" USING btree ("version_meta_image_id","_locale");
  CREATE UNIQUE INDEX "_events_v_locales_locale_parent_id_unique" ON "_events_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "event_rsvps_site_idx" ON "event_rsvps" USING btree ("site_id");
  CREATE INDEX "event_rsvps_event_idx" ON "event_rsvps" USING btree ("event_id");
  CREATE INDEX "event_rsvps_email_idx" ON "event_rsvps" USING btree ("email");
  CREATE INDEX "event_rsvps_status_idx" ON "event_rsvps" USING btree ("status");
  CREATE INDEX "event_rsvps_dedupe_key_idx" ON "event_rsvps" USING btree ("dedupe_key");
  CREATE INDEX "event_rsvps_updated_at_idx" ON "event_rsvps" USING btree ("updated_at");
  CREATE INDEX "event_rsvps_created_at_idx" ON "event_rsvps" USING btree ("created_at");
  CREATE UNIQUE INDEX "event_dedupeKey_idx" ON "event_rsvps" USING btree ("event_id","dedupe_key");
  CREATE INDEX "event_orders_site_idx" ON "event_orders" USING btree ("site_id");
  CREATE UNIQUE INDEX "event_orders_reference_idx" ON "event_orders" USING btree ("reference");
  CREATE INDEX "event_orders_status_idx" ON "event_orders" USING btree ("status");
  CREATE INDEX "event_orders_event_idx" ON "event_orders" USING btree ("event_id");
  CREATE INDEX "event_orders_rsvp_idx" ON "event_orders" USING btree ("rsvp_id");
  CREATE INDEX "event_orders_provider_ref_idx" ON "event_orders" USING btree ("provider_ref");
  CREATE INDEX "event_orders_updated_at_idx" ON "event_orders" USING btree ("updated_at");
  CREATE INDEX "event_orders_created_at_idx" ON "event_orders" USING btree ("created_at");
  CREATE UNIQUE INDEX "event_stats_event_idx" ON "event_stats" USING btree ("event_id");
  CREATE INDEX "event_stats_updated_at_idx" ON "event_stats" USING btree ("updated_at");
  CREATE INDEX "event_stats_created_at_idx" ON "event_stats" USING btree ("created_at");
  CREATE UNIQUE INDEX "event_settings_site_idx" ON "event_settings" USING btree ("site_id");
  CREATE INDEX "event_settings_updated_at_idx" ON "event_settings" USING btree ("updated_at");
  CREATE INDEX "event_settings_created_at_idx" ON "event_settings" USING btree ("created_at");
  ALTER TABLE "site_urls_rels" ADD CONSTRAINT "site_urls_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_rsvps_fk" FOREIGN KEY ("event_rsvps_id") REFERENCES "public"."event_rsvps"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_orders_fk" FOREIGN KEY ("event_orders_id") REFERENCES "public"."event_orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_stats_fk" FOREIGN KEY ("event_stats_id") REFERENCES "public"."event_stats"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_settings_fk" FOREIGN KEY ("event_settings_id") REFERENCES "public"."event_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "site_urls_rels_events_id_idx" ON "site_urls_rels" USING btree ("events_id");
  CREATE INDEX "payload_locked_documents_rels_events_id_idx" ON "payload_locked_documents_rels" USING btree ("events_id");
  CREATE INDEX "payload_locked_documents_rels_event_rsvps_id_idx" ON "payload_locked_documents_rels" USING btree ("event_rsvps_id");
  CREATE INDEX "payload_locked_documents_rels_event_orders_id_idx" ON "payload_locked_documents_rels" USING btree ("event_orders_id");
  CREATE INDEX "payload_locked_documents_rels_event_stats_id_idx" ON "payload_locked_documents_rels" USING btree ("event_stats_id");
  CREATE INDEX "payload_locked_documents_rels_event_settings_id_idx" ON "payload_locked_documents_rels" USING btree ("event_settings_id");`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "events_tickets" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "events_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_events_v_version_tickets" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_events_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_events_v_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_rsvps" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_orders" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_stats" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "events_tickets" CASCADE;
  DROP TABLE "events" CASCADE;
  DROP TABLE "events_locales" CASCADE;
  DROP TABLE "_events_v_version_tickets" CASCADE;
  DROP TABLE "_events_v" CASCADE;
  DROP TABLE "_events_v_locales" CASCADE;
  DROP TABLE "event_rsvps" CASCADE;
  DROP TABLE "event_orders" CASCADE;
  DROP TABLE "event_stats" CASCADE;
  DROP TABLE "event_settings" CASCADE;
  ALTER TABLE "site_urls_rels" DROP CONSTRAINT "site_urls_rels_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_event_rsvps_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_event_orders_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_event_stats_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_event_settings_fk";
  
  DROP INDEX "site_urls_rels_events_id_idx";
  DROP INDEX "payload_locked_documents_rels_events_id_idx";
  DROP INDEX "payload_locked_documents_rels_event_rsvps_id_idx";
  DROP INDEX "payload_locked_documents_rels_event_orders_id_idx";
  DROP INDEX "payload_locked_documents_rels_event_stats_id_idx";
  DROP INDEX "payload_locked_documents_rels_event_settings_id_idx";
  ALTER TABLE "site_urls_rels" DROP COLUMN "events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_rsvps_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_orders_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_stats_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_settings_id";
  DROP TYPE "public"."enum_events_review_state";
  DROP TYPE "public"."enum_events_status";
  DROP TYPE "public"."enum__events_v_version_review_state";
  DROP TYPE "public"."enum__events_v_version_status";
  DROP TYPE "public"."enum__events_v_published_locale";
  DROP TYPE "public"."enum_event_rsvps_status";
  DROP TYPE "public"."enum_event_orders_status";`)
}
