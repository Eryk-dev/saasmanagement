import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { recordMessage } from "../src/whatsapp/wa-store.js";

// Lead que escreve de um SEGUNDO número (raio-x 30/09): a thread sabia o lead,
// a mensagem não — 8 conversas inteiras invisíveis pras métricas.
test("mensagem em conversa já vinculada a um lead (número diferente do cadastro) herda o leadId e o produto", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "L1", saas: "leverads", name: "Osvaldo", phone: "11943563980" });
  await repo.create("wa_threads", { id: "551143213413", phone: "551143213413", leadId: "L1", saas: "leverads" });
  await recordMessage(repo, { from: "551143213413", direction: "in", text: "Sim eu fiquei um tempão aguardando" });
  await recordMessage(repo, { phone: "551143213413", direction: "out", text: "Perdão Osvaldo", author: "sdr" });
  const msgs = await repo.list("wa_messages");
  assert.equal(msgs.length, 2);
  assert.ok(msgs.every((m) => m.leadId === "L1" && m.saas === "leverads"), JSON.stringify(msgs));
});

test("lead cadastrado com o telefone da conversa continua ganhando pelo telefone (a thread não sobrepõe)", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "L2", saas: "leverads", name: "Novo", phone: "41999990000" });
  await repo.create("wa_threads", { id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" });
  await recordMessage(repo, { from: "5541999990000", direction: "in", text: "oi" });
  assert.equal((await repo.list("wa_messages"))[0].leadId, "L2");
});
