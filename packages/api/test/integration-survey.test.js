// Pesquisa de satisfação da integração (customers/integration-survey.js): link
// por integração enviado à mão pelo CS, página pública de três perguntas, nota
// baixa vira acompanhamento e o agregado por integrador da Análise de Integração.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  askIntegrationSurvey, answerIntegrationSurvey, cleanScore, surveyStats, surveyText, SURVEYS,
} from "../src/customers/integration-survey.js";
import { surveyPageHtml } from "../src/customers/integration-survey-page.js";
import { registerIntegrationSurveyRoutes } from "../src/customers/routes.integration-survey.js";
import { statusRow } from "../src/customers/customer-status.js";

const NOW = new Date("2026-11-20T15:00:00.000Z");
const fakeMailer = (caixa, ok = true) => ({ ready: async () => ok, send: async (m) => { caixa.push(m); return { id: "m1" }; } });

async function seed({ customer = {}, onboarding = {} } = {}) {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Lupa", contact: "Ana", owner: "dona", email: "ana@lupa.com.br", ...customer });
  await repo.create("onboardings", { id: "ob_1", customer: "cu_1", saas: "leverads", kind: "implantacao", integrator: "eryk", stage: "concluida", lead: "l1", ...onboarding });
  return repo;
}

test("cleanScore: só inteiro de 1 a 5", () => {
  assert.deepEqual([1, 5, "3"].map(cleanScore), [1, 5, 3]);
  assert.deepEqual([0, 6, 2.5, "", null, true, "x"].map(cleanScore), [null, null, null, null, null, null, null]);
});

test("pedir: cria uma pesquisa por integração e reaproveita o mesmo link enquanto não há resposta", async () => {
  const repo = await seed();
  const a = await askIntegrationSurvey(repo, "ob_1", { channel: "link", baseUrl: "https://levermoney.com.br/", by: "cs", now: () => NOW });
  assert.match(a.link, /^https:\/\/levermoney\.com\.br\/public\/pesquisa\/[0-9a-f]{32}$/);
  assert.deepEqual([a.survey.integrator, a.survey.owner, a.survey.status, a.survey.channel], ["eryk", "dona", "sent", "link"]);
  assert.match(a.text, /^Oi, Ana! .*3 perguntas rápidas.*\/public\/pesquisa\//);
  const b = await askIntegrationSurvey(repo, "ob_1", { channel: "whatsapp", now: () => NOW });
  assert.equal(b.survey.id, a.survey.id);
  assert.equal(b.survey.channel, "link+whatsapp");
  assert.equal((await repo.list(SURVEYS)).length, 1);
});

test("pedir por e-mail manda pela conta conectada; sem e-mail ou sem conta, 409 com o caminho alternativo", async () => {
  const caixa = [];
  const repo = await seed();
  await askIntegrationSurvey(repo, "ob_1", { channel: "email", mailer: fakeMailer(caixa), baseUrl: "https://x.com", now: () => NOW });
  assert.equal(caixa.length, 1);
  assert.equal(caixa[0].to, "ana@lupa.com.br");
  assert.match(caixa[0].text, /https:\/\/x\.com\/public\/pesquisa\//);
  await assert.rejects(askIntegrationSurvey(repo, "ob_1", { channel: "email", mailer: fakeMailer([], false) }), /Nenhuma conta de e-mail/);
  const semEmail = await seed({ customer: { email: "" } });
  await assert.rejects(askIntegrationSurvey(semEmail, "ob_1", { channel: "email", mailer: fakeMailer([]) }), (e) => e.statusCode === 409);
});

test("pedir: integração cancelada e canal inválido são recusados", async () => {
  await assert.rejects(askIntegrationSurvey(await seed({ onboarding: { stage: "cancelada" } }), "ob_1"), /cancelada/);
  await assert.rejects(askIntegrationSurvey(await seed(), "ob_1", { channel: "sms" }), (e) => e.statusCode === 400);
  await assert.rejects(askIntegrationSurvey(await seed(), "ob_x"), (e) => e.statusCode === 404);
});

test("responder: nota boa grava sem acompanhamento; já respondida não pede de novo", async () => {
  const repo = await seed();
  const { survey } = await askIntegrationSurvey(repo, "ob_1", { now: () => NOW });
  const s = await answerIntegrationSurvey(repo, survey, { score: 5, ready: "sim", comment: "  top  " }, { now: () => NOW });
  assert.deepEqual([s.status, s.score, s.ready, s.comment, s.followup], ["answered", 5, "sim", "top", ""]);
  assert.equal((await repo.list("cs_followups")).length, 0);
  await assert.rejects(askIntegrationSurvey(repo, "ob_1"), /já respondeu/);
  const tl = (await repo.list("timeline_events")).map((t) => t.kind);
  assert.ok(tl.includes("integration_survey.sent") && tl.includes("integration_survey.answered"));
});

test("responder: nota até 3 abre UM acompanhamento pro dono da conta; comentário depois entra nas notas", async () => {
  const repo = await seed();
  const { survey } = await askIntegrationSurvey(repo, "ob_1", { now: () => NOW });
  let s = await answerIntegrationSurvey(repo, survey, { score: 2 }, { now: () => NOW });
  const [f] = await repo.list("cs_followups");
  assert.deepEqual([f.kind, f.owner, f.title, f.source, f.status], ["check_in", "dona", "Pesquisa da integração: nota 2 de 5", "pesquisa_integracao", "aberto"]);
  assert.equal(f.dueAt, "2026-11-21T15:00:00.000Z");
  assert.equal(s.followup, f.id);
  s = await answerIntegrationSurvey(repo, s, { ready: "nao", comment: "faltou treinar o time" }, { now: () => NOW });
  assert.equal((await repo.list("cs_followups")).length, 1, "não duplica");
  assert.match((await repo.get("cs_followups", f.id)).notes, /faltou treinar o time/);
});

test("responder: nota boa mas 'ainda não usa sozinho' também pede contato", async () => {
  const repo = await seed();
  const { survey } = await askIntegrationSurvey(repo, "ob_1", { now: () => NOW });
  await answerIntegrationSurvey(repo, survey, { score: 4, ready: "nao" }, { now: () => NOW });
  assert.equal((await repo.list("cs_followups"))[0].title, "Pesquisa da integração: ainda não usa sozinho");
});

test("responder: trocar a nota vale por 15 minutos; depois é 409; nota inválida é 400", async () => {
  const repo = await seed();
  const { survey } = await askIntegrationSurvey(repo, "ob_1", { now: () => NOW });
  await assert.rejects(answerIntegrationSurvey(repo, survey, { score: 9 }), (e) => e.statusCode === 400);
  let s = await answerIntegrationSurvey(repo, survey, { score: 5 }, { now: () => NOW });
  s = await answerIntegrationSurvey(repo, s, { score: 4 }, { now: () => new Date(NOW.getTime() + 60_000) });
  assert.equal(s.score, 4);
  await assert.rejects(answerIntegrationSurvey(repo, s, { score: 1 }, { now: () => new Date(NOW.getTime() + 20 * 60_000) }), (e) => e.statusCode === 409);
});

test("rotas: CS pede pelo card, cliente responde pela página pública", async () => {
  const repo = await seed();
  const app = Fastify();
  registerIntegrationSurveyRoutes(app, repo, {});
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/customers/onboardings/ob_1/survey" })).json(), { survey: null });
  const r = await app.inject({ method: "POST", url: "/api/customers/onboardings/ob_1/survey", payload: { channel: "link" }, headers: { host: "cockpit.test" } });
  assert.equal(r.statusCode, 201);
  const token = r.json().link.split("/").pop();
  const page = await app.inject({ method: "GET", url: `/public/pesquisa/${token}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Como foi a sua integração com a Lever\?/);
  assert.equal((await app.inject({ method: "GET", url: "/public/pesquisa/naoexiste" })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: `/public/pesquisa/${token}`, payload: { score: 0 } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: `/public/pesquisa/${token}`, payload: { score: 3 } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: `/public/pesquisa/${token}`, payload: { ready: "parcial", comment: "ok" } })).statusCode, 200);
  const got = (await app.inject({ method: "GET", url: "/api/customers/onboardings/ob_1/survey" })).json().survey;
  assert.deepEqual([got.status, got.score, got.ready, got.comment, Boolean(got.followup)], ["answered", 3, "parcial", "ok", true]);
  assert.match((await app.inject({ method: "GET", url: `/public/pesquisa/${token}` })).body, /Obrigado!/);
  await app.close();
});

test("página: escapa o nome do cliente e não usa template literal no script", () => {
  const html = surveyPageHtml({ token: "a".repeat(32), company: "<Loja>", contact: "Ana" });
  assert.ok(html.includes("&lt;Loja&gt;") && !html.includes("<Loja>"));
  assert.ok(!html.slice(html.indexOf("(function ()")).includes("`"));
  assert.match(surveyText({ name: "Lupa" }, "L", { canal: "email" }), /^Oi, Lupa\./);
});

test("agregado: média, prontidão e por integrador; a linha da Carteira mostra a última resposta", () => {
  const rows = [
    { integrator: "eryk", status: "answered", score: 5, ready: "sim", answeredAt: "2026-11-02", customer: "a" },
    { integrator: "eryk", status: "answered", score: 2, ready: "nao", answeredAt: "2026-11-03", customer: "b" },
    { integrator: "leo", status: "sent", score: null },
  ];
  const st = surveyStats(rows);
  assert.deepEqual([st.sent, st.answered, st.avg, st.low, st.ready], [3, 2, 3.5, 1, { sim: 1, parcial: 0, nao: 1 }]);
  assert.deepEqual(st.byIntegrator.map((x) => [x.id, x.sent, x.answered, x.avg]), [["eryk", 2, 2, 3.5], ["leo", 1, 0, null]]);
  assert.equal(st.recent[0].score, 2, "mais recente primeiro");
  const row = statusRow({ id: "a", saas: "leverads" }, { surveys: rows.slice(0, 2) });
  assert.deepEqual(row.integrationSurvey, { score: 2, ready: "nao", at: "2026-11-03", onboarding: "" });
});
