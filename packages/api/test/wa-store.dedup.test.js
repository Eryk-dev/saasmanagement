// Duplicata de conversa no inbox: o mesmo contato em duas grafias de número
// (com/sem o nono dígito, com/sem o 55) tem que cair numa thread SÓ. O bug era o
// recordMessage achar a thread por id EXATO dos dígitos — grafia diferente virava
// conversa nova. Agora casa pela chave normalizada (waMatchKey).

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { recordMessage, listThreads, threadId, waMatchKey } = await import("../src/wa-store.js");

test("mesmo contato em duas grafias (com/sem o 9) = UMA thread", async () => {
  const repo = makeMemRepo();
  // 1ª saída pro número COM o 9 (grafia do form)
  await recordMessage(repo, { phone: "5594999246021", direction: "out", text: "Oi Hilton, é a Manuela", author: "sdr" });
  // 2ª saída pro MESMO contato SEM o 9 (grafia legada que a Meta às vezes devolve)
  await recordMessage(repo, { phone: "559499246021", direction: "out", text: "Oiii, Hilton. recebi seu cadastro", author: "sdr" });

  const threads = await listThreads(repo);
  assert.equal(threads.length, 1, "não pode duplicar a conversa");
  const msgs = await repo.list("wa_messages");
  assert.equal(msgs.length, 2, "as duas mensagens ficam na mesma thread");
  assert.equal(new Set(msgs.map((m) => m.thread)).size, 1, "mesmo thread id nas duas");
});

test("números REALMENTE diferentes seguem em threads separadas", async () => {
  const repo = makeMemRepo();
  await recordMessage(repo, { phone: "5594999246021", direction: "out", text: "a", author: "sdr" });
  await recordMessage(repo, { phone: "5511988887777", direction: "out", text: "b", author: "sdr" });
  assert.equal((await listThreads(repo)).length, 2);
});

test("inbound depois de outbound (grafia diferente) cai na mesma thread", async () => {
  const repo = makeMemRepo();
  await recordMessage(repo, { phone: "5594999246021", direction: "out", text: "oi", author: "sdr" });
  await recordMessage(repo, { from: "559499246021", direction: "in", text: "opa" }); // Meta manda sem o 9
  const threads = await listThreads(repo);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].unread, 1, "a entrada conta como não-lida na thread única");
});
