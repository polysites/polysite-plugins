import { decrypt, encrypt, recoveryKey } from "./crypto.js";
import { isLocked, stateAfterFailure, stateAfterSuccess } from "./policy.js";
import { consumeRecoveryCode, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from "./recovery.js";
import { generateSecret, otpauthUri, verifyTotp } from "./totp.js";
import { STATE } from "./userState.js";

// Everything that reads or changes a person's two-factor state. The state lives in the plugin's own `auth-user-state`
// collection (one row per user, see userState.js), never on the user row. Its writes go through the Local API with
// `overrideAccess`: they are not edits an editor made, so access rules do not apply, and the collection has no hooks.
//
// Two connections matter here. While someone signs in, Payload holds a transaction that has already touched their user
// row. The state is in another table, so reading and writing it never waits for that row, but code inside the sign-in
// (the hook) still passes `req`, joining the transaction, so a code that was accepted is recorded together with the
// sign-in it belongs to. The count of wrong codes is the one thing that must survive the sign-in being refused (the
// refusal rolls the transaction back), so it lives in its own table and is written without `req`, on a separate connection.
//
// The users collection itself is only touched for what Payload keeps there (the email, the sessions list): the session
// helpers at the bottom, which write to it the way Payload does.
export const USERS = "users";
export const ATTEMPTS = "auth-attempts";

// A message a visitor is allowed to see (Payload hides the text of ordinary errors in production).
export const publicError = (message, status = 400) => Object.assign(new Error(message), { status, isPublic: true });

export const readUser = (payload, id, req) =>
  payload.findByID({ collection: USERS, id, depth: 0, overrideAccess: true, showHiddenFields: true, req });

// Changes an array field of the user row (the sessions) the way Payload itself does: hand the adapter the WHOLE document,
// so every other array (assignedSites) is written back unchanged, because the database layer rewrites EVERY array table
// of a row from what it is given. `change(user)` returns the fields to replace.
export async function saveWithArrays(payload, id, change, req) {
  const user = await readUser(payload, id, req);
  const data = { ...user, ...change(user), updatedAt: null };
  await payload.db.updateOne({ collection: USERS, id, data, returning: false, req });
}

export async function readSettings(payload) {
  try {
    const settings = await payload.findGlobal({ slug: "auth-settings", overrideAccess: true, depth: 0 });
    return { policy: settings?.twoFactorPolicy ?? "off", issuer: settings?.issuerName || "Polysite" };
  } catch {
    return { policy: "off", issuer: "Polysite" };
  }
}

// --- the person's two-factor row -----------------------------------------------------------------------------------

const rowOf = async (payload, userId, req) =>
  (
    await payload.find({
      collection: STATE,
      where: { user: { equals: userId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      showHiddenFields: true,
      pagination: false,
      req,
    })
  ).docs[0] ?? null;

// The row's values, with defaults for "no row yet": two-factor off, nothing stored.
export async function readState(payload, userId, req) {
  const row = await rowOf(payload, userId, req);
  return {
    totpEnabled: Boolean(row?.totpEnabled),
    totpSecret: row?.totpSecret ?? null,
    totpPendingSecret: row?.totpPendingSecret ?? null,
    totpLastStep: row?.totpLastStep ?? null,
    recoveryCodeHashes: Array.isArray(row?.recoveryCodeHashes) ? row.recoveryCodeHashes : [],
  };
}

// Changes some of the person's values, making the row on first use. Two requests making the row at the same moment: the
// second one meets the unique index and updates the row the first one made.
export async function saveState(payload, userId, data, req) {
  const row = await rowOf(payload, userId, req);
  if (row) return payload.update({ collection: STATE, id: row.id, data, overrideAccess: true, depth: 0, req });
  try {
    return await payload.create({ collection: STATE, data: { user: userId, ...data }, overrideAccess: true, depth: 0, req });
  } catch (err) {
    const again = await rowOf(payload, userId, req);
    if (!again) throw err;
    return payload.update({ collection: STATE, id: again.id, data, overrideAccess: true, depth: 0, req });
  }
}

// Forgets everything about the person's second factor (turned off by them, or reset by a Super Admin).
export const clearState = (payload, userId, req) => payload.delete({ collection: STATE, where: { user: { equals: userId } }, overrideAccess: true, req });

// --- wrong-code counter (own table, own connection) ---------------------------------------------------------------

async function attemptsOf(payload, userId) {
  const found = await payload.find({ collection: ATTEMPTS, where: { userId: { equals: String(userId) } }, limit: 1, depth: 0, overrideAccess: true });
  return found.docs[0] ?? null;
}

// The policy helpers speak in `totpFailures` and `totpLockedUntil`; the table stores `failures` and `lockedUntil`.
async function stateOf(payload, userId) {
  const row = await attemptsOf(payload, userId);
  return { totpFailures: row?.failures ?? 0, totpLockedUntil: row?.lockedUntil ?? null };
}

async function saveAttempts(payload, userId, state) {
  const data = { failures: state.totpFailures, lockedUntil: state.totpLockedUntil ?? null };
  const row = await attemptsOf(payload, userId);
  if (row) return payload.update({ collection: ATTEMPTS, id: row.id, data, overrideAccess: true, depth: 0 });
  try {
    return await payload.create({ collection: ATTEMPTS, data: { userId: String(userId), ...data }, overrideAccess: true, depth: 0 });
  } catch {
    // Two wrong codes at the same moment both tried to make the row; the second one updates it.
    const again = await attemptsOf(payload, userId);
    if (!again) throw new Error("could not record the wrong code");
    return payload.update({ collection: ATTEMPTS, id: again.id, data, overrideAccess: true, depth: 0 });
  }
}

export const lockedMessage = "Too many wrong codes. Try again in 10 minutes.";

const lockedNow = async (payload, userId) => isLocked(await stateOf(payload, userId));
const fail = async (payload, userId) => saveAttempts(payload, userId, stateAfterFailure(await stateOf(payload, userId)));
async function succeed(payload, userId) {
  const row = await attemptsOf(payload, userId);
  if (row && (row.failures || row.lockedUntil)) await saveAttempts(payload, userId, stateAfterSuccess());
}

// --- turning it on -----------------------------------------------------------------------------------------------

// Step 1: make a secret and keep it as "pending" (encrypted) until a code from the app proves the person scanned it.
export async function startSetup(payload, user) {
  const { issuer } = await readSettings(payload);
  const secret = generateSecret();
  await saveState(payload, user.id, { totpPendingSecret: encrypt(secret) });
  const uri = otpauthUri({ secret, account: user.email, issuer });
  let qr = null;
  try {
    const { default: QRCode } = await import("qrcode");
    qr = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200 });
  } catch {
    // The QR picture is a convenience; the text key works without it.
  }
  return { secret, uri, qr };
}

// Step 2: the first valid code turns it on and shows the recovery codes, once.
export async function confirmSetup(payload, userId, input) {
  const state = await readState(payload, userId);
  if (state.totpEnabled) throw publicError("Two-factor sign-in is already on for this account.", 409);
  if (await lockedNow(payload, userId)) throw publicError(lockedMessage, 429);
  const pending = decrypt(state.totpPendingSecret);
  if (!pending) throw publicError("Start again: there is no setup in progress.", 409);
  const step = verifyTotp(pending, input);
  if (step === null) {
    await fail(payload, userId);
    throw publicError("That code isn't right. Check the time on your phone and try the next code.", 400);
  }
  const codes = generateRecoveryCodes();
  const key = recoveryKey();
  await saveState(payload, userId, {
    totpEnabled: true,
    totpSecret: encrypt(pending),
    totpPendingSecret: null,
    totpLastStep: step,
    recoveryCodeHashes: codes.map((code) => hashRecoveryCode(code, key)),
  });
  await succeed(payload, userId);
  return { recoveryCodes: codes };
}

// --- checking a code ---------------------------------------------------------------------------------------------

// Checks a code typed at sign-in, or to confirm a sensitive change: an authenticator code first, then a recovery code.
// `req` is passed when this runs inside the sign-in (see the note at the top). Returns { ok, ... }.
export async function checkSecondFactor(payload, userId, input, req) {
  const state = await readState(payload, userId, req);
  if (!state.totpEnabled) return { ok: true };
  if (await lockedNow(payload, userId)) return { ok: false, message: lockedMessage, status: 429 };
  const text = String(input ?? "").trim();
  if (!text) return { ok: false, message: "Enter the 6-digit code from your authenticator app.", status: 401, missing: true };

  if (looksLikeRecoveryCode(text)) {
    const used = consumeRecoveryCode(state.recoveryCodeHashes, text, recoveryKey());
    if (used.ok) {
      await saveState(payload, userId, { recoveryCodeHashes: used.remaining }, req);
      await succeed(payload, userId);
      return { ok: true, usedRecovery: true, recoveryLeft: used.remaining.length };
    }
  } else {
    const step = verifyTotp(decrypt(state.totpSecret), text, { lastStep: state.totpLastStep ?? -1 });
    if (step !== null) {
      await saveState(payload, userId, { totpLastStep: step }, req);
      await succeed(payload, userId);
      return { ok: true };
    }
  }
  await fail(payload, userId);
  return { ok: false, message: "That code isn't right.", status: 401 };
}

export async function disable(payload, userId) {
  await clearState(payload, userId);
  await succeed(payload, userId);
}

export async function newRecoveryCodes(payload, userId) {
  const codes = generateRecoveryCodes();
  const key = recoveryKey();
  await saveState(payload, userId, { recoveryCodeHashes: codes.map((code) => hashRecoveryCode(code, key)) });
  return codes;
}

// A session is a record on the user; removing it makes the token that names it useless.
export const dropSession = (payload, userId, sid, req) =>
  saveWithArrays(payload, userId, (user) => ({ sessions: (user.sessions ?? []).filter((s) => s.id !== sid) }), req);

export const dropAllSessions = (payload, userId, req) => saveWithArrays(payload, userId, () => ({ sessions: [] }), req);

export function sidOf(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sid;
  } catch {
    return undefined;
  }
}
