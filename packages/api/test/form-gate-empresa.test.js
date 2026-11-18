// Corte de qualificação por empresa aberta + ramo da Mentoria (Leo, 18/11/2026).
//
// O fluxo existia desde jul/2026 e tinha ficado só no formulário antigo. Aqui o
// que se garante é o caminho das duas pontas: quem tem CNPJ não vê nada de
// diferente além da tela do corte, e quem não tem sai pela lateral sem ser
// perguntado pelo nome de uma empresa que ele acabou de dizer que não tem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { FORMS_V2, FORM_IDS, GATE_KEY, EXITS, comGateDeEmpresa } from "../src/forms/forms-v2.leverads.js";
import {
  computePath, submissionExit, submissionTerminal, validateAnswers,
  leadFromSubmission, submissionSummary, publicForm,
} from "../src/forms/forms.js";
import { formPageHtml } from "../src/forms/form-page.js";
import { withGateEmpresa, ensureFormGateEmpresa } from "../src/platform/migrations.js";
import { LEAD_QUESTIONS_UNIAO, questionsFor } from "../src/forms/lead-questions.produtos.js";

const ads = () => FORMS_V2.find((f) => f.id === FORM_IDS.ads);

const vendaOk = {
  tem_empresa: "sim", niche: "autopecas", accounts: "2-3", listings: "1000-5000",
  trigger: "Quero escalar", orders: "500-1000", ticket: "150-300",
  nome: "Leonardo", empresa: "Lever", whatsapp: "41999999999", email: "leo@lever.com",
};
const ramoOk = {
  tem_empresa: "nao", aprender_interesse: "sim", aprender_verba: "5k-20k",
  nome: "Leonardo", whatsapp: "41999999999", email: "leo@lever.com",
};

test("o corte abre os três formulários e as duas saídas existem", () => {
  for (const f of FORMS_V2) {
    assert.equal(f.questions[0].key, GATE_KEY, f.id);
    assert.equal(f.questions[0].required, true, f.id);
    const nao = f.questions[0].options.find((o) => o.value === "nao");
    assert.equal(nao.exit, "mentoria", f.id);
    assert.equal(nao.to, "aprender_interesse", f.id);
    assert.deepEqual(Object.keys(f.exits), ["mentoria", "sem_interesse"], f.id);
    assert.equal(f.exits.mentoria.stage, "Mentoria", f.id);
    // O ramo fica no FIM: o fluxo de venda termina na última pergunta de contato.
    const keys = f.questions.map((q) => q.key);
    assert.deepEqual(keys.slice(-2), ["aprender_interesse", "aprender_verba"], f.id);
    assert.equal(f.questions.find((q) => q.key === "email").to, "_end", f.id);
    assert.equal(f.questions.find((q) => q.key === "aprender_verba").to, "nome", f.id);
  }
});

test("quem tem CNPJ segue o fluxo de venda inteiro, sem passar pelo ramo", () => {
  const f = ads();
  const caminho = computePath(f.questions, vendaOk).map((q) => q.key);
  assert.equal(caminho[0], GATE_KEY);
  assert.ok(caminho.includes("empresa"), "a empresa continua sendo perguntada na venda");
  assert.ok(!caminho.includes("aprender_interesse"));
  assert.ok(!caminho.includes("aprender_verba"));
  assert.equal(submissionExit(f.questions, vendaOk), "");
  assert.equal(submissionTerminal(f.questions, vendaOk), "_end");
  assert.deepEqual(validateAnswers(f, vendaOk), []);
});

test("quem não tem empresa sai pela Mentoria e NÃO é perguntado pelo nome da empresa", () => {
  const f = ads();
  const caminho = computePath(f.questions, ramoOk).map((q) => q.key);
  assert.deepEqual(caminho, [GATE_KEY, "aprender_interesse", "aprender_verba", "nome", "whatsapp", "email"]);
  assert.ok(!caminho.includes("empresa"));
  assert.equal(submissionExit(f.questions, ramoOk), "mentoria");
  // Sem a empresa no caminho, a obrigatoriedade dela não cobra ninguém.
  assert.deepEqual(validateAnswers(f, ramoOk), []);
  // E o contato continua valendo pelo mapping (é o que faz o card ser trabalhável).
  const lead = leadFromSubmission(f, ramoOk);
  assert.equal(lead.name, "Leonardo");
  assert.equal(lead.phone, "41999999999");
  assert.equal(lead.aprender_verba, "5k-20k");
});

test("empresa digitada antes de voltar e trocar a resposta não entra no lead", () => {
  const f = ads();
  const voltou = { ...ramoOk, empresa: "Loja que eu ia abrir" };
  assert.deepEqual(validateAnswers(f, voltou), []);
  const lead = leadFromSubmission(f, voltou);
  assert.equal(lead.company, undefined);
  assert.equal(lead.empresa, undefined);
});

test("quem não quer começar a vender para no form, sem contato", () => {
  const f = ads();
  const answers = { tem_empresa: "nao", aprender_interesse: "nao" };
  assert.equal(submissionExit(f.questions, answers), "sem_interesse");
  assert.equal(submissionTerminal(f.questions, answers), "_end");
  const caminho = computePath(f.questions, answers).map((q) => q.key);
  assert.ok(!caminho.includes("nome"), "não pede contato de quem disse não duas vezes");
  assert.deepEqual(validateAnswers(f, answers), []);
});

test("o resumo do aviso de lead novo não gasta vaga com a resposta do corte", () => {
  const f = ads();
  const resumo = submissionSummary(f, vendaOk);
  assert.ok(!/CNPJ/.test(resumo), resumo);
  assert.match(resumo, /^Autopeças/);
});

test("a página pública leva hideOnExit e o renderer respeita a saída", () => {
  const pub = publicForm(ads());
  assert.deepEqual(pub.questions.find((q) => q.key === "empresa").hideOnExit, ["mentoria"]);
  const html = formPageHtml(pub, { id: FORM_IDS.ads });
  assert.match(html, /function hiddenQ/);
  assert.match(html, /function visibleOf/);
  assert.match(html, /qs = visibleOf\(cur\)/);
});

test("o corte não vira pergunta do card; o ramo vira", () => {
  const chaves = LEAD_QUESTIONS_UNIAO.map((q) => q.key);
  assert.ok(!chaves.includes(GATE_KEY));
  assert.ok(chaves.includes("aprender_verba"));
  assert.ok(!questionsFor("oem").some((q) => q.key === GATE_KEY));
});

test("comGateDeEmpresa é idempotente", () => {
  const uma = comGateDeEmpresa(ads().questions);
  assert.deepEqual(uma.map((q) => q.key), ads().questions.map((q) => q.key));
});

test("migração: formulário publicado ganha o corte, o ramo e as saídas", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", leadQuestions: [] }, "leverads");
  await repo.create("forms", {
    id: "fo_ads_v2", name: "Diagnóstico Lever Ads", saas: "leverads", status: "published",
    mapping: { name: "nome", company: "empresa", email: "email", phone: "whatsapp" },
    questions: [
      { key: "niche", label: "Nicho", type: "select", required: true, options: [{ value: "autopecas", label: "Autopeças" }] },
      { key: "nome", label: "Como você se chama?", type: "text", required: true },
      { key: "empresa", label: "E o nome da sua *empresa*?", type: "text", required: true, stack: true },
      { key: "whatsapp", label: "WhatsApp", type: "phone", required: true },
      { key: "email", label: "E-mail", type: "email", required: true, stack: true },
    ],
  }, "fo_ads_v2");
  // Form de outro produto não é tocado.
  await repo.create("forms", { id: "fo_outro", saas: "uniquekids", mapping: { name: "nome" }, questions: [{ key: "nome", type: "text" }] }, "fo_outro");
  // Form que já manda gente pra Mentoria por outra pergunta fica como está.
  await repo.create("forms", {
    id: "fo_diagnostico_leverads", saas: "leverads", mapping: { name: "nome" },
    questions: [{ key: "vende_marketplace", type: "select", options: [{ value: "nao", label: "Ainda não", exit: "mentoria" }] }, { key: "nome", type: "text" }],
    exits: { mentoria: { label: "Ainda não vende em marketplace", stage: "Mentoria" } },
  }, "fo_diagnostico_leverads");

  assert.equal(await ensureFormGateEmpresa(repo), 1);
  const form = await repo.get("forms", "fo_ads_v2");
  assert.deepEqual(form.questions.map((q) => q.key),
    [GATE_KEY, "niche", "nome", "empresa", "whatsapp", "email", "aprender_interesse", "aprender_verba"]);
  assert.deepEqual(form.questions.find((q) => q.key === "empresa").hideOnExit, ["mentoria"]);
  assert.equal(form.questions.find((q) => q.key === "email").to, "_end");
  assert.equal(form.exits.mentoria.stage, "Mentoria");
  assert.equal(form.exits.mentoria.title, EXITS.mentoria.title);
  // O painel do card ganhou a verba do ramo (sem ela o closer não sabe o que ofertar).
  const produto = await repo.get("products", "leverads");
  assert.ok(produto.leadQuestions.some((q) => q.key === "aprender_verba"));
  assert.ok(!produto.leadQuestions.some((q) => q.key === GATE_KEY));
  // Idempotente e sem mexer no que não é dele.
  assert.equal(await ensureFormGateEmpresa(repo), 0);
  assert.equal((await repo.get("forms", "fo_outro")).questions.length, 1);
  assert.equal((await repo.get("forms", "fo_diagnostico_leverads")).questions.length, 2);
  assert.equal(withGateEmpresa(await repo.get("forms", "fo_diagnostico_leverads")), null);
});
