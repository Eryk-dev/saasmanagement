// Rotas da pesquisa de satisfação da integração (lógica em integration-survey.js).
//
//   GET  /api/customers/onboardings/:id/survey   a pesquisa da integração (ou null) — guard de Clientes
//   POST /api/customers/onboardings/:id/survey   { channel: link|whatsapp|email } cria/reaproveita e registra o envio
//   GET  /public/pesquisa/:token                 a página que o cliente abre (sem login)
//   POST /public/pesquisa/:token                 { score } no clique; { ready, comment } junto ou depois
//
// A página é anônima como a do NPS: o token de 32 hex identifica a pesquisa.
// Rate-limit por IP e nota validada de 1 a 5.

import { SURVEYS, askIntegrationSurvey, answerIntegrationSurvey, surveyOf, surveyView } from "./integration-survey.js";
import { surveyPageHtml, surveyDoneHtml, surveyNotFoundHtml } from "./integration-survey-page.js";
import { makeRateLimiter } from "../forms/forms.js";
import { clientIp } from "../platform/request.js";

const baseUrlOf = (req) => {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return host ? `${proto}://${host}` : "";
};

async function guard(reply, fn) {
  try { return await fn(); }
  catch (err) {
    if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
}

export function registerIntegrationSurveyRoutes(app, repo, { mailer = null } = {}) {
  const allow = makeRateLimiter({ limit: 20, windowMs: 60_000 });
  const byToken = async (token) => (await repo.listWhere(SURVEYS, { token: String(token || "") }).catch(() => []))[0] || null;

  app.get("/api/customers/onboardings/:id/survey", async (req) =>
    ({ survey: surveyView(await surveyOf(repo, req.params.id), baseUrlOf(req)) }));

  app.post("/api/customers/onboardings/:id/survey", async (req, reply) => guard(reply, async () => {
    const r = await askIntegrationSurvey(repo, req.params.id, {
      channel: req.body?.channel || "link", baseUrl: baseUrlOf(req), mailer, by: req.authUser?.id || "api",
    });
    return reply.code(201).send({ survey: surveyView(r.survey, baseUrlOf(req)), link: r.link, text: r.text });
  }));

  app.get("/public/pesquisa/:token", async (req, reply) => {
    const doc = await byToken(req.params.token);
    reply.type("text/html").header("cache-control", "no-store");
    if (!doc) return reply.code(404).send(surveyNotFoundHtml);
    const customer = await repo.get("customers", doc.customer).catch(() => null);
    const company = customer?.name || "";
    return reply.send(doc.status === "answered" && (doc.ready || doc.comment)
      ? surveyDoneHtml(company)
      : surveyPageHtml({ token: doc.token, company, contact: customer?.contact || "" }));
  });

  app.post("/public/pesquisa/:token", async (req, reply) => {
    if (!allow(clientIp(req))) return reply.code(429).send({ error: "Muitas respostas. Tente de novo em instantes." });
    const doc = await byToken(req.params.token);
    if (!doc) return reply.code(404).send({ error: "Pesquisa não encontrada." });
    return guard(reply, async () => {
      await answerIntegrationSurvey(repo, doc, req.body || {});
      return { ok: true };
    });
  });
}
