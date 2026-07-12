// Núcleo do CRM (lead-flow.js): movimento de estágio canônico (histórico +
// motivo de perda + GPS) e denormalizações de toque. Testado pela superfície
// REST — é o contrato que o SPA e o MCP usam.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1, cadence: { firstTouchHours: 2 } },
  { stage: "Em contato", kind: "contato", conv: 1, cadence: { maxAttempts: 5, retryDays: 1 } },
  { stage: "Follow-up", kind: "followup", conv: 0.5, cadence: { maxAttempts: 8, retryDays: 3 } },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, lossReasons: [{ id: "preco", label: "Preço" }] });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

const activitiesOf = async (repo, leadId, type) =>
  (await repo.list("activities")).filter((a) => a.lead === leadId && (!type || a.type === type));

test("POST /api/leads loga lead_created e marca o 1º toque pela cadência", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Ana", saas: "leverads" } });
  const lead = res.json();

  const acts = await activitiesOf(repo, lead.id, "system");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.event, "lead_created");
  assert.equal(acts[0].meta.via, "api");
  assert.equal(acts[0].meta.stage, "Novo lead"); // stage "" resolve pro 1º estágio

  // firstTouchHours: 2 → nextActionAt ≈ agora + 2h
  const delta = new Date(lead.nextActionAt).getTime() - Date.now();
  assert.ok(delta > 1.9 * 3600_000 && delta < 2.1 * 3600_000, `nextActionAt fora do SLA de 2h: ${lead.nextActionAt}`);
  await app.close();
});

test("PATCH de estágio: activity stage {from,to}, stageAttempts zera, GPS re-agenda", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Novo lead", stageAttempts: 3 });

  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } });
  const lead = res.json();
  assert.equal(lead.stage, "Follow-up");
  assert.equal(lead.stageAttempts, 0);
  assert.ok(lead.stageSince);
  // retryDays: 3 do Follow-up
  const delta = new Date(lead.nextActionAt).getTime() - Date.now();
  assert.ok(delta > 2.9 * 86_400_000 && delta < 3.1 * 86_400_000, `nextActionAt fora dos 3d: ${lead.nextActionAt}`);

  const acts = await activitiesOf(repo, "l1", "stage");
  assert.equal(acts.length, 1);
  assert.deepEqual({ from: acts[0].meta.from, to: acts[0].meta.to }, { from: "Novo lead", to: "Follow-up" });
  assert.equal(acts[0].at, lead.stageSince); // mesmo timestamp do carimbo
  await app.close();
});

test("mover pra perda sem motivo preenche nao_informado; com motivo, respeita", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Follow-up", nextActionAt: "2026-07-10T00:00:00Z" });
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "Follow-up" });

  const r1 = (await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Perdido" } })).json();
  assert.equal(r1.lostReason, "nao_informado");
  assert.equal(r1.nextActionAt, ""); // terminal sai da fila

  const r2 = (await app.inject({ method: "PATCH", url: "/api/leads/l2", payload: { stage: "Perdido", lostReason: "preco", lostNote: "achou caro" } })).json();
  assert.equal(r2.lostReason, "preco");
  assert.equal(r2.lostNote, "achou caro");
  const acts = await activitiesOf(repo, "l2", "stage");
  assert.equal(acts[0].meta.lostReason, "preco");
  await app.close();
});

test("revival: voltar de Perdido pra ativo limpa o motivo de perda", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Perdido", lostReason: "preco", lostNote: "x" });
  const lead = (await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } })).json();
  assert.equal(lead.lostReason, "");
  assert.equal(lead.lostNote, "");
  assert.ok(lead.nextActionAt, "revival volta pra fila do GPS");
  await app.close();
});

test("ganho: limpa GPS, cria cliente e loga customer_created", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", company: "ACME", stage: "Follow-up", nextActionAt: "2026-07-10T00:00:00Z" });
  const lead = (await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } })).json();
  assert.equal(lead.nextActionAt, "");

  const customers = await repo.list("customers");
  assert.equal(customers.length, 1);
  assert.equal(customers[0].leadId, "l1");
  const sys = await activitiesOf(repo, "l1", "system");
  assert.ok(sys.some((a) => a.meta.event === "customer_created" && a.meta.customerId === customers[0].id));
  await app.close();
});

test("toque via POST /api/activities: denorm + tentativa + re-agendamento", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Em contato", stageAttempts: 1, nextActionAt: "2026-07-09T00:00:00Z" });

  const at = "2026-07-09T12:00:00.000Z";
  await app.inject({ method: "POST", url: "/api/activities", payload: { lead: "l1", saas: "leverads", type: "whatsapp", text: "1ª tentativa", author: "leonardo", at } });
  let lead = await repo.get("leads", "l1");
  assert.equal(lead.stageAttempts, 2);
  assert.equal(lead.lastActivityAt, at);
  assert.equal(lead.lastActivityType, "whatsapp");
  assert.equal(lead.nextActionAt, "2026-07-10T12:00:00.000Z"); // retryDays: 1 a partir do toque

  // nota: atualiza últ. contato, NÃO conta tentativa nem re-agenda
  await app.inject({ method: "POST", url: "/api/activities", payload: { lead: "l1", type: "note", text: "obs" } });
  lead = await repo.get("leads", "l1");
  assert.equal(lead.stageAttempts, 2);
  assert.equal(lead.lastActivityType, "note");
  assert.equal(lead.nextActionAt, "2026-07-10T12:00:00.000Z");

  // meta.reschedule === false: registra o toque sem mexer na agenda
  await app.inject({ method: "POST", url: "/api/activities", payload: { lead: "l1", type: "call", at: "2026-07-09T13:00:00.000Z", meta: { reschedule: false } } });
  lead = await repo.get("leads", "l1");
  assert.equal(lead.stageAttempts, 2);
  assert.equal(lead.nextActionAt, "2026-07-10T12:00:00.000Z");
  await app.close();
});

test("submissão de form loga lead_created e reject vira Desqualificado estruturado", async () => {
  const { app, repo } = await buildApp();
  await repo.create("products", { id: "lv2", name: "LV2", funnel: [...FUNNEL, { stage: "Desqualificado", kind: "desqualificado", conv: 0 }] });
  await repo.create("forms", {
    id: "fo_x", saas: "lv2", status: "published",
    questions: [
      { key: "nome", label: "Nome?", type: "text", required: true },
      { key: "porte", label: "Porte?", type: "select", options: [ { value: "ok", label: "OK" }, { value: "pequeno", label: "Pequeno", to: "_reject" } ] },
    ],
    mapping: { name: "nome" }, thanks: {},
  });

  // caminho qualificado
  await app.inject({ method: "POST", url: "/public/forms/fo_x/submissions", payload: { answers: { nome: "Ana", porte: "ok" } } });
  const ana = (await repo.list("leads")).find((l) => l.name === "Ana");
  assert.ok(ana.nextActionAt, "lead de form nasce com 1º toque marcado");
  const acts = await activitiesOf(repo, ana.id, "system");
  assert.equal(acts[0].meta.event, "lead_created");
  assert.equal(acts[0].meta.via, "form");
  assert.equal(acts[0].author, "lead");

  // caminho _reject
  await app.inject({ method: "POST", url: "/public/forms/fo_x/submissions", payload: { answers: { nome: "Bia", porte: "pequeno" } } });
  const bia = (await repo.list("leads")).find((l) => l.name === "Bia");
  assert.equal(bia.stage, "Desqualificado");
  assert.equal(bia.lostReason, "sem_fit");
  assert.equal(bia.nextActionAt, "");
  await app.close();
});

test("aceite de proposta recarimba stageSince, loga e converte quando acceptStage é ganho", async () => {
  const { app, repo } = await buildApp();
  const oldSince = "2020-01-01T00:00:00.000Z";
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Follow-up", stageSince: oldSince });
  await repo.create("proposals", { id: "p1", saas: "leverads", lead: "l1", acceptStage: "Ganho", accepted: false });

  const res = await app.inject({ method: "POST", url: "/public/proposals/p1/accept", payload: {} });
  assert.equal(res.statusCode, 200);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.stage, "Ganho");
  assert.ok(new Date(lead.stageSince).getTime() > new Date(oldSince).getTime(), "stageSince recarimbado (bug antigo: update cru)");
  assert.ok(lead.proposalAccepted);

  // convertWonLead rodou no aceite (bug antigo: cliente só nascia via PATCH)
  const customers = await repo.list("customers");
  assert.equal(customers.length, 1);
  assert.equal(customers[0].leadId, "l1");

  const sys = await activitiesOf(repo, "l1");
  assert.ok(sys.some((a) => a.type === "stage" && a.meta.to === "Ganho"));
  assert.ok(sys.some((a) => a.type === "system" && a.meta.event === "proposal_accepted"));
  await app.close();
});

test("lead ganho manda Purchase pro CAPI com o valor do negócio, uma vez só", async () => {
  const purchases = [];
  const metaCapi = { configured: () => true, sendPurchase: async (p) => { purchases.push(p); } };
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, metaPixelId: "555666777" });
  const app = Fastify();
  registerRoutes(app, repo, { metaCapi });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Novo lead", email: "ana@x.com", fbp: "fb.1.1.2", fbc: "fb.1.3.abc" });

  // O modal de fechamento manda amount junto com o stage no mesmo PATCH.
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho", amount: 600 } });
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].eventId, "won:l1");
  assert.equal(purchases[0].leadId, "l1");
  assert.equal(purchases[0].value, 600);
  assert.equal(purchases[0].pixelId, "555666777");
  assert.equal(purchases[0].fbp, "fb.1.1.2");   // cookies persistidos no submit
  assert.equal(purchases[0].fbc, "fb.1.3.abc"); // melhoram o match do Purchase

  // Reenvio não acontece: o guard de customer do convertWonLead segura.
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  assert.equal(purchases.length, 1);

  // Lead interno (teste da equipe) não suja o sinal — mas o cliente nasce.
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Bia", stage: "Novo lead", internal: true });
  await app.inject({ method: "PATCH", url: "/api/leads/l2", payload: { stage: "Ganho", amount: 100 } });
  assert.equal(purchases.length, 1);
  assert.equal((await repo.list("customers")).length, 2);
  await app.close();
});
