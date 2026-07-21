// FORM → mandou o Whats: dos leads que preencheram o form, quantos dispararam
// a mensagem (thread iniciada pelo lead). A conta tem que ser JUSTA: só entra
// no denominador quem PODERIA ter mandado — tem telefone E foi criado depois
// que o número passou a receber mensagem. Lead de antes disso nunca teve a
// chance e não pode derrubar a taxa.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { waFormEngagement } = await import("../src/wa-store.js");

const NOW = new Date("2026-07-20T12:00:00.000Z").getTime();
const day = (d) => new Date(`2026-07-${String(d).padStart(2, "0")}T12:00:00.000Z`).toISOString();

async function seed() {
  const repo = makeMemRepo();
  // WhatsApp começou a receber em 15/07 (1ª mensagem inbound).
  await repo.create("wa_threads", { id: "551199990001", phone: "551199990001" });
  await repo.create("wa_messages", { id: "m1", thread: "551199990001", direction: "in", at: day(15) });
  // um lead que mandou depois (16/07)
  await repo.create("wa_threads", { id: "551199990002", phone: "551199990002" });
  await repo.create("wa_messages", { id: "m2", thread: "551199990002", direction: "in", at: day(16) });

  // Leads do form:
  await repo.create("leads", { id: "a", source: "Form · Diagnóstico", phone: "551199990001", createdAt: day(15) }); // mandou (pós-número)
  await repo.create("leads", { id: "b", source: "Form", phone: "551199990002", createdAt: day(16) });               // mandou (pós-número)
  await repo.create("leads", { id: "c", source: "Form · Diagnóstico", phone: "551199990003", createdAt: day(17) }); // não mandou (sem thread)
  // ANTES do número (10/07): não podia ter mandado → fora do denominador
  await repo.create("leads", { id: "d", source: "Form", phone: "551199990009", createdAt: day(10) });
  // sem telefone: não há como mandar → fora do denominador
  await repo.create("leads", { id: "e", source: "Form", phone: "", createdAt: day(18) });
  // não é do form: fora
  await repo.create("leads", { id: "f", source: "Indicação", phone: "551199990010", createdAt: day(18) });
  return repo;
}

test("denominador justo: só form leads com telefone e criados a partir da 1ª mensagem recebida", async () => {
  const repo = await seed();
  const r = await waFormEngagement(repo, { days: 30, now: NOW });
  // a, b, c entram (form + telefone + criados >= 15/07). d (antes do número), e
  // (sem telefone) e f (não-form) ficam de fora.
  assert.equal(r.formLeads, 3);
  assert.equal(r.formStarted, 2); // a e b mandaram; c não tem thread
  // a janela foi ancorada no 1º inbound (15/07), não no início dos 30 dias
  assert.equal(new Date(r.since).toISOString(), day(15));
});

test("sem nenhuma mensagem recebida ainda: cai na janela normal de N dias", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "a", source: "Form", phone: "5511999", createdAt: day(18) });
  const r = await waFormEngagement(repo, { days: 30, now: NOW });
  assert.equal(r.formLeads, 1);       // sem âncora de inbound, usa os 30 dias
  assert.equal(r.formStarted, 0);
});
