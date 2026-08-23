import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { flagFailedBotSend } from "../src/wa-call-flow.js";

// Envio do robô recusado pela Meta (status failed): alerta quente único por
// lead, com o carimbo que destrava o acompanhamento humano (23/08).
test("failed do sdr-bot vira alerta uma vez; mensagem humana não dispara", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "L1", saas: "leverads", name: "Rafael" });
  await repo.create("wa_threads", { id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" });
  await repo.create("wa_messages", { id: "w1", thread: "5541999990000", leadId: "L1", direction: "out", author: "sdr-bot", status: "failed", error: "Message undeliverable", at: new Date().toISOString() });
  await repo.create("wa_messages", { id: "w2", thread: "5541999990000", leadId: "L1", direction: "out", author: "sdr", status: "failed", error: "x", at: new Date().toISOString() });

  assert.equal(await flagFailedBotSend(repo, "w1"), "L1");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /NÃO entregue/);
  assert.match(alerts[0].text, /Message undeliverable/);
  assert.ok((await repo.get("leads", "L1")).sdrLog.sendFailedAlertAt);

  // Repetição e autor humano: nada de novo.
  assert.equal(await flagFailedBotSend(repo, "w1"), null);
  assert.equal(await flagFailedBotSend(repo, "w2"), null);
  assert.equal((await repo.list("wa_alerts")).length, 1);
});
