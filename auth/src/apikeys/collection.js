// API keys, in a table of their own (Payload's built-in `useAPIKey` would add columns to the users collection). A key is
// stored only as a keyed hash; the text itself is shown once, when it is made (POST /api/auth-keys/issue). Signing in with
// one is the strategy in strategy.js. A person can read and delete their own keys (never the hash), a Super Admin anyone's;
// nobody creates or edits a row through the API, because only the issue endpoint can make a proper hash.
export const KEYS = "auth-api-keys";

const isSuper = ({ req: { user } }) => user?.isSuperAdmin === true;
const never = () => false;

const ownOrSuper = ({ req: { user } }) => {
  if (!user) return false;
  if (user.isSuperAdmin === true) return true;
  return { user: { equals: user.id } };
};

export const apiKeys = {
  slug: KEYS,
  graphQL: false,
  labels: { singular: "API key", plural: "API keys" },
  admin: {
    group: "Administration",
    useAsTitle: "label",
    custom: { navSubgroup: "Sign-in" },
    defaultColumns: ["label", "keyPrefix", "user", "lastUsedAt", "expiresAt"],
    description: "Long-lived keys that sign in as their owner, for scripts. People make their own on their account page; delete a row to revoke a key at once. Only works when AUTH_API_KEYS=true.",
    hidden: ({ user }) => !isSuper({ req: { user } }),
  },
  access: { read: ownOrSuper, create: never, update: never, delete: ownOrSuper },
  fields: [
    { name: "user", type: "relationship", relationTo: "users", required: true, index: true },
    { name: "label", type: "text", required: true, maxLength: 80, label: "What it is for" },
    { name: "keyPrefix", type: "text", required: true, label: "Starts with", admin: { description: "The first part of the key, to tell keys apart. The rest is never stored." } },
    {
      name: "keyHash",
      type: "text",
      required: true,
      unique: true,
      index: true,
      hidden: true,
      access: { read: never, create: never, update: never },
      admin: { hidden: true },
    },
    { name: "lastUsedAt", type: "date", label: "Last used" },
    { name: "expiresAt", type: "date", label: "Stops working on", admin: { description: "Empty means it works until it is deleted." } },
  ],
};
