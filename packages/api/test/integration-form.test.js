// Formulário de Integração: o questionário que o cliente recém-fechado preenche
// antes da call de integração. O que se garante aqui:
//   1. o pedido nasce com TOKEN opaco (o id é o link público) e status pendente;
//   2. a página /fi/:id abre pro cliente sem API key e some quando o token não existe;
//   3. o envio é validado no SERVIDOR: tudo que está visível é obrigatório, e o
//      que a condicional esconde não é exigido (nem viaja junto);
//   4. responder é um evento ÚNICO: o segundo envio bate em 409;
//   5. a resposta guarda snapshot das perguntas + a assinatura do termo.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { validateIntegrationAnswers, sanitizeIntegrationAnswers } from "../src/integration-form.js";

const { registerRoutes } = await import("../src/routes.js");

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

// Caminho "tudo não": as condicionais ficam todas fechadas, então este é o
// conjunto MÍNIMO completo de um formulário válido.
const FULL = {
  nome: "João da Silva",
  empresa: "Loja do João LTDA",
  documento: "12.345.678/0001-90",
  whatsapp: "41999998888",
  email: "joao@lojadojoao.com.br",
  operador: "Maria, gerente de marketplace",
  contas: [{
    marketplace: "Mercado Livre", apelido: "Loja do João", papel: "É a conta-mãe (é dela que saem os anúncios)",
    conectada: "Já está conectada", envio: "Full", setor: "autopeças", oficial: "Não",
  }],
  mesma_plataforma: "Não",
  rotas: [{ origem: "Loja do João (ML)", destino: "João Peças (Shopee)", oque: "O catálogo inteiro" }],
  rotas_recorte: "catálogo inteiro",
  preco_diferente: "Não, mesmo preço em todas",
  tem_bloqueio: "Não, pode clonar tudo",
  descricao_padrao: "Não, pode manter a descrição do anúncio de origem",
  moda: "Não",
  classico_premium: "O Clássico",
  status_clone: "Sempre pausado (eu ativo depois)",
  erp: "Não uso",
  sync: "Não, cada conta com o estoque dela",
  regra_mesmo_documento: true,
  regra_mae: true, regra_auto: true, regra_shopee: true, regra_edicao: true, regra_mudanca: true,
  observacoes: "nada",
  termo_aceite: true,
  assinatura: "João da Silva",
  assinatura_doc: "123.456.789-00",
};

const criar = (app) => app.inject({
  method: "POST", url: "/api/integration_forms",
  payload: { saas: "leverads", customerId: "cu_1", customerName: "Loja do João", leadId: "le_1" },
});

test("pedido nasce com token opaco e status pendente", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const res = await criar(app);
  assert.equal(res.statusCode, 201);
  const doc = res.json();
  assert.match(doc.id, /^if_[a-f0-9]{20}$/, "o id é o token do link público, não pode ser adivinhável");
  assert.equal(doc.status, "pendente");
  assert.ok(doc.createdAt);
});

test("id mandado pelo cliente não vira token", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const res = await app.inject({ method: "POST", url: "/api/integration_forms", payload: { id: "escolhido", saas: "leverads" } });
  assert.notEqual(res.json().id, "escolhido");
});

test("página /fi/:id abre com o nome do cliente e 404 sem token", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const { id } = (await criar(app)).json();

  const page = await app.inject({ method: "GET", url: `/fi/${id}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.ok(page.body.includes("Loja do João"), "a página se apresenta pro cliente certo");
  assert.ok(page.body.includes("Formulário de Integração"));

  const miss = await app.inject({ method: "GET", url: "/fi/if_naoexiste" });
  assert.equal(miss.statusCode, 404);
});

test("pré-visualização em branco abre pro time", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const res = await app.inject({ method: "GET", url: "/fi/preview" });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes("Formulário de Integração"));
});

test("envio incompleto é recusado com a lista do que falta", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const { id } = (await criar(app)).json();
  const { termo_aceite, assinatura, ...semTermo } = FULL;
  const res = await app.inject({ method: "POST", url: `/public/integration-forms/${id}`, payload: { answers: semTermo } });
  assert.equal(res.statusCode, 400);
  const keys = res.json().details.map((d) => d.key);
  assert.ok(keys.includes("termo_aceite"), "termo não marcado trava o envio");
  assert.ok(keys.includes("assinatura"));
});

test("linha de lista pela metade é recusada", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const { id } = (await criar(app)).json();
  const answers = { ...FULL, contas: [{ ...FULL.contas[0], setor: "" }] };
  const res = await app.inject({ method: "POST", url: `/public/integration-forms/${id}`, payload: { answers } });
  assert.equal(res.statusCode, 400);
  assert.ok(res.json().details.some((d) => d.key === "contas[0].setor"));
});

test("envio completo grava respostas, snapshot e assinatura do termo", async (t) => {
  const repo = makeMemRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const { id } = (await criar(app)).json();

  const res = await app.inject({ method: "POST", url: `/public/integration-forms/${id}`, payload: { answers: FULL } });
  assert.equal(res.statusCode, 201);

  const doc = await repo.get("integration_forms", id);
  assert.equal(doc.status, "respondido");
  assert.ok(doc.respondedAt);
  assert.equal(doc.answers.empresa, "Loja do João LTDA");
  assert.equal(doc.answers.contas.length, 1);
  assert.ok(Array.isArray(doc.sections) && doc.sections.length, "a versão respondida fica congelada no documento");
  assert.ok(Array.isArray(doc.term) && doc.term.length, "o texto do termo assinado fica junto");
  assert.equal(doc.respondent.name, "João da Silva");
  assert.equal(doc.respondent.doc, "123.456.789-00");
  assert.ok(doc.respondent.at);

  // O card do lead fica sabendo (carimbo + timeline).
  const lead = await repo.get("leads", "le_1");
  assert.equal(lead, null, "lead inexistente não quebra o envio");
  const acts = await repo.list("activities");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.event, "integration_form");
});

test("responder é evento único: o segundo envio bate em 409", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const { id } = (await criar(app)).json();
  await app.inject({ method: "POST", url: `/public/integration-forms/${id}`, payload: { answers: FULL } });
  const again = await app.inject({ method: "POST", url: `/public/integration-forms/${id}`, payload: { answers: FULL } });
  assert.equal(again.statusCode, 409);
});

test("condicional: 'sim' abre pergunta obrigatória, 'não' não exige nada", async () => {
  // Fechado: sem diferença de preço, a regra de preço nem é pedida.
  assert.equal(validateIntegrationAnswers(FULL).length, 0);

  // Aberto e vazio: a regra passa a ser obrigatória.
  const abre = { ...FULL, preco_diferente: "Sim, tem diferença" };
  assert.ok(validateIntegrationAnswers(abre).some((e) => e.key === "preco_regra"));

  // Aberto e preenchido: passa.
  assert.equal(validateIntegrationAnswers({ ...abre, preco_regra: "Shopee = ML + 18%" }).length, 0);
});

test("sincronização de estoque só é aceita com o checklist inteiro", async () => {
  const querSync = { ...FULL, sync: "Sim, quero" };
  const faltando = validateIntegrationAnswers(querSync).map((e) => e.key);
  for (const k of ["sync_deposito", "sync_sku", "sync_full", "sync_fonte", "sync_reserva", "sync_ciente"]) {
    assert.ok(faltando.includes(k), `${k} precisa ser exigido quando o cliente pede sincronização`);
  }
});

test("resposta escondida pela condicional não é guardada, e chave inventada some", async () => {
  const sujo = { ...FULL, preco_regra: "regra antiga que ficou pra trás", campo_inventado: "x" };
  const limpo = sanitizeIntegrationAnswers(sujo);
  assert.equal(limpo.preco_regra, undefined);
  assert.equal(limpo.campo_inventado, undefined);
  assert.equal(limpo.empresa, "Loja do João LTDA");
});

// Regra do Mercado Livre (não da LeverAds): conta do mesmo CNPJ/CPF não pode ter
// o mesmo anúncio. O formulário conscientiza e o cliente assume o risco; sem a
// marcação, o envio não passa.
test("ciência da regra de mesmo CNPJ/CPF é obrigatória", async () => {
  const { regra_mesmo_documento, ...semCiencia } = FULL;
  assert.ok(validateIntegrationAnswers(semCiencia).some((e) => e.key === "regra_mesmo_documento"));
  assert.ok(validateIntegrationAnswers({ ...FULL, regra_mesmo_documento: false }).some((e) => e.key === "regra_mesmo_documento"));
});

test("opção fora da lista é recusada (a rota é pública)", async () => {
  const errs = validateIntegrationAnswers({ ...FULL, status_clone: "qualquer coisa" });
  assert.ok(errs.some((e) => e.key === "status_clone"));
});
