// Guard da Remuneração: /api/comp_plans é dado sensível (salário) — exige a
// etiqueta admin ALÉM da tela. Lista de telas em branco significa "vê tudo",
// e salário não pode vazar por esse caminho (era o furo da conta sem restrição).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeScreenGuardHook } from "../src/screens.js";

const run = async (user, url, method = "GET") => {
  let code = null;
  const reply = { code(c) { code = c; return this; }, send() { return this; } };
  await makeScreenGuardHook()({ authUser: user, url, method }, reply);
  return code;
};

test("comp_plans: não-admin toma 403 mesmo com todas as telas liberadas", async () => {
  assert.equal(await run({ roles: ["closer"], screens: [] }, "/api/comp_plans"), 403);
  assert.equal(await run({ roles: ["integrator"], screens: [] }, "/api/comp_plans/abc", "PATCH"), 403);
});

test("comp_plans: admin passa; key mestre (sem authUser) passa", async () => {
  assert.equal(await run({ roles: ["closer", "admin"], screens: [] }, "/api/comp_plans"), null);
  assert.equal(await run(null, "/api/comp_plans"), null);
});

test("comp_plans: admin com telas RESTRITAS ainda precisa da tela remuneracao", async () => {
  assert.equal(await run({ roles: ["admin"], screens: ["overview"] }, "/api/comp_plans?x=1"), 403);
  assert.equal(await run({ roles: ["admin"], screens: ["remuneracao"] }, "/api/comp_plans"), null);
});
