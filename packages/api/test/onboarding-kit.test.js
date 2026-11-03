// Kit da integração (03/11/2026): o que o modo integração mostra na call.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { formSections, missingOf, onboardingKit } from "../src/customers/onboarding-kit.js";
import { registerOnboardingRoutes } from "../src/customers/routes.onboardings.js";

const SECTIONS = [
  { key: "contas", title: "Contas", questions: [
    { key: "contas", label: "Contas no marketplace", fields: [{ key: "marketplace", label: "Marketplace" }, { key: "apelido", label: "Apelido" }] },
    { key: "principal", label: "Conta principal" },
  ] },
  { key: "estoque", title: "Estoque", questions: [{ key: "erp", label: "ERP" }, { key: "sync", label: "Sincroniza" }, { key: "nada", label: "Sem resposta" }] },
  { key: "vazia", title: "Vazia", questions: [{ key: "x", label: "X" }] },
];

test("formulário: só o respondido, lista vira uma linha por item, booleano vira Sim/Não", () => {
  const out = formSections({ sections: SECTIONS, answers: { contas: [{ marketplace: "Mercado Livre", apelido: "LOJA1" }, { marketplace: "Shopee" }], principal: "LOJA1", erp: "Bling", sync: true } });
  assert.deepEqual(out.map((s) => s.title), ["Contas", "Estoque"], "seção sem resposta some");
  assert.deepEqual(out[0].items[0].rows, ["Marketplace: Mercado Livre · Apelido: LOJA1", "Marketplace: Shopee · Apelido: —"]);
  assert.deepEqual(out[1].items, [{ label: "ERP", value: "Bling" }, { label: "Sincroniza", value: "✓ Sim" }]);
});

test("o que falta: formulário, conta no sistema, pendência do cliente e integrador", () => {
  const m = missingOf({ form: null, products: [{ id: "leverprice", account: false }, { id: "leverads", account: true }], clientPending: { open: 2, overdue: 1 }, onboarding: {} });
  assert.deepEqual(m.map((x) => x.key), ["form", "conta:leverprice", "pendencias", "integrador"]);
  assert.match(m[2].text, /2 pendências do cliente em aberto \(1 atrasada\)/);
  assert.deepEqual(missingOf({ form: { status: "respondido" }, products: [], clientPending: null, onboarding: { integrator: "eryk" } }), []);
});

async function cenario() {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld_1", saas: "leverads", name: "Lupa", closer: "tiago", dealProduct: "full", amount: 9000, clientPending: { open: 1, overdue: 0, items: [{ item: "mandar acesso" }] } });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Lupa", leadId: "ld_1", products: ["leverads", "leverprice"], leveradsOrgId: "o1", email: "dono@lupa.test" });
  await repo.create("guides", { id: "gd_pub", saas: "leverads", title: "Implantação", status: "publicado", steps: [{ id: "abrir-call", title: "Abrir" }] });
  await repo.create("guides", { id: "gd_rasc", saas: "leverads", title: "Rascunho", status: "rascunho", steps: [] });
  await repo.create("onboardings", { id: "ob_1", customer: "cu_1", lead: "ld_1", saas: "leverads", stage: "kickoff", integrator: "eryk", items: [
    { id: "i1", title: "Kickoff", side: "lever", doneAt: "x", guide: { id: "gd_pub", step: "abrir-call" } },
    { id: "i2", title: "Treino", side: "lever", doneAt: "", guide: { id: "gd_rasc", step: "" } },
  ] });
  await repo.create("integration_forms", { id: "tok_old", saas: "leverads", customerId: "cu_1", status: "pendente", createdAt: "2026-10-01" });
  await repo.create("integration_forms", { id: "tok_ok", saas: "leverads", leadId: "ld_1", status: "respondido", respondedAt: "2026-10-05", sections: SECTIONS, answers: { erp: "Bling" } });
  await repo.create("integration_forms", { id: "tok_nf", saas: "leverads", customerId: "cu_1", kind: "nota_fiscal", status: "respondido", respondedAt: "2026-10-09", sections: [], answers: {} });
  await repo.create("activities", { id: "ac_1", lead: "ld_1", type: "system", at: "2026-10-02", meta: { event: "integration_brief", brief: { resumo: "Loja de autopeças", entregas: ["clonar ML"], atencao: [] } } });
  return repo;
}

test("kit: junta cliente, formulário respondido, resumo da venda, pendências e guias visíveis", async () => {
  const repo = await cenario();
  const kit = await onboardingKit(repo, "ob_1");
  assert.equal(kit.onboarding.progress, 50);
  assert.deepEqual(kit.customer.products, [{ id: "leverads", account: true }, { id: "leverprice", account: false }]);
  assert.equal(kit.customer.contacts[0].email, "dono@lupa.test");
  assert.deepEqual([kit.form.id, kit.form.sections[0].items[0]], ["tok_ok", { label: "ERP", value: "Bling" }], "o respondido de integração vence o pendente e o da nota fiscal");
  assert.equal(kit.brief.resumo, "Loja de autopeças");
  assert.equal(kit.deal.amount, undefined, "sem dinheiro no kit do integrador");
  assert.equal(kit.clientPending.open, 1);
  assert.deepEqual(Object.keys(kit.guides), ["gd_pub"], "rascunho só para quem edita");
  assert.deepEqual(Object.keys((await onboardingKit(repo, "ob_1", { editor: true })).guides).sort(), ["gd_pub", "gd_rasc"]);
  assert.deepEqual(kit.missing.map((m) => m.key), ["conta:leverprice", "pendencias"]);
});

test("rota: GET /api/customers/onboardings/:id/kit; 404 para integração que não existe", async () => {
  const repo = await cenario();
  const app = Fastify();
  app.addHook("preHandler", async (req) => { req.authUser = { id: "eryk", roles: ["integrator"] }; });
  registerOnboardingRoutes(app, repo);
  const ok = await app.inject({ url: "/api/customers/onboardings/ob_1/kit" });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(Object.keys(ok.json().guides), ["gd_pub"]);
  assert.equal((await app.inject({ url: "/api/customers/onboardings/nao_existe/kit" })).statusCode, 404);
});
