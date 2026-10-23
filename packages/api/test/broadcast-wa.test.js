// Broadcast de WhatsApp pela API oficial (docs/PLANO-DISPAROS.md, fase 3).
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { tierLimit, broadcastDailyCap } from "../src/shared/wa-tier.js";
import { enqueueWaBroadcast, runWaBroadcastTick, waBroadcastProgress, templateParams } from "../src/marketing/broadcast-wa.js";

const { registerRoutes } = await import("../src/routes.js");

const TPL = { name: "retomada", language: "pt_BR", body: "Oi {{1}}, aqui é da {{2}}.", params: 2, header: "", vars: [{ source: "token", value: "nome" }, { source: "text", value: "LeverAds" }] };
function fakeWa({ tier = "TIER_1K", fail = () => false } = {}) {
  const sent = [];
  return {
    sent,
    configured: () => true,
    numberInfo: async () => ({ tier }),
    tokenWabaIds: async () => ["WABA1"],
    listTemplates: async () => [{ name: "retomada", language: "pt_BR" }],
    uploadMedia: async () => "MEDIA1",
    async sendTemplate(to, name, lang, components, { phoneId } = {}) {
      if (fail(to)) throw Object.assign(new Error("(#131026) Message undeliverable"), { code: 131026 });
      sent.push({ to, name, lang, components, phoneId });
      return { messageId: `wamid.B${sent.length}` };
    },
  };
}
async function seed(repo, leads) {
  await repo.create("products", { id: "leverads", name: "LeverAds", waPhoneId: "PH1", funnel: [] });
  for (const l of leads) await repo.create("leads", { saas: "leverads", ...l });
  return repo.create("campaigns", { id: "c1", saas: "leverads", name: "Retomada", channel: "whatsapp", status: "draft", wa: { template: TPL }, sent: {} });
}
const NOW = () => new Date("2026-10-22T15:00:00Z");

test("faixa do número: TIER_1K é mil (era 1), teto do disparo é 80%", () => {
  assert.equal(tierLimit("TIER_1K"), 1000);
  assert.equal(tierLimit("TIER_250"), 250);
  assert.equal(tierLimit("TIER_UNLIMITED"), Infinity);
  assert.equal(broadcastDailyCap("TIER_1K"), 800);
  assert.equal(broadcastDailyCap(""), null);
});

test("enfileirar: só quem pode receber; nada é enviado ainda", async () => {
  const repo = makeMemRepo();
  const camp = await seed(repo, [
    { id: "ok", name: "Ana Souza", phone: "11999990001" },
    { id: "semfone", name: "Bia" },
    { id: "saiu", name: "Caio", phone: "11999990002", whatsappOptOut: true },
    { id: "invalido", name: "Duda", phone: "11999990003", whatsappInvalid: true },
    { id: "semnome", name: "", phone: "11999990004" },
  ]);
  const out = await enqueueWaBroadcast(repo, camp, ["ok", "semfone", "saiu", "invalido", "semnome", "ok"]);
  assert.equal(out.queued, 1);
  assert.deepEqual(Object.fromEntries(out.skipped.map((s) => [s.leadId, s.reason])), {
    semfone: "sem telefone", saiu: "pediu para não receber", invalido: "número sem WhatsApp", semnome: "variável sem valor para este lead",
  });
  assert.equal(out.campaign.status, "sending");
  assert.equal(out.campaign.sent.ok.waStatus, "queued");
  const again = await enqueueWaBroadcast(repo, out.campaign, ["ok"]);
  assert.equal(again.queued, 0, "já na fila não entra de novo");
  await assert.rejects(() => enqueueWaBroadcast(repo, { ...camp, wa: { template: { ...TPL, header: "image" } } }, ["ok"]), /foto padrão/);
  assert.deepEqual(templateParams(TPL, { name: "Ana Souza" }, null), ["Ana", "LeverAds"]);
});

test("ciclo: envia o modelo com as variáveis, grava no Inbox e na timeline, respeita o teto e fecha o broadcast", async () => {
  const repo = makeMemRepo();
  const leads = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, name: `Lead${i} X`, phone: `1199999000${i}` }));
  const camp = await seed(repo, leads);
  await enqueueWaBroadcast(repo, camp, leads.map((l) => l.id));
  const wa = fakeWa({ tier: "TIER_250" });
  // Já saíram 198 hoje pelo mesmo número (outro broadcast): sobram 2 do teto de 200.
  const old = Object.fromEntries(Array.from({ length: 198 }, (_, i) => [`x${i}`, { whatsapp: "2026-10-22T12:00:00Z", waStatus: "sent" }]));
  await repo.create("campaigns", { id: "c0", saas: "leverads", channel: "whatsapp", status: "done", wa: { template: TPL }, sent: old });

  let r = await runWaBroadcastTick(repo, { wa, now: NOW });
  assert.equal(r.sent, 2, "para no teto diário");
  assert.deepEqual(wa.sent[0].components, [{ type: "body", parameters: [{ type: "text", text: "Lead0" }, { type: "text", text: "LeverAds" }] }]);
  assert.equal(wa.sent[0].phoneId, "PH1");
  const msg = await repo.get("wa_messages", "wamid.B1");
  assert.equal(msg.author, "disparo");
  assert.equal(msg.text, "Oi Lead0, aqui é da LeverAds.");
  const acts = (await repo.list("activities")).filter((a) => a.meta?.campaign === "c1");
  assert.equal(acts.length, 2);
  assert.equal((await repo.get("campaigns", "c1")).status, "sending");

  // Dia seguinte: o resto sai e o broadcast fecha.
  r = await runWaBroadcastTick(repo, { wa, now: () => new Date("2026-10-23T15:00:00Z") });
  assert.equal(r.sent, 3);
  const c1 = await repo.get("campaigns", "c1");
  assert.equal(c1.status, "done");
  assert.ok(c1.doneAt);
});

test("proteções: número sinalizado pausa; muita falha aciona o disjuntor", async () => {
  const repo = makeMemRepo();
  const leads = Array.from({ length: 25 }, (_, i) => ({ id: `l${i}`, name: `Lead${i}`, phone: `11988880${String(i).padStart(3, "0")}` }));
  const camp = await seed(repo, leads);
  await enqueueWaBroadcast(repo, camp, leads.map((l) => l.id));
  await repo.create("app_config", { id: "wa_health", number: { event: "FLAGGED" } });
  let r = await runWaBroadcastTick(repo, { wa: fakeWa(), now: NOW });
  assert.deepEqual(r.paused, ["c1"]);
  assert.match((await repo.get("campaigns", "c1")).pauseReason, /SINALIZADO/);

  await repo.remove("app_config", "wa_health");
  await repo.update("campaigns", "c1", { status: "sending", pauseReason: "" });
  r = await runWaBroadcastTick(repo, { wa: fakeWa({ fail: () => true }), now: NOW, perTick: 25 });
  assert.equal(r.failed, 25);
  const c1 = await repo.get("campaigns", "c1");
  assert.equal(c1.status, "paused");
  assert.match(c1.pauseReason, /25 de 25 envios recentes falharam/);
});

test("rotas: enfileira só com modelo aprovado, pausa/retoma e mostra o progresso com a entrega", async (t) => {
  const repo = makeMemRepo();
  await seed(repo, [{ id: "a", name: "Ana", phone: "11999990001" }, { id: "b", name: "Bia", phone: "11999990002" }]);
  const wa = fakeWa();
  const app = Fastify();
  registerRoutes(app, repo, { whatsapp: wa });
  t.after(() => app.close());
  const post = (url, payload) => app.inject({ method: "POST", url, ...(payload ? { payload } : {}) });

  await repo.update("campaigns", "c1", { wa: { template: { ...TPL, name: "nao_aprovado" } } });
  assert.equal((await post("/api/campaigns/c1/send-whatsapp", { leadIds: ["a"] })).statusCode, 400);
  await repo.update("campaigns", "c1", { wa: { template: TPL } });
  const q = (await post("/api/campaigns/c1/send-whatsapp", { leadIds: ["a", "b"] })).json();
  assert.deepEqual({ queued: q.queued, status: q.status }, { queued: 2, status: "sending" });

  assert.equal((await post("/api/campaigns/c1/pause")).json().status, "paused");
  assert.equal((await post("/api/campaigns/c1/pause")).statusCode, 409);
  assert.equal((await post("/api/campaigns/c1/resume")).json().status, "sending");

  await runWaBroadcastTick(repo, { wa, now: NOW });
  await repo.update("wa_messages", "wamid.B1", { status: "read" });
  const prog = (await app.inject({ url: "/api/campaigns/c1/progress" })).json();
  assert.equal(prog.status, "done");
  assert.equal(prog.read, 1);
  assert.equal(prog.sent, 1);
  assert.equal(prog.queued, 0);
  assert.deepEqual(await waBroadcastProgress(repo, { sent: {} }), { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, email: { queued: 0, sent: 0, failed: 0, skipped: 0 } });
});

test("broadcast nos dois canais: cada canal na sua fila; só conclui quando as duas esvaziam", async (t) => {
  const repo = makeMemRepo();
  await seed(repo, [{ id: "a", name: "Ana", phone: "11999990001", email: "ana@x.com" }, { id: "b", name: "Bia", email: "bia@x.com" }]);
  await repo.update("campaigns", "c1", { channel: "both", email: { subject: "Oi {{nome}}", body: "Corpo" } });
  const wa = fakeWa();
  const mails = [];
  const app = Fastify();
  registerRoutes(app, repo, { whatsapp: wa, mailer: { provider: async () => "resend", ready: async () => true, send: async (m) => { mails.push(m.to); return { id: "m" }; } } });
  t.after(() => app.close());
  const em = (await app.inject({ method: "POST", url: "/api/campaigns/c1/send-email", payload: { leadIds: ["a", "b"] } })).json();
  assert.equal(em.queued, 2);
  const q = (await app.inject({ method: "POST", url: "/api/campaigns/c1/send-whatsapp", payload: { leadIds: ["a", "b"] } })).json();
  assert.equal(q.queued, 1, "Bia não tem telefone");
  assert.equal(q.skipped[0].reason, "sem telefone");
  const r = await runWaBroadcastTick(repo, { wa, now: NOW });
  assert.equal(r.sent, 1);
  assert.equal((await repo.get("campaigns", "c1")).status, "sending", "os e-mails ainda estão na fila");
  const { runEmailBroadcastTick } = await import("../src/marketing/broadcast-email.js");
  const er = await runEmailBroadcastTick(repo, { mailer: { ready: async () => true, send: async (m) => { mails.push(m.to); return { id: "m" }; } } });
  assert.equal(er.sent, 2);
  assert.deepEqual(mails.sort(), ["ana@x.com", "bia@x.com"]);
  const c1 = await repo.get("campaigns", "c1");
  assert.equal(c1.status, "done");
  assert.ok(c1.sent.a.email && c1.sent.a.whatsapp, "Ana recebeu pelos dois");
});

test("entrega recusada depois do aceite: o webhook marca a falha no broadcast e o lead pode ser reenviado", async (t) => {
  const repo = makeMemRepo();
  const leads = [{ id: "a", name: "Ana", phone: "11999990001" }, { id: "b", name: "Bia", phone: "11999990002" }];
  const camp = await seed(repo, leads);
  await enqueueWaBroadcast(repo, camp, ["a", "b"]);
  const wa = fakeWa();
  await runWaBroadcastTick(repo, { wa, now: NOW });
  assert.equal((await repo.get("campaigns", "c1")).sent.a.waStatus, "sent");
  const app = Fastify();
  registerRoutes(app, repo, { whatsapp: wa });
  t.after(() => app.close());
  // A Meta avisa: a mensagem da Ana (wamid.B1) não foi entregue (131049).
  const hook = { entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.B1", status: "failed", errors: [{ code: 131049, title: "This message was not delivered to maintain healthy ecosystem engagement." }] }] } }] }] };
  assert.equal((await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: hook })).statusCode, 200);
  const c = await repo.get("campaigns", "c1");
  assert.equal(c.sent.a.waStatus, "failed");
  assert.match(c.sent.a.waError, /preservar o engajamento/);
  assert.equal(c.sent.b.waStatus, "sent");
  // Reenviar: a Ana volta pra fila; a Bia, que recebeu, fica de fora.
  const again = await enqueueWaBroadcast(repo, c, ["a", "b"]);
  assert.equal(again.queued, 1);
  assert.deepEqual(again.skipped, [{ leadId: "b", reason: "já recebeu" }]);
});

test("progresso reconcilia broadcast antigo: quem consta como enviado mas falhou na entrega vira falha em byLead", async (t) => {
  const repo = makeMemRepo();
  await seed(repo, [{ id: "a", name: "Ana", phone: "11999990001" }]);
  await repo.update("campaigns", "c1", { status: "done", sent: { a: { whatsapp: "2026-10-22T12:00:00Z", waStatus: "sent", waMessageId: "wamid.OLD" } } });
  await repo.create("wa_messages", { id: "wamid.OLD", thread: "5511999990001", leadId: "a", saas: "leverads", author: "disparo", direction: "out", status: "failed", error: "Message undeliverable", errorCode: 131026 });
  const app = Fastify();
  registerRoutes(app, repo, { whatsapp: fakeWa() });
  t.after(() => app.close());
  const p = (await app.inject({ method: "GET", url: "/api/campaigns/c1/progress" })).json();
  assert.equal(p.byLead.a.waStatus, "failed");
  assert.match(p.byLead.a.waError, /não recebe mensagem/);
  assert.equal(p.failed, 1);
  assert.equal(typeof p.sent, "number");
  assert.equal((await repo.get("campaigns", "c1")).sent.a.waStatus, "failed");
});
