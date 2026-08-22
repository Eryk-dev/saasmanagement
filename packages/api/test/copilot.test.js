// Copiloto da call — sessão por lead, pedaços de áudio virando transcrição, cue
// da IA a cada 3 pedaços e stop gravando a transcrição na timeline. Transcritor
// e IA são fakes: aqui se testa o circuito, não os fornecedores.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerCopilotRoutes } = await import("../src/copilot.js");

const CHECKLIST = [{ id: "p1", label: "Raio-X da operação" }, { id: "p2", label: "Demo AO VIVO" }];

function fakes() {
  const seen = [];
  const transcriber = {
    configured: () => true,
    transcribe: async (buf, opts) => { seen.push(opts); return `Vendedor: fala ${seen.length} com bastante texto pra passar do minimo de oitenta caracteres que o cue exige antes de analisar qualquer coisa`; },
  };
  const anthropic = {
    configured: () => true,
    copilotCue: async ({ checklist }) => ({ cue: {
      steps: checklist.map((c, i) => ({ id: c.id, done: i === 0 })),
      objecao: { resumo: "vai canibalizar", resposta: "Replicar não canibaliza: a Unique dobrou a conta 2 e a 1 subiu 20%." },
      alerta: null, sugestao: "Chama pra demo ao vivo agora.",
    } }),
  };
  const vision = {
    configured: () => true,
    read: async () => ({ cameraLigada: true, pessoas: 2, atencao: "alta", nota: "segunda pessoa entrou na sala" }),
  };
  return { transcriber, anthropic, vision, seen };
}

async function build() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("leads", { id: "le1", saas: "leverads", name: "Ana", company: "Loja X", stage: "Call agendada" });
  const f = fakes();
  const app = Fastify();
  await app.register(multipart);
  app.addHook("onRequest", async (req) => { if (req.headers["x-user"]) req.authUser = { id: String(req.headers["x-user"]) }; });
  registerCopilotRoutes(app, repo, { transcriber: f.transcriber, anthropic: f.anthropic, vision: f.vision });
  return { app, repo, ...f };
}

const audioPayload = (boundary, bytes = 5000) => Buffer.concat([
  Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="chunk.webm"\r\ncontent-type: audio/webm\r\n\r\n`),
  Buffer.alloc(bytes, 7),
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

test("copiloto: start → chunks viram transcrição, cue no 3º pedaço, stop grava na timeline", async () => {
  const { app, repo, seen } = await build();
  const as = { "x-user": "jon" };

  // sem sessão de usuário: 401 (copiloto é por pessoa)
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/le1/copilot/start", payload: { checklist: CHECKLIST } })).statusCode, 401);

  const start = await app.inject({ method: "POST", url: "/api/leads/le1/copilot/start", headers: as, payload: { checklist: CHECKLIST } });
  assert.equal(start.statusCode, 200, start.body);

  const boundary = "----copilot";
  const send = () => app.inject({ method: "POST", url: "/api/leads/le1/copilot/chunk",
    headers: { ...as, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: audioPayload(boundary) });

  const c1 = (await send()).json();
  assert.match(c1.text, /Vendedor: fala 1/);
  assert.ok(c1.cues, "o 1º pedaço com fala já orienta");
  await send();
  const c3 = (await send()).json();
  assert.equal(c3.cues.sugestao, "Chama pra demo ao vivo agora.");
  assert.equal(c3.cues.objecao.resumo, "vai canibalizar");
  // a transcrição estéreo pede rótulo por canal
  assert.match(seen[0].instructions, /canal esquerdo é o VENDEDOR/);

  const st = (await app.inject({ url: "/api/leads/le1/copilot", headers: as })).json();
  assert.equal(st.active, true);
  assert.equal(st.checklist.length, 2);
  assert.match(st.transcriptTail, /fala 3/);
  assert.ok(st.chars > 100);

  const stop = (await app.inject({ method: "POST", url: "/api/leads/le1/copilot/stop", headers: as })).json();
  assert.equal(stop.ok, true);
  const acts = (await repo.list("activities")).filter((a) => a.lead === "le1" && a.meta?.event === "copilot_transcript");
  assert.equal(acts.length, 1, "transcrição inteira vira toque na timeline");
  assert.match(acts[0].text, /fala 1/);

  // sessão encerrada: chunk novo é recusado (o front reinicia com start)
  assert.equal((await send()).statusCode, 409);
  await app.close();
});

test("copiloto: frame da aba vira leitura visual na sessão (a imagem não persiste)", async () => {
  const { app, repo } = await build();
  const as = { "x-user": "jon" };
  await app.inject({ method: "POST", url: "/api/leads/le1/copilot/start", headers: as, payload: { checklist: CHECKLIST } });
  const boundary = "----frame";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="frame.jpg"\r\ncontent-type: image/jpeg\r\n\r\n`),
    Buffer.alloc(8000, 3),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = (await app.inject({ method: "POST", url: "/api/leads/le1/copilot/frame",
    headers: { ...as, "content-type": `multipart/form-data; boundary=${boundary}` }, payload })).json();
  assert.equal(r.visual.pessoas, 2);
  assert.equal(r.visual.atencao, "alta");
  const doc = await repo.get("copilot_sessions", "cs_le1");
  assert.equal(doc.visual.nota, "segunda pessoa entrou na sala");
  const st = (await app.inject({ url: "/api/leads/le1/copilot", headers: as })).json();
  assert.equal(st.visual.cameraLigada, true);
  await app.close();
});

test("copiloto: pedaço minúsculo (silêncio) não gasta transcrição; start exige transcritor configurado", async () => {
  const { app } = await build();
  const as = { "x-user": "jon" };
  await app.inject({ method: "POST", url: "/api/leads/le1/copilot/start", headers: as, payload: { checklist: CHECKLIST } });
  const boundary = "----tiny";
  const r = (await app.inject({ method: "POST", url: "/api/leads/le1/copilot/chunk",
    headers: { ...as, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: audioPayload(boundary, 100) })).json();
  assert.equal(r.skipped, true);
  await app.close();

  // transcritor desligado → 424 com instrução
  const repo2 = makeMemRepo();
  await repo2.create("leads", { id: "le9", saas: "", name: "X" });
  const app2 = Fastify();
  await app2.register(multipart);
  app2.addHook("onRequest", async (req) => { req.authUser = { id: "jon" }; });
  registerCopilotRoutes(app2, repo2, { transcriber: { configured: () => false }, anthropic: null });
  assert.equal((await app2.inject({ method: "POST", url: "/api/leads/le9/copilot/start", payload: {} })).statusCode, 424);
  await app2.close();
});
