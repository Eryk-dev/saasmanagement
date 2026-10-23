// Segredo em app_config não vaza pelo CRUD genérico (docs/PLANO-DISPAROS.md, fase 0).
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

test("google_oauth: CRUD lê sem o refresh token e não escreve", async (t) => {
  const repo = makeMemRepo();
  await repo.create("app_config", { id: "google_oauth", refreshToken: "1//segredo", account: "time@exemplo.com", scopes: "gmail.send" });
  await repo.create("app_config", { id: "followup_contacts", value: [1] });
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());

  const one = (await app.inject({ url: "/api/app_config/google_oauth" })).json();
  assert.equal(one.refreshToken, undefined);
  assert.equal(one.account, "time@exemplo.com", "o resto continua legível");
  const all = (await app.inject({ url: "/api/app_config" })).json();
  assert.ok(!JSON.stringify(all).includes("segredo"));
  assert.ok(all.some((c) => c.id === "followup_contacts" && c.value[0] === 1), "config comum intocada");

  for (const [method, url, payload] of [
    ["PATCH", "/api/app_config/google_oauth", { refreshToken: "trocado" }],
    ["POST", "/api/app_config", { id: "google_oauth", refreshToken: "novo" }],
    ["DELETE", "/api/app_config/google_oauth"],
  ]) {
    const r = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    assert.equal(r.statusCode, 403, `${method} ${url}`);
  }
  assert.equal((await repo.get("app_config", "google_oauth")).refreshToken, "1//segredo", "o token segue no servidor");
});
