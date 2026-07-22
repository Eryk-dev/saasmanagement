// Evita cadastro duplicado de lead: casa por telefone/e-mail no mesmo produto e
// mescla no card existente (sem tocar o estado do funil), em vez de criar outro.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { findDuplicateLead, dedupMergePatch } from "../src/lead-dedup.js";

const { registerRoutes } = await import("../src/routes.js");

test("findDuplicateLead: casa por telefone normalizado (9º dígito/DDI) no MESMO produto", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", saas: "leverads", phone: "5541999887766", name: "Zé" });
  assert.equal((await findDuplicateLead(repo, { saas: "leverads", phone: "4199887766" }))?.id, "l1");      // sem 9 / sem DDI
  assert.equal((await findDuplicateLead(repo, { saas: "leverads", phone: "(41) 99988-7766" }))?.id, "l1"); // formatado
  assert.equal(await findDuplicateLead(repo, { saas: "uniquekids", phone: "4199887766" }), null);          // outro produto ≠ duplicata
  assert.equal(await findDuplicateLead(repo, { saas: "leverads" }), null);                                  // sem telefone/e-mail → null
});

test("findDuplicateLead: e-mail desempata; lead interno (teste) fica fora", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", saas: "leverads", email: "A@Ex.com", name: "Ana" });
  await repo.create("leads", { id: "t1", saas: "leverads", phone: "41988887777", internal: true });
  assert.equal((await findDuplicateLead(repo, { saas: "leverads", email: "a@ex.com" }))?.id, "l1"); // case-insensitive
  assert.equal(await findDuplicateLead(repo, { saas: "leverads", phone: "41988887777" }), null);    // interno não casa
});

test("dedupMergePatch: refresca atribuição, preenche buraco, NÃO toca o estado do funil", () => {
  const existing = { id: "l1", stage: "Desqualificado", owner: "u1", name: "41999", email: "", utm: { campaign: "old" }, amount: 500 };
  const incoming = { stage: "Novo lead", owner: "", name: "Maria Silva", email: "m@ex.com", utm: { campaign: "new" }, amount: 0, sourceUrl: "https://x" };
  const patch = dedupMergePatch(existing, incoming);
  assert.deepEqual(patch.utm, { campaign: "new" }); // atribuição sempre refresca
  assert.equal(patch.sourceUrl, "https://x");
  assert.equal(patch.email, "m@ex.com");            // preenche vazio
  assert.equal(patch.name, "Maria Silva");          // troca "só número" por nome de verdade
  assert.equal("stage" in patch, false);            // estado do funil NÃO entra
  assert.equal("owner" in patch, false);
  assert.equal("amount" in patch, false);
});

test("POST /api/leads duplicado → mescla no existente e NÃO cria card novo (terminal fica fechado)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", funnel: [{ stage: "Novo lead", kind: "novo" }, { stage: "Desqualificado", kind: "desqualificado" }] });
  await repo.create("leads", { id: "l1", saas: "leverads", phone: "41999887766", name: "Zé", stage: "Desqualificado", utm: { campaign: "old" } });
  const app = Fastify(); registerRoutes(app, repo); await app.ready();

  const res = await app.inject({ method: "POST", url: "/api/leads", payload: { saas: "leverads", phone: "(41) 99988-7766", name: "José", stage: "Novo lead", utm: { campaign: "new" }, sourceUrl: "https://ad" } });
  assert.equal(res.statusCode, 200);                    // 200 (existente), não 201 (criado)
  assert.equal(res.json().id, "l1");
  assert.equal((await repo.list("leads")).length, 1);   // não nasceu card novo
  const l = await repo.get("leads", "l1");
  assert.equal(l.stage, "Desqualificado");              // terminal continua fechado
  assert.deepEqual(l.utm, { campaign: "new" });         // atribuição refrescada
  assert.equal(l.sourceUrl, "https://ad");
  assert.equal(l.name, "Zé");                           // não pisa nome bom
  assert.ok((await repo.list("activities")).some((a) => a.lead === "l1" && a.meta?.event === "lead_resubmit"));
  await app.close();
});

test("POST /api/leads: telefone novo cria normal; interno (teste) não dedup", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", funnel: [{ stage: "Novo lead", kind: "novo" }] });
  await repo.create("leads", { id: "l1", saas: "leverads", phone: "41999887766", name: "Zé" });
  const app = Fastify(); registerRoutes(app, repo); await app.ready();

  const novo = await app.inject({ method: "POST", url: "/api/leads", payload: { saas: "leverads", phone: "41911112222", name: "Outro" } });
  assert.equal(novo.statusCode, 201);                    // pessoa nova → cria
  assert.equal((await repo.list("leads")).length, 2);
  await app.close();
});

test("form: re-submissão da mesma pessoa mescla no lead (não cria outro; funil conta os 2 envios)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", funnel: [{ stage: "Novo lead", kind: "novo" }] });
  await repo.create("forms", {
    id: "f1", name: "Diag", saas: "leverads", status: "published",
    questions: [{ key: "nome", type: "text", required: true }, { key: "fone", type: "phone", required: true }],
    mapping: { name: "nome", phone: "fone" }, thanks: {},
  });
  const app = Fastify(); registerRoutes(app, repo); await app.ready();

  const s1 = await app.inject({ method: "POST", url: "/public/forms/f1/submissions", payload: { answers: { nome: "Ana", fone: "41999887766" } } });
  assert.equal(s1.statusCode, 201);
  const s2 = await app.inject({ method: "POST", url: "/public/forms/f1/submissions", payload: { answers: { nome: "Ana", fone: "(41) 99988-7766" } } }); // mesma pessoa, outra grafia
  assert.equal(s2.statusCode, 201);
  assert.equal((await repo.list("leads")).length, 1);            // 1 lead (mesclou)
  assert.equal((await repo.list("form_submissions")).length, 2); // 2 envios (o funil do form conta os dois)
  assert.ok((await repo.list("activities")).some((a) => a.meta?.event === "lead_resubmit"));
  await app.close();
});
