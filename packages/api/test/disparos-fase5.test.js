// Disparos, fase 5 (docs/PLANO-DISPAROS.md): passo de WhatsApp da sequência
// com modelo oficial e webhook do Resend (devolução e spam).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeDripRunner } from "../src/marketing/drip-runner.js";
import { verifySvix, applyResendEvent } from "../src/email/resend-webhook.js";

const { registerRoutes } = await import("../src/routes.js");
const TPL = { name: "retomada", language: "pt_BR", body: "Oi {{1}}!", params: 1, header: "", vars: [{ source: "token", value: "nome" }] };

function fakeWa({ configured = true } = {}) {
  const sent = [];
  return { sent, configured: () => configured, sendTemplate: async (to, name, lang, components, { phoneId } = {}) => { sent.push({ to, name, components, phoneId }); return { messageId: `wamid.S${sent.length}` }; } };
}
async function seqRepo(leads) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", waPhoneId: "PH1", funnel: [{ stage: "Nutrição", kind: "contato" }] });
  for (const l of leads) await repo.create("leads", { saas: "leverads", stage: "Nutrição", ...l });
  await repo.create("sequences", { id: "seq1", saas: "leverads", name: "Reativação", status: "active", trigger: { stages: ["Nutrição"] }, exitOn: {},
    steps: [{ channel: "whatsapp", delayDays: 0, template: TPL }, { channel: "whatsapp", delayDays: 2, text: "Oi {{nome}}, livre" }] });
  return repo;
}

test("sequência: passo de WhatsApp com modelo oficial sai sozinho; texto livre vai para a fila", async () => {
  const repo = await seqRepo([{ id: "a", name: "Ana Souza", phone: "11999990001" }, { id: "b", name: "", phone: "11999990002" }, { id: "c", name: "Caio", phone: "11999990003", whatsappOptOut: true }]);
  const wa = fakeWa();
  const runner = makeDripRunner({ repo, whatsapp: () => wa, log: { warn() {} } });
  const r = await runner.tick();
  assert.equal(r.sent, 1);
  assert.deepEqual(wa.sent[0], { to: "11999990001", name: "retomada", components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }], phoneId: "PH1" });
  assert.equal((await repo.get("wa_messages", "wamid.S1")).author, "sequencia");
  const ens = Object.fromEntries((await repo.list("sequence_enrollments")).map((e) => [e.lead, e]));
  assert.equal(ens.a.stepIndex, 1, "avançou para o passo 2");
  assert.equal(ens.b.stepIndex, 1, "sem nome para a variável: pula o passo");
  assert.equal(ens.c.stepIndex, 1, "pediu para sair: pula o passo");
  assert.equal(wa.sent.length, 1);

  // Passo 2 (texto livre) vence em 2 dias e para na fila do time.
  for (const e of Object.values(ens)) await repo.update("sequence_enrollments", e.id, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
  await runner.tick();
  assert.equal((await repo.get("sequence_enrollments", ens.a.id)).status, "waiting");
});

test("sequência: sem WhatsApp configurado o passo de modelo espera o próximo ciclo", async () => {
  const repo = await seqRepo([{ id: "a", name: "Ana", phone: "11999990001" }]);
  const runner = makeDripRunner({ repo, whatsapp: fakeWa({ configured: false }), log: { warn() {} } });
  await runner.tick();
  const [en] = await repo.list("sequence_enrollments");
  assert.equal(en.stepIndex, 0);
  assert.equal(en.status, "active");
});

const SECRET = `whsec_${Buffer.from("segredo-de-teste-do-resend-123").toString("base64")}`;
function signed(body, { secret = SECRET, ts = Math.floor(Date.now() / 1000), id = "msg_1" } = {}) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${raw}`).digest("base64");
  return { raw, headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` } };
}

test("assinatura Svix: confere, recusa adulterada e velha", () => {
  const { raw, headers } = signed({ type: "email.delivered" });
  assert.equal(verifySvix(Buffer.from(raw), headers, SECRET), true);
  assert.equal(verifySvix(Buffer.from(raw + " "), headers, SECRET), false);
  assert.equal(verifySvix(Buffer.from(raw), headers, `whsec_${Buffer.from("outro").toString("base64")}`), false);
  const old = signed({ type: "x" }, { ts: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(verifySvix(Buffer.from(old.raw), old.headers, SECRET), false);
});

test("webhook do Resend: devolução invalida o e-mail, spam descadastra, temporária não muda nada", async (t) => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", email: "Ana@Loja.com" });
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Bia", email: "bia@loja.com" });
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());
  const post = ({ raw, headers }) => app.inject({ method: "POST", url: "/api/webhooks/resend", payload: raw, headers });

  assert.equal((await post(signed({ type: "email.bounced", data: { to: ["ana@loja.com"] } }))).statusCode, 424, "sem segredo salvo");
  await repo.create("integration_secrets", { id: "email", provider: "resend", apiKey: "re_x", fromEmail: "a@b.com", webhookSecret: SECRET });
  const bad = signed({ type: "email.bounced", data: { to: ["ana@loja.com"] } });
  bad.headers["svix-signature"] = "v1,AAAA";
  assert.equal((await post(bad)).statusCode, 401);

  let r = await post(signed({ type: "email.bounced", data: { email_id: "e1", to: ["ana@loja.com"], bounce: { type: "Transient", message: "caixa cheia" } } }));
  assert.equal(r.json().updated, 0);
  r = await post(signed({ type: "email.bounced", data: { email_id: "e2", to: ["ana@loja.com"], bounce: { type: "Permanent", message: "endereço não existe" } } }));
  assert.equal(r.json().updated, 1);
  const l1 = await repo.get("leads", "l1");
  assert.equal(l1.emailInvalid, true);
  assert.equal(l1.emailInvalidReason, "endereço não existe");
  r = await post(signed({ type: "email.complained", data: { to: ["bia@loja.com"] } }));
  assert.equal(r.json().updated, 1);
  assert.equal((await repo.get("leads", "l2")).emailOptOut, true);
  const acts = (await repo.list("activities")).filter((a) => a.author === "resend");
  assert.deepEqual(acts.map((a) => a.meta.event).sort(), ["email_bounced", "email_complained"]);
  assert.equal(await applyResendEvent(repo, { type: "email.bounced", data: { to: ["ana@loja.com"] } }), 0, "já marcado não regrava");
});

test("broadcast de e-mail pula o endereço devolvido", async (t) => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ok", saas: "leverads", name: "Ok", email: "ok@x.com" });
  await repo.create("leads", { id: "dev", saas: "leverads", name: "Dev", email: "dev@x.com", emailInvalid: true });
  await repo.create("campaigns", { id: "c1", saas: "leverads", name: "Teste", channel: "email", email: { subject: "Oi", body: "Corpo" }, sent: {} });
  const sent = [];
  const app = Fastify();
  registerRoutes(app, repo, { mailer: { provider: async () => "resend", ready: async () => true, send: async (m) => { sent.push(m.to); return { id: "x" }; } } });
  t.after(() => app.close());
  const r = (await app.inject({ method: "POST", url: "/api/campaigns/c1/send-email", payload: { leadIds: ["ok", "dev"] } })).json();
  assert.equal(r.queued, 1);
  assert.equal(r.skipped.find((x) => x.leadId === "dev").reason, "e-mail devolvido");
  const { runEmailBroadcastTick } = await import("../src/marketing/broadcast-email.js");
  await runEmailBroadcastTick(repo, { mailer: { ready: async () => true, send: async (m) => { sent.push(m.to); return { id: "x" }; } } });
  assert.deepEqual(sent, ["ok@x.com"]);
});

test("fila de e-mail: muita falha pausa com o motivo; pausado não envia; retomar devolve as falhas à fila e termina", async () => {
  const { enqueueEmailBroadcast, runEmailBroadcastTick } = await import("../src/marketing/broadcast-email.js");
  const repo = makeMemRepo();
  for (let i = 0; i < 12; i++) await repo.create("leads", { id: `l${i}`, saas: "leverads", name: `Lead${i}`, email: `l${i}@x.com` });
  const camp = await repo.create("campaigns", { id: "c1", saas: "leverads", name: "Teste", channel: "email", status: "draft", email: { subject: "Oi {{nome}}", body: "Corpo" }, sent: {} });
  await enqueueEmailBroadcast(repo, camp, Array.from({ length: 12 }, (_, i) => `l${i}`));
  const failing = { ready: async () => true, send: async () => { throw new Error("Resend: The x.com domain is not verified"); } };
  let r = await runEmailBroadcastTick(repo, { mailer: failing, perTick: 12 });
  assert.equal(r.failed, 12);
  let c1 = await repo.get("campaigns", "c1");
  assert.equal(c1.status, "paused");
  assert.match(c1.pauseReason, /12 de 12 e-mails falharam .*domain is not verified/);
  // Falhou fica marcado como falha; para reenviar, enfileira de novo após corrigir.
  const sent = [];
  const ok = { ready: async () => true, send: async (m) => { sent.push(m.to); return { id: "x" }; } };
  r = await runEmailBroadcastTick(repo, { mailer: ok });
  assert.equal(r.sent, 0, "pausado não envia");
  // Retomar pela rota devolve os que falharam para a fila.
  const app = Fastify();
  registerRoutes(app, repo);
  const resumed = (await app.inject({ method: "POST", url: "/api/campaigns/c1/resume" })).json();
  await app.close();
  assert.equal(Object.values(resumed.sent).filter((s) => s.emailStatus === "queued").length, 12);
  r = await runEmailBroadcastTick(repo, { mailer: ok, perTick: 12 });
  assert.equal(r.sent, 12);
  c1 = await repo.get("campaigns", "c1");
  assert.equal(c1.status, "done");
  assert.equal((await repo.list("activities")).filter((a) => a.type === "email").length, 12);
  const again = await enqueueEmailBroadcast(repo, c1, ["l0"]);
  assert.equal(again.queued, 0, "quem já recebeu não entra de novo");
});
