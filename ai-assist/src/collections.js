import { decrypt, encrypt, isEncrypted, SECRET_MASK } from "./crypto.js";
import { DEFAULTS } from "./limits.js";
import { DEFAULT_MODEL, PROVIDERS } from "./providers/index.js";

export const SLUGS = { settings: "ai-assist-settings", usage: "ai-assist-usage" };

const SETTINGS_PANEL = "../../../plugins/ai-assist/src/admin/SettingsPanel#SettingsPanel";

const superOnly = ({ req: { user } }) => user?.isSuperAdmin === true;

export const settingsGlobal = {
  slug: SLUGS.settings,
  label: "AI assist settings",
  admin: {
    group: "Administration",
    description:
      "Help for editors inside the admin: draft and rewrite text, suggest search titles and alt text, translate, build a page from a brief. It is OFF until you switch it on here and tick the sites that may use it. Results are only ever suggestions the editor accepts; nothing publishes. Only Super Admins see this page.",
  },
  access: { read: superOnly, update: superOnly },
  fields: [
    { name: "panel", type: "ui", admin: { components: { Field: SETTINGS_PANEL } } },
    {
      name: "enabled",
      type: "checkbox",
      defaultValue: false,
      label: "Switched on",
      admin: { description: "Off by default. Even when on, only the sites ticked below can use it." },
    },
    {
      name: "sites",
      type: "relationship",
      relationTo: "sites",
      hasMany: true,
      label: "Sites that may use AI assist",
      admin: { description: "Editors of other sites do not see the AI assist box." },
    },
    {
      type: "collapsible",
      label: "Provider and key",
      admin: { initCollapsed: false },
      fields: [
        {
          name: "provider",
          type: "select",
          defaultValue: "anthropic",
          options: Object.entries(PROVIDERS).map(([value, p]) => ({ value, label: p.label })),
        },
        {
          name: "model",
          type: "text",
          defaultValue: DEFAULT_MODEL,
          admin: { description: `The model's id. Default ${DEFAULT_MODEL}. A cheaper one such as claude-sonnet-5-5 or claude-haiku-5-5 costs less per request.` },
        },
        {
          name: "baseUrl",
          type: "text",
          label: "Endpoint address (optional)",
          admin: { description: "Needed for an OpenAI-compatible endpoint (for example https://models.example.com/v1). For Anthropic leave empty unless you use a gateway." },
        },
        {
          name: "apiKey",
          type: "text",
          label: "API key",
          admin: {
            description:
              "The environment variable AI_ASSIST_API_KEY (or ANTHROPIC_API_KEY) on the server wins when it is set, and then nothing is stored here. Otherwise paste the key: it is encrypted, shown as bullets afterwards, and never sent to a browser. Leave the bullets to keep it.",
          },
          hooks: {
            afterRead: [
              ({ value, req }) => {
                if (req.context?.revealAiSecrets) return decrypt(value);
                if (req.context?.rawAiSecrets) return value;
                return value ? SECRET_MASK : value;
              },
            ],
            beforeChange: [
              async ({ value, req }) => {
                if (value === undefined) return value;
                let next = value;
                if (value === SECRET_MASK) {
                  const current = await req.payload.findGlobal({ slug: SLUGS.settings, overrideAccess: true, context: { rawAiSecrets: true } });
                  next = current?.apiKey ?? "";
                }
                return isEncrypted(next) ? next : encrypt(next);
              },
            ],
          },
        },
        {
          name: "refusalFallback",
          type: "checkbox",
          defaultValue: false,
          label: "Retry policy refusals on a fallback model (Anthropic only)",
          admin: { description: "Uses Anthropic's server-side fallback beta when the model declines a request. Leave off unless you want it." },
        },
      ],
    },
    {
      type: "collapsible",
      label: "What is sent",
      fields: [
        {
          name: "maskPersonalData",
          type: "checkbox",
          defaultValue: true,
          label: "Mask email addresses and phone numbers before sending",
          admin: { description: "Replaces them with [email] and [phone] in any text sent to the provider." },
        },
      ],
    },
    {
      type: "collapsible",
      label: "Limits and cost",
      fields: [
        { name: "maxRequestsPerSitePerDay", type: "number", min: 1, defaultValue: DEFAULTS.maxRequestsPerSitePerDay, label: "Requests per site per day" },
        { name: "maxTokensPerSitePerMonth", type: "number", min: 1, defaultValue: DEFAULTS.maxTokensPerSitePerMonth, label: "Tokens per site per month (input + output)" },
        { name: "maxRequestsPerUserPerMinute", type: "number", min: 1, defaultValue: DEFAULTS.maxRequestsPerUserPerMinute, label: "Requests per person per minute" },
        { name: "maxInputChars", type: "number", min: 500, defaultValue: DEFAULTS.maxInputChars, label: "Longest text sent at once (characters)" },
        { name: "inputPricePerMTok", type: "number", min: 0, defaultValue: DEFAULTS.inputPricePerMTok, label: "Input price, USD per million tokens (for the estimate)" },
        { name: "outputPricePerMTok", type: "number", min: 0, defaultValue: DEFAULTS.outputPricePerMTok, label: "Output price, USD per million tokens (for the estimate)" },
        { name: "usageRetentionDays", type: "number", min: 1, defaultValue: DEFAULTS.usageRetentionDays, label: "Keep the usage log for (days)" },
      ],
    },
  ],
};

export const usageCollection = {
  slug: SLUGS.usage,
  labels: { singular: "AI assist use", plural: "AI assist use" },
  admin: {
    group: "Administration",
    defaultColumns: ["createdAt", "site", "user", "action", "model", "inputTokens", "outputTokens", "ok"],
    description: "One row per request: who, which site, which action and how many tokens. It never holds the text sent or the answer. Old rows are removed automatically.",
  },
  access: { read: superOnly, create: () => false, update: () => false, delete: superOnly },
  fields: [
    { name: "site", type: "relationship", relationTo: "sites", index: true },
    { name: "user", type: "relationship", relationTo: "users" },
    { name: "action", type: "text", index: true },
    { name: "collection", type: "text" },
    { name: "docId", type: "text" },
    { name: "model", type: "text" },
    { name: "inputTokens", type: "number", defaultValue: 0 },
    { name: "outputTokens", type: "number", defaultValue: 0 },
    { name: "ok", type: "checkbox", defaultValue: true },
    { name: "error", type: "text" },
  ],
};
