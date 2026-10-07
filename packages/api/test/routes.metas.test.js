// Metas — GET traz o catálogo por vaga com as metas atuais + time; PUT faz
// upsert/delete na collection goals (positivo salva, vazio apaga), por vaga e
// por pessoa, ignorando métrica/role inválida.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerMetasRoutes } = await import("../src/metrics/routes.metas.js");

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["closer"] });
  await repo.create("users", { id: "jon", name: "Jon", roles: ["sdr", "closer"] });
  await repo.create("users", { id: "ana", name: "Ana", roles: [] }); // sem papel de meta → fora
  const app = Fastify();
  registerMetasRoutes(app, repo);
  return { app, repo };
}

test("GET: catálogo por vaga + metas atuais + time com papel de meta", async () => {
  const { app, repo } = await buildApp();
  await repo.create("goals", { id: "g_book", saas: "leverads", scope: "role", key: "sdr", metric: "bookingRate", target: 35, period: "month" });
  await repo.create("goals", { id: "g_won", saas: "leverads", scope: "user", key: "leo", metric: "won", target: 8, period: "month" });

  const r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  assert.deepEqual(r.roles.map((x) => x.role), ["sdr", "closer", "integrator", "social"]);
  const sdr = r.roles.find((x) => x.role === "sdr");
  assert.equal(sdr.metrics.find((m) => m.metric === "bookingRate").target, 35); // configurada
  assert.equal(sdr.metrics.find((m) => m.metric === "contactRate").target, null); // sem meta → null
  assert.equal(sdr.metrics.find((m) => m.metric === "contactRate").default, 80);  // benchmark
  // time só com papel de meta (ana fica de fora)
  assert.deepEqual(r.users.map((u) => u.id).sort(), ["jon", "leo"]);
  // overrides por pessoa
  assert.deepEqual(r.userGoals, [{ key: "leo", metric: "won", target: 8 }]);
});

test("PUT: positivo faz upsert, vazio apaga; ignora métrica/role inválida", async () => {
  const { app, repo } = await buildApp();
  // meta pré-existente que será apagada ao mandar vazio
  const g = await repo.create("goals", { id: "g_closer_won", saas: "leverads", scope: "role", key: "closer", metric: "won", target: 5, period: "month" });

  const put = await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [
    { scope: "role", key: "sdr", metric: "bookingRate", target: 40 },   // cria
    { scope: "role", key: "closer", metric: "won", target: "" },        // apaga o existente
    { scope: "user", key: "leo", metric: "revenue", target: 50000 },    // cria user-scope
    { scope: "role", key: "sdr", metric: "inexistente", target: 10 },   // ignora (métrica inválida)
    { scope: "role", key: "vendedor", metric: "won", target: 10 },      // ignora (role inválida)
  ] } });
  assert.equal(put.statusCode, 200);
  const body = put.json();
  assert.equal(body.created, 2);  // bookingRate + revenue
  assert.equal(body.removed, 1);  // won apagado

  const goals = await repo.list("goals");
  assert.ok(goals.find((x) => x.scope === "role" && x.key === "sdr" && x.metric === "bookingRate" && x.target === 40));
  assert.ok(goals.find((x) => x.scope === "user" && x.key === "leo" && x.metric === "revenue" && x.target === 50000));
  assert.equal(await repo.get("goals", g.id), null); // apagado
  // não criou lixo
  assert.ok(!goals.some((x) => x.metric === "inexistente"));
  assert.ok(!goals.some((x) => x.key === "vendedor"));
});

test("PUT: idempotente (mandar de novo atualiza, não duplica)", async () => {
  const { app, repo } = await buildApp();
  const payload = { goals: [{ scope: "role", key: "sdr", metric: "contactRate", target: 85 }] };
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload });
  const put2 = await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [{ scope: "role", key: "sdr", metric: "contactRate", target: 90 }] } });
  assert.equal(put2.json().updated, 1);
  assert.equal(put2.json().created, 0);
  const matches = (await repo.list("goals")).filter((x) => x.scope === "role" && x.key === "sdr" && x.metric === "contactRate");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].target, 90);
});

test("meta da empresa: GET expõe cashTarget (null = padrão); PUT grava e limpa no produto", async () => {
  const { app, repo } = await buildApp();
  // Sem meta configurada: null + o padrão do pace pro placeholder da tela.
  let r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  assert.equal(r.company.cashTarget, null);
  assert.equal(r.company.cashTargetDefault, 120000);

  // PUT com company grava no product.monthlyCashTarget (goals pode ir vazio).
  const put = await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { cashTarget: "80000" } } });
  assert.equal(put.json().companySaved, true);
  assert.equal((await repo.get("products", "leverads")).monthlyCashTarget, 80000);
  r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  assert.equal(r.company.cashTarget, 80000);

  // Vazio limpa (a faixa volta pro padrão); sem `company` no body, não mexe.
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { cashTarget: "" } } });
  assert.equal((await repo.get("products", "leverads")).monthlyCashTarget, null);
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [{ scope: "role", key: "sdr", metric: "bookingRate", target: 30 }] } });
  assert.equal((await repo.get("products", "leverads")).monthlyCashTarget, null);
});

test("PUT inválido = 400; produto inexistente = 404", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: "x" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/metas/naoexiste" })).statusCode, 404);
});

// A meta de cada vaga tem que descer da meta da EMPRESA, senão o placar cobra
// um número que não fecha com o mês. Mesma cadeia e mesmas taxas do pace.
test("derived: a meta do mês desce pela cadeia do pace e vira alvo de time", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { monthlyCashTarget: 120000 });
  // Sem histórico, as taxas caem no benchmark (80/30/75/25) e o ticket vem da
  // meta configurada — é o cenário de quem está começando.
  await repo.create("goals", { id: "g_ticket", saas: "leverads", scope: "role", key: "closer", metric: "ticket", target: 5000, period: "month" });

  const r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  const d = r.derived;
  assert.equal(d.blockedBy, null);
  assert.equal(d.target, 120000);
  assert.equal(d.ticket, 5000);
  assert.equal(d.won, 24);          // 120000 ÷ 5000
  assert.equal(d.callsShown, 73);   // 24 ÷ 33% de fechamento (das que ACONTECERAM)
  assert.equal(d.callsBooked, 98);  // 73 ÷ 75% de comparecimento
  assert.equal(d.contacts, 327);    // 98 ÷ 30% de agendamento
  assert.equal(d.leads, 409);       // 327 ÷ 80% de contato

  // O que o botão grava: só VOLUME (taxa continua digitada, senão vira circular).
  const byMetric = Object.fromEntries(d.goals.map((g) => [g.metric, g]));
  assert.deepEqual(Object.keys(byMetric).sort(), ["callsBooked", "callsShown", "contacts", "newAccounts", "revenue", "ticket", "won"]);
  assert.equal(byMetric.won.target, 24);
  assert.equal(byMetric.callsShown.target, 73, "as calls que precisam ACONTECER pra dar 24 ganhos");
  assert.equal(byMetric.won.role, "closer");
  assert.equal(byMetric.revenue.target, 120000);
  assert.equal(byMetric.callsBooked.role, "sdr");
  assert.equal(byMetric.newAccounts.target, 24); // conta nova = ganho
  assert.ok(!("contactRate" in byMetric), "taxa não é derivada");

  // Quantas pessoas por vaga (o placar reparte a meta de time entre elas).
  assert.equal(r.people.closer, 2); // leo + jon
  assert.equal(r.people.sdr, 1);    // jon
});

test("derived: sem ticket a cadeia não fecha e a tela avisa em vez de chutar", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { monthlyCashTarget: 120000 });
  const d = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json().derived;
  assert.equal(d.blockedBy, "ticket");
  assert.equal(d.won, null);
  assert.deepEqual(d.goals, []);
});

test("catálogo marca quais metas são do TIME (repartem) e quais são de cada um", async () => {
  const { app } = await buildApp();
  const r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  const m = (role, metric) => r.roles.find((x) => x.role === role).metrics.find((y) => y.metric === metric);
  assert.equal(m("closer", "conversaoCall").hint, "das calls que aconteceram", "denominador escrito por extenso");
  assert.equal(m("closer", "won").team, true);
  assert.equal(m("closer", "revenue").team, true);
  assert.equal(m("closer", "ticket").team, undefined, "média não se reparte");
  assert.equal(m("sdr", "contacts").team, true);
  assert.equal(m("sdr", "bookingRate").team, undefined, "taxa não se reparte");
  assert.equal(m("integrator", "nps").team, undefined, "índice não se reparte");
});

// ── Meta por MÊS (agenda) + campo vazio seguindo a meta ─────────────────────
// O Leo configura agosto hoje; quando vira o mês, a plataforma inteira passa a
// perseguir o número novo sem ninguém mexer em nada.
const { cashTargetFor } = await import("../src/metrics/pipeline-pace.js");

test("meta por mês: o mês configurado vence o padrão, e o padrão vence o do sistema", () => {
  const p = { monthlyCashTarget: 120000, monthlyCashTargets: { "2026-08": 150000, "2026-09": 0 } };
  assert.deepEqual(cashTargetFor(p, "2026-08"), { target: 150000, configured: true, source: "month" });
  assert.deepEqual(cashTargetFor(p, "2026-07"), { target: 120000, configured: true, source: "default" });
  assert.deepEqual(cashTargetFor(p, "2026-09"), { target: 120000, configured: true, source: "default" }, "zero no mapa não zera a meta");
  assert.deepEqual(cashTargetFor({}, "2026-07"), { target: 120000, configured: false, source: "system" });
});

test("regra de crescimento: mês sem valor cresce % composto sobre o último agendado", () => {
  // A escada real de produção: 180k → 270k → 405k (×1,5). Com a regra em 50%,
  // novembro em diante segue sozinho em vez de despencar pro padrão 120k.
  const p = {
    monthlyCashTarget: 120000, monthlyCashGrowthPct: 50,
    monthlyCashTargets: { "2026-08": 180000, "2026-09": 270000, "2026-10": 405000 },
  };
  assert.deepEqual(cashTargetFor(p, "2026-10"), { target: 405000, configured: true, source: "month" }, "mês agendado vence a regra");
  assert.deepEqual(cashTargetFor(p, "2026-11"), { target: 607500, configured: true, source: "growth", growthFrom: "2026-10", growthPct: 50 });
  assert.equal(cashTargetFor(p, "2026-12").target, 911250, "composto: 405k × 1,5²");
  assert.equal(cashTargetFor(p, "2027-01").target, Math.round(405000 * 1.5 ** 3), "vira o ano contando os meses certos");
  // âncora é o ÚLTIMO agendado antes do mês, não o primeiro
  assert.deepEqual(cashTargetFor(p, "2026-09").growthFrom, undefined, "setembro é agendado, nem passa pela regra");
  // sem mês agendado antes, não há âncora: cai no padrão
  assert.deepEqual(cashTargetFor(p, "2026-07"), { target: 120000, configured: true, source: "default" });
  // sem regra configurada, comportamento antigo intacto
  const semRegra = { ...p, monthlyCashGrowthPct: null };
  assert.deepEqual(cashTargetFor(semRegra, "2026-11"), { target: 120000, configured: true, source: "default" });
});

test("PUT/GET: company.growthPct grava, arredonda a 1 casa e limpa", async () => {
  const { app, repo } = await buildApp();
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { growthPct: "50.44" } } });
  assert.equal((await repo.get("products", "leverads")).monthlyCashGrowthPct, 50.4);
  assert.equal((await app.inject({ url: "/api/metas/leverads" })).json().company.growthPct, 50.4);
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { growthPct: "" } } });
  assert.equal((await repo.get("products", "leverads")).monthlyCashGrowthPct, null);
  assert.equal((await app.inject({ url: "/api/metas/leverads" })).json().company.growthPct, null);
});

test("agenda de meses: GET cobre jan do ano corrente a dez do próximo; PUT grava, apaga e ignora lixo", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [], monthlyCashTarget: 120000 });
  const app = Fastify();
  registerMetasRoutes(app, repo, { now: () => new Date("2026-10-07T15:00:00Z") });

  const antes = (await app.inject({ url: "/api/metas/leverads" })).json();
  const months = antes.company.months;
  assert.equal(months.length, 24, "jan/2026 → dez/2027: quatro trimestres de cada ano");
  assert.equal(months[0].month, "2026-01");
  assert.equal(months.at(-1).month, "2027-12");
  assert.deepEqual(antes.company.horizon, { from: "2026-01", to: "2027-12", current: "2026-10" });
  assert.deepEqual(months.filter((m) => m.current).map((m) => m.month), ["2026-10"], "um só mês corrente");
  assert.ok(months.filter((m) => m.month < "2026-10").every((m) => m.past === true), "passado marcado");
  assert.ok(months.filter((m) => m.month >= "2026-10").every((m) => m.past === false), "corrente e futuro não");
  const out = months.find((m) => m.month === "2026-10");
  assert.equal(out.target, null, "sem valor próprio ainda");
  assert.equal(out.effective, 120000, "mas segue o padrão");

  const r = await app.inject({
    method: "PUT", url: "/api/metas/leverads",
    payload: { goals: [], company: { months: { "2026-11": 150000, "2027-12": 900000, "2026-13": 999, "mês": 1 } } },
  });
  assert.equal(r.statusCode, 200);
  const depois = (await app.inject({ url: "/api/metas/leverads" })).json();
  const nov = depois.company.months.find((m) => m.month === "2026-11");
  assert.equal(nov.target, 150000);
  assert.equal(nov.source, "month");
  assert.equal(depois.company.months.find((m) => m.month === "2027-12").target, 900000, "dez do ano seguinte grava normal");
  const prod = await repo.get("products", "leverads");
  assert.deepEqual(Object.keys(prod.monthlyCashTargets).sort(), ["2026-11", "2027-12"], "mês inválido não entra");

  // apagar o mês devolve ele pro padrão
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { months: { "2026-11": "", "2027-12": "" } } } });
  const limpo = (await app.inject({ url: "/api/metas/leverads" })).json();
  assert.equal(limpo.company.months.find((m) => m.month === "2026-11").target, null);
  assert.equal(limpo.company.months.find((m) => m.month === "2026-11").effective, 120000);
});

test("agenda em dezembro: 13 meses (dez corrente + o ano seguinte inteiro)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  const app = Fastify();
  registerMetasRoutes(app, repo, { now: () => new Date("2026-12-15T15:00:00Z") });
  const r = (await app.inject({ url: "/api/metas/leverads" })).json();
  assert.equal(r.company.months.length, 24, "o horizonte é sempre jan do ano corrente a dez do próximo");
  assert.equal(r.company.months.filter((m) => !m.past).length, 13);
  assert.equal(r.company.months[11].current, true);
  assert.deepEqual(r.company.horizon, { from: "2026-01", to: "2027-12", current: "2026-12" });
});

// A escada de produção (07/10/2026): ago 180k → fev/27 686.646, crescendo 25%.
const ESCADA = { "2026-08": 180000, "2026-09": 225000, "2026-10": 281250, "2026-11": 351563, "2026-12": 439453, "2027-01": 549316, "2027-02": 686646 };

test("agenda: mês passado vem com a meta da época; além do agendado, a regra compõe em potência direta", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [], monthlyCashTarget: 120000, monthlyCashTargets: ESCADA, monthlyCashGrowthPct: 25 });
  const app = Fastify();
  registerMetasRoutes(app, repo, { now: () => new Date("2026-10-07T15:00:00Z") });
  const by = Object.fromEntries((await app.inject({ url: "/api/metas/leverads" })).json().company.months.map((m) => [m.month, m]));
  assert.deepEqual([by["2026-07"].effective, by["2026-07"].source], [120000, "default"], "julho valia o padrão");
  assert.deepEqual([by["2026-08"].effective, by["2026-08"].source, by["2026-08"].past], [180000, "month", true]);
  assert.equal(by["2027-03"].source, "growth");
  assert.equal(by["2027-03"].effective, Math.round(686646 * 1.25));
  // Potência direta sobre a âncora (não arredonda em cadeia): dez/27 = fev/27 × 1,25^10.
  assert.equal(by["2027-12"].effective, Math.round(686646 * Math.pow(1.25, 10)));
  assert.equal(by["2027-12"].target, null);
});

// ── Histórico mensal (meta × realizado) ──────────────────────────────────────
const FUNIL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];
async function venda(repo, id, { at, amount, keyAccount = false }) {
  await repo.create("customers", { id: `c_${id}`, saas: "leverads", leadId: id, name: `Cliente ${id}`, startedAt: at, paymentMethod: "pix", keyAccount });
  await repo.create("leads", { id, saas: "leverads", stage: "Ganho", amount, customerId: `c_${id}`, wonAt: at, paymentMethod: "pix", closer: "leo" });
}
async function histApp(now = "2026-10-07T15:00:00Z", product = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNIL, monthlyCashTarget: 120000, ...product });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["closer"] });
  const app = Fastify();
  registerMetasRoutes(app, repo, { now: () => new Date(now) });
  return { app, repo };
}

test("history: 400 em from inválido ou futuro; 404 sem produto", async () => {
  const { app } = await histApp();
  assert.equal((await app.inject({ url: "/api/metas/leverads/history?from=2026-13" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/metas/leverads/history?from=2026-11" })).statusCode, 400, "mês futuro não tem histórico");
  assert.equal((await app.inject({ url: "/api/metas/nada/history" })).statusCode, 404);
});

test("history: começa no piso jun/2026, vai até o mês corrente (parcial) e mês fechado tem veredito", async () => {
  const { app, repo } = await histApp();
  await venda(repo, "l_mai", { at: "2026-05-10T15:00:00Z", amount: 4000 }); // antes do piso: fica fora da lista
  await venda(repo, "l_jul", { at: "2026-07-08T15:00:00Z", amount: 5000 });
  await venda(repo, "l_out", { at: "2026-10-02T15:00:00Z", amount: 7000 });
  const h = (await app.inject({ url: "/api/metas/leverads/history" })).json();
  assert.equal(h.from, "2026-06");
  assert.equal(h.to, "2026-10");
  assert.deepEqual(h.months.map((m) => m.month), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  const jun = h.months[0];
  assert.deepEqual([jun.sold, jun.soldN, jun.target, jun.status, jun.ended], [0, 0, 120000, "behind", true]);
  const jul = h.months[1];
  assert.deepEqual([jul.sold, jul.soldN, jul.contracted, jul.ended, jul.current], [5000, 1, 5000, true, false]);
  const out = h.months.at(-1);
  assert.equal(out.current, true);
  assert.equal(out.ended, false);
  assert.equal(out.sold, 7000);
  assert.ok(out.expectedProgress > 0 && out.expectedProgress < 1, "mês corrente é parcial");
  assert.ok(["ahead", "attention", "behind"].includes(out.status));
  assert.ok(h.months.every((m) => m.month <= "2026-10"), "mês futuro nunca entra");
  // Meses passados com a escada da época: ago/set valem o agendado.
  const { app: app2, repo: repo2 } = await histApp("2026-10-07T15:00:00Z", { monthlyCashTargets: ESCADA, monthlyCashGrowthPct: 25 });
  await venda(repo2, "l_ago", { at: "2026-08-20T15:00:00Z", amount: 190000 });
  const h2 = (await app2.inject({ url: "/api/metas/leverads/history" })).json();
  const ago = h2.months.find((m) => m.month === "2026-08");
  assert.deepEqual([ago.target, ago.source, ago.status], [180000, "month", "ahead"], "meta batida no mês fechado");
  assert.equal(h2.months.find((m) => m.month === "2026-09").target, 225000);
});

test("history: ?from respeita o pedido; sem venda alguma começa no mês corrente", async () => {
  const { app, repo } = await histApp();
  const vazio = (await app.inject({ url: "/api/metas/leverads/history" })).json();
  assert.deepEqual(vazio.months.map((m) => m.month), ["2026-10"]);
  await venda(repo, "l_jul", { at: "2026-07-08T15:00:00Z", amount: 5000 });
  const h = (await app.inject({ url: "/api/metas/leverads/history?from=2026-09" })).json();
  assert.deepEqual(h.months.map((m) => m.month), ["2026-09", "2026-10"]);
});

test("history: totais por ano somam os meses listados; conta grande sai do sold e volta em keyAccount", async () => {
  const { app, repo } = await histApp();
  await venda(repo, "l_jul", { at: "2026-07-08T15:00:00Z", amount: 5000 });
  await venda(repo, "l_set", { at: "2026-09-08T15:00:00Z", amount: 3000 });
  await venda(repo, "l_big", { at: "2026-09-15T15:00:00Z", amount: 120000, keyAccount: true });
  const h = (await app.inject({ url: "/api/metas/leverads/history" })).json();
  const set = h.months.find((m) => m.month === "2026-09");
  assert.equal(set.sold, 3000, "conta grande fora do resultado");
  assert.equal(set.soldN, 1);
  assert.deepEqual([set.keyAccount.count, set.keyAccount.revenue, set.keyAccount.soldWith, set.keyAccount.countWith], [1, 120000, 123000, 2]);
  assert.equal(h.months.find((m) => m.month === "2026-07").keyAccount, null);
  assert.equal(h.years.length, 1);
  const y = h.years[0];
  assert.equal(y.year, 2026);
  assert.equal(y.months, 4, "começa no 1º mês com venda (jul), não no piso");
  assert.equal(y.closedMonths, 3);
  assert.equal(y.sold, 8000);
  assert.equal(y.soldN, 2);
  assert.equal(y.target, h.months.reduce((a, m) => a + m.target, 0));
  assert.equal(y.progress, Math.round((8000 / y.target) * 10000) / 10000);
});

// ── Card Pace da tela Metas persegue a META ATUAL (super meta) ──────────────
const { deriveGoalsFromPace } = await import("../src/metrics/metas.js");

const paceStub = (over = {}) => ({
  sale: { target: 120000, chaseTarget: 120000, chasePct: 100, ...over.sale },
  context: { averageEntry: 6000, averageEntrySource: "won_tcv", ...over.context },
  conversions: {
    closeRateEffective: { value: 0.5, source: "history" },
    showRate: { value: 0.8, source: "history" },
    bookingRate: { value: 0.5, source: "history" },
    contactRate: { value: 0.8, source: "history" },
  },
});

test("derivação abaixo de 100%: persegue a base (nada muda)", () => {
  const d = deriveGoalsFromPace(paceStub());
  assert.equal(d.target, 120000);
  assert.equal(d.superMode, false);
  assert.equal(d.won, 20, "120k ÷ 6k ticket = 20 ganhos");
});

test("batida a base: a cadeia desce sobre a super meta que o pace persegue", () => {
  // O pace já re-ancorou em 240k (200%); a tela Metas desdobra ESSE teto.
  const d = deriveGoalsFromPace(paceStub({ sale: { target: 120000, chaseTarget: 240000, chasePct: 200 } }));
  assert.equal(d.target, 240000);
  assert.equal(d.base, 120000);
  assert.equal(d.superMode, true);
  assert.equal(d.chasePct, 200);
  assert.equal(d.won, 40, "240k ÷ 6k = 40 ganhos (o dobro da base)");
  assert.equal(d.goals.find((g) => g.metric === "revenue").target, 240000);
  assert.equal(d.goals.find((g) => g.metric === "won").target, 40);
});

test("passado de 200% (chaseTarget null): cai na base, não há teto acima", () => {
  const d = deriveGoalsFromPace(paceStub({ sale: { target: 120000, chaseTarget: null, chasePct: null } }));
  assert.equal(d.target, 120000);
  assert.equal(d.superMode, false);
});

// ── Meta de contratos da empresa (monthlyContractsTarget) ────────────────────
test("meta de contratos digitada vence a venda ÷ ticket e puxa a cadeia", () => {
  const d = deriveGoalsFromPace(paceStub(), { contractsTarget: 32 });
  assert.equal(d.won, 32, "digitado vence os 20 da divisão");
  assert.equal(d.wonFromTicket, 20, "a divisão fica exposta pra comparação");
  assert.equal(d.wonSource, "company");
  assert.equal(d.callsShown, 64, "cadeia desce do digitado: 32 ÷ 50%");
  assert.equal(d.goals.find((g) => g.metric === "won").target, 32);
  // e não escala em super meta (digitado não escala)
  const s = deriveGoalsFromPace(paceStub({ sale: { target: 120000, chaseTarget: 240000, chasePct: 200 } }), { contractsTarget: 32 });
  assert.equal(s.won, 32);
});

test("sem ticket, a meta de contratos digitada sustenta a cadeia sozinha", () => {
  const semTicket = paceStub({ context: { averageEntry: 0, averageEntrySource: "" } });
  assert.equal(deriveGoalsFromPace(semTicket).blockedBy, "ticket", "sem nada, trava como antes");
  const d = deriveGoalsFromPace(semTicket, { contractsTarget: 30 });
  assert.equal(d.blockedBy, null);
  assert.equal(d.won, 30);
  assert.equal(d.wonFromTicket, null);
  assert.ok(!d.goals.find((g) => g.metric === "ticket"), "sem ticket não deriva meta de ticket");
  assert.equal(d.goals.find((g) => g.metric === "revenue").target, 120000, "a meta de R$ segue derivando");
});

test("GET: plano de remuneração exposto (padrão e doc salvo) + nível por pessoa", async () => {
  const { app, repo } = await buildApp();
  await repo.update("users", "jon", { compLevel: 2 });
  const r1 = (await app.inject({ url: "/api/metas/leverads" })).json();
  assert.equal(r1.users.find((u) => u.id === "jon").compLevel, 2);
  assert.equal(r1.users.find((u) => u.id === "leo").compLevel, 1, "sem campo = júnior");
  assert.deepEqual(r1.compPlan.sdr.map((l) => l.metaContracts), [20, 25, 35], "padrão aprovado 04/08");
  // SDR (06/10/2026): contratos e receita são a META DO MÊS DA EQUIPE — nem
  // campo de vaga nem nível do plano. O closer segue no plano por nível.
  const sdr = r1.roles.find((x) => x.role === "sdr");
  assert.equal(sdr.metrics.find((m) => m.metric === "won").teamGoal, true, "contratos do SDR = meta do mês da equipe");
  assert.equal(sdr.metrics.find((m) => m.metric === "revenue").teamGoal, true);
  assert.ok(!sdr.metrics.find((m) => m.metric === "won").compPlan, "SDR não segue o plano por nível");
  assert.ok(!sdr.metrics.find((m) => m.metric === "contacts").teamGoal, "volume comum segue campo de vaga");
  const closer = r1.roles.find((x) => x.role === "closer");
  assert.equal(closer.metrics.find((m) => m.metric === "won").compPlan, true, "closer segue o plano, não campo de vaga");
  // doc salvo na tela Remuneração vence o padrão (só da trilha dele)
  await repo.create("comp_plans", { id: "cp_closer", role: "closer", plan: { levels: [{ n: 1, metaContracts: 18, metaRevenue: 80000 }] } });
  const r2 = (await app.inject({ url: "/api/metas/leverads" })).json();
  assert.deepEqual(r2.compPlan.closer, [{ n: 1, metaContracts: 18, metaRevenue: 80000 }]);
  assert.deepEqual(r2.compPlan.sdr.map((l) => l.n), [1, 2, 3], "sdr segue no padrão");
});

test("PUT/GET: company.contractsTarget grava no produto, arredonda e limpa", async () => {
  const { app, repo } = await buildApp();
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { contractsTarget: "32.4" } } });
  assert.equal((await repo.get("products", "leverads")).monthlyContractsTarget, 32);
  assert.equal((await app.inject({ url: "/api/metas/leverads" })).json().company.contractsTarget, 32);
  // vazio limpa: o número volta a seguir a venda ÷ ticket
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { contractsTarget: "" } } });
  assert.equal((await repo.get("products", "leverads")).monthlyContractsTarget, null);
  assert.equal((await app.inject({ url: "/api/metas/leverads" })).json().company.contractsTarget, null);
});

test("derived: a meta de contratos usa o ticket do MÊS ANTERIOR e diz qual mês foi", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { monthlyCashTarget: 120000, funnel: [
    { stage: "Novo lead", kind: "novo", conv: 1 }, { stage: "Ganho", kind: "ganho", conv: 1 }, { stage: "Perdido", kind: "perdido", conv: 0 },
  ] });
  // Mês anterior ao corrente: 2 vendas à vista de 4k e 8k → ticket 6k.
  const d0 = new Date(); d0.setUTCDate(15); d0.setUTCMonth(d0.getUTCMonth() - 1);
  const prev = d0.toISOString().slice(0, 7);
  await repo.create("customers", { id: "cA", saas: "leverads", startedAt: `${prev}-10T15:00:00.000Z` });
  await repo.create("customers", { id: "cB", saas: "leverads", startedAt: `${prev}-12T15:00:00.000Z` });
  await repo.create("leads", { id: "jA", saas: "leverads", stage: "Ganho", customerId: "cA", wonAt: `${prev}-10T15:00:00.000Z`, amount: 4000, paymentMethod: "pix", createdAt: `${prev}-01T12:00:00.000Z` });
  await repo.create("leads", { id: "jB", saas: "leverads", stage: "Ganho", customerId: "cB", wonAt: `${prev}-12T15:00:00.000Z`, amount: 8000, paymentMethod: "pix", createdAt: `${prev}-02T12:00:00.000Z` });
  // Ticket configurado NÃO vence o mês anterior (só é fallback).
  await repo.create("goals", { id: "g_ticket", saas: "leverads", scope: "role", key: "closer", metric: "ticket", target: 5000, period: "month" });

  const d = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json().derived;
  assert.equal(d.ticket, 6000);
  assert.equal(d.ticketSource, "prev_month");
  assert.equal(d.ticketMonth, prev);
  assert.deepEqual(d.previousMonth, { month: prev, sold: 12000, soldN: 2, ticket: 6000 });
  assert.equal(d.wonFromTicket, 20); // 120k ÷ 6k
  assert.equal(d.won, 20);
});
