import { apiKeyEndpoints } from "./apikeys/endpoints.js";
import { apiKeys, KEYS } from "./apikeys/collection.js";
import { STRATEGY, apiKeyStrategy, meForKeys } from "./apikeys/strategy.js";
import { apiKeysEnabled } from "./apikeys/keys.js";
import { captchaBeforeOperation, captchaEndpoint, signInProtectionField } from "./captcha.js";
import { endpoints } from "./endpoints.js";
import { afterOperation, beforeLogin } from "./hooks.js";
import { POLICIES } from "./policy.js";
import { ssoProviders } from "./sso/collection.js";
import { IDENTITIES, ssoIdentities } from "./sso/identities.js";
import { ssoEndpoints } from "./sso/endpoints.js";
import { ATTEMPTS } from "./twofactor.js";
import { STATE, userStateCollection } from "./userState.js";

// Admin component paths are relative to apps/cms/src (the import map's baseDir); see the notifications plugin.
const LOGIN_BOX = "../../../plugins/auth/src/admin/TwoFactorLoginBox#TwoFactorLoginBox";
const PANEL = "../../../plugins/auth/src/admin/TwoFactorPanel#TwoFactorPanel";
const BANNER = "../../../plugins/auth/src/admin/TwoFactorBanner#TwoFactorBanner";
const SSO_BUTTONS = "../../../plugins/auth/src/admin/SsoButtons#SsoButtons";
const KEYS_PANEL = "../../../plugins/auth/src/admin/ApiKeysPanel#ApiKeysPanel";
// A provider (it wraps every admin page, the sign-in and forgot-password pages included, which have no slot of their own).
const CAPTCHA_GATE = "../../../plugins/auth/src/admin/CaptchaGate#CaptchaGate";

const isSuper = ({ req: { user } }) => user?.isSuperAdmin === true;
const never = () => false;

// The only thing added to the users collection: panels on the edit screen (`ui` fields, which have no column). All the
// state they show lives in the plugin's own collections.
// Both are always there, switched on or not: the admin's component map is built when the app is built, before anyone sets AUTH_API_KEYS,
// so a panel that only exists when the switch is on would be missing from it. The keys panel draws nothing while the feature is off.
const userFields = [
  { name: "twoFactorPanel", type: "ui", admin: { components: { Field: PANEL } } },
  { name: "apiKeysPanel", type: "ui", admin: { components: { Field: KEYS_PANEL } } },
];

const settingsGlobal = {
  slug: "auth-settings",
  label: "Sign-in security",
  admin: {
    group: "Administration",
    custom: { navSubgroup: "Sign-in" },
    description: "Who must use two-factor sign-in, and the Cloudflare Turnstile check on the sign-in page. Installed by the auth plugin.",
  },
  access: { read: isSuper, update: isSuper },
  fields: [
    {
      name: "twoFactorPolicy",
      type: "select",
      label: "Two-factor sign-in",
      defaultValue: "off",
      options: [
        { label: "Optional: each person can turn it on for their own account", value: "off" },
        { label: "Required for Super Admins", value: "super-admins" },
        { label: "Required for everyone", value: "everyone" },
      ],
      validate: (value) => value === undefined || value === null || POLICIES.includes(value) || "Choose one of the listed options.",
      admin: {
        description:
          "When it is required, a person who has not set it up cannot sign in until they do (they are offered the setup under the sign-in form). Setting it up needs their password, so nobody is locked out.",
      },
    },
    {
      name: "issuerName",
      type: "text",
      label: "Name shown in the authenticator app",
      defaultValue: "Polysite",
      admin: { description: "The label people see next to their code, such as the name of your organisation." },
    },
    signInProtectionField,
  ],
};

// Counts wrong two-factor codes per person, in a table of its own (see twofactor.js for why). Nothing reads or writes it
// through the API.
const attemptsCollection = {
  slug: ATTEMPTS,
  admin: { hidden: true },
  access: { read: never, create: never, update: never, delete: never },
  fields: [
    { name: "userId", type: "text", required: true, unique: true, index: true },
    { name: "failures", type: "number", defaultValue: 0 },
    { name: "lockedUntil", type: "date" },
  ],
};

const minutes = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Sign-in security: an authenticator-app second factor (with recovery codes and an administrator reset), an optional
// policy, lockout settings and API keys. Applied last like every plugin, so it sees the users collection as the core
// finished it. Single sign-on (Google, Microsoft, GitHub, any OpenID Connect provider) is here too.
export default function authPlugin(incomingConfig, kit) {
  const userSlug = incomingConfig.admin?.user ?? "users";

  // When a person is deleted, what the plugin holds for them goes too (their two-factor row, linked sign-ins, API keys, the
  // wrong-code count): none of it is meaningful without the person, and a key must stop working at once. It runs BEFORE the
  // delete because those tables point at the person with a required column: removing the person first would be refused.
  const beforeDelete = async ({ id, req }) => {
    for (const slug of [STATE, IDENTITIES, KEYS]) {
      await req.payload.delete({ collection: slug, where: { user: { equals: id } }, overrideAccess: true, req });
    }
    await req.payload.delete({ collection: ATTEMPTS, where: { userId: { equals: String(id) } }, overrideAccess: true, req });
  };

  const collections = (incomingConfig.collections ?? []).map((collection) => {
    if (collection.slug !== userSlug) return collection;
    const auth = typeof collection.auth === "object" && collection.auth !== null ? collection.auth : {};
    return {
      ...collection,
      auth: {
        ...auth,
        // Payload locks an account after 5 wrong passwords for 10 minutes; these only change the numbers.
        maxLoginAttempts: minutes(process.env.AUTH_MAX_LOGIN_ATTEMPTS, auth.maxLoginAttempts ?? 5),
        lockTime: minutes(process.env.AUTH_LOCK_MINUTES, (auth.lockTime ?? 600000) / 60000) * 60000,
        // API keys are this plugin's own (a table of their own and this sign-in strategy), not Payload's `useAPIKey`, which
        // would add columns to the users table. Off unless an administrator switches them on.
        ...(apiKeysEnabled() ? { strategies: [...(auth.strategies ?? []), apiKeyStrategy(userSlug)] } : {}),
      },
      fields: [...(collection.fields ?? []), ...userFields],
      hooks: {
        ...collection.hooks,
        // After the core's per-address throttle (the plugin is applied last), so a flood never costs a call to Cloudflare.
        beforeOperation: [...(collection.hooks?.beforeOperation ?? []), captchaBeforeOperation],
        beforeLogin: [...(collection.hooks?.beforeLogin ?? []), beforeLogin],
        afterOperation: [...(collection.hooks?.afterOperation ?? []), afterOperation],
        beforeDelete: [...(collection.hooks?.beforeDelete ?? []), beforeDelete],
        // Payload's `me` reads a `Bearer` header as a JWT and fails on a key; for a request a key signed in, answer without the token details.
        ...(apiKeysEnabled() ? { me: [...(collection.hooks?.me ?? []), meForKeys] } : {}),
      },
    };
  });

  return {
    ...incomingConfig,
    admin: {
      ...incomingConfig.admin,
      components: {
        ...incomingConfig.admin?.components,
        providers: [...(incomingConfig.admin?.components?.providers ?? []), CAPTCHA_GATE],
        beforeLogin: [...(incomingConfig.admin?.components?.beforeLogin ?? []), LOGIN_BOX],
        afterLogin: [...(incomingConfig.admin?.components?.afterLogin ?? []), SSO_BUTTONS],
        header: [...(incomingConfig.admin?.components?.header ?? []), BANNER],
      },
    },
    collections: [...collections, attemptsCollection, userStateCollection, ssoProviders, ssoIdentities, apiKeys],
    globals: [...(incomingConfig.globals ?? []), settingsGlobal],
    endpoints: [...(incomingConfig.endpoints ?? []), ...endpoints, ...ssoEndpoints(kit), ...apiKeyEndpoints(), captchaEndpoint],
  };
}
