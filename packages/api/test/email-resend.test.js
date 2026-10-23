// E-mail pelo Resend (docs/PLANO-DISPAROS.md, fase 1): mailer multiprovedor,
// cliente do Resend, configuração com a chave fora da tela e permissão.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth/auth.js";
import { seedTestAdmins } from "./helpers/seed-admins.js";
import { makeScreenGuardHook } from "../src/auth/screens.js";
import { makeMailer } from "../src/email/mailer.js";
import { makeResend } from "../src/email/resend.js";

const { registerRoutes } = await import("../src/routes.js");
const KEY = "re_TesteChave1234";

function fakeResend({ domains = [{ id: "d1", name: "lever.com.br", status: "verified" }] } = {}) {
  const sent = [];
  return { sent, send: async (m) => { sent.push(m); return { id: `em_${sent.length}` }; }, domains: async () => domains };
}
const fakeGoogle = (ready) => ({ gmailReady: async () => ready, sendGmail: async (m) => ({ id: "gm_1", ...m }) });

test("mailer: Resend configurado vence o Gmail; sem Resend cai no Gmail; sem nada não está pronto", async () => {
  const repo = makeMemRepo();
  const resend = fakeResend();
  const sleeps = [];
  let clock = 1000;
  const mailer = makeMailer({ google: fakeGoogle(true), repo, resend, minIntervalMs: 500, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  assert.equal(await mailer.provider(), "gmail");
  assert.equal((await mailer.send({ to: "a@x.com", subject: "s", text: "t" })).id, "gm_1");

  await repo.create("integration_secrets", { id: "email", provider: "resend", apiKey: KEY, fromEmail: "time@lever.com.br", fromName: "Lever", replyTo: "contato@lever.com.br" });
  assert.equal(await mailer.provider(), "resend");
  await mailer.send({ to: "b@x.com", subject: "Oi", text: "corpo", headers: { "List-Unsubscribe": "<u>" } });
  await mailer.send({ to: "c@x.com", subject: "Oi", text: "corpo", fromName: "Suporte <Lever>" });
  assert.equal(resend.sent[0].from, "Lever <time@lever.com.br>");
  assert.equal(resend.sent[0].apiKey, KEY);
  assert.equal(resend.sent[0].replyTo, "contato@lever.com.br");
  assert.deepEqual(resend.sent[0].headers, { "List-Unsubscribe": "<u>" });
  assert.equal(resend.sent[1].from, "Suporte Lever <time@lever.com.br>", "nome do chamador vence, sem < >");
  assert.deepEqual(sleeps, [500], "segundo envio espera o respiro do limite do Resend");

  const none = makeMailer({ google: fakeGoogle(false), repo: makeMemRepo(), resend });
  assert.equal(await none.ready(), false);
  await assert.rejects(() => none.send({ to: "a@x.com", subject: "s", text: "t" }), /nenhum provedor/);
});

test("cliente do Resend: corpo da API, 429 espera e tenta de novo, erro legível", async () => {
  const calls = [];
  let n = 0;
  const f = async (url, init) => {
    calls.push({ url, init });
    n++;
    if (n === 1) return { status: 429, headers: { get: () => "1" }, text: async () => "{}" };
    if (url.endsWith("/domains")) return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: [{ id: "d", name: "x.com", status: "pending" }] }) };
    if (n === 3) return { status: 422, headers: { get: () => null }, text: async () => JSON.stringify({ message: "The x.com domain is not verified" }) };
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ id: "em_9" }) };
  };
  const waits = [];
  const r = makeResend({ fetch: f, sleep: async (ms) => waits.push(ms) });
  const out = await r.send({ apiKey: KEY, from: "A <a@x.com>", to: "b@y.com", subject: "s", text: "t", headers: { h: "1" }, replyTo: "r@x.com" });
  assert.equal(out.id, "em_9");
  assert.deepEqual(waits, [1000]);
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body, { from: "A <a@x.com>", to: ["b@y.com"], subject: "s", text: "t", headers: { h: "1" }, reply_to: "r@x.com" });
  assert.equal(calls[1].init.headers.authorization, `Bearer ${KEY}`);
  await assert.rejects(() => r.send({ apiKey: KEY, from: "a@x.com", to: "b@y.com", subject: "s", text: "t" }), /domain is not verified/);
  assert.deepEqual(await r.domains(KEY), [{ id: "d", name: "x.com", status: "pending", region: "" }]);
});

function buildApp(repo, opts) {
  const app = Fastify();
  const providedKey = (req) => req.headers["x-api-key"] || "";
  app.addHook("onRequest", makeAuthHook({ apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [], providedKey }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo, opts);
  return app;
}
const login = async (app, username) => ({ "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "1234" } })).json().token });

test("config do e-mail: chave nunca volta, validação, só admin grava, teste pelo provedor ativo", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", { id: "sdr1", name: "sdr1", roles: ["sdr"], screens: [], passwordHash: hashPassword("1234") });
  const resend = fakeResend();
  const app = buildApp(repo, { resend, google: undefined });
  t.after(() => app.close());
  const KEYH = { "x-api-key": "test-key" };

  let r = await app.inject({ method: "PUT", url: "/api/email/config", headers: KEYH, payload: { apiKey: "chave-errada", fromEmail: "sem-arroba" } });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().errors.length, 2);

  r = await app.inject({ method: "PUT", url: "/api/email/config", headers: KEYH, payload: { apiKey: KEY, fromEmail: "Time@Lever.com.br", fromName: "Lever" } });
  assert.equal(r.statusCode, 200);
  const st = r.json();
  assert.equal(st.apiKey, undefined);
  assert.ok(!JSON.stringify(st).includes(KEY));
  assert.equal(st.last4, "1234");
  assert.equal(st.fromEmail, "time@lever.com.br");
  assert.equal(st.active, "resend");
  assert.deepEqual(st.domainStatus, { name: "lever.com.br", status: "verified" });

  // Trocar só o remetente mantém a chave.
  r = await app.inject({ method: "PUT", url: "/api/email/config", headers: KEYH, payload: { fromName: "Lever Ads" } });
  assert.equal(r.json().fromName, "Lever Ads");
  assert.equal((await repo.get("integration_secrets", "email")).apiKey, KEY);

  const sdr = await login(app, "sdr1");
  assert.equal((await app.inject({ url: "/api/email/config", headers: sdr })).statusCode, 200, "quem tem Configurações lê");
  assert.equal((await app.inject({ method: "PUT", url: "/api/email/config", headers: sdr, payload: { fromName: "x" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/email/test", headers: sdr, payload: { to: "a@b.com" } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/integration_secrets", headers: KEYH })).statusCode, 404, "coleção privada fora do CRUD");

  r = await app.inject({ method: "POST", url: "/api/email/test", headers: KEYH, payload: { to: "eu@lever.com.br" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().provider, "resend");
  assert.equal(resend.sent.at(-1).to, "eu@lever.com.br");

  r = await app.inject({ method: "DELETE", url: "/api/email/config", headers: KEYH });
  assert.equal(r.json().configured, false);
  assert.equal(r.json().active, "");
});

test("estado do domínio: chave só de envio fica 'restricted'; outro erro mostra o motivo", async (t) => {
  const repo = makeMemRepo();
  const fail = (code, message) => ({ send: async () => ({ id: "x" }), domains: async () => { const e = new Error(`Resend: ${message}`); e.status = 401; e.code = code; throw e; } });
  let resend = fail("restricted_api_key", "This API key is restricted to only send emails");
  const app = buildApp(repo, { resend: { send: (...a) => resend.send(...a), domains: (...a) => resend.domains(...a) }, google: undefined });
  t.after(() => app.close());
  const KEYH = { "x-api-key": "test-key" };
  let r = await app.inject({ method: "PUT", url: "/api/email/config", headers: KEYH, payload: { apiKey: KEY, fromEmail: "time@leverads.com.br" } });
  assert.deepEqual(r.json().domainStatus, { name: "leverads.com.br", status: "restricted" });
  resend = fail("validation_error", "API key is invalid");
  r = await app.inject({ url: "/api/email/config", headers: KEYH });
  assert.deepEqual(r.json().domainStatus, { name: "leverads.com.br", status: "error", error: "Resend: API key is invalid" });
});

test("cliente do Resend: o nome do erro vira err.code", async () => {
  const f = async () => ({ status: 401, headers: { get: () => null }, text: async () => JSON.stringify({ statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails" }) });
  await assert.rejects(makeResend({ fetch: f }).domains(KEY), (e) => e.code === "restricted_api_key" && e.status === 401);
});
