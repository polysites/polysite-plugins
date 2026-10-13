import { SECRET_MASK, decrypt, encrypt, isEncrypted } from "../crypto.js";
import { TYPES, isTenantId } from "./claims.js";

export const PROVIDERS = "sso-providers";

const isSuper = ({ req: { user } }) => user?.isSuperAdmin === true;

// The client secret: encrypted at rest, masked on every read, and "the mask means keep" on save (the same pattern as
// the email and notifications plugins). The sign-in code asks for the real value through `revealSsoSecret`.
const clientSecretField = {
  name: "clientSecret",
  type: "text",
  label: "Client secret",
  required: true,
  admin: { description: "From your provider's app settings. Stored encrypted and never shown again." },
  hooks: {
    afterRead: [
      ({ value, req }) => {
        if (req.context?.revealSsoSecret) return decrypt(value);
        if (req.context?.rawSsoSecret) return value;
        return value ? SECRET_MASK : value;
      },
    ],
    beforeChange: [
      async ({ value, originalDoc, req }) => {
        let next = value;
        if (value === SECRET_MASK) {
          const current = originalDoc?.id
            ? await req.payload.findByID({ collection: PROVIDERS, id: originalDoc.id, depth: 0, overrideAccess: true, context: { rawSsoSecret: true } })
            : null;
          next = current?.clientSecret ?? "";
        }
        return isEncrypted(next) ? next : encrypt(next);
      },
    ],
  },
};

export const ssoProviders = {
  slug: PROVIDERS,
  labels: { singular: "Sign-in provider", plural: "Sign-in providers" },
  admin: {
    group: "Administration",
    useAsTitle: "label",
    custom: { navSubgroup: "Sign-in" },
    defaultColumns: ["label", "type", "enabled"],
    description:
      "Single sign-on: let people sign in with Google, Microsoft, GitHub or another OpenID Connect provider. Someone can only sign in this way if an account with their (verified) email address already exists. Only Super Admins manage these.",
  },
  access: { read: isSuper, create: isSuper, update: isSuper, delete: isSuper },
  fields: [
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      label: "Short name",
      admin: { description: "Lower-case letters, numbers and hyphens, such as google. It is part of the redirect address you give the provider: https://<your CMS address>/api/auth-sso/<short name>/callback" },
      validate: (value) => (typeof value === "string" && /^[a-z0-9-]{2,30}$/.test(value)) || "Use 2 to 30 lower-case letters, numbers or hyphens.",
    },
    { name: "label", type: "text", required: true, label: "Button text", defaultValue: "Continue with Google" },
    { name: "type", type: "select", required: true, defaultValue: "google", options: [
      { label: "Google", value: "google" },
      { label: "Microsoft (Entra ID, work or school)", value: "microsoft" },
      { label: "GitHub", value: "github" },
      { label: "Other OpenID Connect provider", value: "oidc" },
    ], validate: (value) => TYPES.includes(value) || "Choose a provider type." },
    { name: "enabled", type: "checkbox", defaultValue: true, label: "On" },
    { name: "clientId", type: "text", required: true, label: "Client ID" },
    clientSecretField,
    {
      name: "tenant",
      type: "text",
      label: "Directory (tenant) ID",
      admin: { condition: (data) => data?.type === "microsoft", description: "The ID of your Microsoft directory, as a GUID. Only people from this directory can sign in." },
      validate: (value, { siblingData }) => siblingData?.type !== "microsoft" || isTenantId(value) || "Enter the directory (tenant) ID, a GUID like 00000000-0000-0000-0000-000000000000.",
    },
    {
      name: "issuer",
      type: "text",
      label: "Issuer address",
      admin: { condition: (data) => data?.type === "oidc", description: "The provider's issuer, such as https://login.example.org/realms/main. Must start with https://." },
      validate: (value, { siblingData }) => siblingData?.type !== "oidc" || (typeof value === "string" && (process.env.AUTH_SSO_ALLOW_HTTP === "1" ? /^https?:\/\/[^\s]+$/ : /^https:\/\/[^\s]+$/).test(value)) || "Enter the issuer address, starting with https://.",
    },
    {
      name: "allowedDomains",
      type: "text",
      label: "Only these email domains",
      admin: { description: "Optional. Separate with commas, such as example.org, example.com. Leave empty to allow any address that matches an account." },
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data?.slug) data.slug = String(data.slug).trim().toLowerCase();
        if (data?.type && data.type !== "microsoft") data.tenant = null;
        if (data?.type && data.type !== "oidc") data.issuer = null;
        return data;
      },
    ],
  },
};

