import assert from "node:assert/strict";
import { test } from "node:test";

import { base32Decode, base32Encode, generateSecret, hotp, normaliseCode, otpauthUri, stepOf, totp, verifyTotp } from "../src/totp.js";

// RFC 6238 appendix B uses the ASCII key "12345678901234567890" (SHA-1); its 8-digit answers end in these 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("base32 round-trips and matches the known encoding", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(base32Decode(RFC_SECRET).toString(), "12345678901234567890");
  const random = generateSecret();
  assert.equal(random.length, 32);
  assert.deepEqual(base32Decode(random), base32Decode(random.toLowerCase()));
  assert.throws(() => base32Decode("not*base32"));
});

test("codes match the RFC 6238 and RFC 4226 test vectors", () => {
  assert.equal(totp(RFC_SECRET, 59 * 1000), "287082");
  assert.equal(totp(RFC_SECRET, 1111111109 * 1000), "081804");
  assert.equal(totp(RFC_SECRET, 1111111111 * 1000), "050471");
  assert.equal(hotp(RFC_SECRET, 0), "755224");
});

test("a code is accepted in its own window and one either side, not further", () => {
  const now = 1_700_000_000_000;
  const code = totp(RFC_SECRET, now);
  assert.equal(verifyTotp(RFC_SECRET, code, { now }), stepOf(now));
  assert.equal(verifyTotp(RFC_SECRET, code, { now: now + 30_000 }), stepOf(now));
  assert.equal(verifyTotp(RFC_SECRET, code, { now: now - 30_000 }), stepOf(now));
  assert.equal(verifyTotp(RFC_SECRET, code, { now: now + 90_000 }), null);
});

test("a code can't be used twice: steps up to the last used one are refused", () => {
  const now = 1_700_000_000_000;
  const code = totp(RFC_SECRET, now);
  const step = verifyTotp(RFC_SECRET, code, { now });
  assert.equal(verifyTotp(RFC_SECRET, code, { now, lastStep: step }), null);
  assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), { now: now + 30_000, lastStep: step }), step + 1);
});

test("malformed input is refused, spaces and hyphens are forgiven", () => {
  const now = 1_700_000_000_000;
  const code = totp(RFC_SECRET, now);
  assert.equal(normaliseCode(" 123-456 "), "123456");
  assert.notEqual(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { now }), null);
  for (const bad of ["", "12345", "1234567", "abcdef", null, undefined]) {
    assert.equal(verifyTotp(RFC_SECRET, bad, { now }), null, String(bad));
  }
  assert.equal(verifyTotp("", code, { now }), null);
});

test("the enrolment link carries the secret, issuer and account in the standard form", () => {
  const uri = otpauthUri({ secret: "ABC234", account: "a.b+c@example.org", issuer: "Polysite Demo" });
  assert.equal(uri, "otpauth://totp/Polysite%20Demo:a.b%2Bc%40example.org?secret=ABC234&issuer=Polysite%20Demo&algorithm=SHA1&digits=6&period=30");
});
