// CORS: rota privada só responde CORS para as origens do cockpit; rota aberta
// (formulário, proposta, webhook…) segue aceitando qualquer origem.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { makeCorsDelegator } from "../src/cors-policy.js";

async function buildApp(env) {
  const app = Fastify();
  const isOpenPath = (path) => path.startsWith("/public/");
  await app.register(cors, { delegator: makeCorsDelegator({ env, isOpenPath }) });
  app.get("/api/leads", async () => []);
  app.get("/public/forms/x", async () => ({}));
  return app;
}

const ACAO = "access-control-allow-origin";

test("CORS: rota privada só para as origens do cockpit", async (t) => {
  const app = await buildApp({ COCKPIT_PUBLIC_URL: "https://cockpit.exemplo.com/app", CORS_ORIGINS: "https://outro.exemplo.com, lixo" });
  t.after(() => app.close());
  const get = (origin) => app.inject({ method: "GET", url: "/api/leads", headers: { origin } });
  assert.equal((await get("https://cockpit.exemplo.com")).headers[ACAO], "https://cockpit.exemplo.com");
  assert.equal((await get("https://outro.exemplo.com")).headers[ACAO], "https://outro.exemplo.com");
  assert.equal((await get("https://malicioso.com")).headers[ACAO], undefined);
  // sem Origin (servidor → servidor, curl): nada muda
  const plain = await app.inject({ method: "GET", url: "/api/leads" });
  assert.equal(plain.statusCode, 200);
  assert.equal(plain.headers[ACAO], undefined);
});

test("CORS: rota aberta aceita qualquer origem", async (t) => {
  const app = await buildApp({});
  t.after(() => app.close());
  const res = await app.inject({ method: "GET", url: "/public/forms/x", headers: { origin: "https://site-do-cliente.com" } });
  assert.equal(res.headers[ACAO], "https://site-do-cliente.com");
});
