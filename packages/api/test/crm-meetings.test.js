// Call de venda como registro (crm/meetings.js): espelho dos campos de call do
// lead com estado — agendada, realizada, no-show, remarcada — idempotente, e o
// placar por closer.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { MEETINGS, meetingsReport, runMeetingsSweep, syncLeadMeetings } from "../src/crm/meetings.js";

const { registerRoutes } = await import("../src/routes.js");
const now = Date.parse("2026-10-20T15:00:00Z");

test("call futura = agendada; remarcar antes de acontecer marca a velha como remarcada", async () => {
  const repo = makeMemRepo();
  const lead = await repo.create("leads", { id: "l1", saas: "leverads", callAt: "2026-10-22T10:00", closer: "leo", callUrl: "https://meet.google.com/a" });
  await syncLeadMeetings(repo, lead, { now });
  let rows = await repo.list(MEETINGS);
  assert.deepEqual(rows.map((m) => [m.status, m.closer, m.meetUrl]), [["agendada", "leo", "https://meet.google.com/a"]]);
  assert.equal(rows[0].at, "2026-10-22T13:00:00.000Z", "hora de Brasília");

  await syncLeadMeetings(repo, await repo.update("leads", "l1", { callAt: "2026-10-23T11:00" }), { now });
  rows = (await repo.list(MEETINGS)).sort((a, b) => a.at.localeCompare(b.at));
  assert.deepEqual(rows.map((m) => m.status), ["remarcada", "agendada"]);
  assert.equal((await syncLeadMeetings(repo, await repo.get("leads", "l1"), { now })).written, 0, "sem mudança, não regrava");
});

test("call que passou = realizada; lead no no-show depois do horário = no_show; histórico conta como realizada", async () => {
  const repo = makeMemRepo();
  const lead = await repo.create("leads", { id: "l2", callAt: "2026-10-20T09:00", stage: "No show", stageSince: "2026-10-20T13:30:00Z", closer: "leo",
    callHistory: [{ at: "2026-10-10T10:00", closer: "ana" }] });
  await syncLeadMeetings(repo, lead, { now });
  const rows = (await repo.list(MEETINGS)).sort((a, b) => a.at.localeCompare(b.at));
  assert.deepEqual(rows.map((m) => [m.status, m.closer]), [["realizada", "ana"], ["no_show", "leo"]]);
});

test("placar por closer com taxa de comparecimento", async () => {
  const repo = makeMemRepo();
  for (const [i, closer, status] of [[1, "leo", "realizada"], [2, "leo", "realizada"], [3, "leo", "no_show"], [4, "ana", "agendada"]]) {
    await repo.create(MEETINGS, { id: `m${i}`, closer, status, at: `2026-10-1${i}T10:00:00.000Z`, saas: "leverads" });
  }
  const r = await meetingsReport(repo, { from: "2026-10-01", to: "2026-11-01" });
  assert.deepEqual(r.closers.map((c) => [c.closer, c.total, c.comparecimento]), [["leo", 3, 67], ["ana", 1, null]]);
});

test("pelo app: PATCH do callAt cria o registro; a rotina pega o lead gravado direto (robô)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo", kind: "novo" }, { stage: "Call", kind: "call" }] });
  await repo.create("leads", { id: "l3", saas: "leverads", stage: "Novo" });
  const app = Fastify();
  registerRoutes(app, repo);
  const r = await app.inject({ method: "PATCH", url: "/api/leads/l3", payload: { stage: "Call", callAt: "2099-01-05T10:00" } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await app.inject({ url: "/api/leads/l3/meetings" })).json().meetings[0].status, "agendada");

  await repo.create("leads", { id: "l4", saas: "leverads", callAt: "2099-01-06T10:00", closer: "bot" });
  assert.equal((await runMeetingsSweep(repo)).written, 1, "só o lead novo; o l3 já estava espelhado");
});

// Produção 22/10/2026: callHistory com o mesmo horário da call atual (ou o
// mesmo horário duas vezes) criava o mesmo id duas vezes, o banco recusava
// ("meetings_pkey") e a rotina parava inteira nesse lead, a cada 15 min.
test("horário repetido no histórico vira uma call só (a atual vence) e um lead com erro não para a rotina", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "dup", callAt: "2026-10-22T10:00", closer: "leo", callUrl: "https://meet.google.com/x",
    callHistory: [{ at: "2026-10-22T10:00", closer: "ana" }, { at: "2026-10-18T09:00" }, { at: "2026-10-18T09:00" }] });
  await repo.create("leads", { id: "depois", callAt: "2026-10-21T10:00", closer: "leo" });
  const r = await runMeetingsSweep(repo, { now });
  const rows = (await repo.list(MEETINGS)).sort((a, b) => a.at.localeCompare(b.at));
  assert.deepEqual(rows.map((m) => [m.lead, m.status, m.closer]), [["dup", "realizada", "leo"], ["depois", "agendada", "leo"], ["dup", "agendada", "leo"]]);
  assert.equal(r.failed, 0);

  // Um lead que quebra não impede os outros.
  const broken = makeMemRepo();
  await broken.create("leads", { id: "a", callAt: "2026-10-22T10:00" });
  await broken.create("leads", { id: "b", callAt: "2026-10-22T11:00" });
  const create = broken.create.bind(broken);
  broken.create = async (col, row) => { if (col === MEETINGS && row.lead === "a") throw new Error("falha simulada"); return create(col, row); };
  const out = await runMeetingsSweep(broken, { now });
  assert.equal(out.failed, 1);
  assert.deepEqual((await broken.list(MEETINGS)).map((m) => m.lead), ["b"]);
});
