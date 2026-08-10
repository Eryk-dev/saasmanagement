// Duas coisas que acontecem na borda pública do formulário:
//   1. no PLANTÃO de fim de semana o botão do "obrigado" manda o lead pro
//      número de quem está de plantão, e não pro número comercial;
//   2. lead que entra vira ALERTA de lead novo (pop-up do cockpit) pra alguém
//      fazer o 1º toque enquanto ele ainda está com o assunto na cabeça.
// Repo in-memory, via Fastify inject.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

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
      key: "contas", label: "Quantas contas?", type: "select", required: true,
      options: [{ value: "1", label: "1 conta" }, { value: "3-5", label: "3 a 5 contas" }],
    },
    {
      key: "nicho", label: "Segmento?", type: "select", required: true,
      options: [{ value: "autopecas", label: "Autopeças" }],
    },
  ],
  mapping: { name: "nome", phone: "whatsapp" },
  // Número escrito NO FORM: fora do plantão é ele que vale.
  thanks: { title: "Valeu!", whatsapp: "5541936183835" },
};

// O form valida nome como primeiro nome só (sem espaços) — ver nameError.
const ANSWERS = { nome: "Ana", whatsapp: "41992516545", contas: "3-5", nicho: "autopecas" };

// A janela do plantão é relativa ao AGORA do relógio do negócio, senão o teste
// só passaria no fim de semana. `deOffset`/`ateOffset` são horas a partir de
// agora: (-1, +1) = plantão valendo; (+2, +3) = plantão só mais tarde.
const BRT = 3 * 3_600_000;
function janela(deOffsetH, ateOffsetH) {
  const clock = new Date(Date.now() - BRT);
  const agora = clock.getUTCDay() * 1440 + clock.getUTCHours() * 60 + clock.getUTCMinutes();
  const em = (h) => {
    const m = (((agora + h * 60) % 10080) + 10080) % 10080;
    return { dow: Math.floor(m / 1440), hour: (m % 1440) / 60 };
  };
  const a = em(deOffsetH), b = em(ateOffsetH);
  return { fromDow: a.dow, fromHour: a.hour, toDow: b.dow, toHour: b.hour };
}
const PLANTAO = (deH, ateH) => ({ enabled: true, phone: "5541995063622", ...janela(deH, ateH) });

async function buildApp({ weekendDuty = null, product = {}, forms = [], leads = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM });
  for (const f of forms) await repo.create("forms", f);
  await repo.create("products", { id: "leverads", name: "LeverAds", ...product, ...(weekendDuty ? { weekendDuty } : {}) });
  for (const l of leads) await repo.create("leads", l);
  const app = Fastify();
  registerRoutes(app, repo, {});
  await app.ready();
  return { app, repo };
}

const submit = (app, payload) =>
  app.inject({ method: "POST", url: "/public/forms/fo_test/submissions", payload });

const alerts = async (repo) => (await repo.list("wa_alerts")).filter((a) => a.status === "open");

// ── Plantão de fim de semana ────────────────────────────────────────────────

test("no plantão, o número do plantonista vence até o número escrito no form", async () => {
  const { app } = await buildApp({ weekendDuty: PLANTAO(-1, 1) });

  const pub = (await app.inject({ method: "GET", url: "/public/forms/fo_test" })).json();
  assert.equal(pub.thanks.whatsapp, "5541995063622");

  const page = await app.inject({ method: "GET", url: "/f/fo_test" });
  assert.ok(page.body.includes("5541995063622"), "a página hospedada leva o número do plantão");
  assert.ok(!page.body.includes("5541936183835"), "e não leva mais o número comercial");
  await app.close();
});

test("fora da janela, nada muda: continua o número do form", async () => {
  const { app } = await buildApp({ weekendDuty: PLANTAO(2, 3) });
  const pub = (await app.inject({ method: "GET", url: "/public/forms/fo_test" })).json();
  assert.equal(pub.thanks.whatsapp, "5541936183835");
  await app.close();
});

test("produto sem plantão configurado nunca troca de número", async () => {
  const { app } = await buildApp();
  const pub = (await app.inject({ method: "GET", url: "/public/forms/fo_test" })).json();
  assert.equal(pub.thanks.whatsapp, "5541936183835");
  await app.close();
});

test("plantão é por produto: o form de outro SaaS não é afetado", async () => {
  const { app, repo } = await buildApp({ weekendDuty: PLANTAO(-1, 1) });
  await repo.create("products", { id: "uniquekids", name: "UniqueKids" });
  await repo.create("forms", { ...FORM, id: "fo_kids", saas: "uniquekids", thanks: { title: "ok", whatsapp: "5541987111569" } });

  const kids = (await app.inject({ method: "GET", url: "/public/forms/fo_kids" })).json();
  assert.equal(kids.thanks.whatsapp, "5541987111569", "o lead da Ana continua indo pra Ana");
  await app.close();
});

// ── Alerta de lead novo ─────────────────────────────────────────────────────

test("lead que entra pelo form vira alerta de lead novo, com o resumo das respostas", async () => {
  const { app, repo } = await buildApp();
  assert.equal((await submit(app, { answers: ANSWERS })).statusCode, 201);

  const [a] = await alerts(repo);
  assert.ok(a, "o alerta foi levantado");
  assert.equal(a.kind, "lead");
  assert.equal(a.thread, "", "lead novo ainda não tem conversa");
  assert.equal(a.name, "Ana");
  assert.equal(a.saas, "leverads");
  assert.equal(a.phone, "41992516545");
  // Rótulo da opção, não o valor cru, e sem as perguntas de contato.
  assert.equal(a.text, "3 a 5 contas · Autopeças");
  const lead = await repo.get("leads", a.leadId);
  assert.equal(lead.name, "Ana");
  await app.close();
});

test("reenvio do mesmo contato atualiza o MESMO alerta (não empilha pop-up)", async () => {
  const { app, repo } = await buildApp();
  await submit(app, { answers: ANSWERS });
  await submit(app, { answers: { ...ANSWERS, contas: "1" } });

  const abertos = await alerts(repo);
  assert.equal(abertos.length, 1, "um alerta por lead");
  assert.equal(abertos[0].text, "1 conta · Autopeças", "com o resumo mais novo");
  assert.equal((await repo.list("leads")).length, 1, "e um lead só (dedup por telefone)");
  await app.close();
});

test("teste da equipe não vira pop-up", async () => {
  const { app, repo } = await buildApp();
  assert.equal((await submit(app, { answers: ANSWERS, internal: true })).statusCode, 201);
  assert.equal((await repo.list("leads")).length, 1, "o lead de teste existe");
  assert.equal((await alerts(repo)).length, 0, "mas não interrompe ninguém");
  await app.close();
});

test("cliente que já fechou não vira pop-up de lead novo", async () => {
  const { app, repo } = await buildApp({
    leads: [{ id: "ld_cli", saas: "leverads", name: "Ana", phone: "41992516545", stage: "Ganho" }],
  });
  assert.equal((await submit(app, { answers: ANSWERS })).statusCode, 201);
  assert.equal((await repo.list("leads")).length, 1, "mesclou no card que já existia");
  assert.equal((await alerts(repo)).length, 0, "e não virou pop-up de lead novo");
  await app.close();
});

test("saída lateral (não é fila de venda) não vira pop-up", async () => {
  const comSaida = {
    ...FORM,
    id: "fo_test",
    questions: [
      { key: "nome", label: "Seu nome?", type: "text", required: true },
      { key: "whatsapp", label: "WhatsApp", type: "phone", required: true },
      {
        key: "vende", label: "Já vende?", type: "select", required: true,
        options: [{ value: "sim", label: "Sim" }, { value: "nao", label: "Ainda não", exit: "mentoria", to: "_end" }],
      },
    ],
    exits: { mentoria: { label: "Ainda não vende", stage: "Mentoria" } },
  };
  const repo = makeMemRepo();
  await repo.create("forms", comSaida);
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const app = Fastify();
  registerRoutes(app, repo, {});
  await app.ready();

  assert.equal((await submit(app, { answers: { nome: "Bia", whatsapp: "41988887777", vende: "nao" } })).statusCode, 201);
  assert.equal((await repo.list("leads")).length, 1, "o card da saída existe");
  assert.equal((await alerts(repo)).length, 0, "quem saiu do funil não interrompe o SDR");
  await app.close();
});
