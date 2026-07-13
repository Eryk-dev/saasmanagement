// Insight de pitch a partir das calls: digest dos resumos + rota que pede a
// melhoria do roteiro. Offline (Fastify + mem-repo + anthropic fake). Importa
// só routes.pitch.js (sem routes.js) pra não puxar dependências não instaladas.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { registerPitchRoutes, buildCallsDigest } from "../src/routes.pitch.js";
import { makeAnthropic } from "../src/anthropic.js";

test("buildCallsDigest: agrega objeções (normaliza case), dores e temperatura, sem travessão", () => {
  const digest = buildCallsDigest([
    { temperatura: "quente", dores: ["medo de banimento"], objecoes: [{ objecao: "Preço alto", resolvida: false }] },
    { temperatura: "frio", dores: ["medo de banimento", "tempo de setup"], objecoes: [{ objecao: "preço alto", comoFoiTratada: "mostrou ROI vs operador", resolvida: true }] },
  ]);
  assert.ok(digest.includes("Calls analisadas: 2"));
  assert.ok(digest.includes("1 quentes"));
  assert.ok(/Preço alto · 2x, 1 em aberto/.test(digest)); // conta as duas variações de case
  assert.ok(digest.includes("mostrou ROI vs operador"));
  assert.ok(/medo de banimento · 2x/.test(digest));
  assert.ok(!digest.includes("—")); // regra de copy do Leo
});

test("POST /api/pitch/:saas/improve: agrega as calls e devolve a sugestão", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("activities", {
    id: "a1", saas: "leverads", type: "system", at: "2026-07-12T10:00:00Z",
    meta: { event: "call_summary", summary: { temperatura: "morno", dores: ["preço"], objecoes: [{ objecao: "achou caro", resolvida: false }] } },
  });
  // ruído que NÃO deve entrar no digest: outro saas + activity comum
  await repo.create("activities", { id: "a2", saas: "outro", type: "system", meta: { event: "call_summary", summary: { temperatura: "quente" } } });
  await repo.create("activities", { id: "a3", saas: "leverads", type: "note", text: "ligou" });

  const captured = {};
  const fakeAnthropic = {
    configured: () => true,
    improvePitch: async (args) => {
      captured.args = args;
      return { suggestion: {
        diagnostico: "objeção de preço recorrente sem ancoragem de valor",
        objecoesRecorrentes: [{ objecao: "achou caro", frequencia: "1 call", comoTratarNoPitch: "ancorar valor antes do preço" }],
        sugestao: { resumo: "postura nova", objetivo: "obj", passos: [{ t: "Abertura", fala: "Oi {{nome}}", dica: "" }] },
      } };
    },
  };
  const app = Fastify();
  registerPitchRoutes(app, repo, { anthropic: fakeAnthropic });

  const res = await app.inject({ method: "POST", url: "/api/pitch/leverads/improve", payload: {
    scriptKey: "call", scriptLabel: "Call de fechamento",
    currentScript: { resumo: "r", objetivo: "o", passos: [{ t: "A", fala: "x" }] },
  } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.base, 1); // só a call_summary do leverads
  assert.equal(body.sugestao.passos[0].t, "Abertura");
  assert.ok(body.diagnostico.includes("preço"));
  // passou o digest agregado + o roteiro atual + label pro modelo
  assert.ok(captured.args.calls.includes("Calls analisadas: 1"));
  assert.ok(captured.args.calls.includes("achou caro"));
  assert.equal(captured.args.scriptLabel, "Call de fechamento");
  assert.equal(captured.args.currentScript.resumo, "r");
  assert.equal(captured.args.productName, "LeverAds");

  await app.close();
});

test("anthropic.improvePitch: manda schema pitch_improvement + roteiro atual + digest e parseia", async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return { status: 200, json: async () => ({
      model: "claude-opus-4-8",
      content: [{ type: "text", text: JSON.stringify({ diagnostico: "d", objecoesRecorrentes: [], sugestao: { resumo: "r", objetivo: "o", passos: [] } }) }],
    }) };
  };
  const a = makeAnthropic({ fetch: f, apiKey: "sk-test" });
  const { suggestion } = await a.improvePitch({
    productName: "LeverAds", scriptLabel: "Call de fechamento",
    currentScript: { resumo: "postura", objetivo: "obj", passos: [{ t: "Abertura", fala: "Oi {{nome}}", dica: "seja breve" }] },
    calls: "Calls analisadas: 3",
  });
  assert.equal(suggestion.diagnostico, "d");
  const req = calls[0];
  assert.equal(req.body.output_config.format.schema.properties.sugestao.properties.passos.items.properties.t.type, "string");
  assert.ok(req.body.system.includes("travessão")); // regra de copy do Leo no prompt
  assert.ok(req.body.messages[0].content.includes("ROTEIRO ATUAL"));
  assert.ok(req.body.messages[0].content.includes("Oi {{nome}}")); // roteiro atual vai no contexto
  assert.ok(req.body.messages[0].content.includes("Calls analisadas: 3")); // digest das calls vai junto
});

test("guards: IA off = 503; produto inexistente = 404; sem calls resumidas = 422", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });

  const offApp = Fastify();
  registerPitchRoutes(offApp, repo, { anthropic: { configured: () => false } });
  assert.equal((await offApp.inject({ method: "POST", url: "/api/pitch/leverads/improve", payload: {} })).statusCode, 503);
  await offApp.close();

  const app = Fastify();
  registerPitchRoutes(app, repo, { anthropic: { configured: () => true, improvePitch: async () => ({ suggestion: {} }) } });
  assert.equal((await app.inject({ method: "POST", url: "/api/pitch/naoexiste/improve", payload: {} })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/pitch/leverads/improve", payload: {} })).statusCode, 422); // produto existe, sem call_summary
  await app.close();
});
