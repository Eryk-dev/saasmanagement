// Feriado nacional fecha a agenda do cockpit (Leo, 24/11/2026: "pode bloquear
// feriado na agenda manual do cockpit"). A mesma lista (shared/holidays.js)
// trava o cálculo de horários livres, a gravação da call e da integração pela
// API, a capacidade da agenda nas regras de veiculação e as grades do SPA.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { nationalHoliday, isNationalHoliday, holidayMessage } from "../src/shared/holidays.js";
import { slotsForLead, wallFromNaive } from "../src/crm/agenda-slots.js";
import { sdrSlotsForLead } from "../src/sdr/sdr-agenda.js";
import { dayCapacity } from "../src/marketing/ad-delivery.js";

const { registerRoutes } = await import("../src/routes.js");

test("feriados nacionais: fixos e móveis, lidos da data, do compromisso e da chave da grade", () => {
  assert.equal(nationalHoliday("2026-12-25"), "Natal");
  assert.equal(nationalHoliday("2026-12-25T10:00"), "Natal");
  assert.equal(nationalHoliday("2026-12-25-10-30"), "Natal");
  assert.deepEqual(["2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26", "2027-04-21", "2027-05-01", "2027-05-27", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20"].map(isNationalHoliday), Array(12).fill(true));
  assert.deepEqual(["2026-12-24", "2026-12-26", "2027-02-10", "", "amanhã", null].map(isNationalHoliday), Array(6).fill(false));
  assert.equal(holidayMessage("2026-12-25T10:00"), "25/12 é feriado nacional (Natal): a agenda não abre nesse dia");
  assert.equal(holidayMessage("2026-12-24T10:00"), "");
});

async function world() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", kind: "novo" }, { stage: "Call agendada", kind: "call" }, { stage: "Integração", kind: "integracao" }] });
  for (const u of [{ id: "leo", name: "Leonardo Parra", roles: ["closer"], compLevel: 1 }, { id: "vit", name: "Vitor Silva", roles: ["closer"], compLevel: 3 }, { id: "eryk", name: "Eryk", roles: ["integrator"] }]) await repo.create("users", u);
  return repo;
}

test("horários livres (agenda manual e robô) nunca caem em feriado; a oferta do robô anda pro dia útil seguinte", async () => {
  const repo = await world();
  // Sexta 04/09/2026; a segunda 07/09 é feriado (Independência).
  const sexta = wallFromNaive("2026-09-04T09:00");
  const manual = await slotsForLead(repo, { saas: "leverads", grade: "A", now: sexta, days: 3, limit: 0 });
  const dias = [...new Set(manual.slots.map((s) => s.at.slice(0, 10)))];
  assert.deepEqual(dias, ["2026-09-04", "2026-09-08"], "sexta e terça; a segunda de feriado não entra");
  // Robô na sexta à noite: hoje não tem mais horário e o próximo dia útil é feriado → oferece a terça.
  const noite = wallFromNaive("2026-09-04T20:30");
  const robo = await sdrSlotsForLead(repo, { saas: "leverads", grade: "A", now: noite, limit: 0, messages: [] });
  assert.ok(robo.slots.length, "o robô não fica sem oferta por causa do feriado");
  assert.ok(robo.slots.every((s) => s.at >= "2026-09-08T00:00"), JSON.stringify(robo.slots.slice(0, 3)));
});

test("capacidade da agenda nas regras de veiculação: feriado conta como dia fechado", async () => {
  const users = [{ id: "leo", name: "Leonardo Parra", roles: ["closer"], compLevel: 1 }];
  assert.ok(dayCapacity({ users, blocks: [], saas: "leverads", dayStr: "2026-09-08" }).capacity > 0);
  assert.equal(dayCapacity({ users, blocks: [], saas: "leverads", dayStr: "2026-09-07" }).capacity, 0);
});

test("API recusa (409) marcar ou mover call e integração pra feriado; o que não mudou e os outros dias passam", async (t) => {
  const repo = await world();
  await repo.create("leads", { id: "ana", saas: "leverads", name: "Ana", stage: "Novo lead", closer: "leo" });
  // Card antigo que já tinha call num feriado (antes da regra): editar outro campo não trava.
  await repo.create("leads", { id: "bia", saas: "leverads", name: "Bia", stage: "Call agendada", closer: "leo", callAt: "2026-12-25T10:00" });
  const app = Fastify();
  registerRoutes(app, repo, {});
  t.after(() => app.close());
  const patch = (id, body) => app.inject({ method: "PATCH", url: `/api/leads/${id}`, payload: body });
  let r = await patch("ana", { callAt: "2026-12-25T10:00" });
  assert.equal(r.statusCode, 409);
  assert.deepEqual([r.json().code, r.json().field], ["holiday", "callAt"]);
  assert.equal(r.json().error, "25/12 é feriado nacional (Natal): a agenda não abre nesse dia");
  assert.equal((await repo.get("leads", "ana")).callAt || "", "", "nada foi gravado");
  // Horário em ISO com fuso (cliente da API) cai no mesmo dia de Brasília.
  r = await patch("ana", { callAt: "2027-01-01T13:00:00.000Z" });
  assert.equal(r.statusCode, 409);
  r = await patch("ana", { integrationAt: "2027-02-09T10:00", integrator: "eryk" });
  assert.deepEqual([r.statusCode, r.json().field], [409, "integrationAt"]);
  assert.match(r.json().error, /Carnaval/);
  // Dia normal grava.
  r = await patch("ana", { callAt: "2026-12-28T10:00" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await repo.get("leads", "ana")).callAt, "2026-12-28T10:00");
  // Call que já estava no feriado: outro campo edita, limpar edita, mover pra outro feriado não.
  assert.equal((await patch("bia", { name: "Bia Souza", callAt: "2026-12-25T10:00" })).statusCode, 200);
  assert.equal((await patch("bia", { callAt: "2027-01-01T10:00" })).statusCode, 409);
  assert.equal((await patch("bia", { callAt: "" })).statusCode, 200);
  // Criar o card já com call em feriado também é recusado.
  r = await app.inject({ method: "POST", url: "/api/leads", payload: { id: "caio", saas: "leverads", name: "Caio", stage: "Novo lead", callAt: "2026-12-25T15:00" } });
  assert.deepEqual([r.statusCode, r.json().code], [409, "holiday"]);
});
