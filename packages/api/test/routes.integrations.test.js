// Análise de integração: agregação (sentimento, pendências, configurado) + rota.
// Offline (Fastify + mem-repo). Importa só routes.integrations.js.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { registerIntegrationRoutes, aggregateIntegrations } from "../src/routes.integrations.js";

test("aggregateIntegrations: sentimento, pendências (com responsável) e configurado", () => {
  const a = aggregateIntegrations([
    { sentimento: "satisfeito", configurado: ["conta criada"], pendencias: [{ item: "Enviar foto", responsavel: "cliente" }] },
    { sentimento: "em risco", configurado: ["conta criada"], pendencias: [{ item: "enviar foto", responsavel: "cliente" }, { item: "Liberar acesso", responsavel: "equipe" }] },
  ]);
  assert.equal(a.count, 2);
  assert.deepEqual(a.sentimento, { satisfeito: 1, neutro: 0, "em risco": 1 });
  assert.equal(a.pendencias[0].item, "Enviar foto"); // 2× (normaliza case)
  assert.equal(a.pendencias[0].total, 2);
  assert.equal(a.pendencias[0].cliente, 2);
  assert.equal(a.configurado[0].total, 2);
});

test("GET /api/integrations/:saas/summary: só integração, dedup por meetEventId, recentes com nome", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "uniquekids", name: "UniqueKids" });
  await repo.create("leads", { id: "le1", saas: "uniquekids", name: "Maria", stage: "Integração" });
  await repo.create("activities", { id: "a1", saas: "uniquekids", type: "system", at: "2026-07-14T18:00:00Z", lead: "le1", meta: { event: "call_summary", kind: "integracao", meetEventId: "ev1", recordingUrl: "http://doc", summary: { sentimento: "satisfeito", resumo: "setup ok", configurado: ["conta"], pendencias: [{ item: "foto", responsavel: "cliente" }] } } });
  // re-resumo da MESMA integração (mesmo meetEventId) → não conta 2×
  await repo.create("activities", { id: "a1b", saas: "uniquekids", type: "system", at: "2026-07-14T17:00:00Z", lead: "le1", meta: { event: "call_summary", kind: "integracao", meetEventId: "ev1", summary: { sentimento: "neutro" } } });
  // ruído: call de VENDA (kind call) não entra
  await repo.create("activities", { id: "a2", saas: "uniquekids", type: "system", lead: "le1", meta: { event: "call_summary", kind: "call", summary: { temperatura: "quente" } } });

  const app = Fastify();
  registerIntegrationRoutes(app, repo);
  const res = await app.inject({ method: "GET", url: "/api/integrations/uniquekids/summary" });
  assert.equal(res.statusCode, 200);
  const b = res.json();
  assert.equal(b.count, 1); // dedup: 1 integração; a venda foi ignorada
  assert.deepEqual(b.sentimento, { satisfeito: 1, neutro: 0, "em risco": 0 });
  assert.equal(b.recent.length, 1);
  assert.equal(b.recent[0].leadName, "Maria");
  assert.equal(b.recent[0].sentimento, "satisfeito"); // manteve o mais recente
  await app.close();
});
