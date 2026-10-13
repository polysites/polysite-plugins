export async function up({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "auth_settings" ADD COLUMN "sign_in_protection_captcha_enabled" boolean DEFAULT false;
  ALTER TABLE "auth_settings" ADD COLUMN "sign_in_protection_turnstile_site_key" varchar;
  ALTER TABLE "auth_settings" ADD COLUMN "sign_in_protection_turnstile_secret_key" varchar;
  ALTER TABLE "auth_settings" ADD COLUMN "sign_in_protection_captcha_on_sign_in" boolean DEFAULT true;
  ALTER TABLE "auth_settings" ADD COLUMN "sign_in_protection_captcha_on_reset" boolean DEFAULT true;`)
}

export async function down({ db, sql }) {
  await db.execute(sql`
   ALTER TABLE "auth_settings" DROP COLUMN "sign_in_protection_captcha_enabled";
  ALTER TABLE "auth_settings" DROP COLUMN "sign_in_protection_turnstile_site_key";
  ALTER TABLE "auth_settings" DROP COLUMN "sign_in_protection_turnstile_secret_key";
  ALTER TABLE "auth_settings" DROP COLUMN "sign_in_protection_captcha_on_sign_in";
  ALTER TABLE "auth_settings" DROP COLUMN "sign_in_protection_captcha_on_reset";`)
}
