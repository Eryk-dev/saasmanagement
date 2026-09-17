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

// ── Plantio da indicação (Leo, 12/09/2026) ──────────────────────────────────
// O pedido de indicação no fim do formulário é a ÚNICA parte opcional: é a
// exceção à régua "tudo que está visível é obrigatório", que existe pra não
// faltar dado da integração. Nome dado aqui não vira lead: fica na ficha do
// cliente e gera tarefa pra alguém pedir a ponte, porque o próprio formulário
// promete ao cliente que ninguém é procurado antes de ele ser avisado.
test("indicação em branco (ou nem enviada) não bloqueia o formulário", async () => {
  assert.deepEqual(validateIntegrationAnswers(FULL), []);                                  // nem veio no payload
  assert.deepEqual(validateIntegrationAnswers({ ...FULL, indicacoes: [] }), []);            // lista vazia
  // A tela nasce com uma linha em branco: linha sem nada não é resposta.
  const limpo = sanitizeIntegrationAnswers({ ...FULL, indicacoes: [{ nome: "", whatsapp: "" }] });
  assert.deepEqual(limpo.indicacoes, []);
  assert.deepEqual(validateIntegrationAnswers(limpo), []);
});

test("indicação começada tem que ser terminada (nome sem WhatsApp não passa)", async () => {
  const errs = validateIntegrationAnswers({ ...FULL, indicacoes: [{ nome: "Pedro das Peças", whatsapp: "" }] });
  assert.ok(errs.some((e) => e.key === "indicacoes[0].whatsapp"));
});

test("nomes indicados vão pra FICHA do cliente e viram tarefa, sem criar lead", async (t) => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Loja do João", owner: "jonan" });
  await repo.create("users", { id: "jonan", name: "Jonan", roles: ["integrator"] });
  const app = buildApp(repo);
  t.after(() => app.close());
  const doc = (await criar(app)).json();

  const res = await app.inject({
    method: "POST", url: `/public/integration-forms/${doc.id}`,
    payload: { answers: { ...FULL, indicacoes: [
      { nome: "Pedro das Peças", whatsapp: "41988887777" },
      { nome: "Marcos Turbo", whatsapp: "41977776666" },
    ] } },
  });
  assert.equal(res.statusCode, 201);

  const customer = await repo.get("customers", "cu_1");
  assert.equal(customer.referralSeeds.length, 2);
  assert.equal(customer.referralSeeds[0].name, "Pedro das Peças");
  assert.equal(customer.referralSeeds[0].from, "integracao");
  assert.equal((await repo.list("leads")).length, 0, "nome de terceiro não vira lead sem consentimento");

  const task = (await repo.list("tasks")).find((x) => (x.labels || []).includes("indicacao"));
  assert.match(task.title, /Pedir a ponte das indicações de Loja do João/);
  assert.deepEqual(task.assignees, ["jonan"]);         // o dono do cliente pede a ponte
  assert.match(task.description, /Pedro das Peças/);
  assert.match(task.description, /R\$ 500 se fechar/); // o coletor sabe o que ganha
});

// ── Compromissos que o formulário já revela ───────────────────────────────
import { formPendencias } from "../src/integration-form.js";

test("formPendencias: conta não conectada e contas fora do ERP viram pendência", () => {
  const itens = formPendencias({
    contas: [
      { marketplace: "Mercado Livre", apelido: "Loja 1", conectada: "Já está conectada" },
      { marketplace: "Shopee", apelido: "Loja 2", conectada: "Ainda não conectei" },
      { marketplace: "Amazon", apelido: "", conectada: "Ainda não conectei" },
      { marketplace: "Magalu", apelido: "Loja 4", conectada: "Não sei dizer" },
    ],
    erp: "Bling",
    erp_contas: "Só algumas",
  });
  assert.deepEqual(itens, [
    "Conectar a conta Loja 2 (Shopee) na LeverAds",
    "Conectar a conta sem nome (Amazon) na LeverAds",
    "Ligar no Bling as contas que ainda ficaram de fora",
  ]);
});

test("formPendencias: ERP \"Outro\" usa o nome escrito; todas ligadas não gera nada", () => {
  assert.deepEqual(formPendencias({ erp: "Outro", erp_qual: "Bling do primo", erp_contas: "Só algumas" }),
    ["Ligar no Bling do primo as contas que ainda ficaram de fora"]);
  assert.deepEqual(formPendencias({ erp: "Tiny (Olist)", erp_contas: "Sim, todas" }), []);
  assert.deepEqual(formPendencias({ erp: "Não uso" }), []);
});

test("formPendencias: \"Quero decidir na call\" NÃO é pendência do cliente", () => {
  assert.deepEqual(formPendencias({ sync: "Quero decidir na call", contas: [{ conectada: "Já está conectada" }] }), []);
});

test("formPendencias: formulário vazio não inventa pendência", () => {
  assert.deepEqual(formPendencias({}), []);
  assert.deepEqual(formPendencias(), []);
});

// ── Dados pra nota fiscal (kind: "nota_fiscal", Leo 17/09/2026) ──────────────
// Segundo questionário na MESMA máquina: link opaco, envio único, snapshot e
// termo. O que muda é o conteúdo (cadastro do tomador) e o destino: a ficha do
// cliente recebe `fiscal`, pronto pro financeiro emitir a NFS-e.
import { FORM_KINDS } from "../src/integration-form.js";
import { fiscalRecord, fiscalSummary } from "../src/fiscal-form.js";

const FISCAL_PJ = {
  nome: "Ricardo Nunes", funcao: "Sócio", whatsapp: "41999990004", email: "ricardo@rn.example",
  tipo: "Pessoa jurídica (CNPJ)",
  razao_social: "RN Distribuidora de Ferramentas LTDA", nome_fantasia: "RN Distribuidora",
  cnpj: "12.345.678/0001-90", inscricao_estadual: "Isento", regime: "Simples Nacional",
  cep: "80010000", logradouro: "Rua XV de Novembro", numero: "100", bairro: "Centro", cidade: "Curitiba", uf: "PR",
  email_nf: "financeiro@rn.example", momento: "Depois do pagamento (padrão)",
  confere_receita: true, confere_mudanca: true,
  termo_aceite: true, assinatura: "Ricardo Nunes", assinatura_doc: "123.456.789-00",
};

const criarFiscal = (app, extra = {}) => app.inject({
  method: "POST", url: "/api/integration_forms",
  payload: { saas: "leverads", kind: "nota_fiscal", customerId: "cu_1", customerName: "RN Distribuidora", leadId: "le_1", ...extra },
});

test("nota fiscal: o pedido guarda o tipo, e tipo inventado vira integração", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const doc = (await criarFiscal(app)).json();
  assert.equal(doc.kind, "nota_fiscal");
  assert.match(doc.id, /^if_[a-f0-9]{20}$/);
  const outro = (await criarFiscal(app, { kind: "qualquer" })).json();
  assert.equal(outro.kind, "integracao");
  const semKind = (await criar(app)).json();
  assert.equal(semKind.kind, "integracao");
});

test("nota fiscal: a página abre com o título e as perguntas fiscais, e a prévia aceita ?kind", async (t) => {
  const app = buildApp(makeMemRepo());
  t.after(() => app.close());
  const { id } = (await criarFiscal(app)).json();
  const page = await app.inject({ method: "GET", url: `/fi/${id}` });
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes("Dados para nota fiscal"));
  assert.ok(page.body.includes("Endereço fiscal"), "as seções fiscais vão inline pra página");
  assert.ok(!page.body.includes("Suas contas de marketplace"), "as perguntas de integração ficam de fora");

  const prev = await app.inject({ method: "GET", url: "/fi/preview?kind=nota_fiscal" });
  assert.ok(prev.body.includes("Dados para nota fiscal"));
  const prevInt = await app.inject({ method: "GET", url: "/fi/preview" });
  assert.ok(prevInt.body.includes("Suas contas de marketplace"), "sem kind a prévia é a de integração");

  const qs = await app.inject({ method: "GET", url: "/api/integration-forms/questions?kind=nota_fiscal" });
  assert.equal(qs.json().kind, "nota_fiscal");
  assert.deepEqual(qs.json().kinds.map((k) => k.key), ["integracao", "nota_fiscal"]);
});

test("nota fiscal: PJ exige CNPJ com 14 dígitos e não pede CPF; PF é o inverso", () => {
  const secs = FORM_KINDS.nota_fiscal.sections;
  assert.deepEqual(validateIntegrationAnswers(FISCAL_PJ, secs), []);
  assert.ok(validateIntegrationAnswers({ ...FISCAL_PJ, cnpj: "12.345.678/0001-9" }, secs).some((e) => e.key === "cnpj"));
  assert.ok(validateIntegrationAnswers({ ...FISCAL_PJ, cep: "8001" }, secs).some((e) => e.key === "cep"));
  assert.ok(validateIntegrationAnswers({ ...FISCAL_PJ, uf: "XX" }, secs).some((e) => e.key === "uf"));

  const { razao_social, cnpj, inscricao_estadual, regime, ...semPj } = FISCAL_PJ;
  const pf = { ...semPj, tipo: "Pessoa física (CPF)", nome_pf: "Ricardo Nunes", cpf: "123.456.789-00" };
  assert.deepEqual(validateIntegrationAnswers(pf, secs), []);
  assert.ok(validateIntegrationAnswers({ ...pf, cpf: "" }, secs).some((e) => e.key === "cpf"));
  // O que é da PJ não viaja junto quando a resposta é PF.
  const limpo = sanitizeIntegrationAnswers({ ...pf, cnpj: "12.345.678/0001-90" }, secs);
  assert.equal(limpo.cnpj, undefined);
  assert.equal(limpo.nome_fantasia, undefined, "opcional da PJ nem é guardado na resposta PF");
  assert.equal(limpo.complemento, "", "opcional visível em branco fica vazio, não falta");
});

test("nota fiscal: o envio vai pra ficha do cliente e pro card do lead, sem mexer na integração", async (t) => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "RN Distribuidora" });
  await repo.create("leads", { id: "le_1", saas: "leverads", name: "Ricardo" });
  const app = buildApp(repo);
  t.after(() => app.close());
  const { id } = (await criarFiscal(app)).json();

  const faltando = await app.inject({ method: "POST", url: `/public/integration-forms/${id}`, payload: { answers: { ...FISCAL_PJ, confere_receita: false } } });
  assert.equal(faltando.statusCode, 400);

  const res = await app.inject({ method: "POST", url: `/public/integration-forms/${id}`, payload: { answers: FISCAL_PJ } });
  assert.equal(res.statusCode, 201);

  const doc = await repo.get("integration_forms", id);
  assert.equal(doc.status, "respondido");
  assert.equal(doc.kind, "nota_fiscal");
  assert.equal(doc.sections[0].key, "responsavel", "o snapshot é o das perguntas fiscais");
  assert.equal(doc.term, FORM_KINDS.nota_fiscal.term);
  assert.equal(doc.respondent.name, "Ricardo Nunes");

  const customer = await repo.get("customers", "cu_1");
  assert.equal(customer.fiscal.nome, "RN Distribuidora de Ferramentas LTDA");
  assert.equal(customer.fiscal.documento, "12.345.678/0001-90");
  assert.equal(customer.fiscal.endereco.cep, "80010-000");
  assert.equal(customer.fiscal.emailNf, "financeiro@rn.example");
  assert.equal(customer.fiscalFormId, id);

  const lead = await repo.get("leads", "le_1");
  assert.equal(lead.fiscalFormId, id);
  assert.equal(lead.integrationFormId, undefined, "não é o formulário de integração");
  const acts = await repo.list("activities");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.event, "fiscal_form");
  assert.match(acts[0].meta.summary, /RN Distribuidora de Ferramentas LTDA · 12\.345\.678\/0001-90 · Curitiba\/PR · Simples Nacional/);

  const again = await app.inject({ method: "POST", url: `/public/integration-forms/${id}`, payload: { answers: FISCAL_PJ } });
  assert.equal(again.statusCode, 409);
});

test("fiscalRecord/fiscalSummary: PF sai com CPF formatado e sem regime", () => {
  const pf = { tipo: "Pessoa física (CPF)", nome_pf: "Ana Souza", cpf: "98765432100", cidade: "Curitiba", uf: "PR", cep: "80010000" };
  assert.equal(fiscalSummary(pf), "Ana Souza · 987.654.321-00 · Curitiba/PR");
  const r = fiscalRecord(pf, { formId: "if_x", at: "2026-09-17T12:00:00.000Z" });
  assert.equal(r.tipo, "PF");
  assert.equal(r.documento, "987.654.321-00");
  assert.equal(r.regime, "");
  assert.equal(r.formId, "if_x");
});
