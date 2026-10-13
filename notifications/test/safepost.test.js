import assert from "node:assert/strict";
import { test } from "node:test";

import { assertUrlAllowed, isPrivateAddress } from "../src/safePost.js";

test("private, reserved and special-purpose addresses are refused", () => {
  for (const a of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "192.0.0.8", "192.0.2.1", "198.18.0.1", "203.0.113.9", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ["::1", "fe80::1", "febf::1", "fc00::1", "fd12::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::10.0.0.1", "2002:7f00:1::1", "2002:a9fe:a9fe::"]) {
    assert.equal(isPrivateAddress(a), true, a);
  }
});

test("public addresses are allowed", () => {
  for (const a of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "64:ff9b::8.8.8.8", "2002:0808:0808::1"]) assert.equal(isPrivateAddress(a), false, a);
});

test("a destination URL must be http(s) and not a private address literal", () => {
  assert.throws(() => assertUrlAllowed("ftp://example.org/x"));
  assert.throws(() => assertUrlAllowed("http://127.0.0.1:3001/x"));
  assert.throws(() => assertUrlAllowed("https://[::1]/x"));
  assert.throws(() => assertUrlAllowed("https://2130706433/"));
  assert.doesNotThrow(() => assertUrlAllowed("https://hooks.example.org/x"));
});
