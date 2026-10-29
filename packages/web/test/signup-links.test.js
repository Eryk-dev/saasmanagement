import test from "node:test";
import assert from "node:assert/strict";
import { pendingSignupProducts } from "../src/lib/leverid.js";

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
