// Which provider identities are linked to which account, one row each. A row says "this person at this provider is that
// user". It is its own table (nothing is added to the users collection) and is written only by the sign-in code.
// A Super Admin can see the rows and delete one (to unlink an identity); nobody can create or edit one through the API.
export const IDENTITIES = "sso-identities";

const isSuper = ({ req: { user } }) => user?.isSuperAdmin === true;
const never = () => false;

// Two rules the table enforces itself: an identity at a provider belongs to one account, and an account has one identity
// per provider. They are two unique text fields filled in from the row's own values, rather than compound indexes,
// because Payload names a compound index after its fields only (`provider_subject_idx`), with nothing to say which plugin's
// table it is in, and index names are shared by the whole database.
const keyField = (name) => ({
  name,
  type: "text",
  unique: true,
  hidden: true,
  access: { read: never, create: never, update: never },
  admin: { hidden: true },
});

const idOf = (value) => (value && typeof value === "object" ? value.id : value);

export const ssoIdentities = {
  slug: IDENTITIES,
  graphQL: false,
  labels: { singular: "Linked sign-in", plural: "Linked sign-ins" },
  admin: {
    group: "Administration",
    custom: { navSubgroup: "Sign-in" },
    defaultColumns: ["user", "provider", "createdAt"],
    description:
      "Which single sign-on identity belongs to which account. Created automatically at a person's first sign-in with a provider. Delete one to unlink it: that person's next sign-in links again by their verified email address.",
    hidden: ({ user }) => user?.isSuperAdmin !== true,
  },
  access: { read: isSuper, create: never, update: never, delete: isSuper },
  hooks: {
    beforeValidate: [
      ({ data, originalDoc }) => {
        const row = { ...originalDoc, ...data };
        const user = idOf(row.user);
        if (row.provider && row.subject) data.identityKey = `${row.provider}:${row.subject}`;
        if (row.provider && user !== undefined && user !== null) data.accountKey = `${row.provider}:${user}`;
        return data;
      },
    ],
  },
  fields: [
    { name: "user", type: "relationship", relationTo: "users", required: true, index: true },
    { name: "provider", type: "text", required: true, label: "Provider (short name)" },
    { name: "subject", type: "text", required: true, label: "Identity at the provider" },
    keyField("identityKey"),
    keyField("accountKey"),
  ],
};
