import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { startSdrHandoffReminder } from "../src/sdr-handoff-reminder.js";

// Handoff do robô sem ninguém assumir vira aviso pra quem cuida do lead
// (raio-x 30/09: mediana de 90 min até o humano, 4 nunca atendidos).
const ISO = (s) => new Date(s).toISOString();
const NOW = new Date("2026-08-20T13:00:00Z"); // quinta, 10h BRT
const TID = "5541999990000";

async function world({ handoffAt = ISO("2026-08-20T12:15:00Z"), messages = [], lead = {} } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("users", { id: "sdr", name: "Manuela", roles: ["sdr"] });
  await repo.create("users", { id: "pl", name: "Jonathan", roles: ["closer"] });
  await repo.create("leads", { id: "L1", saas: "leverads", name: "Tiago", phone: "41999990000", owner: "sdr", closer: "pl", stage: "Qualificando", sdrLog: { handoffAt, handoffKind: "ia", handoffWhy: "pediu horário fora da agenda: quarta" }, ...lead });
  await repo.create("wa_threads", { id: TID, phone: TID, leadId: "L1", saas: "leverads" });
  let seq = 0;
  for (const m of [
    { direction: "in", text: "Tem horário na quarta?", at: ISO("2026-08-20T12:14:00Z") },
    { direction: "out", author: "sdr-bot", text: "Deixa eu reservar um horário na quarta aqui e te confirmo em minutos", at: handoffAt },
    ...messages,
  ]) await repo.create("wa_messages", { id: "m" + (++seq), thread: TID, leadId: "L1", saas: "leverads", ...m });
  return repo;
}
const runnerOf = (repo, at = NOW) => startSdrHandoffReminder(repo, { log: { warn: () => {} }, now: () => at });

test("45 min sem gente depois do handoff: aviso pro closer com o motivo; não repete na mesma janela; repete 2h depois", async () => {
  const repo = await world();
  const r = runnerOf(repo);
  assert.deepEqual(await r.tick(), { created: 1 });
  const [n] = await repo.list("notifications");
  assert.equal(n.user, "pl");
  assert.equal(n.type, "sdr_handoff");
  assert.match(n.text, /Robô entregou Tiago há 45 min e ninguém assumiu: pediu horário fora da agenda: quarta/);
  assert.deepEqual(n.link, { screen: "whatsapp", thread: TID, lead: "L1" });
  assert.deepEqual(await r.tick(), { created: 0 });
  assert.deepEqual(await r.tick(new Date("2026-08-20T15:00:00Z")), { created: 1 }, "2h45 depois: segundo aviso");
  assert.equal((await repo.list("notifications")).length, 2);
  r.stop();
});

test("humano falou depois do handoff = atendido; handoff fresco (menos de 30 min) espera; fora do expediente cala", async () => {
  const attended = await world({ messages: [{ direction: "out", author: "pl", text: "Quarta 14h pode ser?", at: ISO("2026-08-20T12:30:00Z") }] });
  assert.deepEqual(await runnerOf(attended).tick(), { created: 0 });
  const fresh = await world({ handoffAt: ISO("2026-08-20T12:50:00Z") });
  assert.deepEqual(await runnerOf(fresh).tick(), { created: 0 });
  const night = await world();
  assert.deepEqual(await runnerOf(night).tick(new Date("2026-08-21T02:00:00Z")), { created: 0 });
});

test("lead escreveu de novo enquanto esperava: o aviso diz que ele está sem resposta", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "e aí?", at: ISO("2026-08-20T12:40:00Z") }] });
  await runnerOf(repo).tick();
  assert.match((await repo.list("notifications"))[0].text, /o lead escreveu de novo e está sem resposta/);
});
