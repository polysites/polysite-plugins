import { apiKeyKey } from "../crypto.js";
import { KEYS } from "./collection.js";
import { hashKey, isExpired, keyFromHeader } from "./keys.js";

// `Authorization: Bearer psk_...` signs a request in as the key's owner. A strategy is configuration on the users
// collection (no schema): Payload tries it before its own token check, and a request without such a header costs one
// string test. The key can never give more than its owner has: the request carries the owner's own document, so every
// access rule applies as it would to that person. It skips the second factor, like any token a person made for a script.
export const STRATEGY = "polysite-api-key";

// A key's "last used" time is written at most once a minute, so a busy script doesn't write a row per request.
const TOUCH_EVERY_MS = 60_000;

export function apiKeyStrategy(userSlug) {
  return {
    name: STRATEGY,
    authenticate: async ({ headers, payload, req, isGraphQL }) => {
      const key = keyFromHeader(headers.get("authorization"));
      if (!key) return { user: null };
      try {
        const found = await payload.find({
          collection: KEYS,
          where: { keyHash: { equals: hashKey(key, apiKeyKey()) } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
          pagination: false,
        });
        const row = found.docs[0];
        if (!row || !row.user || isExpired(row)) return { user: null };

        const collection = payload.collections[userSlug];
        const user = await payload.findByID({
          collection: userSlug,
          id: row.user,
          depth: isGraphQL ? 0 : collection.config.auth.depth,
          overrideAccess: true,
          req,
        });
        // A locked account (too many wrong passwords) stays locked for keys too.
        if (!user || (user.lockUntil && new Date(user.lockUntil).getTime() > Date.now())) return { user: null };

        const last = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
        if (Date.now() - last > TOUCH_EVERY_MS) {
          payload
            .update({ collection: KEYS, id: row.id, data: { lastUsedAt: new Date().toISOString() }, overrideAccess: true, depth: 0 })
            .catch((err) => payload.logger.warn({ err, msg: "[auth] could not record an API key's last use" }));
        }
        return { user: { ...user, collection: userSlug, _strategy: STRATEGY } };
      } catch (err) {
        payload.logger.warn({ err, msg: "[auth] API key sign-in failed" });
        return { user: null };
      }
    },
  };
}

// Payload's `me` endpoint reads any `Authorization: Bearer ...` header as a JWT to report its expiry, and fails on a key.
// For a request a key signed in, this answers instead (the person, no token details).
export const meForKeys = ({ args, user }) => (args?.req?.user?._strategy === STRATEGY ? { user, exp: undefined } : undefined);
