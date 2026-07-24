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

test("contato por WhatsApp do cockpit conta (SDR e funil do time), sem virar atividade", async () => {
  const { app, repo } = await buildApp();
  // Lead do SDR SEM nenhum toque na timeline — só uma mensagem ENVIADA no inbox.
  await repo.create("leads", { id: "lw", saas: "leverads", owner: "u_sdr", stage: "Qualificando", createdAt: now });
  await repo.create("wa_messages", { id: "m1", saas: "leverads", leadId: "lw", direction: "out", author: "u_sdr", at: "2026-07-10T15:00:00.000Z" });
  // Mensagem RECEBIDA (in) do lead não conta como contato NOSSO.
  await repo.create("wa_messages", { id: "m2", saas: "leverads", leadId: "lw", direction: "in", author: "", at: "2026-07-10T15:01:00.000Z" });
  // Lead de outro SDR-owner por mensagem: não credita o u_sdr.
  await repo.create("leads", { id: "lo", saas: "leverads", owner: "outro", stage: "Qualificando", createdAt: now });
  await repo.create("wa_messages", { id: "m3", saas: "leverads", leadId: "lo", direction: "out", author: "outro", at: now });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const s = sb.sdr.find((x) => x.user === "u_sdr");
  assert.equal(s.contacted, 1);                    // lw contado pela mensagem enviada, sem atividade
  assert.equal(sb.team.contacted, 2);              // lw + lo no funil do time (qualquer envio)
  // Não criou atividade de cadência (o inbox segue separado da timeline).
  assert.equal((await repo.list("activities")).length, 0);
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

test("CS: upsell (fatura kind:upsell) conta e soma R$ pelo dono do cliente", async () => {
  const { app, repo } = await buildApp();
  await repo.create("customers", { id: "c1", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  await repo.create("customers", { id: "c2", saas: "leverads", owner: "outro", startedAt: "2026-05-01T10:00:00.000Z" });
  // upsell na janela, cliente do u_cs → conta e soma
  await repo.create("invoices", { id: "u1", saas: "leverads", customer: "c1", kind: "upsell", status: "paid", amount: 1200, paidAt: "2026-07-08T12:00:00.000Z" });
  // upsell FORA da janela → não conta
  await repo.create("invoices", { id: "u2", saas: "leverads", customer: "c1", kind: "upsell", status: "paid", amount: 999, paidAt: "2026-06-01T12:00:00.000Z" });
  // fatura normal (renewal) na janela → não é upsell
  await repo.create("invoices", { id: "r1", saas: "leverads", customer: "c1", kind: "renewal", status: "paid", amount: 500, paidAt: "2026-07-09T12:00:00.000Z" });
  // upsell de cliente de OUTRO dono → não entra no card do u_cs
  await repo.create("invoices", { id: "u3", saas: "leverads", customer: "c2", kind: "upsell", status: "paid", amount: 700, paidAt: "2026-07-08T12:00:00.000Z" });

  const cs = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().cs.find((x) => x.user === "u_cs");
  assert.equal(cs.upsells, 1);
  assert.equal(cs.upsellRevenue, 1200);
  await app.close();
});

test("CS: indicações = leads com origem 'Indicação' na janela (nº do time)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("customers", { id: "c1", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  await repo.create("leads", { id: "r1", saas: "leverads", owner: "u_sdr", stage: "Novo lead", source: "Indicação", createdAt: now });
  await repo.create("leads", { id: "r2", saas: "leverads", owner: "u_sdr", stage: "Novo lead", utm: { source: "indicacao" }, createdAt: now });
  await repo.create("leads", { id: "r3", saas: "leverads", owner: "u_sdr", stage: "Novo lead", source: "Form · Diagnóstico", createdAt: now }); // não é indicação
  await repo.create("leads", { id: "r4", saas: "leverads", owner: "u_sdr", stage: "Novo lead", source: "Indicação", createdAt: "2026-06-01T10:00:00.000Z" }); // fora da janela

  const cs = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().cs.find((x) => x.user === "u_cs");
  assert.equal(cs.referrals, 2); // r1 (source) + r2 (utm), r3 não conta, r4 fora da janela
  await app.close();
});

test("CS: meta de indicação deriva da base (7 × clientes do CS)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("customers", { id: "c1", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  await repo.create("customers", { id: "c2", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  const cs = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().cs.find((x) => x.user === "u_cs");
  assert.equal(cs.goals.referrals.target, 14); // 7 × 2 clientes da carteira
  assert.equal(cs.goals.referrals.scope, "derived");
  await app.close();
});

test("CS: meta de indicação manual (role) vence a derivada da base", async () => {
  const { app, repo } = await buildApp();
  await repo.create("customers", { id: "c1", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  await repo.create("goals", { id: "g1", saas: "leverads", scope: "role", key: "integrator", metric: "referrals", target: 50, period: "month" });
  const cs = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().cs.find((x) => x.user === "u_cs");
  assert.equal(cs.goals.referrals.target, 50); // manual vence, não reparte (team:false)
  assert.equal(cs.goals.referrals.scope, "role");
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

test("SDR e closer do papel aparecem mesmo com 0 atividade na janela (pra ver a meta)", async () => {
  // Janela vazia (jun/2026, antes de todo o dataset): o SDR e o closer não têm
  // lead/call/ganho ali. Antes o placar os SUMIA (filtro por atividade), então
  // o "Desempenho do time" perdia o SDR no filtro Hoje. Agora o membro do papel
  // fica (igual ao CS), mostrando zeros e a meta.
  const { app } = await buildApp();
  const empty = "?since=2026-06-01&until=2026-06-30";
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${empty}` })).json();
  const sdr = sb.sdr.find((x) => x.user === "u_sdr");
  assert.ok(sdr, "o SDR aparece mesmo sem atividade na janela");
  assert.equal(sdr.leadsNew, 0);
  assert.equal(sdr.callsBooked, 0);
  const clo = sb.closer.find((x) => x.user === "u_clo");
  assert.ok(clo, "o closer aparece mesmo sem atividade na janela");
  assert.equal(clo.calls, 0);
  assert.equal(clo.won, 0);
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
  // 4 leads que viraram call na janela (safra de calls), sem recorte por pessoa.
  // Contatado = lead com TOQUE (whatsapp/call/…) — a mesma régua da Análise de
  // Pace (funnelCounts); um lead agendado teve toque antes.
  const mkBooked = async (id, stage, extra = {}) => {
    await repo.create("leads", { id, saas: "leverads", stage, createdAt: now, ...extra });
    await repo.create("activities", { id: `tq_${id}`, saas: "leverads", lead: id, type: "whatsapp", author: "u_sdr", at: now });
    await repo.create("activities", { id: `st_${id}`, saas: "leverads", lead: id, type: "stage", author: "u_sdr", at: now, meta: { from: "Qualificando", to: "Call agendada" } });
  };
  await mkBooked("t1", "Ganho", { amount: 800, stageSince: now });                  // compareceu + fechou
  await mkBooked("t2", "Follow-up");                                                // compareceu, não fechou
  await mkBooked("t3", "Perdido", { lostReason: "nao_compareceu", stageSince: now }); // NÃO compareceu
  await mkBooked("t4", "Call agendada");                                            // ainda não resolvido
  await repo.create("activities", { id: "won_t1", saas: "leverads", lead: "t1", type: "stage", author: "u_clo", at: now, meta: { from: "Call agendada", to: "Ganho" } });
  // lead só CONTATADO (toque, sem call)
  await repo.create("leads", { id: "t5", saas: "leverads", stage: "Qualificando", createdAt: now });
  await repo.create("activities", { id: "tq_t5", saas: "leverads", lead: "t5", type: "whatsapp", author: "u_sdr", at: now });
  // lead sem toque nenhum: não conta como contatado
  await repo.create("leads", { id: "t6", saas: "leverads", stage: "Novo lead", createdAt: now });
  // meta de TAXA role-scope anexada pra colorir a régua da Visão geral
  await repo.create("goals", { id: "gb", saas: "leverads", scope: "role", key: "sdr", metric: "bookingRate", target: 35, period: "month" });

  const t = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().team;
  assert.equal(t.leadsNew, 6);
  assert.equal(t.contacted, 5);      // t1..t5 têm toque; t6 não
  assert.equal(t.callsBooked, 4);
  assert.equal(t.bookingRate, 80);   // 4 calls ÷ 5 contatados
  assert.equal(t.shown, 2);          // t1, t2 (t4 segue sem resolução)
  assert.equal(t.noShow, 1);         // t3
  assert.equal(t.showRate, 50);      // comparecimento sobre AGENDADAS: 2 ÷ 4 (funil encadeado)
  assert.equal(t.wonFromCalls, 1);   // t1
  assert.equal(t.callWinRate, 25);   // 1 ÷ 4 agendadas
  assert.equal(t.closeRate, 50);     // 1 ÷ 2 realizadas
  assert.equal(t.won, 1);            // ganhos totais no período (transição do t1)
  assert.equal(t.revenue, 800);
  assert.equal(t.leadToWin, 16.67);  // 1 ganho ÷ 6 leads criados
  assert.equal(t.paceAdjust, null);  // sem histórico pré-cockpit neste produto
  assert.equal(t.goals.bookingRate.target, 35);
  await app.close();
});

// A régua do funil é ATIVIDADE no período, não a coorte de entrada: um lead que
// ENTROU antes da janela mas foi tocado / marcou call / fechou DENTRO dela conta
// no funil (senão o topo ficava MENOR que a soma dos cards, que contam a
// atividade toda) — é o conserto que o Leo pediu (24/07).
test("Funil do TIME: conta a atividade do período, não só a safra que entrou", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "old1", saas: "leverads", stage: "Ganho", amount: 900, createdAt: "2026-05-01T10:00:00.000Z", stageSince: now });
  await repo.create("activities", { id: "tq_old1", saas: "leverads", lead: "old1", type: "whatsapp", author: "u_sdr", at: now });
  await repo.create("activities", { id: "st_old1", saas: "leverads", lead: "old1", type: "stage", author: "u_sdr", at: now, meta: { from: "Qualificando", to: "Call agendada" } });
  await repo.create("activities", { id: "won_old1", saas: "leverads", lead: "old1", type: "stage", author: "u_clo", at: now, meta: { from: "Call agendada", to: "Ganho" } });

  const t = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().team;
  assert.equal(t.leadsNew, 0);      // entrou em maio: fora da janela de leads novos
  assert.equal(t.contacted, 1);     // mas foi TOCADO na janela → conta na atividade
  assert.equal(t.callsBooked, 1);   // marcou call na janela → conta
  assert.equal(t.shown, 1);         // compareceu
  assert.equal(t.wonFromCalls, 1);  // e fechou pela call
  assert.equal(t.won, 1);           // ganho no período
  await app.close();
});

test("Funil do TIME: histórico pré-cockpit (product.paceAdjust) soma ao funil da Visão geral", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { paceAdjust: { contacted: 80, booked: 10, shown: 10, won: 7 } });
  await repo.create("leads", { id: "a1", saas: "leverads", stage: "Ganho", amount: 500, createdAt: now, stageSince: now });
  await repo.create("activities", { id: "tq_a1", saas: "leverads", lead: "a1", type: "whatsapp", author: "u_sdr", at: now });
  await repo.create("activities", { id: "st_a1", saas: "leverads", lead: "a1", type: "stage", author: "u_sdr", at: now, meta: { from: "Qualificando", to: "Call agendada" } });
  await repo.create("activities", { id: "wa1", saas: "leverads", lead: "a1", type: "stage", author: "u_clo", at: now, meta: { from: "Call agendada", to: "Ganho" } });

  const t = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json().team;
  assert.deepEqual(t.paceAdjust, { contacted: 80, booked: 10, shown: 10, won: 7 });
  assert.equal(t.leadsNew, 1);        // 1 lead logado (sem ajuste de leads)
  assert.equal(t.contacted, 81);      // 1 + 80
  assert.equal(t.callsBooked, 11);    // 1 + 10
  assert.equal(t.shown, 11);          // 1 + 10
  assert.equal(t.wonFromCalls, 8);    // 1 + 7
  await app.close();
});

// O pré-cockpit compensa leads trabalhados ANTES do time registrar atividade no
// cockpit. Numa janela recente (que começa no/depois do 1º registro), o funil
// tem que seguir o filtro e mostrar só o dado real — senão "ontem" aparecia com
// contatados > leads. Época = 1º dia com atividade do produto (aqui, 07-10).
test("Funil do TIME: janela recente (a partir do 1º registro) NÃO soma o pré-cockpit", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { paceAdjust: { contacted: 80, booked: 10, shown: 10, won: 7 } });
  await repo.create("leads", { id: "a1", saas: "leverads", stage: "Ganho", amount: 500, createdAt: now, stageSince: now });
  await repo.create("activities", { id: "tq_a1", saas: "leverads", lead: "a1", type: "whatsapp", author: "u_sdr", at: now });
  await repo.create("activities", { id: "st_a1", saas: "leverads", lead: "a1", type: "stage", author: "u_sdr", at: now, meta: { from: "Qualificando", to: "Call agendada" } });
  await repo.create("activities", { id: "wa1", saas: "leverads", lead: "a1", type: "stage", author: "u_clo", at: now, meta: { from: "Call agendada", to: "Ganho" } });

  // Janela que começa NO dia do 1º registro (07-10): não alcança o pré-cockpit.
  const t = (await app.inject({ url: `/api/scoreboard/leverads?since=2026-07-10&until=2026-07-31` })).json().team;
  assert.equal(t.paceAdjust, null);   // ajuste some quando a janela não alcança a época
  assert.equal(t.contacted, 1);       // só o real (sem +80)
  assert.equal(t.callsBooked, 1);     // sem +10
  assert.equal(t.shown, 1);           // sem +10
  assert.equal(t.wonFromCalls, 1);    // sem +7
  await app.close();
});

// A data de corte pode ser fixada em product.paceAdjust.before (vence a época
// derivada): útil quando há atividade backdated que mexeria no 1º registro.
test("Funil do TIME: paceAdjust.before fixa a data de corte do histórico", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { paceAdjust: { contacted: 80, before: "2026-07-05" } });
  await repo.create("leads", { id: "a1", saas: "leverads", stage: "Qualificando", createdAt: now, stageSince: now });
  await repo.create("activities", { id: "tq_a1", saas: "leverads", lead: "a1", type: "whatsapp", author: "u_sdr", at: now });

  // since=07-01 < before(07-05) → aplica; since=07-05 (==before) → não aplica.
  const applied = (await app.inject({ url: `/api/scoreboard/leverads?since=2026-07-01&until=2026-07-31` })).json().team;
  assert.equal(applied.contacted, 81);           // 1 + 80
  const skipped = (await app.inject({ url: `/api/scoreboard/leverads?since=2026-07-05&until=2026-07-31` })).json().team;
  assert.equal(skipped.paceAdjust, null);
  assert.equal(skipped.contacted, 1);            // só o real
  await app.close();
});

test("404 pra produto inexistente", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ url: "/api/scoreboard/nada" })).statusCode, 404);
  await app.close();
});

// Meta de vaga = alvo do TIME: o placar cobra a parte de cada um, senão 2
// closers com "24 ganhos" perseguem 48 e a empresa só precisa de 24.
test("meta de VAGA é do time e reparte entre as pessoas; taxa e ticket não se repartem", async () => {
  const { app, repo } = await buildApp();
  await repo.create("users", { id: "u_clo2", name: "Cida Closer", roles: ["closer"] }); // 2 closers
  await repo.create("users", { id: "u_kids", name: "Ana Kids", roles: ["closer"], saas: "uniquekids" }); // outro produto: não dilui
  // 24 ganhos e R$ 120k do TIME; ticket e win rate são de cada um.
  await repo.create("goals", { id: "gw", saas: "leverads", scope: "role", key: "closer", metric: "won", target: 24, period: "month" });
  await repo.create("goals", { id: "gr", saas: "leverads", scope: "role", key: "closer", metric: "revenue", target: 120000, period: "month" });
  await repo.create("goals", { id: "gt", saas: "leverads", scope: "role", key: "closer", metric: "ticket", target: 5000, period: "month" });
  await repo.create("goals", { id: "gwr", saas: "leverads", scope: "role", key: "closer", metric: "winRateCall", target: 25, period: "month" });
  await repo.create("leads", { id: "w1", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 500, createdAt: now, stageSince: now });
  await repo.create("activities", { id: "st_w1", saas: "leverads", lead: "w1", type: "stage", at: now, meta: { from: "Follow-up", to: "Ganho" } });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const c = sb.closer.find((x) => x.user === "u_clo");
  assert.equal(c.goals.won.target, 12, "24 do time ÷ 2 closers");
  assert.equal(c.goals.won.teamTarget, 24);
  assert.equal(c.goals.won.people, 2, "closer de outro produto fica de fora do rateio");
  assert.equal(c.goals.revenue.target, 60000);
  assert.equal(c.goals.ticket.target, 5000, "média não se reparte");
  assert.equal(c.goals.winRateCall.target, 25, "taxa não se reparte");
  await app.close();
});

test("meta por PESSOA passa inteira (já é individual) e não vira rateio", async () => {
  const { app, repo } = await buildApp();
  await repo.create("users", { id: "u_clo2", name: "Cida Closer", roles: ["closer"] });
  await repo.create("goals", { id: "gw", saas: "leverads", scope: "role", key: "closer", metric: "won", target: 24, period: "month" });
  await repo.create("goals", { id: "gu", saas: "leverads", scope: "user", key: "u_clo", metric: "won", target: 20, period: "month" });
  await repo.create("leads", { id: "w1", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 500, createdAt: now, stageSince: now });
  await repo.create("activities", { id: "st_w1", saas: "leverads", lead: "w1", type: "stage", at: now, meta: { from: "Follow-up", to: "Ganho" } });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const c = sb.closer.find((x) => x.user === "u_clo");
  assert.equal(c.goals.won.target, 20);
  assert.equal(c.goals.won.scope, "user");
  assert.equal(c.goals.won.teamTarget, undefined);
  await app.close();
});

test("vaga com uma pessoa só mantém a meta inteira (não muda o que já valia)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("goals", { id: "gb", saas: "leverads", scope: "role", key: "sdr", metric: "callsBooked", target: 40, period: "month" });
  await repo.create("leads", { id: "l1", saas: "leverads", owner: "u_sdr", stage: "Novo lead", createdAt: now });
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  assert.equal(sb.sdr.find((x) => x.user === "u_sdr").goals.callsBooked.target, 40);
  await app.close();
});

// Uma taxa de fechamento só. A conversão sobre as calls AGENDADAS é CONTA
// (comparecimento × fechamento), não meta digitada: com as duas editáveis dava
// pra configurar 25% das agendadas e 25% das que aconteceram ao mesmo tempo,
// que é impossível quando o comparecimento não é 100%.
test("conversão sobre as AGENDADAS é derivada de comparecimento × fechamento", async () => {
  const { app, repo } = await buildApp();
  await repo.create("goals", { id: "gs", saas: "leverads", scope: "role", key: "sdr", metric: "showRate", target: 75, period: "month" });
  await repo.create("goals", { id: "gc", saas: "leverads", scope: "role", key: "closer", metric: "conversaoCall", target: 40, period: "month" });
  await repo.create("leads", { id: "l1", saas: "leverads", owner: "u_sdr", closer: "u_clo", stage: "Novo lead", createdAt: now });
  await repo.create("leads", { id: "w1", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 500, createdAt: now, stageSince: now });
  await repo.create("activities", { id: "st_w1", saas: "leverads", lead: "w1", type: "stage", at: now, meta: { from: "Follow-up", to: "Ganho" } });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  assert.equal(sb.closer.find((x) => x.user === "u_clo").goals.conversaoCall.target, 40);
  assert.equal(sb.closer.find((x) => x.user === "u_clo").goals.winRateCall.target, 30, "75% × 40%");
  assert.equal(sb.closer.find((x) => x.user === "u_clo").goals.winRateCall.scope, "derived");
  assert.equal(sb.sdr.find((x) => x.user === "u_sdr").goals.callWinRate.target, 30, "mesma conta no card do SDR");
  assert.equal(sb.team.goals.callWinRate.target, 30);
  assert.equal(sb.team.goals.closeRate.target, 40, "a régua de fechamento da Visão geral enfim tem meta");
  await app.close();
});

test("sem meta configurada a derivada cai nos benchmarks (75% × 33%)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", owner: "u_sdr", stage: "Novo lead", createdAt: now });
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  assert.equal(sb.sdr.find((x) => x.user === "u_sdr").goals.callWinRate.target, 24.75);
  await app.close();
});

// O cartão de cada pessoa mostra AS METAS DA VAGA dela com o realizado no
// período — é o que a Visão geral cobra, pessoa a pessoa.
test("targets por PESSOA: metas da vaga com o realizado dela e a parte do rateio", async () => {
  const { app, repo } = await buildApp();
  await repo.create("users", { id: "u_clo2", name: "Cida Closer", roles: ["closer"] });
  for (const [id, key, metric, target] of [
    ["g1", "closer", "won", 24],
    ["g2", "closer", "revenue", 120000],
    ["g3", "closer", "conversaoCall", 40],
    ["g4", "sdr", "contacts", 300],
    ["g5", "sdr", "showRate", 75],
  ]) await repo.create("goals", { id, saas: "leverads", scope: "role", key, metric, target, period: "month" });

  await repo.create("leads", { id: "w1", saas: "leverads", owner: "u_sdr", closer: "u_clo", stage: "Ganho", amount: 500, createdAt: now, stageSince: now });
  await repo.create("activities", { id: "t_w1", saas: "leverads", lead: "w1", type: "call", author: "u_sdr", at: now });
  await repo.create("activities", { id: "b_w1", saas: "leverads", lead: "w1", type: "stage", at: now, meta: { from: "Qualificando", to: "Call agendada" } });
  await repo.create("activities", { id: "st_w1", saas: "leverads", lead: "w1", type: "stage", at: now, meta: { from: "Follow-up", to: "Ganho" } });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const clo = Object.fromEntries(sb.closer.find((x) => x.user === "u_clo").targets.map((t) => [t.metric, t]));
  assert.equal(clo.won.target, 12, "24 do time ÷ 2 closers = a parte dele");
  assert.equal(clo.won.teamTarget, 24);
  assert.equal(clo.won.value, 1, "realizado DELE, não do time");
  assert.equal(clo.won.kind, "flow", "só fluxo pode ser reescalado pra janela");
  assert.equal(clo.revenue.target, 60000);
  assert.equal(clo.conversaoCall.target, 40, "taxa não se reparte");
  assert.equal(clo.conversaoCall.kind, "rate");
  assert.equal(clo.ticket.target, null, "sem meta, mas com valor medido, ainda aparece");
  assert.equal(clo.ticket.value, 500);

  const sdr = Object.fromEntries(sb.sdr.find((x) => x.user === "u_sdr").targets.map((t) => [t.metric, t]));
  assert.equal(sdr.contacts.target, 300, "1 SDR só: a meta do time é dele inteira");
  assert.equal(sdr.contacts.value, 1);
  assert.equal(sdr.showRate.target, 75);
  // métrica sem meta E sem valor medido não vira linha vazia no cartão
  assert.equal(sdr.bookingRate.value, 100);
  await app.close();
});

test("Ana (só UniqueKids) não entra no placar da LeverAds", async () => {
  const { app, repo } = await buildApp();
  await repo.create("users", { id: "ana", name: "Ana", roles: ["closer", "integrator", "social"], saas: "uniquekids" });
  await repo.create("goals", { id: "g1", saas: "leverads", scope: "role", key: "closer", metric: "won", target: 24, period: "month" });
  await repo.create("leads", { id: "w1", saas: "leverads", closer: "u_clo", stage: "Ganho", amount: 500, createdAt: now, stageSince: now });
  await repo.create("activities", { id: "st_w1", saas: "leverads", lead: "w1", type: "stage", at: now, meta: { from: "Follow-up", to: "Ganho" } });
  await repo.create("customers", { id: "c1", saas: "leverads", owner: "u_cs", startedAt: now });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  for (const role of ["sdr", "closer", "cs", "social"]) {
    assert.equal(sb[role].some((x) => x.user === "ana"), false, `ana não pode aparecer em ${role}`);
  }
  // e não dilui a meta do time daqui: 1 closer da LeverAds persegue os 24
  assert.equal(sb.closer.find((x) => x.user === "u_clo").targets.find((t) => t.metric === "won").target, 24);
  await app.close();
});

test("closer: calls REALIZADAS entram como meta e o realizado ignora o no-show", async () => {
  const { app, repo } = await buildApp();
  await repo.create("goals", { id: "g1", saas: "leverads", scope: "role", key: "closer", metric: "callsShown", target: 73, period: "month" });
  const mk = async (id, stage, extra) => {
    await repo.create("leads", { id, saas: "leverads", closer: "u_clo", createdAt: now, callAt: now, stage, ...extra });
  };
  await mk("c1", "Follow-up", {});                                              // aconteceu
  await mk("c2", "Perdido", { lostReason: "preco", stageSince: now });          // aconteceu (perdeu por outro motivo)
  await mk("c3", "Perdido", { lostReason: "nao_compareceu", stageSince: now }); // NÃO aconteceu

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${win}` })).json();
  const row = sb.closer.find((x) => x.user === "u_clo");
  const t = row.targets.find((x) => x.metric === "callsShown");
  assert.equal(row.calls, 3, "3 agendadas");
  assert.equal(t.value, 2, "só as que aconteceram (o no-show é do comparecimento do SDR)");
  assert.equal(t.target, 73, "1 closer: a meta do time é dele inteira");
  assert.equal(t.kind, "flow", "acumula, então reescala pra janela");
  await app.close();
});
