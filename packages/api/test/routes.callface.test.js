// POST /api/webhooks/callface: a ligação encerrada na Callface vira toque `call`
// na timeline do lead (casado por deal_id ou telefone), com autor pelo e-mail,
// sem duplicar e sem derrubar quando o lead não existe.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeCallface, callfaceActivityText, parseCallfacePayload } = await import("../src/calls/callface.js");

const SECRET = "cf-secret-123";
const PATH = "/api/webhooks/callface";

async function build({ secret = SECRET } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [
      { stage: "Novo lead", kind: "novo", cadence: { firstTouchHours: 2 } },
      { stage: "Qualificando", kind: "qualificacao", cadence: { retryDays: 2 } },
      { stage: "Call agendada", kind: "call" },
      { stage: "Ganho", kind: "ganho" },
      { stage: "Perdido", kind: "perdido" },
    ],
  });
  await repo.create("users", { id: "ana", name: "Ana", roles: ["sdr"], email: "Ana@Empresa.com" });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Loja Um", phone: "+55 41 98888-0000", stage: "Novo lead", createdAt: "2026-10-01T10:00:00.000Z" });
  const app = Fastify();
  registerRoutes(app, repo, { callface: makeCallface({ secret }) });
  await app.ready();
  return { app, repo };
}

function payload(over = {}) {
  return {
    deal_id: "l1", contact_id: "c1", call_date: "2026-10-29T14:40:56.441Z",
    summarization: "**Resumo**\n- Lead quer escalar anúncios\n- Call marcada pra quinta",
    transcription: [{ speaker: "agent", text: "oi" }],
    call_link: "https://app.callface.ai/calls/abc123", call_duration: 125,
    call_audio_url: "https://storage.callface.ai/abc123.mp3",
    user_email: "ana@empresa.com", user_name: "Ana Silva",
    destination_number: "+5541988880000", credentials: [], call_status: "FINISHED",
    deal_closure_percentage: 72,
    scheduling: { has_scheduling: true, items: [{ category: "Agendar Reunião", communication_type: "reuniao-online-meet", date: "2026-11-05", status: "Combinado" }] },
    ...over,
  };
}

function post(app, body, { signature = SECRET } = {}) {
  const headers = { "content-type": "application/json" };
  if (signature !== null) headers["x-callface-signature"] = signature;
  return app.inject({ method: "POST", url: PATH, payload: JSON.stringify(body), headers });
}

test("sem secret no env recusa tudo", async () => {
  const { app, repo } = await build({ secret: "" });
  const r = await post(app, payload());
  assert.equal(r.statusCode, 401);
  assert.equal((await repo.list("callface_calls")).length, 0);
  await app.close();
});

test("assinatura ausente ou errada → 401 e nada gravado", async () => {
  const { app, repo } = await build();
  assert.equal((await post(app, payload(), { signature: null })).statusCode, 401);
  assert.equal((await post(app, payload(), { signature: "errada" })).statusCode, 401);
  assert.equal((await repo.list("activities")).length, 0);
  assert.equal((await repo.list("callface_calls")).length, 0);
  await app.close();
});

test("aceita também HMAC-SHA256 do corpo com o secret (hex e base64)", async () => {
  const { app, repo } = await build();
  const body = JSON.stringify(payload());
  const hex = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  const r = await app.inject({ method: "POST", url: PATH, payload: body, headers: { "content-type": "application/json", "x-callface-signature": hex } });
  assert.equal(r.statusCode, 200);
  assert.equal((await repo.list("callface_calls")).length, 1);
  await app.close();
});

test("ligação casada por deal_id vira toque call com resumo, autor pelo e-mail e re-agenda o GPS", async () => {
  const { app, repo } = await build();
  const r = await post(app, payload());
  assert.equal(r.statusCode, 200);
  const out = r.json();
  assert.equal(out.received, true);
  assert.equal(out.ok, true);
  assert.equal(out.lead, "l1");
  assert.equal(out.matchedBy, "deal_id");

  // Além do toque, a promoção Novo → Qualificando grava o activity de estágio.
  const acts = (await repo.listWhere("activities", { lead: "l1" })).filter((x) => x.type === "call");
  assert.equal(acts.length, 1);
  const a = acts[0];
  assert.equal(a.text, payload().summarization);
  assert.equal(a.author, "ana"); // e-mail casado sem diferenciar maiúsculas
  assert.equal(a.at, "2026-10-29T14:40:56.441Z");
  assert.equal(a.saas, "leverads");
  assert.equal(a.meta.provider, "callface");
  assert.equal(a.meta.callId, "cf_abc123");
  assert.equal(a.meta.callLink, "https://app.callface.ai/calls/abc123");
  assert.equal(a.meta.audioUrl, "https://storage.callface.ai/abc123.mp3");
  assert.equal(a.meta.durationSec, 125);
  assert.equal(a.meta.status, "FINISHED");
  assert.equal(a.meta.closurePct, 72);
  assert.equal(a.meta.scheduling.items.length, 1);
  assert.equal(a.meta.transcription, undefined); // transcrição não vai na timeline

  // onActivityCreated rodou: toque real re-agenda e promove Novo → Qualificando.
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.lastActivityType, "call");
  assert.equal(lead.lastActivityAt, "2026-10-29T14:40:56.441Z");
  assert.equal(lead.stage, "Qualificando");
  assert.ok(lead.nextActionAt);

  const calls = await repo.list("callface_calls");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "cf_abc123");
  assert.equal(calls[0].lead, "l1");
  assert.equal(calls[0].activityId, a.id);
  assert.equal(calls[0].transcription.length, 1);
  assert.equal(calls[0].author, "ana");
  await app.close();
});

test("deal_id desconhecido casa pelo telefone, tolerante ao nono dígito", async () => {
  const { app, repo } = await build();
  // Callface devolve o número sem o 9 (formato legado) e um deal_id que não é nosso.
  const r = await post(app, payload({ deal_id: "xyz-da-callface", destination_number: "+554188880000" }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().lead, "l1");
  assert.equal(r.json().matchedBy, "phone");
  const acts = (await repo.listWhere("activities", { lead: "l1" })).filter((x) => x.type === "call");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.matchedBy, "phone");
  await app.close();
});

test("telefone repetido: prefere o lead aberto e mais recente", async () => {
  const { app, repo } = await build();
  await repo.create("leads", { id: "l0", saas: "leverads", name: "Antigo perdido", phone: "41988880000", stage: "Perdido", createdAt: "2026-09-01T10:00:00.000Z" });
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Novo aberto", phone: "41988880000", stage: "Novo lead", createdAt: "2026-10-20T10:00:00.000Z" });
  const r = await post(app, payload({ deal_id: "" }));
  assert.equal(r.json().lead, "l2");
  await app.close();
});

test("mesma ligação duas vezes não duplica o toque", async () => {
  const { app, repo } = await build();
  await post(app, payload());
  const r = await post(app, payload());
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().duplicate, true);
  assert.equal((await repo.listWhere("activities", { lead: "l1" })).filter((x) => x.type === "call").length, 1);
  assert.equal((await repo.list("callface_calls")).length, 1);
  await app.close();
});

test("sem lead casado responde 200 e guarda a ligação sem toque", async () => {
  const { app, repo } = await build();
  const r = await post(app, payload({ deal_id: "nada", destination_number: "+5511900000000", call_link: "https://app.callface.ai/calls/zzz" }));
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().lead, null);
  assert.equal((await repo.list("activities")).length, 0);
  const calls = await repo.list("callface_calls");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lead, "");
  assert.equal(calls[0].activityId, "");
  await app.close();
});

test("sem resumo o texto diz o estado e a duração; e-mail desconhecido vira autor callface", async () => {
  const { app, repo } = await build();
  const r = await post(app, payload({ summarization: "", call_status: "NO_ANSWER", call_duration: 0, user_email: "outra@empresa.com" }));
  assert.equal(r.statusCode, 200);
  const [a] = (await repo.listWhere("activities", { lead: "l1" })).filter((x) => x.type === "call");
  assert.equal(a.text, "Ligação pela Callface · não atendida");
  assert.equal(a.author, "callface");
  assert.equal(a.meta.userName, "Ana Silva");
  await app.close();
});

test("texto com duração quando a ligação foi concluída sem resumo", () => {
  const p = parseCallfacePayload(payload({ summarization: "", call_status: "FINISHED", call_duration: 65 }));
  assert.equal(callfaceActivityText(p), "Ligação pela Callface · concluída · 1:05");
  // Sem call_link o id é um hash estável de destino + data.
  const q = parseCallfacePayload(payload({ call_link: "" }));
  assert.match(q.callId, /^cf_[0-9a-f]{24}$/);
  assert.equal(q.callId, parseCallfacePayload(payload({ call_link: "" })).callId);
});

test("payload vazio assinado (teste do painel) responde 200 sem gravar", async () => {
  const { app, repo } = await build();
  const r = await post(app, {});
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ignored, "no call");
  assert.equal((await repo.list("callface_calls")).length, 0);
  await app.close();
});

test("callface_calls fica fora do CRUD genérico", async () => {
  const { app } = await build();
  const r = await app.inject({ method: "GET", url: "/api/callface_calls" });
  assert.equal(r.statusCode, 404);
  await app.close();
});
