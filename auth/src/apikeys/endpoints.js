import { apiKeyKey } from "../crypto.js";
import { USERS, publicError } from "../twofactor.js";
import { KEYS } from "./collection.js";
import { apiKeysEnabled, cleanLabel, expiryFromDays, generateKey, hashKey } from "./keys.js";
import { STRATEGY } from "./strategy.js";

// /api/auth-keys/list     the signed-in person's keys (never the secret or its hash)
// /api/auth-keys/issue    makes a key and returns its text once
// /api/auth-keys/revoke   deletes one of the person's keys (a Super Admin: anyone's)
//
// All three need a real sign-in. A key can't make or revoke keys: a stolen key must not be able to outlive its own deletion.
export const MAX_KEYS_PER_USER = 10;

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const body = async (req) => (await req.json?.().catch(() => null)) ?? {};

const handler = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (err) {
    if (err?.isPublic) return json({ message: err.message }, err.status ?? 400);
    req.payload.logger.error({ err, msg: "[auth] API key endpoint failed" });
    return json({ message: "Something went wrong." }, 500);
  }
};

function signedInPerson(req) {
  if (!apiKeysEnabled()) throw publicError("API keys are switched off. An administrator turns them on with AUTH_API_KEYS=true.", 404);
  if (!req.user || req.user.collection !== USERS) throw publicError("Sign in first.", 401);
  if (req.user._strategy === STRATEGY) throw publicError("Sign in with your password to manage API keys; a key can't manage keys.", 403);
  return req.user;
}

const present = (row) => ({ id: row.id, label: row.label, prefix: row.keyPrefix, lastUsedAt: row.lastUsedAt ?? null, expiresAt: row.expiresAt ?? null, createdAt: row.createdAt });

export function apiKeyEndpoints() {
  return [
    {
      path: "/auth-keys/list",
      method: "get",
      handler: handler(async (req) => {
        const user = signedInPerson(req);
        const found = await req.payload.find({ collection: KEYS, where: { user: { equals: user.id } }, sort: "-createdAt", limit: 50, depth: 0, overrideAccess: true, pagination: false });
        return json({ keys: found.docs.map(present) });
      }),
    },
    {
      path: "/auth-keys/issue",
      method: "post",
      handler: handler(async (req) => {
        const user = signedInPerson(req);
        const { label, expiresInDays } = await body(req);
        const name = cleanLabel(label);
        if (!name) throw publicError("Say what the key is for, in 80 characters or fewer.", 400);
        const expiresAt = expiryFromDays(expiresInDays);
        if (expiresAt === undefined) throw publicError("Expiry is a whole number of days from 1 to 3650, or empty for none.", 400);
        const { totalDocs } = await req.payload.count({ collection: KEYS, where: { user: { equals: user.id } }, overrideAccess: true });
        if (totalDocs >= MAX_KEYS_PER_USER) throw publicError(`You already have ${MAX_KEYS_PER_USER} keys. Delete one you no longer use first.`, 409);

        const { key, prefix } = generateKey();
        const row = await req.payload.create({
          collection: KEYS,
          data: { user: user.id, label: name, keyPrefix: prefix, keyHash: hashKey(key, apiKeyKey()), expiresAt },
          overrideAccess: true,
          depth: 0,
        });
        req.payload.logger.info(`[auth] ${user.email} made API key ${prefix} ("${name}")`);
        return json({ key, ...present(row) }, 201);
      }),
    },
    {
      path: "/auth-keys/revoke",
      method: "post",
      handler: handler(async (req) => {
        const user = signedInPerson(req);
        const { id } = await body(req);
        if (id === undefined || id === null || id === "") throw publicError("Say which key to delete.", 400);
        const row = await req.payload.findByID({ collection: KEYS, id, depth: 0, overrideAccess: true }).catch(() => null);
        // A key that isn't yours looks the same as one that doesn't exist.
        if (!row || (String(row.user) !== String(user.id) && user.isSuperAdmin !== true)) throw publicError("There is no such key.", 404);
        await req.payload.delete({ collection: KEYS, id: row.id, overrideAccess: true });
        req.payload.logger.info(`[auth] ${user.email} deleted API key ${row.keyPrefix}`);
        return json({ ok: true });
      }),
    },
  ];
}
