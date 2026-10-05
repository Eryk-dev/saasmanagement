// Rotas de sistema: health com a impressão do build, tempo real (SSE em
// /api/events) e a documentação OpenAPI.

import { srcFingerprint } from "../build-info.js";
import { COLLECTION_NAMES } from "./db.js";
import { QUIET, currentRev, subscribe as subscribeChanges } from "./changes.js";
import { docsHtml, openapi } from "./openapi.js";

export function registerSystemRoutes(app, repo) {
  // `build` = impressão digital do código em execução (build-info.js): comparar
  // com `node packages/api/src/build-info.js` na main responde se o deploy do
  // EasyPanel está atualizado.
  app.get("/api/health", async () => ({ ok: true, service: "cockpit-api", build: srcFingerprint(), collections: COLLECTION_NAMES }));

  // ── Tempo real ─────────────────────────────────────────────────────────
  // Toda escrita no repo (db.js) incrementa um contador global (changes.js).
  // O SPA escuta /api/events (SSE) e recarrega o SEED quando o rev muda — é o
  // que faz a alteração de um usuário aparecer na tela dos outros sem refresh.
  app.get("/api/rev", async () => ({ rev: currentRev() }));
  app.get("/api/events", (req, reply) => {
    // EventSource não manda headers — a key/token vem em ?key= (ver providedKey
    // no index.js). reply.hijack(): a resposta vira um stream cru de vida longa.
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no", // proxies (nginx/traefik) não bufferizam o stream
    });
    reply.raw.write(`data: {"rev":${currentRev()}}\n\n`);
    // `quiet`: coleção com tela de fetch próprio (atividade/caixa de entrada
    // das tarefas) — o SPA repassa o evento (cockpit-change) sem recarregar o SEED.
    const unsub = subscribeChanges((rev, collection) => {
      reply.raw.write(`data: ${JSON.stringify({ rev, collection, quiet: QUIET.has(collection) })}\n\n`);
    });
    // Heartbeat: proxies matam conexão ociosa; comentário SSE a cada 25s segura.
    const hb = setInterval(() => reply.raw.write(":hb\n\n"), 25000);
    req.raw.on("close", () => { clearInterval(hb); unsub(); });
  });

  // API documentation (OpenAPI spec + Redoc page). The MCP server consumes this.
  app.get("/api/openapi.json", async () => openapi);
  app.get("/api/docs", async (_req, reply) => reply.type("text/html").send(docsHtml));
}
