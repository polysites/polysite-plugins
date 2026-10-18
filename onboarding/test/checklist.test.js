import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate, isPublicDomain, ITEMS, sees, siteIdFromCookie } from "../src/checklist.js";
import onboardingPlugin from "../src/index.js";

const superAdmin = { isSuperAdmin: true };
const siteAdmin = { role: { modules: ["pages", "media", "forms"], operations: { create: true }, manageSiteSettings: true } };
const siteUser = { role: { modules: ["pages", "media", "forms"], operations: { create: true }, manageSiteSettings: false } };
const readOnly = { role: { modules: ["pages"], operations: { create: false }, manageSiteSettings: false } };
const empty = { siteId: "1", site: { domain: "demo.localhost", logo: null, headerNavItems: [] }, ownPages: 0, forms: 0, media: 0, editors: 0 };
const ids = (result) => result.items.map((i) => i.id);

describe("isPublicDomain", () => {
  it("rejects development names and bare addresses", () => {
    for (const d of ["", undefined, "localhost", "demo.localhost", "box.local", "a.test", "a.example", "10.0.0.5", "[::1]", "intranet", "x.lan"]) assert.equal(isPublicDomain(d), false, String(d));
  });
  it("accepts a real hostname, with or without a port", () => {
    assert.equal(isPublicDomain("www.example.org"), true);
    assert.equal(isPublicDomain("Example.ORG:8443"), true);
  });
});

describe("who sees which step", () => {
  it("shows a Super Admin everything", () => assert.deepEqual(ids(evaluate({ person: superAdmin, facts: empty })), ITEMS.map((i) => i.id)));
  it("hides the settings, people and server steps from a Site User", () => {
    assert.deepEqual(ids(evaluate({ person: siteUser, facts: empty })), ["page", "media", "form", "drafts"]);
  });
  it("shows a Site Admin the settings steps but not the people and server steps", () => {
    assert.deepEqual(ids(evaluate({ person: siteAdmin, facts: empty })), ["identity", "menu", "domain", "page", "media", "form", "drafts"]);
  });
  it("gives a role that cannot create anything only the reading step", () => assert.deepEqual(ids(evaluate({ person: readOnly, facts: empty })), ["drafts"]));
  it("shows nothing to nobody", () => assert.equal(sees(ITEMS[0], undefined), false));
});

describe("ticking", () => {
  it("ticks each step from what exists", () => {
    const facts = { siteId: "1", site: { domain: "www.example.org", logo: 5, headerNavItems: [{ label: "A" }] }, ownPages: 2, forms: 1, media: 3, editors: 1 };
    const result = evaluate({ person: superAdmin, facts, byHand: ["drafts"] });
    assert.deepEqual(result.items.filter((i) => !i.done).map((i) => i.id), ["backups"]);
    assert.equal(result.complete, false);
    assert.equal(evaluate({ person: superAdmin, facts, byHand: ["drafts", "backups"] }).complete, true);
  });
  it("leaves a step unticked when the number could not be read", () => {
    const result = evaluate({ person: superAdmin, facts: { ...empty, editors: undefined, forms: undefined } });
    assert.equal(result.items.find((i) => i.id === "editor").done, false);
    assert.equal(result.items.find((i) => i.id === "form").done, false);
  });
  it("only ticks a step by hand when it is a by-hand step", () => {
    const result = evaluate({ person: superAdmin, facts: empty, byHand: ["page", "backups"] });
    assert.equal(result.items.find((i) => i.id === "page").done, false);
    assert.equal(result.items.find((i) => i.id === "backups").done, true);
  });
  it("counts done and total", () => {
    const result = evaluate({ person: siteUser, facts: { ...empty, forms: 1 }, byHand: [] });
    assert.deepEqual([result.done, result.total], [1, 4]);
  });
  it("points the steps at real admin pages", () => {
    const result = evaluate({ person: superAdmin, facts: empty });
    assert.equal(result.items.find((i) => i.id === "identity").href, "/admin/collections/sites/1");
    assert.equal(result.items.find((i) => i.id === "form").href, "/admin/collections/forms/create");
  });
});

describe("siteIdFromCookie", () => {
  it("reads the site switcher's cookie", () => assert.equal(siteIdFromCookie("a=b; payload-tenant=4; c=d"), "4"));
  it("ignores a missing or odd value", () => {
    assert.equal(siteIdFromCookie("a=b"), undefined);
    assert.equal(siteIdFromCookie("payload-tenant=../x"), undefined);
  });
});

describe("the plugin", () => {
  it("adds its own hidden collection and the dashboard card, and nothing public", () => {
    const config = onboardingPlugin({ collections: [{ slug: "pages" }], admin: { components: { beforeDashboard: ["x"] } } });
    const added = config.collections.find((c) => c.slug === "onboarding-progress");
    assert.equal(added.admin.hidden, true);
    assert.deepEqual(added.custom.polysite.siteSettings, { key: "onboarding", publicFields: [] });
    assert.equal(config.admin.components.beforeDashboard.length, 2);
    assert.equal(config.collections.length, 2);
  });
  it("lets anyone signed in update a row but only a Super Admin delete one", () => {
    const { access } = onboardingPlugin({}).collections[0];
    const req = (user) => ({ req: { user } });
    assert.equal(access.update(req({ id: 1 })), true);
    assert.equal(access.update(req(null)), false);
    assert.equal(access.delete(req({ id: 1 })), false);
    assert.equal(access.delete(req({ isSuperAdmin: true })), true);
  });
  it("accepts step names and refuses anything else", () => {
    const field = onboardingPlugin({}).collections[0].fields.find((f) => f.name === "doneByHand");
    assert.equal(field.validate(["backups"]), true);
    assert.notEqual(field.validate(["<script>"]), true);
  });
});
