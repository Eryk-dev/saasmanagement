// Silêncio nosso no WhatsApp (13/09/2026): o cliente falou e ninguém voltou.
// O que este teste protege: só o NOSSO silêncio vira aviso (não o dele), o
// aviso vai pra quem cuida do lead, o mesmo silêncio não avisa duas vezes e uma
// resposta nova reabre o caso.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { startWaWaitingReminder } = await import("../src/wa-waiting-reminder.js");

const AGORA = new Date("2026-09-14T17:00:00.000Z"); // 14h em Brasília, dia útil
const horasAtras = (h) => new Date(AGORA.getTime() - h * 3600 * 1000).toISOString();

async function cenario({ lastDir = "in", horas = 5, closer = "bia", status = "" } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead" }] });
  await repo.create("users", { id: "bia", name: "Bia", roles: ["sdr"] });
  await repo.create("users", { id: "vitor", name: "Vitor", roles: ["closer"] });
  await repo.create("leads", { id: "ld_1", saas: "leverads", name: "Rafael Duarte", closer, owner: "vitor", stage: "Novo lead" });
  await repo.create("wa_threads", {
    id: "wa_1", saas: "leverads", leadId: "ld_1", name: "Rafael", phone: "5541999",
    lastDir, lastAt: horasAtras(horas), lastText: "e aí, quanto fica?", unread: 1, status,
  });
  return repo;
}

test("cliente falou e ninguém voltou: avisa quem cuida do lead, uma vez só", async () => {
  const repo = await cenario({ horas: 5 });
  const r = startWaWaitingReminder(repo, { now: () => AGORA });
  const um = await r.tick(AGORA);
  assert.equal(um.created, 1);

  const [n] = await repo.list("notifications");
  assert.equal(n.user, "bia", "o closer do lead é quem recebe");
  assert.equal(n.type, "wa_waiting");
  assert.match(n.text, /Rafael Duarte respondeu no WhatsApp e ninguém voltou há 5 horas/);
  assert.deepEqual(n.link, { screen: "whatsapp", thread: "wa_1", lead: "ld_1" }, "o aviso abre a conversa");

  const dois = await r.tick(AGORA);
  assert.equal(dois.created, 0, "o mesmo silêncio não avisa de novo");
  assert.equal((await repo.list("notifications")).length, 1);
});

test("o silêncio dele não é o nosso: a gente falou por último não vira aviso", async () => {
  const repo = await cenario({ lastDir: "out", horas: 9 });
  const r = startWaWaitingReminder(repo, { now: () => AGORA });
  assert.equal((await r.tick(AGORA)).created, 0);
});

test("silêncio curto não incomoda ninguém", async () => {
  const repo = await cenario({ horas: 1 });
  const r = startWaWaitingReminder(repo, { now: () => AGORA, hours: 3 });
  assert.equal((await r.tick(AGORA)).created, 0);
});

test("conversa encerrada e lead sem dono ficam de fora", async () => {
  const encerrada = await cenario({ status: "closed" });
  const r1 = startWaWaitingReminder(encerrada, { now: () => AGORA });
  assert.equal((await r1.tick(AGORA)).created, 0, "conversa encerrada não cobra ninguém");

  const semDono = await cenario({ closer: "" });
  await semDono.update("leads", "ld_1", { owner: "" });
  const r2 = startWaWaitingReminder(semDono, { now: () => AGORA });
  assert.equal((await r2.tick(AGORA)).created, 0, "aviso pra todo mundo é aviso pra ninguém");
});

test("resposta nova reabre o caso (a chave é o instante da última mensagem dele)", async () => {
  const repo = await cenario({ horas: 5 });
  const r = startWaWaitingReminder(repo, { now: () => AGORA });
  await r.tick(AGORA);
  await repo.update("wa_threads", "wa_1", { lastAt: horasAtras(4), lastText: "oi?" });
  assert.equal((await r.tick(AGORA)).created, 1, "mensagem nova, silêncio novo");
  assert.equal((await repo.list("notifications")).length, 2);
});
