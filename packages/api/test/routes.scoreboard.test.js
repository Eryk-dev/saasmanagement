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
  { stage: "No show", kind: "contato", conv: 1 }, // furo de call vai pra cá no fluxo atual (kind contato, identidade pelo nome)
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
  await repo.create("activities", { id: "a1", saas: "leverads", lead: "l1", type: "call", author: "u_sdr", at: "2026-07-10T13:00:00.000Z" }); // toque 1h depois
  await repo.create("activities", { id: "a2", saas: "leverads", lead: "l1", type: "stage", author: "u_sdr", at: "2026-07-10T13:05:00.000Z", meta: { from: "Qualificando", to: "Call agendada" } });
  await repo.create("activities", { id: "a3", saas: "leverads", lead: "l1", type: "call", author: "u_sdr", at: "2026-07-10T14:00:00.000Z", meta: { reschedule: false, event: "reschedule" } }); // cliente pediu pra remarcar

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const s = sb.sdr.find((x) => x.user === "u_sdr");
  assert.equal(s.name, "Sara SDR");
  assert.equal(s.leadsNew, 2);
  assert.equal(s.contacted, 1);            // l1 teve toque/stage DO SDR no período (atividade do dia)
  assert.equal(s.reschedules, 1);          // 1 remarcação na confirmação (evento, credita contato)
  assert.equal(s.callsBooked, 1);          // 1 transição pra Call agendada
  assert.equal(s.bookingRate, 100);        // calls ÷ contatados = 1/1
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

test("Closer: conversão na call, ganhos (handoff), receita, ciclo call→ganho", async () => {
  const { app, repo } = await buildApp();
  // Fechamento = TRANSIÇÃO pra Ganho/Integração (stage activity); o valor entra nessa passagem.
  const mkWin = async (id, amount, callAt, winAt) => {
    await repo.create("leads", { id, saas: "leverads", closer: "u_clo", stage: "Ganho", amount, createdAt: "2026-07-02T10:00:00.000Z", stageSince: winAt, callAt });
    await repo.create("activities", { id: `st_${id}`, saas: "leverads", lead: id, type: "stage", at: winAt, meta: { from: "Follow-up", to: "Ganho" } });
  };
  await mkWin("w1", 600, "2026-07-05T10:00:00.000Z", "2026-07-08T10:00:00.000Z"); // call 05 → ganho 08 = 3d
  await mkWin("w2", 400, "2026-07-06T10:00:00.000Z", "2026-07-09T10:00:00.000Z"); // call 06 → ganho 09 = 3d
  // call que ACONTECEU mas perdeu por preço (compareceu, não fechou)
  await repo.create("leads", { id: "x1", saas: "leverads", closer: "u_clo", stage: "Perdido", lostReason: "preco", createdAt: "2026-07-01T10:00:00.000Z", stageSince: "2026-07-06T10:00:00.000Z", callAt: "2026-07-04T10:00:00.000Z" });
  // NO-SHOW: call agendada mas não compareceu (fora de callsShown)
  await repo.create("leads", { id: "x2", saas: "leverads", closer: "u_clo", stage: "Perdido", lostReason: "nao_compareceu", createdAt: "2026-07-01T10:00:00.000Z", stageSince: "2026-07-07T10:00:00.000Z", callAt: "2026-07-07T10:00:00.000Z" });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const c = sb.closer.find((x) => x.user === "u_clo");
  assert.equal(c.calls, 4);             // w1,w2,x1,x2 têm callAt na janela
  assert.equal(c.callsShown, 3);        // w1,w2,x1 aconteceram; x2 é no-show
  assert.equal(c.won, 2);               // w1,w2 transicionaram pra Ganho na janela
  assert.equal(c.revenue, 1000);
  assert.equal(c.ticket, 500);          // 1000/2
  assert.equal(c.conversaoCall, 66.67); // 2 ganhos ÷ 3 compareceram
  assert.equal(c.winRateCall, 50);      // 2 ÷ 4 agendadas
  assert.equal(c.revenuePerCall, 250);  // 1000 ÷ 4
  assert.equal(c.cycleDays, 3);         // mediana call→ganho: 3d, 3d
  assert.equal(c.lost, 2);              // x1, x2
  await app.close();
});

test("Closer: venda pela régua oficial (isWonLead + wonAt), com fallbacks pro lead sem carimbo", async () => {
  const { app, repo } = await buildApp();
  // Venda carimbada (wonAt): a data oficial, mesmo que o card já tenha andado.
  await repo.create("leads", { id: "wc", saas: "leverads", closer: "u_clo", stage: "Integração", amount: 5000, customerId: "cc", wonAt: now, createdAt: now, stageSince: "2026-08-02T10:00:00.000Z" });
  // u_cs é integrator (CS) e fechou um lead — o papel não censura o placar; o
  // ganho dele conta. Lead legado sem wonAt: fallback no stageSince.
  await repo.create("leads", { id: "wx", saas: "leverads", closer: "u_cs", stage: "Ganho", amount: 7000, createdAt: now, stageSince: now });
  // Lead ganho SEM carimbo nenhum: cai no startedAt do cliente vinculado.
  await repo.create("leads", { id: "wy", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 3000, createdAt: now });
  await repo.create("customers", { id: "cy", saas: "leverads", name: "Y", leadId: "wy", startedAt: "2026-07-09" });
  // Venda carimbada FORA da janela (junho): não entra no placar de julho,
  // mesmo com o card ainda em Ganho.
  await repo.create("leads", { id: "wz", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 900, customerId: "cz", wonAt: "2026-06-02T10:00:00.000Z", createdAt: "2026-06-01T10:00:00.000Z", stageSince: now });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const cs = sb.closer.find((p) => p.user === "u_cs");
  assert.equal(cs.won, 1);
  assert.equal(cs.revenue, 7000);
  const clo = sb.closer.find((p) => p.user === "u_clo");
  assert.equal(clo.won, 2);              // wc (wonAt) + wy (fallback via cliente); wz vendeu em junho
  assert.equal(clo.revenue, 8000);
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
  await repo.create("activities", { id: "st_gw1", saas: "leverads", lead: "w1", type: "stage", at: now, meta: { from: "Follow-up", to: "Ganho" } });

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

test("No show por ETAPA conta como furo (SDR, closer e time), não só o motivo de perda", async () => {
  const { app, repo } = await buildApp();
  const mk = async (id, stage, extra = {}) => {
    await repo.create("leads", { id, saas: "leverads", owner: "u_sdr", closer: "u_clo", stage, createdAt: now, callAt: now, ...extra });
    await repo.create("activities", { id: `st_${id}`, saas: "leverads", lead: id, type: "stage", author: "u_sdr", at: now, meta: { from: "Qualificando", to: "Call agendada" } });
  };
  await mk("s1", "Ganho", { amount: 300, stageSince: now });
  await mk("s2", "No show"); // furou: parado na etapa de No show (sem motivo de perda)
  await repo.create("activities", { id: "won_s1", saas: "leverads", lead: "s1", type: "stage", author: "u_clo", at: now, meta: { from: "Call agendada", to: "Ganho" } });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const s = sb.sdr.find((x) => x.user === "u_sdr");
  assert.equal(s.callsBooked, 2);
  assert.equal(s.noShow, 1);       // s2 pela ETAPA
  assert.equal(s.shown, 1);        // s1
  assert.equal(s.showRate, 50);
  const c = sb.closer.find((x) => x.user === "u_clo");
  assert.equal(c.calls, 2);
  assert.equal(c.callsShown, 1);   // a call do s2 não aconteceu
  assert.equal(sb.team.noShow, 1);
  assert.equal(sb.team.showRate, 50);
  await app.close();
});

test("Funil do TIME: contato humano, agendamento, comparecimento, call→ganho e ponta a ponta", async () => {
  const { app, repo } = await buildApp();
  // 4 leads que viraram call na janela (safra de calls), sem recorte por pessoa
  const mkBooked = async (id, stage, extra = {}) => {
    await repo.create("leads", { id, saas: "leverads", stage, createdAt: now, ...extra });
    await repo.create("activities", { id: `st_${id}`, saas: "leverads", lead: id, type: "stage", author: "u_sdr", at: now, meta: { from: "Qualificando", to: "Call agendada" } });
  };
  await mkBooked("t1", "Ganho", { amount: 800, stageSince: now });                  // compareceu + fechou
  await mkBooked("t2", "Follow-up");                                                // compareceu, não fechou
  await mkBooked("t3", "Perdido", { lostReason: "nao_compareceu", stageSince: now }); // NÃO compareceu
  await mkBooked("t4", "Call agendada");                                            // ainda não resolvido
  await repo.create("activities", { id: "won_t1", saas: "leverads", lead: "t1", type: "stage", author: "u_clo", at: now, meta: { from: "Call agendada", to: "Ganho" } });
  // lead só CONTATADO (toque humano, sem call)
  await repo.create("leads", { id: "t5", saas: "leverads", stage: "Qualificando", createdAt: now });
  await repo.create("activities", { id: "tq_t5", saas: "leverads", lead: "t5", type: "whatsapp", author: "u_sdr", at: now });
  // automação NÃO conta como contato do time (author fora da lista de usuários)
  await repo.create("leads", { id: "t6", saas: "leverads", stage: "Novo lead", createdAt: now });
  await repo.create("activities", { id: "drip_t6", saas: "leverads", lead: "t6", type: "whatsapp", author: "drip", at: now });
  // meta de TAXA role-scope anexada pra colorir a régua da Visão geral
  await repo.create("goals", { id: "gb", saas: "leverads", scope: "role", key: "sdr", metric: "bookingRate", target: 35, period: "month" });

  const t = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().team;
  assert.equal(t.leadsNew, 6);
  assert.equal(t.contacted, 5);      // t1..t5; o drip do t6 não é trabalho do time
  assert.equal(t.callsBooked, 4);
  assert.equal(t.bookingRate, 80);   // 4 calls ÷ 5 contatados
  assert.equal(t.shown, 2);          // t1, t2 (t4 segue sem resolução)
  assert.equal(t.noShow, 1);         // t3
  assert.equal(t.showRate, 66.67);   // 2 ÷ 3 resolvidos
  assert.equal(t.wonFromCalls, 1);   // t1
  assert.equal(t.callWinRate, 25);   // 1 ÷ 4 agendadas
  assert.equal(t.closeRate, 50);     // 1 ÷ 2 realizadas
  assert.equal(t.won, 1);            // transição do t1 pra Ganho na janela
  assert.equal(t.revenue, 800);
  assert.equal(t.leadToWin, 16.67);  // 1 ganho ÷ 6 leads criados
  assert.equal(t.goals.bookingRate.target, 35);
  await app.close();
});

test("404 pra produto inexistente", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ url: "/api/scoreboard/nada" })).statusCode, 404);
  await app.close();
});
