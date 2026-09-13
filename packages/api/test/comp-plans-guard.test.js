// Guard da Remuneração: /api/comp_plans é dado sensível (salário). Lista de
// telas em branco significa "vê tudo", e salário não pode vazar por esse
// caminho (era o furo da conta sem restrição). Passa: admin (tudo) ou quem
// ganhou a tela `remuneracao` EXPLICITAMENTE em Ajustes → Equipe (só GET —
// editar plano de comp segue coisa de admin).
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

test("comp_plans: tela remuneracao concedida explicitamente = leitura; escrita segue só admin", async () => {
  const vitor = { roles: ["closer"], screens: ["overview", "remuneracao"] };
  assert.equal(await run(vitor, "/api/comp_plans"), null);
  assert.equal(await run(vitor, "/api/comp_plans", "POST"), 403);
  assert.equal(await run(vitor, "/api/comp_plans/abc", "PATCH"), 403);
});

test("comp_plans: admin passa; key mestre (sem authUser) passa", async () => {
  assert.equal(await run({ roles: ["closer", "admin"], screens: [] }, "/api/comp_plans"), null);
  assert.equal(await run(null, "/api/comp_plans"), null);
});

test("comp_plans: admin com telas RESTRITAS ainda precisa da tela remuneracao", async () => {
  assert.equal(await run({ roles: ["admin"], screens: ["overview"] }, "/api/comp_plans?x=1"), 403);
  assert.equal(await run({ roles: ["admin"], screens: ["remuneracao"] }, "/api/comp_plans"), null);
});

// ── Extrato mensal: mesmo guard, porque tem R$ por pessoa ────────────────
test("comp/months: não-admin toma 403 mesmo com todas as telas liberadas", async () => {
  assert.equal(await run({ roles: ["closer"], screens: [] }, "/api/comp/months/leverads"), 403);
});

test("comp/months: tela concedida explicitamente lê; fechar o mês segue só admin", async () => {
  const vitor = { roles: ["closer"], screens: ["overview", "remuneracao"] };
  assert.equal(await run(vitor, "/api/comp/months/leverads"), null);
  assert.equal(await run(vitor, "/api/comp/months/leverads/2026-09/close", "POST"), 403);
});

test("comp/months: admin passa e a key mestre passa", async () => {
  assert.equal(await run({ roles: ["admin"], screens: [] }, "/api/comp/months/leverads"), null);
  assert.equal(await run({ roles: ["admin"], screens: [] }, "/api/comp/months/leverads/2026-09/close", "POST"), null);
  assert.equal(await run(null, "/api/comp/months/leverads"), null);
});

test("comp_months fica fora do CRUD genérico (o R$ só sai pelas rotas /api/comp/)", async () => {
  const { COLLECTIONS } = await import("../src/seed-data.js");
  assert.ok("comp_months" in COLLECTIONS, "a coleção precisa existir");
  const { default: fs } = await import("node:fs");
  const routes = fs.readFileSync(new URL("../src/routes.js", import.meta.url), "utf8");
  const privateLine = routes.slice(routes.indexOf("const PRIVATE = new Set("), routes.indexOf("const isExposed"));
  assert.match(privateLine, /"comp_months"/);
});
