import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_FAILURES, isLocked, stateAfterFailure, stateAfterSuccess, twoFactorRequired } from "../src/policy.js";
import { consumeRecoveryCode, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from "../src/recovery.js";

const KEY = Buffer.alloc(32, 7);

test("ten distinct recovery codes in the xxxxx-xxxxx form, with no look-alike characters", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
    assert.ok(looksLikeRecoveryCode(code));
  }
});

test("a recovery code works once, however it is typed", () => {
  const [first, second] = generateRecoveryCodes(2);
  const hashes = [hashRecoveryCode(first, KEY), hashRecoveryCode(second, KEY)];
  const used = consumeRecoveryCode(hashes, ` ${first.toUpperCase().replace("-", " ")} `, KEY);
  assert.equal(used.ok, true);
  assert.deepEqual(used.remaining, [hashes[1]]);
  assert.equal(consumeRecoveryCode(used.remaining, first, KEY).ok, false);
  assert.equal(consumeRecoveryCode(used.remaining, second, KEY).ok, true);
});

test("a wrong, short or empty code is refused and nothing is consumed", () => {
  const hashes = [hashRecoveryCode("abcde-fghjk", KEY)];
  for (const bad of ["abcde-fghjm", "abc", "", null, "123456"]) {
    const result = consumeRecoveryCode(hashes, bad, KEY);
    assert.equal(result.ok, false);
    assert.deepEqual(result.remaining, hashes);
  }
  assert.equal(consumeRecoveryCode(undefined, "abcde-fghjk", KEY).ok, false);
  assert.notEqual(hashRecoveryCode("abcde-fghjk", KEY), hashRecoveryCode("abcde-fghjk", Buffer.alloc(32, 8)));
});

test("the policy decides who must use two-factor", () => {
  assert.equal(twoFactorRequired("off", { isSuperAdmin: true }), false);
  assert.equal(twoFactorRequired("super-admins", { isSuperAdmin: true }), true);
  assert.equal(twoFactorRequired("super-admins", { isSuperAdmin: false }), false);
  assert.equal(twoFactorRequired("everyone", {}), true);
  assert.equal(twoFactorRequired(undefined, { isSuperAdmin: true }), false);
});

test("repeated wrong codes lock the account for a while, and success clears the count", () => {
  const now = Date.now();
  let user = {};
  for (let i = 1; i < MAX_FAILURES; i++) {
    user = { ...user, ...stateAfterFailure(user, now) };
    assert.equal(user.totpFailures, i);
    assert.equal(isLocked(user, now), false);
  }
  user = { ...user, ...stateAfterFailure(user, now) };
  assert.equal(isLocked(user, now), true);
  assert.equal(isLocked(user, now + 11 * 60 * 1000), false);
  assert.deepEqual(stateAfterSuccess(), { totpFailures: 0, totpLockedUntil: null });
});
