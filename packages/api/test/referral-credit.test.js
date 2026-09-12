// Indicação: o vínculo (quem indicou × quem colheu), a cerca do cliente na base
// e o crédito do coletor (R$ 100 na reunião feita, R$ 500 no fechamento, nunca
// os dois). Régua no metrics-core, carimbo no referrals.js, 422 na rota.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  isReferralLead, isPaidReferral, leadClassOf,
  referralCredit, referralsByCollector, REFERRAL_RATES,
} from "../src/metrics-core.js";

const { registerRoutes } = await import("../src/routes.js");

const PRODUCT = { id: "leverads", funnel: [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Call closer", kind: "call" },
  { stage: "Negociação", kind: "proposta" },
  { stage: "No show", kind: "contato" },
  { stage: "Ganho", kind: "ganho" },
] };
const inSet = new Set(["2026-09"]);
const inWin = (iso) => !!iso && inSet.has(String(iso).slice(0, 7));
const witness = (at, temperatura) => ({ type: "system", at, meta: { event: "call_summary", kind: "call", summary: { temperatura } } });
const actsOf = (map) => (id) => map[id] || [];

test("isReferralLead: campo estruturado OU texto legado; isPaidReferral exige as duas pontas", () => {
  assert.equal(isReferralLead({ referredByCustomer: "cu_1" }), true);   // estruturada
  assert.equal(isReferralLead({ source: "Indicação" }), true);          // legado
  assert.equal(isReferralLead({ utm: { source: "indicacao" } }), true); // legado sem acento
  assert.equal(isReferralLead({ source: "Form · Diag" }), false);
  assert.equal(leadClassOf({ referredByCustomer: "cu_1" }), "semente"); // classe acompanha

  assert.equal(isPaidReferral({ referredByCustomer: "cu_1", referralCollectedBy: "jonan" }), true);
  assert.equal(isPaidReferral({ referredByCustomer: "cu_1" }), false);  // sem coletor não há a quem pagar
  assert.equal(isPaidReferral({ source: "Indicação", referralCollectedBy: "jonan" }), false); // texto não paga
});

test("referralCredit: fechou paga closed; testemunha quente paga meeting; fria não paga", () => {
  const paid = { id: "l1", referredByCustomer: "cu_1", referralCollectedBy: "jonan" };
  const acts = actsOf({
    quente: [witness("2026-09-10T15:00:00Z", "quente")],
    frio: [witness("2026-09-10T15:00:00Z", "frio")],
  });
  assert.equal(referralCredit(PRODUCT, { ...paid, customerId: "cu_9" }, acts, "2026-09-12", inWin), "closed");
  assert.equal(referralCredit(PRODUCT, { ...paid, id: "quente", stage: "Call closer", callAt: "2026-09-10T15:00" }, acts, "2026-09-12", inWin), "meeting");
  assert.equal(referralCredit(PRODUCT, { ...paid, id: "frio", stage: "Call closer", callAt: "2026-09-10T15:00" }, acts, "2026-09-12", inWin), null);
  // Sem as duas pontas não existe crédito, mesmo tendo fechado.
  assert.equal(referralCredit(PRODUCT, { id: "l9", source: "Indicação", customerId: "cu_9" }, acts, "2026-09-12", inWin), null);
});

test("referralsByCollector: agrupa por coletor e o fechamento entra NO LUGAR da reunião", () => {
  const leads = [
    // fechou na janela: 500 (e não soma os 100 da reunião)
    { id: "a", referredByCustomer: "cu_1", referralCollectedBy: "jonan", referralAt: "2026-09-02T12:00:00Z", customerId: "cu_x", wonAt: "2026-09-09T12:00:00Z", stage: "Ganho", callAt: "2026-09-05T15:00" },
    // reunião feita na janela: 100
    { id: "b", referredByCustomer: "cu_1", referralCollectedBy: "jonan", referralAt: "2026-09-03T12:00:00Z", stage: "Negociação", callAt: "2026-09-08T15:00" },
    // furou: nada
    { id: "c", referredByCustomer: "cu_2", referralCollectedBy: "jessica", referralAt: "2026-09-04T12:00:00Z", stage: "No show", callAt: "2026-09-08T15:00" },
    // fechou FORA da janela: sai inteiro da conta (foi pago no mês do fechamento)
    { id: "d", referredByCustomer: "cu_3", referralCollectedBy: "jessica", referralAt: "2026-08-20T12:00:00Z", customerId: "cu_y", wonAt: "2026-08-25T12:00:00Z", stage: "Ganho", callAt: "2026-09-08T15:00" },
    // indicação sem coletor: conta no funil, não na comissão
    { id: "e", referredByCustomer: "cu_4", referralAt: "2026-09-05T12:00:00Z", stage: "Negociação", callAt: "2026-09-08T15:00" },
  ];
  const by = referralsByCollector(PRODUCT, leads, actsOf({}), inWin, { today: "2026-09-12" });

  assert.deepEqual(by.get("jonan"), { collected: 2, meetings: 1, closed: 1, value: REFERRAL_RATES.closed + REFERRAL_RATES.meeting });
  assert.deepEqual(by.get("jessica"), { collected: 1, meetings: 0, closed: 0, value: 0 });
  assert.equal(by.has("e"), false);
  assert.equal(by.size, 2);
});

test("POST /api/leads: cliente indicador inexistente é 422 (a cerca contra prêmio inventado)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  const app = Fastify(); registerRoutes(app, repo); await app.ready();

  const res = await app.inject({ method: "POST", url: "/api/leads", payload: { saas: "leverads", name: "Indicado", phone: "41911110000", referredByCustomer: "cu_naoexiste" } });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, "REFERRAL_CLIENTE_INVALIDO");
  assert.equal((await repo.list("leads")).length, 0);
  await app.close();
});

test("POST /api/leads: indicação válida carimba data, coletor, origem e o evento de auditoria", async () => {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Azul Pet" });
  const app = Fastify(); registerRoutes(app, repo); await app.ready();

  const res = await app.inject({ method: "POST", url: "/api/leads", payload: {
    saas: "leverads", name: "Indicado", phone: "41911110000",
    referredByCustomer: "cu_1", referralCollectedBy: "jonan",
  } });
  assert.equal(res.statusCode, 201);
  const lead = res.json();
  assert.equal(lead.referredByCustomer, "cu_1");
  assert.equal(lead.referralCollectedBy, "jonan");
  assert.ok(lead.referralAt, "referralAt carimbado pelo servidor");
  assert.equal(lead.source, "Indicação");   // origem legível no card
  const ev = (await repo.list("activities")).find((a) => a.meta?.event === "referral_collected");
  assert.equal(ev.lead, lead.id);
  assert.equal(ev.meta.customer, "cu_1");
  assert.equal(ev.meta.collectedBy, "jonan");
  await app.close();
});

test("dedup: lead que já existia GANHA o vínculo; quem já tem não troca de dono", async () => {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Azul Pet" });
  await repo.create("customers", { id: "cu_2", saas: "leverads", name: "Dyno Nutri" });
  await repo.create("leads", { id: "l1", saas: "leverads", phone: "41999887766", name: "Zé", source: "Form · Diag" });
  const app = Fastify(); registerRoutes(app, repo); await app.ready();

  // 1ª indicação entra na mescla (o coletor não perde por a pessoa já ter preenchido o form)
  const a = await app.inject({ method: "POST", url: "/api/leads", payload: { saas: "leverads", phone: "(41) 99988-7766", name: "Zé", referredByCustomer: "cu_1", referralCollectedBy: "jonan" } });
  assert.equal(a.statusCode, 200);
  let l = await repo.get("leads", "l1");
  assert.equal(l.referredByCustomer, "cu_1");
  assert.equal(l.referralCollectedBy, "jonan");
  assert.ok((await repo.list("activities")).some((x) => x.meta?.event === "referral_collected" && x.lead === "l1"));

  // 2ª tentativa com outro cliente/coletor NÃO rouba a indicação
  await app.inject({ method: "POST", url: "/api/leads", payload: { saas: "leverads", phone: "41999887766", name: "Zé", referredByCustomer: "cu_2", referralCollectedBy: "jessica" } });
  l = await repo.get("leads", "l1");
  assert.equal(l.referredByCustomer, "cu_1");
  assert.equal(l.referralCollectedBy, "jonan");
  await app.close();
});

test("PATCH /api/leads: registra indicação depois, sem recarimbar a janela; limpar tira as 3 pontas", async () => {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Azul Pet" });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Zé", stage: "Novo lead" });
  const app = Fastify(); registerRoutes(app, repo); await app.ready();

  const r1 = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { referredByCustomer: "cu_1", referralCollectedBy: "jonan" } });
  assert.equal(r1.statusCode, 200);
  const at = r1.json().referralAt;
  assert.ok(at);

  // Reeditar o card não move a comissão de mês
  const r2 = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { referredByCustomer: "cu_1", referralCollectedBy: "jessica" } });
  assert.equal(r2.json().referralAt, at);
  assert.equal(r2.json().referralCollectedBy, "jonan"); // coletor não é sobrescrito por reedição
  assert.equal((await repo.list("activities")).filter((a) => a.meta?.event === "referral_collected").length, 1);

  // Correção: limpar o vínculo tira as três pontas juntas
  const r3 = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { referredByCustomer: "" } });
  assert.equal(r3.json().referredByCustomer, "");
  assert.equal(r3.json().referralCollectedBy, "");
  assert.equal(r3.json().referralAt, "");
  await app.close();
});

test("migração sobe o prêmio de fechamento pra R$ 500, sem pisar em ajuste da tela", async () => {
  const { migrateReferralClosedValue } = await import("../src/migrations.js");
  const { makeMemRepo: mem } = await import("./helpers/mem-repo.js");
  const repo = mem();
  await repo.create("comp_plans", { id: "cp_cs", role: "cs", plan: { referralMeeting: 100, referralClosed: 250, npsFloor: 80 } });
  await repo.create("comp_plans", { id: "cp_cs2", role: "cs", plan: { referralMeeting: 100, referralClosed: 300 } }); // valor ajustado na mão
  await repo.create("comp_plans", { id: "cp_sdr", role: "sdr", plan: { levels: [] } });

  assert.equal(await migrateReferralClosedValue(repo), 1);
  assert.equal((await repo.get("comp_plans", "cp_cs")).plan.referralClosed, 500);
  assert.equal((await repo.get("comp_plans", "cp_cs")).plan.npsFloor, 80, "o resto do plano fica intacto");
  assert.equal((await repo.get("comp_plans", "cp_cs2")).plan.referralClosed, 300, "ajuste manual não é sobrescrito");
  assert.equal(await migrateReferralClosedValue(repo), 0, "idempotente entre boots");
});
