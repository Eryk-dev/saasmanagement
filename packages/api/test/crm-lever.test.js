// Aviso de lead novo pro CRM Lever (o CRM novo): o envio do form que levanta o
// pop-up de lead novo daqui avisa o CRM Lever pra copiar o lead na hora e tocar
// o "Aeroporto de leads" de lá. O aviso não leva dado, nunca é esperado e
// nunca quebra o envio. Repo in-memory, via Fastify inject; fetch mockado.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeCrmLever, crmLeverUrl, CRM_LEVER_PROD_URL } from "../src/integrations/crm-lever.js";
import { assertSafeBoot } from "../src/platform/app-env.js";

const { registerRoutes } = await import("../src/routes.js");

const FORM = {
  id: "fo_test",
  name: "Diagnóstico LeverAds",
  saas: "leverads",
  status: "published",
  questions: [
    { key: "nome", label: "Seu nome?", type: "text", required: true },
    { key: "whatsapp", label: "WhatsApp", type: "phone", required: true },
    {
      key: "vende", label: "Já vende em marketplace?", type: "select", required: true,
      options: [
        { value: "sim", label: "Sim" },
        { value: "nao", label: "Não", to: "_reject" },
        { value: "aprender", label: "Quero aprender", exit: "mentoria", to: "_end" },
      ],
    },
  ],
  mapping: { name: "nome", phone: "whatsapp" },
  exits: { mentoria: { label: "Ainda não vende", stage: "Mentoria" } },
};
const ANSWERS = { nome: "Ana", whatsapp: "41992516545", vende: "sim" };

// Um CRM Lever de mentira: conta as chamadas e responde o que o teste mandar.
function fakeCrmLever(leadNew = async () => true) {
  const calls = [];
  return {
    calls,
    client: { configured: () => true, leadNew: (...args) => { calls.push(args); return leadNew(); } },
  };
}

async function buildApp({ crmLever, leads = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM });
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  for (const l of leads) await repo.create("leads", l);
  const app = Fastify();
  registerRoutes(app, repo, { ...(crmLever ? { crmLever } : {}) });
  await app.ready();
  return { app, repo };
}

const submit = (app, payload) =>
  app.inject({ method: "POST", url: "/public/forms/fo_test/submissions", payload });

// ── O cliente ───────────────────────────────────────────────────────────────

test("o aviso é um POST sem dado nenhum, no endereço do CRM Lever, com o cabeçalho que ele exige", async () => {
  const seen = [];
  const crm = makeCrmLever({ baseUrl: "https://crm.exemplo.com.br/", fetch: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 204 }; } });
  assert.equal(crm.configured(), true);
  assert.equal(await crm.leadNew(), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://crm.exemplo.com.br/api/public/espelho/lead-novo");
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(seen[0].init.headers, { "content-type": "application/json", "x-crm-csrf": "1" });
  // nem nome, nem telefone, nem id do lead, nem chave: o corpo é vazio
  assert.equal(seen[0].init.body, "{}");
  assert.ok(seen[0].init.signal, "tem timeout");
});

test("fail-open: CRM Lever fora do ar, lento ou respondendo erro nunca lança", async () => {
  const down = makeCrmLever({ baseUrl: "https://crm.exemplo.com.br", fetch: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(await down.leadNew(), false);
  const erro = makeCrmLever({ baseUrl: "https://crm.exemplo.com.br", fetch: async () => ({ ok: false, status: 503 }) });
  assert.equal(await erro.leadNew(), false);
});

test("sem endereço fica desligado e não chama ninguém", async () => {
  let called = 0;
  const off = makeCrmLever({ baseUrl: "", fetch: async () => { called++; return { ok: true }; } });
  assert.equal(off.configured(), false);
  assert.equal(await off.leadNew(), false);
  assert.equal(called, 0);
});

test("endereço: em produção vale o do CRM Lever sem variável; fora de produção fica desligado; CRM_LEVER_URL manda e 'off' desliga", () => {
  assert.equal(crmLeverUrl({ NODE_ENV: "production" }), CRM_LEVER_PROD_URL);
  assert.equal(crmLeverUrl({ APP_ENV: "production" }), CRM_LEVER_PROD_URL);
  assert.equal(crmLeverUrl({}), "", "máquina do dev e teste nunca batem no CRM Lever de produção");
  assert.equal(crmLeverUrl({ APP_ENV: "dev", NODE_ENV: "production" }), "");
  assert.equal(crmLeverUrl({ APP_ENV: "dev", CRM_LEVER_URL: "https://dev.crm.levermoney.com.br" }), "https://dev.crm.levermoney.com.br");
  assert.equal(crmLeverUrl({ NODE_ENV: "production", CRM_LEVER_URL: "off" }), "");
  // e a trava de boot recusa dev apontado pro CRM Lever de produção
  assert.throws(() => assertSafeBoot({ APP_ENV: "dev", CRM_LEVER_URL: CRM_LEVER_PROD_URL }), /CRM_LEVER_URL/);
  assert.equal(assertSafeBoot({ APP_ENV: "dev", CRM_LEVER_URL: "https://dev.crm.levermoney.com.br" }), "dev");
});

// ── No envio do form ────────────────────────────────────────────────────────

test("lead que entra pelo form avisa o CRM Lever uma vez, sem argumento nenhum; o reenvio avisa de novo", async () => {
  const crm = fakeCrmLever();
  const { app, repo } = await buildApp({ crmLever: crm.client });
  assert.equal((await submit(app, { answers: ANSWERS })).statusCode, 201);
  assert.equal(crm.calls.length, 1);
  assert.deepEqual(crm.calls[0], [], "o aviso não recebe o lead: quem busca é a cópia do CRM Lever");
  // reenvio de quem já existe: levantar a mão de novo é pop-up de novo, lá também
  assert.equal((await submit(app, { answers: ANSWERS })).statusCode, 201);
  assert.equal((await repo.list("leads")).length, 1, "mesclou no card que já existia");
  assert.equal(crm.calls.length, 2);
  await app.close();
});

test("quem não é fila de venda não avisa: desqualificado, saída lateral, teste da equipe e cliente que já fechou", async () => {
  const crm = fakeCrmLever();
  const { app } = await buildApp({ crmLever: crm.client, leads: [{ id: "ld_cli", saas: "leverads", name: "Caio", phone: "41977776666", stage: "Ganho" }] });
  assert.equal((await submit(app, { answers: { ...ANSWERS, whatsapp: "41911110001", vende: "nao" } })).statusCode, 201);
  assert.equal((await submit(app, { answers: { ...ANSWERS, whatsapp: "41911110002", vende: "aprender" } })).statusCode, 201);
  assert.equal((await submit(app, { answers: { ...ANSWERS, whatsapp: "41911110003" }, internal: true })).statusCode, 201);
  assert.equal((await submit(app, { answers: { ...ANSWERS, nome: "Caio", whatsapp: "41977776666" } })).statusCode, 201);
  assert.equal(crm.calls.length, 0);
  await app.close();
});

test("o envio do form não espera o CRM Lever e não quebra se ele falhar", async () => {
  // um CRM Lever que nunca responde: se a rota esperasse, o inject não voltaria
  const preso = fakeCrmLever(() => new Promise(() => {}));
  const a = await buildApp({ crmLever: preso.client });
  const res = await submit(a.app, { answers: ANSWERS });
  assert.equal(res.statusCode, 201);
  assert.equal(preso.calls.length, 1);
  assert.equal((await a.repo.list("leads")).length, 1);
  await a.app.close();

  // e o cliente de verdade com a rede caindo: o lead entra do mesmo jeito
  const caido = makeCrmLever({ baseUrl: "https://crm.exemplo.com.br", fetch: async () => { throw new Error("ETIMEDOUT"); } });
  const b = await buildApp({ crmLever: caido });
  assert.equal((await submit(b.app, { answers: ANSWERS })).statusCode, 201);
  assert.equal((await b.repo.list("leads")).length, 1);
  assert.equal((await b.repo.list("wa_alerts")).length, 1, "o pop-up daqui segue igual");
  await b.app.close();
});

test("sem CRM Lever configurado (dev, teste) o envio segue igual e ninguém é chamado", async () => {
  let called = 0;
  const off = { configured: () => false, leadNew: async () => { called++; return true; } };
  const { app } = await buildApp({ crmLever: off });
  assert.equal((await submit(app, { answers: ANSWERS })).statusCode, 201);
  assert.equal(called, 0);
  await app.close();
});
