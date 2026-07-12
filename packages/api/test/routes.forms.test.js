// Superfície pública do form builder: definição publicada (sanitizada), página
// /f/:id, envio anônimo → lead + submission, validação estrita com branching,
// honeypot e rate-limit. Repo in-memory (sem Postgres), via Fastify inject.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

// Form com branching: porte=small pula direto pro fim (faturamento nem aparece).
const FORM = {
  id: "fo_test",
  name: "Diagnóstico LeverAds",
  saas: "leverads",
  status: "published",
  theme: { accent: "#ff5500" },
  questions: [
    { key: "nome", label: "Seu nome?", type: "text", required: true },
    { key: "email", label: "Seu e-mail?", type: "email", required: true },
    {
      key: "porte", label: "Porte da operação?", type: "select", required: true,
      options: [{ value: "small", label: "Pequeno", to: "_end" }, { value: "big", label: "Grande" }],
    },
    { key: "faturamento", label: "Faturamento mensal?", type: "number", required: true },
  ],
  mapping: { name: "nome", email: "email", amount: "faturamento" },
  thanks: { title: "Valeu!" },
};

async function buildApp(opts = {}) {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM });
  await repo.create("forms", { ...FORM, id: "fo_draft", status: "draft" });
  const app = Fastify();
  registerRoutes(app, repo, opts);
  return { app, repo };
}

const ANSWERS_FULL = { nome: "Ana", email: "ana@ex.com", porte: "big", faturamento: 12000 };

test("GET /public/forms/:id — publicado vem sanitizado; rascunho é 404", async () => {
  const { app } = await buildApp();

  const res = await app.inject({ method: "GET", url: "/public/forms/fo_test" });
  assert.equal(res.statusCode, 200);
  const pub = res.json();
  assert.equal(pub.id, "fo_test");
  assert.equal(pub.questions.length, 4);
  assert.equal(pub.mapping, undefined);
  assert.equal(pub.saas, undefined);
  assert.equal(pub.status, undefined);

  const draft = await app.inject({ method: "GET", url: "/public/forms/fo_draft" });
  assert.equal(draft.statusCode, 404);
  await app.close();
});

test("GET /f/:id — HTML com a definição inline; rascunho é 404", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: "/f/fo_test" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.body, /__FORM__/);
  assert.match(res.body, /Diagnóstico LeverAds/);
  // sanitização vale pra página também: mapping não vaza no inline
  assert.doesNotMatch(res.body, /"mapping"/);

  const draft = await app.inject({ method: "GET", url: "/f/fo_draft" });
  assert.equal(draft.statusCode, 404);
  await app.close();
});

test("POST submission válida → 201, lead mapeado + submission vinculada", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: { answers: ANSWERS_FULL },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().ok, true);

  const leads = await repo.list("leads");
  assert.equal(leads.length, 1);
  const lead = leads[0];
  assert.equal(lead.name, "Ana");
  assert.equal(lead.email, "ana@ex.com");
  assert.equal(lead.saas, "leverads");
  assert.equal(lead.source, "Form · Diagnóstico LeverAds");
  assert.equal(lead.amount, 12000);
  assert.equal(lead.porte, "big");          // respostas entram flat no lead
  assert.equal(lead.form, "fo_test");
  assert.equal(lead.priority, "P2");        // CREATE_DEFAULTS de leads aplicado

  const subs = await repo.list("form_submissions");
  assert.equal(subs.length, 1);
  assert.equal(subs[0].form, "fo_test");
  assert.equal(subs[0].lead, lead.id);
  assert.deepEqual(subs[0].answers, ANSWERS_FULL);
  await app.close();
});

test("submission com template nativo publicado → proposta NATIVA no lead (dispatcher, não levercopy)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("proposal_templates", {
    id: "pt_lever", saas: "leverads", name: "Proposta LeverAds", status: "published",
    slides: [{ key: "hero", type: "hero", title: "Oi {{lead.company}}" }],
    calc: {},
  });

  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: { answers: ANSWERS_FULL },
  });
  assert.equal(res.statusCode, 201);

  const [lead] = await repo.list("leads");
  assert.ok(lead.proposta_id, "auto-trigger do form gerou proposta");
  assert.match(lead.proposalUrl, /\/p\//); // URL nativa, não levercopy
  const proposal = await repo.get("proposals", lead.proposta_id);
  assert.equal(proposal.saas, "leverads"); // snapshot nativo persistido
  await app.close();
});

test("validação: obrigatória faltando, chave desconhecida e opção inválida → 400", async () => {
  const { app, repo } = await buildApp();

  const missing = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: { answers: { nome: "Ana", porte: "big", faturamento: 1 } }, // sem email
  });
  assert.equal(missing.statusCode, 400);
  assert.ok(missing.json().details.some((d) => d.includes("email")));

  const unknown = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: { answers: { ...ANSWERS_FULL, hack: "x" } },
  });
  assert.equal(unknown.statusCode, 400);

  const badOpt = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: { answers: { ...ANSWERS_FULL, porte: "huge" } },
  });
  assert.equal(badOpt.statusCode, 400);

  assert.equal((await repo.list("leads")).length, 0);
  await app.close();
});

test("branching: opção com to:_end pula pergunta obrigatória seguinte → aceito", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: { answers: { nome: "Bia", email: "bia@ex.com", porte: "small" } }, // sem faturamento
  });
  assert.equal(res.statusCode, 201);
  const [lead] = await repo.list("leads");
  assert.equal(lead.name, "Bia");
  assert.equal(lead.amount, 0); // sem faturamento no caminho → default de lead
  await app.close();
});

test("honeypot preenchido → finge sucesso e não grava nada", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: { answers: ANSWERS_FULL, _hp: "spam-bot" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
  assert.equal((await repo.list("leads")).length, 0);
  assert.equal((await repo.list("form_submissions")).length, 0);
  await app.close();
});

test("rate-limit por IP: acima do limite → 429", async () => {
  const { app } = await buildApp({ forms: { rateLimit: 3 } });
  for (let i = 0; i < 3; i++) {
    const r = await app.inject({
      method: "POST", url: "/public/forms/fo_test/submissions",
      payload: { answers: { nome: `L${i}`, email: "l@ex.com", porte: "small" } },
    });
    assert.equal(r.statusCode, 201);
  }
  const blocked = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: { answers: { nome: "L4", email: "l@ex.com", porte: "small" } },
  });
  assert.equal(blocked.statusCode, 429);
  await app.close();
});

// Form com tela de insight (sem resposta) + duas perguntas empilhadas na mesma
// tela (stack). Required das empilhadas vale; insight não aceita resposta.
const FORM_STEPS = {
  id: "fo_steps",
  name: "Form com telas",
  saas: "leverads",
  status: "published",
  questions: [
    { key: "contas", label: "Quantas contas?", type: "select", required: true,
      options: [{ value: "1", label: "1" }, { value: "2+", label: "2+" }] },
    { key: "ins1", label: "Cada conta soma *50%* de receita.", type: "insight", stat: "+50%", statLabel: "por conta", durationMs: 1200 },
    { key: "nome", label: "Seu nome?", type: "text", required: true },
    { key: "email", label: "Seu e-mail?", type: "email", required: true, stack: true },
    { key: "fone", label: "WhatsApp?", type: "phone", required: false, stack: true },
  ],
  mapping: { name: "nome", email: "email", phone: "fone" },
  thanks: {},
};

test("insight + stack: required das empilhadas vale; insight não aceita resposta", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM_STEPS });
  const app = Fastify();
  registerRoutes(app, repo);

  // e-mail (empilhada, required) faltando → 400 mesmo estando "na mesma tela"
  const missing = await app.inject({
    method: "POST", url: "/public/forms/fo_steps/submissions",
    payload: { answers: { contas: "1", nome: "Ana" } },
  });
  assert.equal(missing.statusCode, 400);
  assert.ok(missing.json().details.some((d) => d.includes("email")));

  // resposta endereçando a tela de insight → 400
  const insightAns = await app.inject({
    method: "POST", url: "/public/forms/fo_steps/submissions",
    payload: { answers: { contas: "1", nome: "Ana", email: "a@ex.com", ins1: "hack" } },
  });
  assert.equal(insightAns.statusCode, 400);
  assert.ok(insightAns.json().details.some((d) => d.includes("ins1")));

  // fluxo válido: insight pulado na validação, fone opcional vazio ok
  const ok = await app.inject({
    method: "POST", url: "/public/forms/fo_steps/submissions",
    payload: { answers: { contas: "2+", nome: "Ana", email: "a@ex.com" } },
  });
  assert.equal(ok.statusCode, 201);
  const [lead] = await repo.list("leads");
  assert.equal(lead.name, "Ana");
  assert.equal(lead.email, "a@ex.com");
  assert.equal(lead.ins1, undefined); // chave de insight nunca vira campo do lead

  await app.close();
});

test("GET /embed.js → script com mount por data-cockpit-form", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: "/embed.js" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /javascript/);
  assert.match(res.body, /data-cockpit-form/);
  await app.close();
});

// Form com saída de NÃO-qualificado: opção "nao" rota pra "_reject".
const FORM_REJECT = {
  id: "fo_reject",
  name: "Qualificação",
  saas: "leverads",
  status: "published",
  questions: [
    { key: "nome", label: "Seu nome?", type: "text", required: true },
    { key: "email", label: "Seu e-mail?", type: "email", required: true },
    {
      key: "expand", label: "Pretende expandir?", type: "select", required: true,
      options: [{ value: "sim", label: "Sim", to: "_end" }, { value: "nao", label: "Não", to: "_reject" }],
    },
  ],
  mapping: { name: "nome", email: "email" },
  thanks: { title: "Valeu!" },
  reject: { title: "Obrigado pelo interesse" },
};

function fakeCapi() {
  const calls = [];
  return { calls, configured: () => true, sendLead: async (a) => { calls.push(a); } };
}

test("submission desqualificada (_reject) → lead marcado, sem proposta, CAPI NÃO dispara", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM_REJECT });
  const capi = fakeCapi();
  const app = Fastify();
  registerRoutes(app, repo, { metaCapi: capi });

  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_reject/submissions",
    payload: { answers: { nome: "Bob", email: "bob@ex.com", expand: "nao" }, eventId: "evt-x", fbp: "fb.1.2.3" },
  });
  assert.equal(res.statusCode, 201);

  const leads = await repo.list("leads");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].disqualified, true);
  assert.equal(leads[0].stage, "disqualified");
  // Não conta como conversão: CAPI não foi chamado.
  assert.equal(capi.calls.length, 0);
  await app.close();
});

test("salvar form sincroniza leadQuestions do produto (upsert por chave, preserva curados)", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM });
  // Produto com um leadQuestion curado e SEM a pergunta `porte` do form.
  await repo.create("products", {
    id: "leverads",
    leadQuestions: [{ key: "legado", label: "Curado", options: [{ value: "a", label: "A" }] }],
  });
  const app = Fastify();
  registerRoutes(app, repo);

  // Edita o form (qualquer PATCH) → dispara o sync.
  const res = await app.inject({
    method: "PATCH", url: "/api/forms/fo_test",
    payload: { name: "Diagnóstico LeverAds v2" },
  });
  assert.equal(res.statusCode, 200);

  const prod = await repo.get("products", "leverads");
  const keys = (prod.leadQuestions || []).map((q) => q.key);
  // Curado preservado + pergunta `porte` do form adicionada; contato/insight fora.
  assert.deepEqual(keys, ["legado", "porte"]);
  const porte = prod.leadQuestions.find((q) => q.key === "porte");
  assert.equal(porte.label, "Porte da operação?");
  assert.equal(porte.options.length, 2); // small + big
  assert.equal(prod.leadQuestions[0].label, "Curado"); // label curado intacto
  await app.close();
});

test("submission qualificada (_end) → CAPI dispara e lead NÃO é desqualificado", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM_REJECT });
  const capi = fakeCapi();
  const app = Fastify();
  registerRoutes(app, repo, { metaCapi: capi });

  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_reject/submissions",
    payload: { answers: { nome: "Ana", email: "ana@ex.com", expand: "sim" }, eventId: "evt-y", fbp: "fb.1.2.3" },
  });
  assert.equal(res.statusCode, 201);

  const leads = await repo.list("leads");
  assert.equal(leads[0].disqualified, undefined);
  // Conversão dispara com o event_id compartilhado e a PII do lead.
  assert.equal(capi.calls.length, 1);
  assert.equal(capi.calls[0].eventId, "evt-y");
  assert.equal(capi.calls[0].email, "ana@ex.com");
  await app.close();
});

test("GET /f/:id — pixel POR PRODUTO (product.metaPixelId) substitui o default do env", async () => {
  const { app, repo } = await buildApp();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaPixelId: "555000111222333" });

  const res = await app.inject({ method: "GET", url: "/f/fo_test" });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /fbq\('init', '555000111222333'\)/);
  assert.doesNotMatch(res.body, /971201888623790/);
  await app.close();
});

test("GET /f/:id — produto sem metaPixelId cai no pixel default (env/legado)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("products", { id: "leverads", name: "LeverAds" });

  const res = await app.inject({ method: "GET", url: "/f/fo_test" });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /fbq\('init', '971201888623790'\)/);
  await app.close();
});

test("CAPI recebe o pixel do produto do form (multi-produto)", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM_REJECT, saas: "uniquekids" });
  await repo.create("products", { id: "uniquekids", name: "UniqueKids", metaPixelId: "888999777666555" });
  const capi = fakeCapi();
  const app = Fastify();
  registerRoutes(app, repo, { metaCapi: capi });

  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_reject/submissions",
    payload: { answers: { nome: "Ana", email: "ana@ex.com", expand: "sim" }, eventId: "evt-z" },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(capi.calls.length, 1);
  assert.equal(capi.calls[0].pixelId, "888999777666555");
  await app.close();
});

test("suggest-welcome: gera variante por IA com contexto do form; 503 sem chave", async () => {
  const calls = [];
  const anthropic = {
    configured: () => true,
    suggestWelcome: async (args) => { calls.push(args); return { suggestion: { title: "T nova", subtitle: "S", button: "Começar" } }; },
  };
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("forms", {
    ...FORM,
    welcome: { title: "Base", subtitle: "sub", button: "Ir", variantSeq: 2, variants: [{ id: "001", title: "V1" }], byPain: { A: { variants: [{ id: "A-001", title: "VA" }] } } },
  });
  const app = Fastify();
  registerRoutes(app, repo, { anthropic });

  const res = await app.inject({ method: "POST", url: "/api/forms/fo_test/suggest-welcome", payload: { startRate: 10 } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { title: "T nova", subtitle: "S", button: "Começar" });
  assert.equal(calls[0].welcome.title, "Base");
  assert.deepEqual(calls[0].variants, ["V1", "VA"]); // títulos já testados (base + por dor)
  assert.equal(calls[0].startRate, 10);
  assert.equal(calls[0].productName, "LeverAds");

  // sem chave de IA → 503 com mensagem acionável
  const off = Fastify();
  registerRoutes(off, repo, { anthropic: { configured: () => false } });
  assert.equal((await off.inject({ method: "POST", url: "/api/forms/fo_test/suggest-welcome", payload: {} })).statusCode, 503);
  // form inexistente → 404
  assert.equal((await app.inject({ method: "POST", url: "/api/forms/nada/suggest-welcome", payload: {} })).statusCode, 404);
  await app.close();
  await off.close();
});
