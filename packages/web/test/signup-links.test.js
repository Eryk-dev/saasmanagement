import test from "node:test";
import assert from "node:assert/strict";
import { customerOrgId, pendingSignupProducts } from "../src/lib/leverid.js";

// Botões do "Link de cadastro" (components/leverads-accounts.jsx): um por
// produto do negócio, e cada um some quando a conta daquele produto existe.
const ORG = "a0000000-0000-4000-8000-000000000001";
const LP = "c0000000-0000-4000-8000-000000000001";

test("pendingSignupProducts: um botão por produto do negócio ainda sem conta", () => {
  const lead = { dealItems: [{ product: "ads_escala" }, { product: "price_escala" }] };
  assert.deepEqual(pendingSignupProducts({ saas: "leverads" }, lead), ["leverads", "leverprice"]);
  assert.deepEqual(pendingSignupProducts({ saas: "leverads", leveradsOrgId: ORG }, lead), ["leverprice"]);
  assert.deepEqual(pendingSignupProducts({ saas: "leverads", leveradsOrgId: ORG, leverpriceOrgId: LP }, lead), []);
  assert.deepEqual(pendingSignupProducts({ saas: "leverads", planCode: "price_essencial" }), ["leverprice"]);
  assert.deepEqual(pendingSignupProducts({ saas: "leverads" }), ["leverads"], "sem dado: o link de sempre");
  assert.deepEqual(pendingSignupProducts({ saas: "leverads", planCode: "men_curso" }), [], "Mentoria não tem cadastro");
  assert.deepEqual(pendingSignupProducts({ saas: "elo" }), [], "fora do workspace LeverAds");
  assert.deepEqual(pendingSignupProducts(null), []);
});

// Cliente só do LeverPrice: o selo do LeverId usa a org do LeverId que o
// cadastro do LeverPrice informou; o id local do LeverPrice não serve.
const CORE = "b0000000-0000-4000-8000-000000000001";

test("customerOrgId: LeverAds primeiro; sem ele, a org do LeverId do vínculo do LeverPrice", () => {
  assert.equal(customerOrgId({ leveradsOrgId: ORG, leverpriceOrgLink: { coreOrgId: CORE } }), ORG);
  assert.equal(customerOrgId({ leverpriceOrgId: LP, leverpriceOrgLink: { via: "convite", coreOrgId: CORE.toUpperCase() } }), CORE);
  assert.equal(customerOrgId({ leverpriceOrgId: LP, leverpriceOrgLink: { via: "manual" } }), "", "sem coreOrgId, sem selo");
  assert.equal(customerOrgId({ leverpriceOrgLink: { coreOrgId: "lixo" } }), "");
});

test("pendingSignupProducts: a org do LeverId do LeverPrice não tira o link do LeverAds", () => {
  const lead = { dealItems: [{ product: "ads_escala" }, { product: "price_escala" }] };
  const c = { saas: "leverads", leverpriceOrgId: LP, leverpriceOrgLink: { coreOrgId: CORE } };
  assert.deepEqual(pendingSignupProducts(c, lead), ["leverads"]);
  assert.deepEqual(pendingSignupProducts({ ...c, planCode: "price_essencial" }), []);
});
