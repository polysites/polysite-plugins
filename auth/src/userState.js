// A person's two-factor state, in a table of its own: nothing is added to the users collection. One row per user.
//
// Nobody reads, creates, changes or deletes a row through the API, not even a Super Admin: the only way in is this
// plugin's own code, which uses the Local API with `overrideAccess`. A Super Admin can reset someone's two-factor
// sign-in (POST /api/auth-2fa/admin-reset), which removes the row; they can never see what is in it.
export const STATE = "auth-user-state";

const never = () => false;

const secretField = (name, type = "text") => ({
  name,
  type,
  hidden: true,
  access: { read: never, create: never, update: never },
  admin: { hidden: true },
});

export const userStateCollection = {
  slug: STATE,
  graphQL: false,
  admin: { hidden: true },
  access: { read: never, create: never, update: never, delete: never },
  fields: [
    { name: "user", type: "relationship", relationTo: "users", required: true, unique: true, index: true, access: { read: never, create: never, update: never } },
    { name: "totpEnabled", type: "checkbox", defaultValue: false, access: { read: never, create: never, update: never } },
    secretField("totpSecret"),
    secretField("totpPendingSecret"),
    secretField("totpLastStep", "number"),
    secretField("recoveryCodeHashes", "json"),
  ],
};
