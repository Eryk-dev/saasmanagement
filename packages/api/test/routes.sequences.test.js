// Sequências (drip) — o motor auto-inscreve, envia e-mail e avança, para no
// passo de WhatsApp assistido (waiting), sai na conversão; wa-sent destrava;
// métricas atribuem conversão no funil por sequência.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { makeDripRunner } = await import("../src/drip-runner.js");
const { registerSequenceRoutes } = await import("../src/routes.sequences.js");

const PAST = "2020-01-01T00:00:00.000Z";

async function setup() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [
    { stage: "Nutrição", kind: "contato" },
    { stage: "Qualificando", kind: "qualificacao" },
    { stage: "Call", kind: "call" },
    { stage: "Ganho", kind: "ganho" },
  ] });
  await repo.create("leads", { id: "A", saas: "leverads", name: "Ana Lima", email: "ana@x.com", stage: "Nutrição" });
  await repo.create("sequences", { id: "seq1", saas: "leverads", name: "Reativação", status: "active",
    trigger: { stages: ["Nutrição"] }, exitOn: { won: true, booked: true, optOut: true },
    steps: [
      { channel: "email", subject: "Oi {{nome}}", body: "corpo pra {{nome}}", delayDays: 0 },
      { channel: "whatsapp", text: "wpp {{nome}}", delayDays: 0 },
    ] });
  const outbox = [];
  const mailer = { ready: async () => true, send: async (m) => { outbox.push(m); return { id: "m" }; } };
  const runner = makeDripRunner({ repo, mailer, log: { warn() {} } });
  return { repo, mailer, outbox, runner };
}

const enrollmentOf = async (repo, seq, lead) =>
  (await repo.list("sequence_enrollments")).find((e) => e.sequence === seq && e.lead === lead);

test("tick: auto-inscreve, envia o e-mail do passo 0 e avança pro passo 1", async () => {
  const { repo, outbox, runner } = await setup();
  const r = await runner.tick();
  assert.equal(r.enrolled, 1);
  assert.equal(r.sent, 1);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "ana@x.com");
  assert.equal(outbox[0].subject, "Oi Ana", "interpola {{nome}} no assunto");
  assert.match(outbox[0].text, /corpo pra Ana/);
  const en = await enrollmentOf(repo, "seq1", "A");
  assert.equal(en.stepIndex, 1, "avançou pro passo 1");
  assert.equal(en.status, "active");
  const acts = (await repo.list("activities")).filter((a) => a.type === "email");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.sequence, "seq1");
});

test("tick: não reinscreve o mesmo lead; passo WhatsApp vira waiting (não auto-envia)", async () => {
  const { repo, outbox, runner } = await setup();
  await runner.tick(); // passo 0 (email) → passo 1
  const r2 = await runner.tick(); // passo 1 (whatsapp) → waiting
  assert.equal(r2.enrolled, 0, "não reinscreve A");
  assert.equal(r2.waiting, 1);
  assert.equal(outbox.length, 1, "WhatsApp não é auto-enviado");
  const en = await enrollmentOf(repo, "seq1", "A");
  assert.equal(en.status, "waiting");
  assert.equal(en.pendingChannel, "whatsapp");
  assert.equal(en.stepIndex, 1, "não avança sozinho no passo assistido");
});

test("wa-sent: loga o toque e avança (encerra a sequência de 2 passos)", async () => {
  const { repo, mailer, runner } = await setup();
  await runner.tick(); await runner.tick(); // chega no waiting do passo WhatsApp
  const en = await enrollmentOf(repo, "seq1", "A");
  const app = Fastify();
  registerSequenceRoutes(app, repo, { mailer });
  const res = await app.inject({ method: "POST", url: "/api/sequences/wa-sent", payload: { enrollmentId: en.id } });
  assert.equal(res.statusCode, 200);
  const updated = res.json();
  assert.equal(updated.status, "done", "sem passo 2 → done");
  assert.equal(updated.stepIndex, 2);
  const wa = (await repo.list("activities")).filter((a) => a.type === "whatsapp");
  assert.equal(wa.length, 1);
  assert.equal(wa[0].meta.sequence, "seq1");
});

test("tick: sai da sequência quando o lead fecha (exitOn.won)", async () => {
  const { repo, outbox, runner } = await setup();
  // inscrição manual num passo vencido, e o lead JÁ fechou
  await repo.update("leads", "A", { stage: "Ganho" });
  await repo.create("sequence_enrollments", { id: "en_x", saas: "leverads", sequence: "seq1", lead: "A", status: "active", stepIndex: 0, nextRunAt: PAST, enrolledAt: PAST });
  const r = await runner.tick();
  assert.equal(r.exited, 1);
  assert.equal(outbox.length, 0, "não envia pra quem já saiu");
  const en = await repo.get("sequence_enrollments", "en_x");
  assert.equal(en.status, "exited");
  assert.equal(en.exitReason, "fechou");
});

test("metrics: conta inscritos + avançou/fechou por sequência", async () => {
  const { repo, mailer } = await setup();
  const T0 = "2026-07-01T10:00:00.000Z";
  await repo.create("sequence_enrollments", { id: "e1", saas: "leverads", sequence: "seq1", lead: "A", status: "active", stepIndex: 0, nextRunAt: T0, enrolledAt: T0 });
  await repo.create("activities", { id: "s1", saas: "leverads", lead: "A", type: "stage", meta: { from: "Nutrição", to: "Ganho" }, at: "2026-07-02T10:00:00.000Z" });
  const app = Fastify();
  registerSequenceRoutes(app, repo, { mailer });
  const res = await app.inject({ method: "GET", url: "/api/sequences/metrics/leverads" });
  assert.equal(res.statusCode, 200);
  const m = res.json().sequences.find((s) => s.id === "seq1");
  assert.equal(m.enrolled, 1);
  assert.equal(m.advanced, 1);
  assert.equal(m.won, 1);
});

test("enroll: inscreve na mão e pula quem já está inscrito", async () => {
  const { repo, mailer } = await setup();
  const app = Fastify();
  registerSequenceRoutes(app, repo, { mailer });
  const r1 = await app.inject({ method: "POST", url: "/api/sequences/seq1/enroll", payload: { leadIds: ["A"] } });
  assert.equal(r1.json().enrolled, 1);
  const r2 = await app.inject({ method: "POST", url: "/api/sequences/seq1/enroll", payload: { leadIds: ["A"] } });
  assert.equal(r2.json().enrolled, 0, "não duplica");
});
