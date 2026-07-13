// Placar por pessoa/papel: /api/scoreboard/:saas agrega leads por owner (SDR) e
// closer, e clientes por owner (CS), no período, com meta da coleção `goals`.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1, cadence: { firstTouchHours: 2 } },
  { stage: "Qualificando", kind: "qualificacao", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Follow-up", kind: "followup", conv: 0.5 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "u_sdr", name: "Sara SDR", roles: ["sdr"] });
  await repo.create("users", { id: "u_clo", name: "Caio Closer", roles: ["closer"] });
  await repo.create("users", { id: "u_cs", name: "Cris CS", roles: ["integrator"] });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

const now = "2026-07-10T12:00:00.000Z";
const win = "?since=2026-07-01&until=2026-07-31";

test("SDR: leads novos, calls agendadas (transição pra kind call) e SLA de 1º toque", async () => {
  const { app, repo } = await buildApp();
  // 2 leads do SDR criados na janela; 1 recebeu toque, 1 nunca
  await repo.create("leads", { id: "l1", saas: "leverads", owner: "u_sdr", stage: "Call agendada", createdAt: now });
  await repo.create("leads", { id: "l2", saas: "leverads", owner: "u_sdr", stage: "Novo lead", createdAt: now });
  await repo.create("activities", { id: "a1", saas: "leverads", lead: "l1", type: "call", at: "2026-07-10T13:00:00.000Z" }); // toque 1h depois
  await repo.create("activities", { id: "a2", saas: "leverads", lead: "l1", type: "stage", at: "2026-07-10T13:05:00.000Z", meta: { from: "Qualificando", to: "Call agendada" } });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const s = sb.sdr.find((x) => x.user === "u_sdr");
  assert.equal(s.name, "Sara SDR");
  assert.equal(s.leadsNew, 2);
  assert.equal(s.contacted, 1);            // só l1 recebeu 1º toque
  assert.equal(s.contactRate, 50);         // 1 de 2 leads novos
  assert.equal(s.callsBooked, 1);          // 1 transição pra Call agendada
  assert.equal(s.bookingRate, 50);         // 1/2
  assert.equal(s.firstTouchMedianH, 1);    // l1 tocado 1h depois
  assert.equal(s.withinSla, 1);            // dentro das 2h da cadência
  await app.close();
});

test("SDR: show-rate (não compareceu) e calls→ganho sobre o cohort de calls", async () => {
  const { app, repo } = await buildApp();
  const mk = async (id, stage, extra = {}) => {
    await repo.create("leads", { id, saas: "leverads", owner: "u_sdr", stage, createdAt: now, ...extra });
    // transição pra Call agendada na janela (entra no cohort de booked)
    await repo.create("activities", { id: `st_${id}`, saas: "leverads", lead: id, type: "stage", at: now, meta: { from: "Qualificando", to: "Call agendada" } });
  };
  await mk("b1", "Ganho", { amount: 500, stageSince: now });   // compareceu + fechou
  await mk("b2", "Follow-up");                                 // compareceu (avançou), não fechou
  await mk("b3", "Perdido", { lostReason: "nao_compareceu", stageSince: now }); // NÃO compareceu
  await mk("b4", "Perdido", { lostReason: "preco", stageSince: now });          // compareceu (perdeu por outro motivo)
  await mk("b5", "Call agendada");                             // ainda não resolvido (não conta)

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const s = sb.sdr.find((x) => x.user === "u_sdr");
  assert.equal(s.callsBooked, 5);
  assert.equal(s.noShow, 1);          // b3
  assert.equal(s.shown, 3);           // b1,b2,b4
  assert.equal(s.showRate, 75);       // compareceram 3 / resolvidos 4 (b1,b2,b3,b4)
  assert.equal(s.wonFromCalls, 1);    // b1
  assert.equal(s.callWinRate, 20);    // 1 / 5
  await app.close();
});

test("Closer: ganhos, receita, taxa de fechamento e ticket na janela", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "w1", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 600, createdAt: "2026-07-02T10:00:00.000Z", stageSince: "2026-07-08T10:00:00.000Z", callAt: "2026-07-05T10:00:00.000Z" });
  await repo.create("leads", { id: "w2", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 400, createdAt: "2026-07-03T10:00:00.000Z", stageSince: "2026-07-09T10:00:00.000Z" });
  await repo.create("leads", { id: "x1", saas: "leverads", closer: "u_clo", stage: "Perdido", lostReason: "preco", createdAt: "2026-07-01T10:00:00.000Z", stageSince: "2026-07-06T10:00:00.000Z" });
  await repo.create("proposals", { id: "p1", saas: "leverads", lead: "w1", createdAt: "2026-07-05T10:00:00.000Z" });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const c = sb.closer.find((x) => x.user === "u_clo");
  assert.equal(c.won, 2);
  assert.equal(c.revenue, 1000);
  assert.equal(c.closeRate, 66.67);   // 2 ganhos / (2 + 1 perdido)
  assert.equal(c.ticket, 500);        // 1000 / 2
  assert.equal(c.calls, 1);           // só w1 tem callAt na janela
  assert.equal(c.proposals, 1);
  assert.equal(c.cycleDays, 6);       // mediana: w1 6d, w2 6d
  assert.equal(c.proposalWinRate, 200); // 2 ganhos / 1 proposta (dado do teste)
  assert.equal(c.winRateCall, 200);   // 2 ganhos / 1 call
  assert.equal(c.proposalRate, 100);  // 1 proposta / 1 call
  assert.equal(c.lost, 1);
  assert.deepEqual(c.lossReasons, [{ reason: "preco", count: 1 }]); // x1 perdido por preço
  await app.close();
});

test("Closer: CS (integrator) que caiu no campo closer de um lead NÃO entra no painel de closers", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "wc", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 5000, createdAt: now, stageSince: now });
  // u_cs é integrator (CS) e aparece como closer num lead ganho — não deve virar closer
  await repo.create("leads", { id: "wx", saas: "leverads", closer: "u_cs", stage: "Ganho", amount: 7000, createdAt: now, stageSince: now });
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  assert.ok(sb.closer.some((p) => p.user === "u_clo"));  // o closer de verdade aparece
  assert.ok(!sb.closer.some((p) => p.user === "u_cs"));   // o CS não aparece como closer
  await app.close();
});

test("meta por pessoa (user-scope) e por papel (role-scope) anexadas ao placar", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", owner: "u_sdr", stage: "Novo lead", createdAt: now });
  // meta específica do Caio (user) vence a meta geral de closer (role)
  await repo.create("goals", { id: "g1", saas: "leverads", scope: "role", key: "closer", metric: "won", target: 8, period: "month" });
  await repo.create("goals", { id: "g2", saas: "leverads", scope: "user", key: "u_clo", metric: "won", target: 12, period: "month" });
  await repo.create("goals", { id: "g3", saas: "leverads", scope: "role", key: "sdr", metric: "callsBooked", target: 40, period: "month" });
  await repo.create("leads", { id: "w1", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 500, createdAt: now, stageSince: now });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const c = sb.closer.find((x) => x.user === "u_clo");
  assert.equal(c.goals.won.target, 12);   // user vence role
  const s = sb.sdr.find((x) => x.user === "u_sdr");
  assert.equal(s.goals.callsBooked.target, 40); // role aplica quando não há user

  // metas de TAXA do SDR (role-scope) chegam anexadas por métrica
  await repo.create("goals", { id: "g4", saas: "leverads", scope: "role", key: "sdr", metric: "bookingRate", target: 30, period: "month" });
  await repo.create("goals", { id: "g5", saas: "leverads", scope: "role", key: "sdr", metric: "contactRate", target: 80, period: "month" });
  const sb2 = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const s2 = sb2.sdr.find((x) => x.user === "u_sdr");
  assert.equal(s2.goals.bookingRate.target, 30);
  assert.equal(s2.goals.contactRate.target, 80);
  await app.close();
});

test("CS: contas ativas e novas por owner do cliente", async () => {
  const { app, repo } = await buildApp();
  await repo.create("customers", { id: "c1", saas: "leverads", owner: "u_cs", startedAt: "2026-07-05T10:00:00.000Z" });
  await repo.create("customers", { id: "c2", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" }); // antiga
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const cs = sb.cs.find((x) => x.user === "u_cs");
  assert.equal(cs.activeAccounts, 2);
  assert.equal(cs.newAccounts, 1); // só c1 começou na janela
  assert.equal(cs.retentionRate, 100); // sem churn = 100%
  assert.equal(cs.nps, null);           // sem resposta de NPS
  await app.close();
});

test("CS: retenção cai com churn na janela e NPS médio das contas do owner", async () => {
  const { app, repo } = await buildApp();
  await repo.create("customers", { id: "c1", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  await repo.create("customers", { id: "c2", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  await repo.create("customers", { id: "c3", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  // 1 assinatura cancelada na janela → churn 1 sobre base 4 (3 ativas + 1)
  await repo.create("subscriptions", { id: "s1", saas: "leverads", customer: "cx", status: "canceled", canceledAt: "2026-07-10T10:00:00.000Z" });
  await repo.create("customers", { id: "cx", saas: "leverads", owner: "u_cs", startedAt: "2026-04-01T10:00:00.000Z" });
  // NPS: duas respostas das contas dele (9 e 7 → média 8)
  await repo.create("nps", { id: "n1", saas: "leverads", customer: "c1", score: 9 });
  await repo.create("nps", { id: "n2", saas: "leverads", customer: "c2", score: 7 });

  const cs = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().cs.find((x) => x.user === "u_cs");
  assert.equal(cs.churned, 1);
  assert.equal(cs.retentionRate, 80); // (5 - 1) / 5 × 100
  assert.equal(cs.nps, 8);
  assert.equal(cs.npsCount, 2);
  await app.close();
});

test("leadsPrev conta os leads da janela anterior (base da meta dinâmica)", async () => {
  const { app, repo } = await buildApp();
  // 3 leads do SDR na semana passada, 1 na atual
  await repo.create("leads", { id: "p1", saas: "leverads", owner: "u_sdr", stage: "Novo lead", createdAt: "2026-06-25T10:00:00.000Z" });
  await repo.create("leads", { id: "p2", saas: "leverads", owner: "u_sdr", stage: "Novo lead", createdAt: "2026-06-27T10:00:00.000Z" });
  await repo.create("leads", { id: "p3", saas: "leverads", owner: "u_sdr", stage: "Novo lead", createdAt: "2026-06-30T10:00:00.000Z" });
  await repo.create("leads", { id: "cur", saas: "leverads", owner: "u_sdr", stage: "Novo lead", createdAt: now });

  const url = `/api/scoreboard/leverads?since=2026-07-01&until=2026-07-31&prevSince=2026-06-24&prevUntil=2026-06-30`;
  const s = (await app.inject({ url })).json().sdr.find((x) => x.user === "u_sdr");
  assert.equal(s.leadsNew, 1);    // só 'cur' na janela atual
  assert.equal(s.leadsPrev, 3);   // p1,p2,p3 na janela anterior

  // sem prevSince/prevUntil → leadsPrev null
  const s2 = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().sdr.find((x) => x.user === "u_sdr");
  assert.equal(s2.leadsPrev, null);
  await app.close();
});

test("CS: responsável do papel aparece mesmo sem conta (pra ver a meta)", async () => {
  const { app } = await buildApp(); // u_cs é integrator, sem nenhuma conta
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const cs = sb.cs.find((x) => x.user === "u_cs");
  assert.ok(cs, "o CS aparece mesmo com 0 contas");
  assert.equal(cs.activeAccounts, 0);
  assert.equal(cs.retentionRate, null);
  await app.close();
});

test("Mídia social: papel aparece com a demanda de conteúdo (produção 0 por ora)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("users", { id: "u_soc", name: "Vini Vídeo", roles: ["social"] });
  await repo.create("goals", { id: "gp", saas: "leverads", scope: "role", key: "social", metric: "postsPerMonth", target: 30, period: "month" });
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const s = sb.social.find((x) => x.user === "u_soc");
  assert.ok(s, "o responsável social aparece");
  assert.equal(s.postsPerMonth, 0);        // produção não conectada ainda
  assert.equal(s.goals.postsPerMonth.target, 30); // a meta (demanda) aparece
  await app.close();
});

test("404 pra produto inexistente", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ url: "/api/scoreboard/nada" })).statusCode, 404);
  await app.close();
});
