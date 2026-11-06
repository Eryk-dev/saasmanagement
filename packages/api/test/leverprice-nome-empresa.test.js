// Nome da empresa pela conta do LeverPrice (06/11/2026): o cliente só do
// LeverPrice nascia com o nome da pessoa ("Max") e a busca não achava a
// empresa ("JOIAS"). Mesma regra do LeverAds (leverads-orgs.js orgNamePatches).

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { leverpriceNamePatches, syncLeverpriceNames } from "../src/customers/leverprice-names.js";
import { handleLeverpriceOrgCreated } from "../src/customers/leverprice-orgs.js";
import { runLifecycleSweep } from "../src/customers/lifecycle.js";

const LP = "c0000000-0000-4000-8000-000000000001";
const LA = "a0000000-0000-4000-8000-000000000001";
const NOW = "2026-11-06T12:00:00.000Z";
const max = (extra = {}) => ({ id: "cu_max", saas: "leverads", name: "Max", contact: "Max", leadId: "le_max",
  leverpriceOrgId: LP, leverpriceOrgLink: { via: "convite", orgName: "JOIAS" }, ...extra });

test("leverpriceNamePatches: nome de pessoa vira o da empresa; a pessoa fica no contato", () => {
  const p = leverpriceNamePatches(max({ contact: "" }), { id: "le_max", name: "Max" }, NOW);
  assert.deepEqual(p.customer, { leverpriceOrgName: "JOIAS", name: "JOIAS", contact: "Max", nameFrom: { via: "leverprice_org", previous: "Max", at: NOW } });
  assert.deepEqual(p.lead, { company: "JOIAS" }, "o lead sem empresa ganha a da conta");
});

test("leverpriceNamePatches: nome de empresa dado à mão não muda, só entra na busca", () => {
  const p = leverpriceNamePatches(max({ name: "Kl sports", contact: "Lorra" }), { id: "le_max", name: "Lorra", company: "Kl sports" }, NOW);
  assert.deepEqual(p.customer, { leverpriceOrgName: "JOIAS" });
  assert.equal(p.lead, null);
});

test("leverpriceNamePatches: com conta do LeverAds o nome segue a do LeverAds", () => {
  const p = leverpriceNamePatches(max({ leveradsOrgId: LA }), { id: "le_max", name: "Max" }, NOW);
  assert.deepEqual(p.customer, { leverpriceOrgName: "JOIAS" });
  assert.equal(p.lead, null);
});

test("leverpriceNamePatches: sem conta ou sem nome da org, nada", () => {
  assert.deepEqual(leverpriceNamePatches(max({ leverpriceOrgId: "" })), { customer: null, lead: null });
  assert.deepEqual(leverpriceNamePatches(max({ leverpriceOrgLink: { via: "manual" } })), { customer: null, lead: null });
});

test("leverpriceNamePatches: nome que veio da org acompanha a org; renomeado à mão, não", () => {
  const seguindo = max({ name: "JOIAS", leverpriceOrgName: "JOIAS", nameFrom: { via: "leverprice_org" }, leverpriceOrgLink: { orgName: "Di Max Joias" } });
  assert.equal(leverpriceNamePatches(seguindo, null, NOW).customer.name, "Di Max Joias");
  const aMao = { ...seguindo, name: "Max Joalheria" };
  assert.deepEqual(leverpriceNamePatches(aMao, null, NOW).customer, { leverpriceOrgName: "Di Max Joias" });
});

test("handleLeverpriceOrgCreated: o cliente ganha o nome da empresa no vínculo", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "le_max", name: "Max", email: "max@loja.test" });
  await repo.create("customers", { id: "cu_max", saas: "leverads", name: "Max", contact: "Max", leadId: "le_max", planCode: "price_essencial", signupInvite: { token: "cvt_abcdefghijklmnop" } });
  const r = await handleLeverpriceOrgCreated(repo, { orgId: LP, invite: "cvt_abcdefghijklmnop", name: "JOIAS", now: () => new Date(NOW) });
  assert.equal(r.linked, true);
  const saved = await repo.get("customers", "cu_max");
  assert.equal(saved.name, "JOIAS");
  assert.equal(saved.contact, "Max");
  assert.equal(saved.leverpriceOrgName, "JOIAS");
  assert.equal((await repo.get("leads", "le_max")).company, "JOIAS");
});

test("ciclo de vida: renomeia os vínculos antigos e os gravados à mão; a segunda passada não regrava", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "le_max", name: "Wilian" });
  await repo.create("customers", max({ name: "Wilian", contact: "Wilian", leverpriceOrgLink: { via: "manual", orgName: "Bagatoli Shope" } }));
  const r = await runLifecycleSweep(repo, { now: new Date(NOW) });
  assert.equal(r.renamed, 1);
  assert.equal((await repo.get("customers", "cu_max")).name, "Bagatoli Shope");
  assert.equal((await syncLeverpriceNames(repo, { now: new Date(NOW) })).renamed, 0);
});
