// Who must use a second factor, and the failure counter that stops someone guessing codes.
export const POLICIES = ["off", "super-admins", "everyone"];
export const MAX_FAILURES = 5;
export const LOCK_MS = 10 * 60 * 1000;

export function twoFactorRequired(policy, user) {
  if (policy === "everyone") return true;
  if (policy === "super-admins") return user?.isSuperAdmin === true;
  return false;
}

export const isLocked = (user, now = Date.now()) => Boolean(user?.totpLockedUntil) && new Date(user.totpLockedUntil).getTime() > now;

// The fields to save after a wrong code: count it, and lock after MAX_FAILURES in a row.
export function stateAfterFailure(user, now = Date.now()) {
  const failures = (user?.totpFailures ?? 0) + 1;
  if (failures >= MAX_FAILURES) return { totpFailures: 0, totpLockedUntil: new Date(now + LOCK_MS).toISOString() };
  return { totpFailures: failures };
}

export const stateAfterSuccess = () => ({ totpFailures: 0, totpLockedUntil: null });
