import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  closerPools, slotsForLead, occupyCells, addBusinessDaysNaive, slotLabel, wallFromNaive, spreadPair,
} from "../src/agenda-slots.js";

// Quarta-feira 19/08/2026, 8h da manhã no relógio de Brasília (ver
// off-hours-duty.test.js: em ago/2026, 10=seg … 14=sex; 19 é quarta).
const NOW = wallFromNaive("2026-08-19T08:00");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Call agendada", kind: "call" },
  { stage: "Follow-up", kind: "followup" },
];

function seedRepo({ users = [], leads = [], blocks = [], consultations = [] } = {}) {
  const repo = makeMemRepo();
  const fill = async () => {
    await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
    for (const u of users) await repo.create("users", u);
    for (const l of leads) await repo.create("leads", l);
    for (const b of blocks) await repo.create("agenda_blocks", b);
    for (const c of consultations) await repo.create("consultations", c);
  };
  return { repo, fill };
}

const JR = { id: "jr", name: "Junio", roles: ["closer"], compLevel: 1 };
const PL = { id: "pl", name: "Plena", roles: ["closer"], compLevel: 2 };
const SR = { id: "sr", name: "Sensei", roles: ["closer"], compLevel: 3 };

test("closerPools separa por compLevel (sem campo = júnior) e respeita o escopo de produto", () => {
  const users = [JR, PL, SR,
    { id: "semnivel", name: "Novato", roles: ["closer"] },
    { id: "outro", name: "Ana", roles: ["closer"], saas: "uniquekids", compLevel: 3 },
    { id: "sdr", name: "Manuela", roles: ["sdr"] }];
  const pools = closerPools(users, "leverads");
  assert.deepEqual(pools.upper.map((u) => u.id), ["pl", "sr"]);
  assert.deepEqual(pools.junior.map((u) => u.id), ["jr", "semnivel"]);
  assert.equal(pools.all.length, 4); // a Ana é da UniqueKids, fica fora
});

test("occupyCells: call de 1h ocupa duas meias-horas; horário quebrado ancora e pega três", () => {
  assert.deepEqual(occupyCells("2026-08-19T14:00"), ["2026-08-19-14-00", "2026-08-19-14-30"]);
  assert.deepEqual(occupyCells("2026-08-19T14:10"), ["2026-08-19-14-00", "2026-08-19-14-30", "2026-08-19-15-00"]);
});

test("lead S/A/B vai pro pool pleno/sênior e o slot mais cedo respeita o aviso mínimo", async () => {
  const { repo, fill } = seedRepo({ users: [JR, PL, SR] });
  await fill();
  const lead = { id: "l1", saas: "leverads", accounts: "10+" }; // nota A na matriz
  const { slots, pool, grade } = await slotsForLead(repo, { lead, saas: "leverads", now: NOW, limit: 3 });
  assert.equal(grade, "A");
  assert.equal(pool, "upper");
  // 8h + 120 min de aviso = primeiro slot às 10h de hoje, de um closer de cima.
  assert.equal(slots[0].at, "2026-08-19T10:00");
  assert.ok(["pl", "sr"].includes(slots[0].closer));
  assert.ok(slots.every((s) => s.closer !== "jr"), "A/B nunca cai no júnior");
});

test("ocupação vale: call marcada, bloqueio semanal e consulta tiram o horário; follow-up não ocupa", async () => {
  const { repo, fill } = seedRepo({
    users: [PL, SR],
    leads: [
      // PL com call às 10h (ocupa 10h e 10h30) e SR bloqueado a quarta inteira.
      { id: "busy1", saas: "leverads", stage: "Call agendada", closer: "pl", callAt: "2026-08-19T10:00" },
      // Follow-up com hora marcada NÃO ocupa a agenda (regra do front).
      { id: "fup", saas: "leverads", stage: "Follow-up", closer: "pl", callAt: "2026-08-19T11:00" },
    ],
    blocks: [{ id: "b1", user: "sr", kind: "block", recur: "weekly", weekday: 3, allDay: true, reason: "quarta fora" }],
    consultations: [{ id: "c1", owner: "pl", at: "2026-08-19T10:30", durationMin: 60, status: "scheduled" }],
  });
  await fill();
  const { slots } = await slotsForLead(repo, { lead: { id: "x", saas: "leverads", accounts: "10+" }, saas: "leverads", now: NOW, limit: 4 });
  // PL: call ocupa 10h00/10h30 e a consulta das 10h30 ocupa 10h30/11h00 — o
  // primeiro slot inteiro livre dele é 11h30 (o follow-up das 11h NÃO bloqueia,
  // senão seria 12h). SR está fora a quarta inteira, então 11h30 vence o dia
  // livre dele na quinta.
  assert.equal(slots[0].at, "2026-08-19T11:30");
  assert.equal(slots[0].closer, "pl");
});

test("C/D fica no júnior; com júnior travado por mais de 1 dia útil, o pleno entra na oferta", async () => {
  const base = {
    users: [JR, PL],
    // Júnior bloqueado quarta, quinta e sexta inteiras → próximo slot dele é segunda.
    blocks: [
      { id: "b1", user: "jr", kind: "block", recur: "once", date: "2026-08-19", allDay: true },
      { id: "b2", user: "jr", kind: "block", recur: "once", date: "2026-08-20", allDay: true },
      { id: "b3", user: "jr", kind: "block", recur: "once", date: "2026-08-21", allDay: true },
    ],
  };
  const { repo, fill } = seedRepo(base);
  await fill();
  const lead = { id: "l2", saas: "leverads", accounts: "2" }; // nota D
  const r = await slotsForLead(repo, { lead, saas: "leverads", now: NOW, days: 6, limit: 6 });
  assert.equal(r.pool, "junior+upper");
  assert.equal(r.slots[0].closer, "pl", "o horário mais cedo vem do pleno (overflow por velocidade)");

  // Sem trava (júnior livre hoje): a régua estrita segura no júnior.
  const { repo: repo2, fill: fill2 } = seedRepo({ users: [JR, PL] });
  await fill2();
  const r2 = await slotsForLead(repo2, { lead, saas: "leverads", now: NOW, limit: 3 });
  assert.equal(r2.pool, "junior");
  assert.ok(r2.slots.every((s) => s.closer === "jr"));
});

test("pool vazio nunca trava: sem pleno/sênior, lead A cai em todos os closers", async () => {
  const { repo, fill } = seedRepo({ users: [JR] });
  await fill();
  const r = await slotsForLead(repo, { lead: { id: "l3", saas: "leverads", accounts: "10+" }, saas: "leverads", now: NOW, limit: 2 });
  assert.equal(r.pool, "all");
  assert.equal(r.slots[0].closer, "jr");
});

test("fim de semana fora e soma de dias úteis pula sábado/domingo", async () => {
  // Sexta 21/08 às 19h: aviso mínimo joga pra depois das 21h → primeiro slot é segunda.
  const { repo, fill } = seedRepo({ users: [PL] });
  await fill();
  const sexta = wallFromNaive("2026-08-21T19:00");
  const { slots } = await slotsForLead(repo, { lead: { id: "l4", saas: "leverads", accounts: "10+" }, saas: "leverads", now: sexta, limit: 1 });
  assert.equal(slots[0].at.slice(0, 10), "2026-08-24"); // segunda
  assert.equal(addBusinessDaysNaive("2026-08-21T10:00", 1), "2026-08-24T10:00");
});

test("slotLabel fala como gente: hoje, amanhã e dia da semana", () => {
  assert.equal(slotLabel("2026-08-19T16:00", NOW), "hoje às 16h");
  assert.equal(slotLabel("2026-08-20T09:30", NOW), "amanhã às 9h30");
  assert.equal(slotLabel("2026-08-21T10:00", NOW), "sexta às 10h");
});

test("janela de oferta do robô: fromHour 9 tira os horários de madrugador da oferta", async () => {
  const { repo, fill } = seedRepo({ users: [PL] });
  await fill();
  const cedo = wallFromNaive("2026-08-19T06:00"); // 6h BRT + aviso de 2h = 8h
  const semFiltro = await slotsForLead(repo, { lead: { id: "l", saas: "leverads", accounts: "10+" }, saas: "leverads", now: cedo, limit: 1 });
  assert.equal(semFiltro.slots[0].at, "2026-08-19T08:00", "a grade completa segue existindo pra marcação manual");
  const oferta = await slotsForLead(repo, { lead: { id: "l", saas: "leverads", accounts: "10+" }, saas: "leverads", now: cedo, limit: 1, fromHour: 9, toHour: 18.5 });
  assert.equal(oferta.slots[0].at, "2026-08-19T09:00", "o robô só oferece horário comercial confortável");
});

test("janela de oferta do robô bloqueia o almoço (12h-13h) e o par sugerido tem 2h de respiro", async () => {
  const { repo, fill } = seedRepo({ users: [PL] });
  await fill();
  const cedo = wallFromNaive("2026-08-19T06:00");
  const { slots } = await slotsForLead(repo, { lead: { id: "l", saas: "leverads", accounts: "10+" }, saas: "leverads", now: cedo, limit: 12, fromHour: 9, toHour: 18.5, lunchFrom: 12, lunchTo: 13 });
  const starts = slots.map((s) => s.at.slice(11));
  assert.ok(!starts.includes("11:30") && !starts.includes("12:00") && !starts.includes("12:30"), "call não encosta no almoço");
  assert.ok(starts.includes("11:00") && starts.includes("13:00"), "a manhã fecha às 11h e a tarde reabre às 13h");
  // Par com respiro: 9h e 11h (2h de diferença), não 9h/9h30.
  const pair = spreadPair(slots);
  assert.equal(pair[0].at, "2026-08-19T09:00");
  assert.equal(pair[1].at, "2026-08-19T11:00");
  // Sem opção espaçada, cai no adjacente.
  const apertado = spreadPair([{ at: "2026-08-19T09:00" }, { at: "2026-08-19T09:30" }]);
  assert.equal(apertado[1].at, "2026-08-19T09:30");
});
