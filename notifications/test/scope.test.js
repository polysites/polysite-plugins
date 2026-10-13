import assert from "node:assert/strict";
import { test } from "node:test";

import { mayHearOfDeletion } from "../src/scope.js";

test("a person hears of a deletion on their own sites only", () => {
  const user = { assignedSites: [{ site: 1 }, { site: { id: 3 } }] };
  assert.equal(mayHearOfDeletion(user, { site: 1 }), true);
  assert.equal(mayHearOfDeletion(user, { site: "3" }), true);
  assert.equal(mayHearOfDeletion(user, { site: 2 }), false);
});

test("a deletion with no site is for Super Admins only", () => {
  assert.equal(mayHearOfDeletion({ assignedSites: [{ site: 1 }] }, { site: null }), false);
  assert.equal(mayHearOfDeletion({ isSuperAdmin: true }, { site: null }), true);
  assert.equal(mayHearOfDeletion({ isSuperAdmin: true }, { site: 9 }), true);
});

test("nobody without an assignment hears of anything", () => {
  assert.equal(mayHearOfDeletion({}, { site: 1 }), false);
  assert.equal(mayHearOfDeletion(null, { site: 1 }), false);
});
