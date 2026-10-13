import { STRATEGY } from "./apikeys/strategy.js";
import { twoFactorRequired } from "./policy.js";
import {
  USERS,
  checkSecondFactor,
  confirmSetup,
  disable,
  dropAllSessions,
  dropSession,
  newRecoveryCodes,
  publicError,
  readSettings,
  readState,
  readUser,
  sidOf,
  startSetup,
} from "./twofactor.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const body = async (req) => (await req.json?.().catch(() => null)) ?? {};

// Every handler turns a thrown public error into a normal JSON answer; anything else is a plain 500.
const handler = (fn) => async (req) => {
  try {
    return await fn(req);
  } catch (err) {
    if (err?.isPublic) return json({ message: err.message }, err.status ?? 400);
    req.payload.logger.error({ err, msg: "[auth] endpoint failed" });
    return json({ message: "Something went wrong." }, 500);
  }
};

// Changing anyone's two-factor sign-in needs a real sign-in, not an API key: a stolen key must not be able to enrol its own
// authenticator and lock the owner out. Only the read-only status may be asked with a key.
const signedIn = (req, { allowKey = false } = {}) => {
  if (!req.user || req.user.collection !== USERS) throw publicError("Sign in first.", 401);
  if (!allowKey && req.user._strategy === STRATEGY) throw publicError("Sign in with your password to change two-factor settings; an API key can't.", 403);
  return req.user;
};

// Proves who someone is before they have a session, for setting up two-factor from the sign-in page. It is a real
// password sign-in (so Payload's own wrong-password lock applies), and the session it creates is thrown away at once.
async function verifyPassword(req, email, password) {
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) throw publicError("Enter your email and password.", 400);
  let login;
  try {
    login = await req.payload.login({ collection: USERS, data: { email, password }, context: { polysiteSkip2FA: true } });
  } catch {
    throw publicError("Email or password is incorrect.", 401);
  }
  const sid = sidOf(login.token);
  if (sid) await dropSession(req.payload, login.user.id, sid);
  return login.user;
}

export const endpoints = [
  {
    path: "/auth-2fa/status",
    method: "get",
    handler: handler(async (req) => {
      const user = signedIn(req, { allowKey: true });
      const state = await readState(req.payload, user.id);
      const { policy } = await readSettings(req.payload);
      return json({
        enabled: state.totpEnabled,
        required: twoFactorRequired(policy, user),
        recoveryCodesLeft: state.recoveryCodeHashes.length,
      });
    }),
  },
  {
    path: "/auth-2fa/setup",
    method: "post",
    handler: handler(async (req) => {
      const user = signedIn(req);
      if ((await readState(req.payload, user.id)).totpEnabled) throw publicError("Two-factor sign-in is already on. Turn it off first to set it up again.", 409);
      return json(await startSetup(req.payload, user));
    }),
  },
  {
    path: "/auth-2fa/confirm",
    method: "post",
    handler: handler(async (req) => {
      const user = signedIn(req);
      const { code } = await body(req);
      return json(await confirmSetup(req.payload, user.id, code));
    }),
  },
  {
    path: "/auth-2fa/disable",
    method: "post",
    handler: handler(async (req) => {
      const user = signedIn(req);
      const { code } = await body(req);
      const result = await checkSecondFactor(req.payload, user.id, code);
      if (!result.ok) throw publicError(result.message, result.status ?? 401);
      const { policy } = await readSettings(req.payload);
      if (twoFactorRequired(policy, user)) throw publicError("Your administrator requires two-factor sign-in, so it can't be turned off.", 403);
      await disable(req.payload, user.id);
      return json({ ok: true });
    }),
  },
  {
    path: "/auth-2fa/recovery-codes",
    method: "post",
    handler: handler(async (req) => {
      const user = signedIn(req);
      const { code } = await body(req);
      const result = await checkSecondFactor(req.payload, user.id, code);
      if (!result.ok) throw publicError(result.message, result.status ?? 401);
      if (!(await readState(req.payload, user.id)).totpEnabled) throw publicError("Two-factor sign-in is not on, so there are no recovery codes to renew.", 409);
      return json({ recoveryCodes: await newRecoveryCodes(req.payload, user.id) });
    }),
  },
  {
    // A Super Admin helps someone who lost their phone and recovery codes. They are signed out everywhere and must sign
    // in again (and set two-factor up again if the policy asks).
    path: "/auth-2fa/admin-reset",
    method: "post",
    handler: handler(async (req) => {
      const admin = signedIn(req);
      if (!admin.isSuperAdmin) throw publicError("Only a Super Admin can reset someone else's two-factor sign-in.", 403);
      const { userId } = await body(req);
      if (!userId) throw publicError("Say whose two-factor sign-in to reset.", 400);
      if (!(await readUser(req.payload, userId).catch(() => null))) throw publicError("There is no such user.", 404);
      await disable(req.payload, userId);
      await dropAllSessions(req.payload, userId);
      req.payload.logger.warn(`[auth] ${admin.email} reset two-factor sign-in for user ${userId}`);
      return json({ ok: true });
    }),
  },
  {
    path: "/auth-2fa/enroll/start",
    method: "post",
    handler: handler(async (req) => {
      const { email, password } = await body(req);
      const user = await verifyPassword(req, email, password);
      if ((await readState(req.payload, user.id)).totpEnabled) throw publicError("Two-factor sign-in is already set up for this account.", 409);
      return json(await startSetup(req.payload, user));
    }),
  },
  {
    path: "/auth-2fa/enroll/confirm",
    method: "post",
    handler: handler(async (req) => {
      const { email, password, code } = await body(req);
      const user = await verifyPassword(req, email, password);
      return json(await confirmSetup(req.payload, user.id, code));
    }),
  },
];
