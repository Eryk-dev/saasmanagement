import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { withCompanyQuestion, ensureFormCompanyQuestion, COMPANY_QUESTION } from "../src/platform/migrations.js";
import { FORMS_V2 } from "../src/forms/forms-v2.leverads.js";
import { leadFromSubmission, submissionSummary } from "../src/forms/forms.js";

const diagnostico = () => ({
  id: "fo_diagnostico_leverads", name: "Diagnóstico LeverAds", saas: "leverads", status: "published",
  mapping: { name: "nome", email: "email", phone: "whatsapp" },
  questions: [
    { key: "niche", label: "Nicho", type: "select", options: [{ value: "autopecas", label: "Autopeças" }] },
    { key: "nome", label: "Como você se chama?", type: "text", required: true },
    { key: "whatsapp", label: "WhatsApp", type: "phone", required: true },
    { key: "email", label: "E-mail", type: "email", required: true, stack: true, to: "_end" },
  ],
});

test("formulários v2 pedem a empresa logo depois do nome, na mesma tela, e mapeiam pra company", () => {
  for (const f of FORMS_V2) {
    const keys = f.questions.map((q) => q.key);
    const i = keys.indexOf("nome");
    assert.ok(i >= 0, f.id);
    assert.equal(keys[i + 1], "empresa", f.id);
    const empresa = f.questions[i + 1];
    assert.equal(empresa.stack, true, "empresa divide a tela do nome, sem etapa nova");
    assert.equal(empresa.required, true);
    assert.equal(f.mapping.company, "empresa");
    assert.equal(f.mapping.name, "nome");
  }
});

test("migração insere a empresa depois do nome e grava mapping.company", () => {
  const patch = withCompanyQuestion(diagnostico());
  assert.deepEqual(patch.questions.map((q) => q.key), ["niche", "nome", "empresa", "whatsapp", "email"]);
  assert.deepEqual(patch.mapping, { name: "nome", company: "empresa", email: "email", phone: "whatsapp" });
  assert.equal(patch.questions[2].stack, true);
  assert.equal(patch.questions[2].label, COMPANY_QUESTION.label);
  // a pergunta do e-mail segue intacta (o fim do fluxo continua nela)
  assert.equal(patch.questions[4].to, "_end");
});

test("migração: salto (`to`) que morava no nome passa pra empresa, última da tela", () => {
  const f = diagnostico();
  f.questions[1].to = "whatsapp";
  const patch = withCompanyQuestion(f);
  assert.equal(patch.questions[1].to, undefined);
  assert.equal(patch.questions[2].to, "whatsapp");
});

test("migração é idempotente e só mexe em formulário do LeverAds com mapping.name", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", diagnostico(), "fo_diagnostico_leverads");
  await repo.create("forms", { ...diagnostico(), id: "fo_kids", saas: "uniquekids" }, "fo_kids");
  await repo.create("forms", { id: "fo_sem_nome", saas: "leverads", mapping: {}, questions: [{ key: "x", type: "text" }] }, "fo_sem_nome");
  await repo.create("forms", { ...diagnostico(), id: "fo_ja_tem", mapping: { name: "nome", company: "empresa" } }, "fo_ja_tem");

  assert.equal(await ensureFormCompanyQuestion(repo), 1);
  assert.equal(await ensureFormCompanyQuestion(repo), 0);

  const done = await repo.get("forms", "fo_diagnostico_leverads");
  assert.equal(done.questions[2].key, "empresa");
  assert.equal(done.mapping.company, "empresa");
  assert.equal((await repo.get("forms", "fo_kids")).questions.some((q) => q.key === "empresa"), false);
  assert.equal((await repo.get("forms", "fo_sem_nome")).mapping.company, undefined);
  assert.equal((await repo.get("forms", "fo_ja_tem")).questions.filter((q) => q.key === "empresa").length, 0);
});

test("resposta da empresa vira lead.company e fica fora do resumo de qualificação", () => {
  const form = { ...diagnostico(), ...withCompanyQuestion(diagnostico()) };
  const answers = { niche: "autopecas", nome: "Marina", empresa: "Marina Philippi LTDA", whatsapp: "48999990000", email: "m@x.com" };
  const lead = leadFromSubmission(form, answers);
  assert.equal(lead.name, "Marina");
  assert.equal(lead.company, "Marina Philippi LTDA");
  assert.equal(submissionSummary(form, answers), "Autopeças");
});
