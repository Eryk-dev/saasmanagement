// Captura da indicação nas duas bordas públicas:
//   1. o LINK do cliente (/f/:id?ref=cu_x): o vínculo nasce sozinho, creditado
//      a quem o link diz (?refby=) ou ao dono do cliente, e link ruim nunca
//      derruba o envio de quem está preenchendo;
//   2. o PLANTIO no Formulário de Integração: os nomes ficam na ficha do
//      cliente e geram tarefa, sem virar lead (ninguém é procurado antes de o
//      cliente ser avisado, é o que o próprio formulário promete).
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FORM = {
  id: "fo_test", name: "Diagnóstico", saas: "leverads", status: "published",
  questions: [
    { key: "nome", label: "Seu nome?", type: "text", required: true },
    { key: "whatsapp", label: "WhatsApp", type: "phone", required: true },
  ],
  mapping: { name: "nome", phone: "whatsapp" },
  thanks: { title: "Valeu!" },
};
const ANSWERS = { nome: "Ana", whatsapp: "41992516545" };

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", kind: "novo" }] });
  await repo.create("users", { id: "jonan", name: "Jonan", roles: ["integrator"] });
  await repo.create("users", { id: "jessica", name: "Jéssica", roles: ["sdr"] });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Azul Pet", owner: "jonan", leadId: "le_velho" });
  const app = Fastify(); registerRoutes(app, repo); await app.ready();
  return { app, repo };
}
const submit = (app, utm) => app.inject({ method: "POST", url: "/public/forms/fo_test/submissions", payload: { answers: ANSWERS, ...(utm ? { utm } : {}) } });

test("form com ?ref= do cliente: vínculo nasce creditado ao DONO do cliente", async (t) => {
  const { app, repo } = await buildApp();
  t.after(() => app.close());
  const res = await submit(app, { ref: "cu_1" });
  assert.equal(res.statusCode, 201);
  const lead = (await repo.list("leads")).find((l) => l.phone === ANSWERS.whatsapp);
  assert.equal(lead.referredByCustomer, "cu_1");
  assert.equal(lead.referralCollectedBy, "jonan"); // o link é do cliente; quem cuida dele colhe
  assert.ok(lead.referralAt);
  assert.equal(lead.source, "Indicação");
  const ev = (await repo.list("activities")).find((a) => a.meta?.event === "referral_collected");
  assert.equal(ev.meta.customer, "cu_1");
  assert.equal(ev.meta.collectedBy, "jonan");
});

test("?refby= manda no crédito; usuário inventado cai pro dono do cliente", async (t) => {
  const { app, repo } = await buildApp();
  t.after(() => app.close());
  await submit(app, { ref: "cu_1", refby: "jessica" });
  let lead = (await repo.list("leads")).find((l) => l.phone === ANSWERS.whatsapp);
  assert.equal(lead.referralCollectedBy, "jessica");

  await repo.create("leads", {}); // ruído
  const r2 = await app.inject({ method: "POST", url: "/public/forms/fo_test/submissions", payload: { answers: { nome: "Bia", whatsapp: "41911112222" }, utm: { ref: "cu_1", refby: "ninguem" } } });
  assert.equal(r2.statusCode, 201);
  lead = (await repo.list("leads")).find((l) => l.phone === "41911112222");
  assert.equal(lead.referralCollectedBy, "jonan");
});

test("ref inválido não vira vínculo e NÃO derruba o envio do formulário", async (t) => {
  const { app, repo } = await buildApp();
  t.after(() => app.close());
  const res = await submit(app, { ref: "cu_naoexiste" });
  assert.equal(res.statusCode, 201, "a pessoa está do outro lado preenchendo: link ruim não pode falhar");
  const lead = (await repo.list("leads")).find((l) => l.phone === ANSWERS.whatsapp);
  assert.equal(lead.referredByCustomer || "", "");  // nasce vazio pelos defaults, não vinculado
  assert.notEqual(lead.source, "Indicação");
  assert.equal((await repo.list("activities")).some((a) => a.meta?.event === "referral_collected"), false);
});

test("teste da equipe (internal) com ?ref= não entra como indicação", async (t) => {
  const { app, repo } = await buildApp();
  t.after(() => app.close());
  await app.inject({ method: "POST", url: "/public/forms/fo_test/submissions", payload: { answers: ANSWERS, internal: true, utm: { ref: "cu_1" } } });
  const lead = (await repo.list("leads")).find((l) => l.internal);
  assert.match(lead.source, /teste da equipe/);
  assert.equal((await repo.list("activities")).some((a) => a.meta?.event === "referral_collected"), false);
});
