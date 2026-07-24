// Migração que FUNDE conversas duplicadas que já existiam antes do fix do
// recordMessage. Simula o estado antigo (duas threads pro mesmo contato, cada
// grafia do número) e confere que vira uma só, sem perder mensagem nem não-lido.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureWaThreadDedup } = await import("../src/migrations.js");

// Semeia direto nas collections (bypassa o recordMessage já corrigido) pra
// reproduzir o estado duplicado que ficou em produção.
async function seedDup(repo) {
  // Thread ANTIGA (grafia sem o 9), com uma mensagem e não-lido.
  await repo.create("wa_threads", {
    id: "559499246021", phone: "559499246021", name: "", leadId: null, saas: "leverads",
    lastText: "oi legado", lastAt: "2026-07-20T10:00:00.000Z", lastDir: "in", unread: 1,
    updatedAt: "2026-07-20T10:00:00.000Z",
  });
  await repo.create("wa_messages", {
    id: "m_old", thread: "559499246021", leadId: null, saas: "leverads",
    direction: "in", text: "oi legado", at: "2026-07-20T10:00:00.000Z",
  });
  // Thread NOVA (grafia com o 9), mais recente, com nome e lead preenchidos.
  await repo.create("wa_threads", {
    id: "5594999246021", phone: "5594999246021", name: "Hilton", leadId: "le_hilton", saas: "leverads",
    lastText: "opa", lastAt: "2026-07-21T09:00:00.000Z", lastDir: "out", unread: 0,
    updatedAt: "2026-07-21T09:00:00.000Z",
  });
  await repo.create("wa_messages", {
    id: "m_new", thread: "5594999246021", leadId: "le_hilton", saas: "leverads",
    direction: "out", text: "opa", at: "2026-07-21T09:00:00.000Z",
  });
}

test("funde as duas threads do mesmo contato numa só, mantendo lead/nome/não-lido", async () => {
  const repo = makeMemRepo();
  await seedDup(repo);
  assert.equal((await repo.list("wa_threads")).length, 2, "pré-condição: duas threads");

  const merged = await ensureWaThreadDedup(repo);
  assert.equal(merged, 1, "uma duplicata fundida");

  const threads = await repo.list("wa_threads");
  assert.equal(threads.length, 1, "sobra uma conversa só");
  const t = threads[0];
  assert.equal(t.id, "5594999246021", "canônica = a mais recente");
  assert.equal(t.name, "Hilton", "nome preservado");
  assert.equal(t.leadId, "le_hilton", "vínculo com o lead preservado");
  assert.equal(t.unread, 1, "não-lido somado das duas");

  const msgs = await repo.list("wa_messages");
  assert.equal(msgs.length, 2, "nenhuma mensagem perdida");
  assert.equal(new Set(msgs.map((m) => m.thread)).size, 1, "todas na thread canônica");
  assert.ok(msgs.every((m) => m.thread === "5594999246021"), "reapontadas pra canônica");
});

test("sem duplicatas é no-op (idempotente entre boots)", async () => {
  const repo = makeMemRepo();
  await repo.create("wa_threads", { id: "5511988887777", phone: "5511988887777", updatedAt: "2026-07-21T09:00:00.000Z" });
  assert.equal(await ensureWaThreadDedup(repo), 0);
  // roda de novo depois de já ter fundido: continua no-op
  const repo2 = makeMemRepo();
  await seedDup(repo2);
  await ensureWaThreadDedup(repo2);
  assert.equal(await ensureWaThreadDedup(repo2), 0, "segunda passada não mexe em nada");
});

test("números realmente diferentes NÃO são fundidos", async () => {
  const repo = makeMemRepo();
  await repo.create("wa_threads", { id: "5594999246021", phone: "5594999246021", updatedAt: "2026-07-21T09:00:00.000Z" });
  await repo.create("wa_threads", { id: "5511988887777", phone: "5511988887777", updatedAt: "2026-07-21T09:00:00.000Z" });
  assert.equal(await ensureWaThreadDedup(repo), 0);
  assert.equal((await repo.list("wa_threads")).length, 2);
});
