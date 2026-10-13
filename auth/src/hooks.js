import { twoFactorRequired } from "./policy.js";
import { checkSecondFactor, dropSession, publicError, readSettings, readState, readUser } from "./twofactor.js";

// The code reaches the server in a short-lived cookie that the sign-in page's code box sets (Payload's own login form
// only carries email and password), or in a header for scripts.
export const CODE_COOKIE = "polysite-totp";
export const CODE_HEADER = "x-polysite-totp";

export function codeFromRequest(req) {
  const header = req.headers?.get?.(CODE_HEADER);
  if (header) return header;
  const cookies = req.headers?.get?.("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CODE_COOKIE) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}

// Runs after the password was checked and before a session is handed out. A person with two-factor on gets in only with
// a valid code; a person the policy says must use it, but who hasn't set it up, is sent to do that first.
// `context.polysiteSkip2FA` is for this plugin's own calls (setting up before the first sign-in), never for a request.
export async function beforeLogin({ user, req }) {
  if (req.context?.polysiteSkip2FA === true) return user;
  const { policy } = await readSettings(req.payload);
  const state = await readState(req.payload, user.id, req);

  if (!state.totpEnabled) {
    if (twoFactorRequired(policy, user)) {
      throw publicError(
        "Two-factor sign-in is required for your account. Set it up with the steps shown under the form, then sign in again.",
        403,
      );
    }
    return user;
  }

  const result = await checkSecondFactor(req.payload, user.id, codeFromRequest(req), req);
  if (!result.ok) throw publicError(result.message, result.status ?? 401);
  if (result.usedRecovery) req.payload.logger.warn(`[auth] ${user.email} signed in with a recovery code (${result.recoveryLeft} left)`);
  return user;
}

// Resetting a password by email signs the person straight in, without ever passing the sign-in check above. For an
// account with two-factor on, that would let anyone who can read the mailbox skip it. So the session that reset just made
// is removed: the password is changed, and the person signs in again with the new password and a code.
export async function afterOperation({ operation, result, req }) {
  if (operation !== "resetPassword" || !result?.user?.id) return result;
  const state = await readState(req.payload, result.user.id, req);
  if (!state.totpEnabled) return result;
  const full = await readUser(req.payload, result.user.id, req);
  const sessions = full.sessions ?? [];
  const newest = sessions[sessions.length - 1];
  if (newest?.id) await dropSession(req.payload, full.id, newest.id, req);
  return result;
}
