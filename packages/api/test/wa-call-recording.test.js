// Gravação da ligação do WhatsApp: o browser sobe o áudio dos dois lados, o
// servidor transcreve e (com lead na conversa) resume igual à call de Meet.
// O áudio NÃO fica guardado — só o texto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerWhatsappRoutes } = await import("../src/routes.whatsapp.js");

function buildMultipart(bytes, { name = "call.webm", type = "audio/webm" } = {}) {
  const boundary = "----cockpitCallBoundary";
  const chunks = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

const AUDIO = Buffer.alloc(12 * 1024, 7); // acima do piso de 8KB

const SUMMARY = {
  resumo: "Lead quer clonar anúncios entre 3 contas.",
  temperatura: "quente", temperaturaPorque: "pediu proposta",
  dores: ["perde tempo publicando manual"], objecoes: [], compromissos: ["mandar proposta hoje"],
  followup: { nota: "mandar proposta", whatsapp: "Segue a proposta!" },
};

async function buildApp({ transcribeText = "Oi, tudo bem? ... [lead] Tudo sim.", transcribeErr = null, aiConfigured = true, calls = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("leads", { id: "l1", name: "Ruann", company: "C7", saas: "leverads", stage: "Qualificando", phone: "5541999999999" });
  await repo.create("wa_calls", {
    id: "call_1", thread: "5541999999999", phone: "5541999999999", leadId: "l1", saas: "leverads",
    status: "ended", startedAt: new Date().toISOString(),
  });
  await repo.create("wa_calls", { id: "call_sem_lead", thread: "5541988888888", phone: "5541988888888", leadId: null, saas: "leverads", status: "ended" });

  const transcriber = {
    configured: () => true,
    async transcribe(buf, opts) {
      calls.push(["transcribe", buf.length, opts.prompt]);
      if (transcribeErr) throw new Error(transcribeErr);
      return transcribeText;
    },
  };
  const anthropic = {
    configured: () => aiConfigured,
    async summarizeCall(args) { calls.push(["summarizeCall", args.transcript, args.lead.name, args.productName]); return { summary: SUMMARY }; },
  };
  const app = Fastify();
  await app.register(multipart);
  registerWhatsappRoutes(app, repo, { whatsapp: { configured: () => false }, anthropic, transcriber });
  return { app, repo, calls };
}

test("transcreve, guarda só o texto na chamada e resume na timeline do lead", async () => {
  const { app, repo, calls } = await buildApp();
  const mp = buildMultipart(AUDIO);
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/calls/call_1/recording?secs=95", payload: mp.body, headers: { "content-type": mp.contentType } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().summarized, true);

  // transcrição salva na chamada, COM a duração; áudio não fica guardado
  const call = await repo.get("wa_calls", "call_1");
  assert.match(call.transcript, /Tudo sim/);
  assert.equal(call.durationSec, 95);
  assert.ok(call.transcriptAt);
  assert.ok(!("audio" in call) && !("data" in call), "o áudio não pode ser persistido");

  // o prompt leva os nomes próprios (é onde a transcrição mais erra)
  const t = calls.find((c) => c[0] === "transcribe");
  assert.match(t[2], /LeverAds/); assert.match(t[2], /Ruann/); assert.match(t[2], /C7/);

  // resumo vira a MESMA activity que a call de Meet, marcada como vinda do Whats
  const act = (await repo.list("activities")).find((a) => a.meta?.event === "call_summary");
  assert.equal(act.lead, "l1");
  assert.equal(act.meta.kind, "call");
  assert.equal(act.meta.source, "whatsapp_call");
  assert.equal(act.meta.waCallId, "call_1");
  assert.equal(act.meta.temperatura, "quente");
  assert.match(act.text, /Lead quer clonar anúncios/);

  // dedup do Meet NÃO é tocado: a call de venda no Meet segue resumível
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.callSummaryFor, undefined);
});

test("sem lead na conversa: transcreve e para aí (nada de resumo)", async () => {
  const { app, repo } = await buildApp();
  const mp = buildMultipart(AUDIO);
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/calls/call_sem_lead/recording", payload: mp.body, headers: { "content-type": mp.contentType } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().summarized, false);
  assert.ok((await repo.get("wa_calls", "call_sem_lead")).transcript);
  assert.equal((await repo.list("activities")).length, 0);
});

test("resumo falhou: a transcrição continua salva (a ligação já aconteceu)", async () => {
  const { app, repo } = await buildApp({ aiConfigured: true });
  const failing = { configured: () => true, async summarizeCall() { throw new Error("IA fora do ar"); } };
  const app2 = Fastify();
  await app2.register(multipart);
  registerWhatsappRoutes(app2, repo, {
    whatsapp: { configured: () => false }, anthropic: failing,
    transcriber: { configured: () => true, async transcribe() { return "texto da ligação"; } },
  });
  const mp = buildMultipart(AUDIO);
  const res = await app2.inject({ method: "POST", url: "/api/whatsapp/calls/call_1/recording", payload: mp.body, headers: { "content-type": mp.contentType } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().summarized, false);
  assert.equal((await repo.get("wa_calls", "call_1")).transcript, "texto da ligação");
});

test("guardas: chamada inexistente, áudio curto, sem chave e erro da transcrição", async () => {
  const { app } = await buildApp();
  const mp = buildMultipart(AUDIO);
  const hd = { "content-type": mp.contentType };

  assert.equal((await app.inject({ method: "POST", url: "/api/whatsapp/calls/zzz/recording", payload: mp.body, headers: hd })).statusCode, 404);

  // trecho de 2KB = clique sem conversa: não gasta transcrição
  const tiny = buildMultipart(Buffer.alloc(2 * 1024, 1));
  const short = await app.inject({ method: "POST", url: "/api/whatsapp/calls/call_1/recording", payload: tiny.body, headers: { "content-type": tiny.contentType } });
  assert.equal(short.statusCode, 200);
  assert.match(short.json().skipped, /curta/);

  // sem OPENAI_API_KEY no servidor
  const { app: app3 } = await (async () => {
    const repo = makeMemRepo();
    await repo.create("wa_calls", { id: "c", thread: "1", phone: "1", saas: "", status: "ended" });
    const a = Fastify();
    await a.register(multipart);
    registerWhatsappRoutes(a, repo, { whatsapp: { configured: () => false }, transcriber: { configured: () => false, async transcribe() {} } });
    return { app: a };
  })();
  const nokey = await app3.inject({ method: "POST", url: "/api/whatsapp/calls/c/recording", payload: mp.body, headers: hd });
  assert.equal(nokey.statusCode, 424);
  assert.match(nokey.json().error, /OPENROUTER_API_KEY/);

  // a API de transcrição respondeu erro → 502 com o motivo legível
  const { app: app4 } = await buildApp({ transcribeErr: "audio muito longo" });
  const boom = await app4.inject({ method: "POST", url: "/api/whatsapp/calls/call_1/recording", payload: mp.body, headers: hd });
  assert.equal(boom.statusCode, 424);
  assert.match(boom.json().error, /audio muito longo/);
});
