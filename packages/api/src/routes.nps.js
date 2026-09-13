// Rotas do NPS: a página pública que o cliente abre (sem chave de API), o envio
// da nota e o pedido manual pela ficha do cliente.
//
// A página é anônima de propósito: o token do link JÁ identifica o cliente, e
// pedir login pra responder uma pergunta de 10 segundos mataria a resposta.
// Endurecimento: rate-limit por IP (o mesmo do form de captação), token opaco de
// 32 hex e nota validada de 0 a 10.

import { askNps, answerNps } from "./nps.js";
import { npsPageHtml, npsDoneHtml, npsNotFoundHtml } from "./nps-page.js";
import { makeRateLimiter } from "./forms.js";
import { clientIp } from "./routes.forms.js";

const baseUrlOf = (req) => {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return host ? `${proto}://${host}` : "";
};

export function registerNpsRoutes(app, repo, { mailer = null, whatsapp = null } = {}) {
  const allow = makeRateLimiter({ limit: 20, windowMs: 60_000 });

  const byToken = async (token) => {
    const found = await repo.listWhere("nps", { token: String(token || "") }).catch(() => []);
    return found[0] || null;
  };

  // Página que o cliente abre. Já respondida mostra o agradecimento (voltar no
  // link depois de responder não pode parecer erro).
  app.get("/public/nps/:token", async (req, reply) => {
    const doc = await byToken(req.params.token);
    if (!doc) return reply.code(404).type("text/html").header("cache-control", "no-store").send(npsNotFoundHtml);
    const customer = await repo.get("customers", doc.customer).catch(() => null);
    const company = customer?.name || "";
    const html = doc.status === "answered"
      ? npsDoneHtml(company)
      : npsPageHtml({ token: doc.token, company, contact: customer?.contact || "" });
    return reply.type("text/html").header("cache-control", "no-store").send(html);
  });

  // Resposta. Dois formatos, porque a tela grava a NOTA no clique e só depois
  // oferece o motivo: { score } grava a nota, { reason } complementa a última.
  app.post("/public/nps/:token", async (req, reply) => {
    if (!allow(clientIp(req))) return reply.code(429).send({ error: "Muitas respostas. Tente de novo em instantes." });
    const doc = await byToken(req.params.token);
    if (!doc) return reply.code(404).send({ error: "Avaliação não encontrada." });
    const body = req.body || {};
    const temNota = body.score !== undefined && body.score !== null && body.score !== "";

    if (doc.status === "answered") {
      // Só o motivo pode chegar depois (o botão "enviar" da tela). Nota nova em
      // avaliação fechada é 409: a resposta é do momento, não se reescreve.
      if (temNota && Number(body.score) !== Number(doc.score)) {
        return reply.code(409).send({ error: "Esta avaliação já foi respondida." });
      }
      if (typeof body.reason === "string" && body.reason.trim()) {
        await repo.update("nps", doc.id, { reason: body.reason.slice(0, 2000) });
      }
      return { ok: true };
    }

    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 0 || score > 10 || Math.floor(score) !== score) {
      return reply.code(400).send({ error: "A nota precisa ser um número de 0 a 10." });
    }
    await answerNps(repo, doc, { score, reason: typeof body.reason === "string" ? body.reason : "" });
    return { ok: true };
  });

  // Pedido manual pela ficha do cliente ("pedir NPS agora").
  app.post("/api/customers/:id/nps/ask", async (req, reply) => {
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado." });
    const doc = await askNps(repo, customer, {
      reason: "manual",
      baseUrl: baseUrlOf(req),
      mailer, whatsapp,
      by: req.authUser?.id || "api",
    });
    return reply.code(201).send({ id: doc.id, channel: doc.channel, link: doc.link });
  });
}
