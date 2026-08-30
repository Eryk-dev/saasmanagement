import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { wallFromNaive } from "../src/agenda-slots.js";
import {
  DEFAULT_RULES, sanitizeRules, dayTarget, bookedCallsFor, costPerCall, fillWindow,
  syncShortFridayBlock, adDeliveryTick, loadDeliveryCfg, registerAdDeliveryRoutes,
} from "../src/ad-delivery.js";

// Calendário de referência (relógio de parede BRT): 31/08/2026 é SEGUNDA —
// logo 03/09 quinta, 04/09 sexta, 05/09 sábado, 06/09 domingo.
const SEG = wallFromNaive("2026-08-31T10:00");
const AMANHA = "2026-09-01"; // terça

const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Call agendada", kind: "call" },
  { stage: "Follow-up", kind: "followup" },
];

const closer = (id) => ({ id, name: id, roles: ["closer"], compLevel: 2 });

async function seedRepo({ users = [], leads = [], blocks = [], insights = [], config = null } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, metaAdAccount: "act_1" });
  for (const u of users) await repo.create("users", u);
  for (const l of leads) await repo.create("leads", l);
  for (const b of blocks) await repo.create("agenda_blocks", b);
  for (const r of insights) await repo.create("ad_insights", r);
  if (config) await repo.create("app_config", { id: "ad_delivery_leverads", ...config });
  return repo;
}

// Meta de mentira: grava as chamadas e mantém o status em memória, pro tick
// seguinte enxergar o efeito do anterior (como na conta real).
function makeFakeMeta({ campaigns = [], adsets = [] } = {}) {
  const calls = { status: [], budget: [] };
  return {
    calls, campaigns, adsets,
    configured: () => true,
    async listCampaigns() { return campaigns.map((c) => ({ ...c })); },
    async listAccountAdsets() { return adsets.map((s) => ({ ...s })); },
    async setObjectStatus(id, status) {
      calls.status.push({ id, status });
      const c = campaigns.find((x) => x.id === id);
      if (c) c.status = status;
      return { id, status };
    },
    async setObjectBudget(id, dailyBudget) {
      calls.budget.push({ id, dailyBudget });
      return { id, dailyBudget };
    },
  };
}

const rules = (patch) => {
  const base = JSON.parse(JSON.stringify(DEFAULT_RULES));
  for (const [k, v] of Object.entries(patch || {})) base[k] = { ...base[k], ...v };
  return base;
};

// ── Réguas puras ────────────────────────────────────────────────────────────

test("dayTarget: 10 horários por closer na janela de oferta; alvo = min(5×ativos, desbloqueados)", async () => {
  const users = [closer("c1"), closer("c2")];
  const t = dayTarget({ users, blocks: [], saas: "leverads", dayStr: AMANHA, callsPerCloser: 5 });
  // 9h..19h de início, almoço (12h) fora = 10 inícios de hora cheia por closer.
  assert.equal(t.capacity, 20);
  assert.equal(t.closersAtivos, 2);
  assert.equal(t.target, 10);
});

test("dayTarget: bloqueio derruba a capacidade e o alvo cai junto (o '22 < 30' do Leo)", async () => {
  const users = [closer("c1"), closer("c2")];
  // c1 bloqueado das 9h às 17h em 01/09 → sobram os inícios 17h, 18h e 19h.
  const blocks = [{ id: "b1", user: "c1", kind: "block", recur: "once", date: AMANHA, fromHour: 9, toHour: 17 }];
  const t = dayTarget({ users, blocks, saas: "leverads", dayStr: AMANHA, callsPerCloser: 5 });
  assert.equal(t.capacity, 13); // 3 do c1 + 10 do c2
  assert.equal(t.closersAtivos, 2);
  assert.equal(t.target, 10); // 5×2 ainda menor que 13
  // c1 fora o dia inteiro: deixa de ser closer ativo e o alvo encolhe pra 5.
  const t2 = dayTarget({
    users, saas: "leverads", dayStr: AMANHA, callsPerCloser: 5,
    blocks: [{ id: "b2", user: "c1", kind: "block", recur: "once", date: AMANHA, allDay: true }],
  });
  assert.equal(t2.closersAtivos, 1);
  assert.equal(t2.target, 5);
  // Capacidade menor que 5×ativos: o alvo vira a capacidade.
  const t3 = dayTarget({
    users: [closer("c1")], saas: "leverads", dayStr: AMANHA, callsPerCloser: 5,
    blocks: [{ id: "b3", user: "c1", kind: "block", recur: "once", date: AMANHA, fromHour: 9, toHour: 17 }],
  });
  assert.equal(t3.target, 3);
});

test("fillWindow: pares fixos seg/ter · qua/qui · sexta sozinha, a partir do próximo dia útil", () => {
  assert.deepEqual(fillWindow(wallFromNaive("2026-08-30T10:00")), ["2026-08-31", "2026-09-01"]); // dom → seg+ter
  assert.deepEqual(fillWindow(wallFromNaive("2026-08-31T10:00")), ["2026-09-01"]);               // seg → só ter
  assert.deepEqual(fillWindow(wallFromNaive("2026-09-01T10:00")), ["2026-09-02", "2026-09-03"]); // ter → qua+qui
  assert.deepEqual(fillWindow(wallFromNaive("2026-09-02T10:00")), ["2026-09-03"]);               // qua → só qui
  assert.deepEqual(fillWindow(wallFromNaive("2026-09-03T10:00")), ["2026-09-04"]);               // qui → sex
  assert.deepEqual(fillWindow(wallFromNaive("2026-09-04T10:00")), ["2026-09-07", "2026-09-08"]); // sex → seg+ter da semana seguinte
  assert.deepEqual(fillWindow(wallFromNaive("2026-08-30T10:00"), "day"), ["2026-08-31"]);        // modo "dia seguinte"
});

test("dayTarget: fim de semana não tem agenda (alvo zero)", () => {
  const t = dayTarget({ users: [closer("c1")], blocks: [], saas: "leverads", dayStr: "2026-09-05", callsPerCloser: 5 });
  assert.equal(t.target, 0);
});

test("bookedCallsFor: conta call de amanhã, ignora follow-up, outro produto e outros dias", () => {
  const products = [{ id: "leverads", funnel: FUNNEL }];
  const leads = [
    { id: "l1", saas: "leverads", stage: "Call agendada", callAt: `${AMANHA}T09:00` },
    { id: "l2", saas: "leverads", stage: "Call agendada", callAt: `${AMANHA}T14:00` },
    { id: "l3", saas: "leverads", stage: "Follow-up", callAt: `${AMANHA}T10:00` }, // não ocupa agenda
    { id: "l4", saas: "leverads", stage: "Call agendada", callAt: "2026-09-02T09:00" }, // depois de amanhã: fora da conta
    { id: "l5", saas: "uniquekids", stage: "Call agendada", callAt: `${AMANHA}T09:00` },
    { id: "l6", saas: "leverads", stage: "Call agendada", callAt: "" },
  ];
  assert.equal(bookedCallsFor({ leads, products, saas: "leverads", dayStr: AMANHA }), 2);
});

test("costPerCall: gasto da janela ÷ calls da coorte de origem Meta", () => {
  const mkLead = (i, { callAt = "", days = 3, utm = { source: "meta", medium: "paid" } } = {}) => ({
    id: `l${i}`, saas: "leverads", utm, callAt,
    createdAt: new Date(SEG.getTime() + 3 * 3_600_000 - days * 86_400_000).toISOString(), // volta pro relógio real
  });
  const leads = [
    mkLead(1, { callAt: "2026-08-28T10:00" }),
    mkLead(2, { callAt: "2026-08-29T10:00" }),
    mkLead(3),
    mkLead(4, { days: 20, callAt: "2026-08-12T10:00" }), // fora da janela de 14d
    mkLead(5, { utm: {} }), // origem direta: fora da coorte
  ];
  const insights = [
    { id: "a", saas: "leverads", date: "2026-08-29", spend: 250 },
    { id: "b", saas: "leverads", date: "2026-08-30", spend: 110 },
    { id: "c", saas: "leverads", date: "2026-08-01", spend: 999 }, // fora da janela
    { id: "d", saas: "uniquekids", date: "2026-08-30", spend: 50 },
  ];
  const c = costPerCall({ leads, insights, saas: "leverads", now: SEG, windowDays: 14 });
  assert.equal(c.leads, 3);
  assert.equal(c.calls, 2);
  assert.equal(c.spend, 360);
  assert.equal(c.costPerCall, 180);
});

test("sanitizeRules: clampa parâmetros e normaliza dias", () => {
  const r = sanitizeRules({
    agendaFull: { enabled: 1, callsPerCloser: 99 },
    weekendOff: { enabled: true, days: [5, 5, "6", 9] },
    shortFriday: { enabled: true, lastCallHour: 23 },
    budget: { enabled: true, maxStepPct: 300, windowDays: 2 },
  });
  assert.equal(r.agendaFull.callsPerCloser, 20);
  assert.deepEqual(r.weekendOff.days, [5, 6]);
  assert.equal(r.shortFriday.lastCallHour, 19);
  assert.equal(r.budget.maxStepPct, 50);
  assert.equal(r.budget.windowDays, 7);
});

// ── Sexta curta ─────────────────────────────────────────────────────────────

test("syncShortFridayBlock: cria o bloqueio semanal com os closers, atualiza e remove", async () => {
  const repo = await seedRepo({ users: [closer("c1"), closer("c2")] });
  const users = await repo.list("users");
  assert.equal(await syncShortFridayBlock(repo, { saas: "leverads", rule: { enabled: true, lastCallHour: 14 }, users }), "criado");
  const b = await repo.get("agenda_blocks", "agb_sexta_curta_leverads");
  assert.equal(b.recur, "weekly");
  assert.equal(b.weekday, 5);
  assert.equal(b.fromHour, 15); // call de 14h ocupa até 15h
  assert.deepEqual(b.users, ["c1", "c2"]);
  // Mesmo estado = não regrava; hora nova = atualiza.
  assert.equal(await syncShortFridayBlock(repo, { saas: "leverads", rule: { enabled: true, lastCallHour: 14 }, users }), null);
  assert.equal(await syncShortFridayBlock(repo, { saas: "leverads", rule: { enabled: true, lastCallHour: 12 }, users }), "atualizado");
  assert.equal((await repo.get("agenda_blocks", "agb_sexta_curta_leverads")).fromHour, 13);
  // Desligou = bloqueio some na hora.
  assert.equal(await syncShortFridayBlock(repo, { saas: "leverads", rule: { enabled: false }, users }), "removido");
  assert.equal(await repo.get("agenda_blocks", "agb_sexta_curta_leverads"), null);
});

test("quinta mira a sexta CURTA: capacidade cai pros inícios até a última call", async () => {
  const users = [closer("c1")];
  const repo = await seedRepo({ users });
  await syncShortFridayBlock(repo, { saas: "leverads", rule: { enabled: true, lastCallHour: 14 }, users });
  const blocks = await repo.list("agenda_blocks");
  // Sexta 04/09 com bloqueio 15h→21h: sobram 9h, 10h, 11h, 13h e 14h.
  const t = dayTarget({ users, blocks, saas: "leverads", dayStr: "2026-09-04", callsPerCloser: 5 });
  assert.equal(t.capacity, 5);
  assert.equal(t.target, 5);
});

// ── O tick ──────────────────────────────────────────────────────────────────

test("agenda cheia pausa TODAS as ativas, não repausa, não religa no meio do dia e religa na virada", async () => {
  const users = [closer("c1")];
  const lead = (i, callAt) => ({ id: `l${i}`, saas: "leverads", stage: "Call agendada", callAt });
  const repo = await seedRepo({
    users,
    leads: [lead(1, `${AMANHA}T09:00`)],
    config: { rules: rules({ agendaFull: { enabled: true, callsPerCloser: 1 } }) },
  });
  const meta = makeFakeMeta({ campaigns: [
    { id: "c_on", status: "ACTIVE" },
    { id: "c_off", status: "PAUSED" }, // pausada pelo Leo: a regra não toca
  ] });

  // 1 closer × 1 call = alvo 1; 1 call marcada → pausa só a ativa.
  await adDeliveryTick(repo, { meta, now: SEG });
  assert.deepEqual(meta.calls.status, [{ id: "c_on", status: "PAUSED" }]);
  let cfg = await loadDeliveryCfg(repo, "leverads");
  assert.deepEqual(cfg.state.pausedCampaigns, ["c_on"]);
  assert.equal(cfg.state.agendaPausedDay, "2026-08-31");

  // Mesmo dia: nada de novo (nem repausa, nem religa).
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-08-31T15:00") });
  assert.equal(meta.calls.status.length, 1);

  // Cancelaram a call (agenda esvaziou): decisão do Leo — NÃO religa no dia.
  await repo.update("leads", "l1", { callAt: "" });
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-08-31T16:00") });
  assert.equal(meta.calls.status.length, 1);

  // Virada (terça 00:05): religa exatamente o que a regra pausou.
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-01T00:05") });
  assert.deepEqual(meta.calls.status[1], { id: "c_on", status: "ACTIVE" });
  cfg = await loadDeliveryCfg(repo, "leverads");
  assert.deepEqual(cfg.state.pausedCampaigns, []);
  assert.equal(meta.campaigns.find((c) => c.id === "c_off").status, "PAUSED", "campanha pausada na mão continua pausada");
});

test("domingo com par seg/ter: segunda lotada NÃO pausa enquanto a terça tem buraco; terça enchendo, pausa", async () => {
  const users = [closer("c1")];
  const repo = await seedRepo({
    users,
    // callsPerCloser 2 → alvo 2 por dia, janela seg+ter = 4. Segunda com 3
    // marcadas (acima do alvo DELA) e terça vazia: 3/4, segue rodando.
    leads: ["09:00", "10:00", "11:00"].map((h, i) => (
      { id: `s${i}`, saas: "leverads", stage: "Call agendada", callAt: `2026-08-31T${h}` })),
    config: { rules: rules({ agendaFull: { enabled: true, callsPerCloser: 2 } }) },
  });
  const meta = makeFakeMeta({ campaigns: [{ id: "c1", status: "ACTIVE" }] });

  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-08-30T10:00") }); // domingo
  assert.equal(meta.calls.status.length, 0, "3/4 na janela: continua rodando pra encher a terça");

  await repo.create("leads", { id: "s9", saas: "leverads", stage: "Call agendada", callAt: "2026-09-01T09:00" });
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-08-30T12:00") });
  assert.deepEqual(meta.calls.status, [{ id: "c1", status: "PAUSED" }]);
  const cfg = await loadDeliveryCfg(repo, "leverads");
  assert.match(cfg.log[0].detail, /janela \(31\/08 \+ 01\/09\) com 4\/4 calls/);
});

test("janela de fim de semana: pausa na sexta, fica quieto no sábado, religa domingo 00:00", async () => {
  const repo = await seedRepo({
    users: [closer("c1")],
    config: { rules: rules({ weekendOff: { enabled: true, days: [5, 6] } }) },
  });
  const meta = makeFakeMeta({ campaigns: [{ id: "c1", status: "ACTIVE" }] });

  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-04T00:02") }); // sexta
  assert.deepEqual(meta.calls.status, [{ id: "c1", status: "PAUSED" }]);

  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-04T12:00") }); // sexta de novo
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-05T10:00") }); // sábado
  assert.equal(meta.calls.status.length, 1, "uma pausa só, sem brigar com religada manual");

  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-06T00:02") }); // domingo
  assert.deepEqual(meta.calls.status[1], { id: "c1", status: "ACTIVE" });
});

test("quinta à tarde: agenda curta de sexta enche e a pausa emenda na janela até domingo", async () => {
  const users = [closer("c1")];
  const leads = ["09:00", "10:00", "11:00", "13:00", "14:00"].map((h, i) => (
    { id: `l${i}`, saas: "leverads", stage: "Call agendada", callAt: `2026-09-04T${h}` }));
  const repo = await seedRepo({
    users, leads,
    config: { rules: rules({
      agendaFull: { enabled: true, callsPerCloser: 5 },
      weekendOff: { enabled: true, days: [5, 6] },
      shortFriday: { enabled: true, lastCallHour: 14 },
    }) },
  });
  const meta = makeFakeMeta({ campaigns: [{ id: "c1", status: "ACTIVE" }] });

  // Quinta 15h: sexta curta tem 5 lugares, os 5 estão marcados → pausa.
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-03T15:00") });
  assert.deepEqual(meta.calls.status, [{ id: "c1", status: "PAUSED" }]);

  // Sexta e sábado: janela morta segura a volta.
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-04T08:00") });
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-05T08:00") });
  assert.equal(meta.calls.status.length, 1);

  // Domingo 00:02: religa pra encher a segunda.
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-09-06T00:02") });
  assert.deepEqual(meta.calls.status[1], { id: "c1", status: "ACTIVE" });
});

test("orçamento: fator proporcional rumo ao alvo com trava de +25%, uma vez por dia", async () => {
  const users = [closer("c1"), closer("c2")]; // alvo = 10
  const mkLead = (i, callAt) => ({
    id: `m${i}`, saas: "leverads", utm: { source: "meta", medium: "paid" }, callAt,
    createdAt: new Date(SEG.getTime() + 3 * 3_600_000 - 2 * 86_400_000).toISOString(),
  });
  const repo = await seedRepo({
    users,
    // 5 calls da coorte Meta (custo/call = 900/5 = 180) — nenhuma amanhã.
    leads: [1, 2, 3, 4, 5].map((i) => mkLead(i, `2026-08-2${i}T10:00`)),
    insights: [{ id: "i1", saas: "leverads", date: "2026-08-29", spend: 900 }],
    config: { rules: rules({ budget: { enabled: true, maxStepPct: 25, windowDays: 14 } }) },
  });
  const meta = makeFakeMeta({
    campaigns: [
      { id: "cbo", status: "ACTIVE", dailyBudget: 100 },     // CBO
      { id: "abo", status: "ACTIVE", dailyBudget: null },    // ABO: orçamento nos conjuntos
      { id: "morta", status: "PAUSED", dailyBudget: 500 },   // pausada na mão: fora
    ],
    adsets: [
      { id: "s1", campaignId: "abo", status: "ACTIVE", dailyBudget: 60 },
      { id: "s2", campaignId: "abo", status: "PAUSED", dailyBudget: 40 },
      { id: "s3", campaignId: "morta", status: "ACTIVE", dailyBudget: 30 },
    ],
  });

  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-08-31T00:03") });
  // Alvo: 10 vagas × R$180 = R$1.800 >> total R$160 → trava em +25%.
  assert.deepEqual(meta.calls.budget, [
    { id: "cbo", dailyBudget: 125 },
    { id: "s1", dailyBudget: 75 },
  ]);

  // Segundo tick do dia: orçamento não mexe de novo.
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-08-31T09:00") });
  assert.equal(meta.calls.budget.length, 2);
});

test("orçamento: agenda de amanhã já cheia derruba o alvo e o fator DESCE (trava -25%)", async () => {
  const users = [closer("c1")]; // alvo 5
  const mkLead = (i, callAt) => ({
    id: `m${i}`, saas: "leverads", utm: { source: "meta", medium: "paid" }, callAt,
    createdAt: new Date(SEG.getTime() + 3 * 3_600_000 - 2 * 86_400_000).toISOString(),
  });
  const repo = await seedRepo({
    users,
    leads: [
      ...[1, 2, 3].map((i) => mkLead(i, `2026-08-2${i}T10:00`)),
      // Amanhã lotada (5 calls de leads antigos, fora da coorte de custo).
      ...[9, 10, 11, 13, 14].map((h, i) => ({ id: `b${i}`, saas: "leverads", stage: "Call agendada", callAt: `${AMANHA}T${String(h).padStart(2, "0")}:00` })),
    ],
    insights: [{ id: "i1", saas: "leverads", date: "2026-08-29", spend: 540 }],
    config: { rules: rules({ budget: { enabled: true, maxStepPct: 25, windowDays: 14 } }) },
  });
  const meta = makeFakeMeta({ campaigns: [{ id: "cbo", status: "ACTIVE", dailyBudget: 100 }] });
  await adDeliveryTick(repo, { meta, now: wallFromNaive("2026-08-31T00:03") });
  assert.deepEqual(meta.calls.budget, [{ id: "cbo", dailyBudget: 75 }]);
});

test("orçamento sem base (menos de 3 calls na janela): pula e explica no log", async () => {
  const repo = await seedRepo({
    users: [closer("c1")],
    insights: [{ id: "i1", saas: "leverads", date: "2026-08-29", spend: 500 }],
    config: { rules: rules({ budget: { enabled: true } }) },
  });
  const meta = makeFakeMeta({ campaigns: [{ id: "cbo", status: "ACTIVE", dailyBudget: 100 }] });
  await adDeliveryTick(repo, { meta, now: SEG });
  assert.equal(meta.calls.budget.length, 0);
  const cfg = await loadDeliveryCfg(repo, "leverads");
  assert.equal(cfg.log[0].rule, "budget");
  assert.equal(cfg.log[0].action, "pulou");
  assert.equal(cfg.state.lastBudgetDay, "2026-08-31");
});

test("tudo desligado e sem config: o tick não toca na Meta nem cria registro", async () => {
  const repo = await seedRepo({ users: [closer("c1")] });
  const meta = makeFakeMeta({ campaigns: [{ id: "c1", status: "ACTIVE" }] });
  const report = await adDeliveryTick(repo, { meta, now: SEG });
  assert.equal(report.leverads.skipped, true);
  assert.equal(meta.calls.status.length + meta.calls.budget.length, 0);
  assert.equal(await repo.get("app_config", "ad_delivery_leverads"), null);
});

// ── Rotas ───────────────────────────────────────────────────────────────────

test("GET/PUT delivery-rules: devolve prévia, sanitiza e mantém o bloqueio de sexta", async () => {
  const repo = await seedRepo({ users: [closer("c1"), closer("c2")] });
  const app = Fastify();
  registerAdDeliveryRoutes(app, repo, { meta: makeFakeMeta() });

  const g = await app.inject({ method: "GET", url: "/api/marketing/leverads/delivery-rules" });
  assert.equal(g.statusCode, 200);
  const got = g.json();
  assert.equal(got.rules.agendaFull.enabled, false);
  assert.equal(got.rules.agendaFull.horizon, "pair");
  // A prévia usa o relógio REAL: a janela tem 1 ou 2 dias conforme o dia da
  // semana em que o teste roda — 2 closers × 10 inícios por dia da janela.
  assert.ok(Array.isArray(got.preview.window) && got.preview.window.length >= 1);
  assert.match(String(got.preview.window[0]), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(got.preview.capacity, got.preview.window.length * 20);
  assert.equal(got.preview.booked, 0);

  const p = await app.inject({
    method: "PUT", url: "/api/marketing/leverads/delivery-rules",
    payload: { rules: rules({ shortFriday: { enabled: true, lastCallHour: 14 }, agendaFull: { enabled: true, callsPerCloser: 50 } }) },
  });
  assert.equal(p.statusCode, 200);
  const saved = p.json();
  assert.equal(saved.rules.agendaFull.callsPerCloser, 20); // clampado
  const b = await repo.get("agenda_blocks", "agb_sexta_curta_leverads");
  assert.deepEqual(b.users, ["c1", "c2"]);

  // Desligar a sexta curta pela rota remove o bloqueio na hora.
  await app.inject({
    method: "PUT", url: "/api/marketing/leverads/delivery-rules",
    payload: { rules: rules({ shortFriday: { enabled: false } }) },
  });
  assert.equal(await repo.get("agenda_blocks", "agb_sexta_curta_leverads"), null);

  const missing = await app.inject({ method: "GET", url: "/api/marketing/nada/delivery-rules" });
  assert.equal(missing.statusCode, 404);
});
