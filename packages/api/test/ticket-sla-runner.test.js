import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { createTicket, patchTicket, saveSettings } from "../src/tickets-core.js";
import { startTicketSla } from "../src/ticket-sla-runner.js";

async function setup() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "alpha", name: "Alpha" });
  await repo.create("users", { id: "lia", name: "Lia", roles: ["support"], supportSaas: ["alpha"] });
  await repo.create("users", { id: "mia", name: "Mia", roles: ["support"], supportSaas: ["alpha"] });
  await repo.create("users", { id: "beto", name: "Beto", roles: ["support"], supportSaas: ["beta"] });
  await saveSettings(repo, "alpha", { businessHours: { enabled: true, hourStart: 8, hourEnd: 18 }, autoCloseResolvedDays: 2 });
  const job = startTicketSla(repo, { autoStart: false });
  return { repo, job };
}
const at = (s) => new Date(s);
const slaNotes = async (repo, user) => (await repo.listWhere("notifications", { user })).filter((n) => /ticket_sla/.test(n.type));

test("aviso a 80% e estouro sem duplicar, só pra quem atende", async () => {
  const { repo, job } = await setup();
  // seg 14/09/2026 09:00 BRT, urgente: 1ª resposta em 60 min
  const tk = await createTicket(repo, { saas: "alpha", subject: "Fora do ar", priority: "urgent" }, { now: "2026-09-14T12:00:00.000Z" });

  let r = await job.tick(at("2026-09-14T12:20:00.000Z"));
  assert.equal(r.warned, 0);

  r = await job.tick(at("2026-09-14T12:50:00.000Z"));
  assert.equal(r.warned, 2, "sem responsável: os dois atendentes do produto");
  assert.equal((await slaNotes(repo, "beto")).length, 0);
  r = await job.tick(at("2026-09-14T12:55:00.000Z"));
  assert.equal(r.warned, 0, "mesmo aviso não repete");

  r = await job.tick(at("2026-09-14T13:05:00.000Z"));
  assert.equal(r.breached, 1);
  const saved = await repo.get("tickets", tk.id);
  assert.equal(saved.sla.breached.firstResponse, true);
  assert.ok((await repo.listWhere("ticket_events", { ticket: tk.id })).some((e) => e.type === "sla_breached"));
  assert.deepEqual((await slaNotes(repo, "lia")).map((n) => n.type).sort(), ["ticket_sla_breach", "ticket_sla_warning"]);
  r = await job.tick(at("2026-09-14T13:10:00.000Z"));
  assert.equal(r.breached, 0, "estouro gravado uma vez");
  assert.equal((await slaNotes(repo, "lia")).length, 2);

  // com responsável, só ele recebe
  await patchTicket(repo, tk.id, { assignee: "mia" }, { now: "2026-09-14T13:10:00.000Z" });
  const tk2 = await createTicket(repo, { saas: "alpha", subject: "Outro", priority: "urgent", assignee: "mia" }, { now: "2026-09-14T13:00:00.000Z" });
  await job.tick(at("2026-09-14T13:50:00.000Z"));
  const forTk2 = async (u) => (await slaNotes(repo, u)).filter((n) => n.task === tk2.id).length;
  assert.equal(await forTk2("mia"), 1);
  assert.equal(await forTk2("lia"), 0);
});

test("fora do expediente grava o estouro mas não avisa; resolvido fecha sozinho", async () => {
  const { repo, job } = await setup();
  // sex 18/09 17:30 BRT, urgente: vence seg 08:30 BRT
  const tk = await createTicket(repo, { saas: "alpha", subject: "Sexta", priority: "urgent" }, { now: "2026-09-18T20:30:00.000Z" });
  await patchTicket(repo, tk.id, { status: "open" }, { now: "2026-09-18T20:31:00.000Z" });
  let r = await job.tick(at("2026-09-21T11:40:00.000Z")); // seg 08:40 BRT: estourado, no expediente
  assert.equal(r.breached, 1);
  assert.equal((await slaNotes(repo, "lia")).length, 1);

  const night = await createTicket(repo, { saas: "alpha", subject: "Madrugada", priority: "urgent" }, { now: "2026-09-21T11:40:00.000Z" });
  r = await job.tick(at("2026-09-22T05:00:00.000Z")); // ter 02:00 BRT
  assert.equal((await repo.get("tickets", night.id)).sla.breached.firstResponse, true);
  assert.equal((await slaNotes(repo, "lia")).filter((n) => n.task === night.id).length, 0, "ninguém é acordado às 2h");

  await patchTicket(repo, tk.id, { status: "resolved" }, { now: "2026-09-22T12:00:00.000Z" });
  r = await job.tick(at("2026-09-23T12:00:00.000Z"));
  assert.equal(r.closed, 0);
  r = await job.tick(at("2026-09-24T12:00:01.000Z"));
  assert.equal(r.closed, 1);
  const closed = await repo.get("tickets", tk.id);
  assert.equal(closed.status, "closed");
  assert.ok(closed.closedAt);
});
