// Rotas do Formulário de Integração. Duas superfícies:
//   PÚBLICA  (fora da API key, ver OPEN_PREFIXES no index.js)
//     GET  /fi/:id                          página que o cliente preenche
//     GET  /fi/preview                      a mesma página em branco, pro time conferir
//     POST /public/integration-forms/:id    envio das respostas
//   AUTENTICADA
//     GET  /api/integration-forms/questions  definição atual (a tela do cockpit
//                                            usa pra mostrar as perguntas)
//
// O CRUD do pedido (criar, listar, excluir) é o genérico de `integration_forms`
// em routes.js — lá o servidor carimba id opaco, status e autor.
//
// O id do documento É o token do link: opaco, um por cliente. Sem login pro
// cliente, como na proposta (/p/:id) e no Manual da Família (/m/:id).

import { makeRateLimiter } from "./forms.js";
import { publicSections, validateIntegrationAnswers, sanitizeIntegrationAnswers, integrationSummary, INTEGRATION_FORM_VERSION, TERM_TEXT } from "./integration-form.js";
import { integrationFormPageHtml } from "./integration-form-page.js";
import { logActivity } from "./lead-flow.js";
import { clientIp } from "./routes.forms.js";

const notFoundHtml = "<!doctype html><meta charset='utf-8'><body style='font-family:system-ui;display:grid;place-items:center;height:100vh;color:#0c1d2b;background:#f7f8fa'><p>Formulário não encontrado. Peça um link novo pro time da LeverAds.</p></body>";

// Payload da página: o pedido + a definição atual das perguntas.
const pagePayload = (doc) => ({
  id: doc.id,
  clientName: doc.customerName || "",
  status: doc.status || "pendente",
  respondedAt: doc.respondedAt || "",
  term: TERM_TEXT,
  sections: publicSections(),
});

export function registerIntegrationFormRoutes(app, repo, opts = {}) {
  const discord = opts.discord; // aviso no canal quando o cliente responde (fail-open)
  const allow = makeRateLimiter({
    limit: opts.rateLimit ?? Number(process.env.FORM_RATE_LIMIT || 10),
    windowMs: opts.rateWindowMs ?? 60_000,
  });

  // Definição das perguntas pro cockpit (tela Formulário de Integração mostra
  // "o que a gente pergunta" sem precisar abrir o link de um cliente).
  app.get("/api/integration-forms/questions", async () => ({
    version: INTEGRATION_FORM_VERSION,
    term: TERM_TEXT,
    sections: publicSections(),
  }));

  // Pré-visualização em branco: o time confere o formulário sem gastar o link
  // de um cliente. Precede /fi/:id (primeiro match vence no Fastify por rota
  // estática, mas fica explícito na ordem).
  app.get("/fi/preview", async (req, reply) =>
    reply.type("text/html").header("cache-control", "no-store").send(
      integrationFormPageHtml({ ...pagePayload({ id: "preview", status: "pendente" }), preview: true }),
    ));

  app.get("/fi/:id", async (req, reply) => {
    const doc = await repo.get("integration_forms", req.params.id);
    if (!doc) return reply.code(404).type("text/html").send(notFoundHtml);
    return reply.type("text/html").header("cache-control", "no-store").send(integrationFormPageHtml(pagePayload(doc)));
  });

  app.post("/public/integration-forms/:id", async (req, reply) => {
    if (!allow(clientIp(req))) return reply.code(429).send({ error: "Muitos envios. Tente de novo em instantes." });
    const doc = await repo.get("integration_forms", req.params.id);
    if (!doc) return reply.code(404).send({ error: "Formulário não encontrado." });
    // Respondido é FINAL: o cliente assinou aquele conteúdo. Mudou alguma regra,
    // quem reabre é a equipe (é o combinado do próprio termo).
    if (doc.status === "respondido") return reply.code(409).send({ error: "Este formulário já foi enviado." });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    // Sanitiza ANTES de validar: sobra só chave que existe na definição e está
    // visível pela condicional — é esse conjunto que precisa estar completo.
    const answers = sanitizeIntegrationAnswers(body.answers);
    const errors = validateIntegrationAnswers(answers);
    if (errors.length) return reply.code(400).send({ error: "Faltou preencher alguma coisa.", details: errors.slice(0, 20) });

    const now = new Date().toISOString();
    const updated = await repo.update("integration_forms", doc.id, {
      status: "respondido",
      answers,
      // Snapshot da versão respondida: o questionário evolui, a resposta antiga
      // continua sendo lida com os rótulos com que foi feita.
      sections: publicSections(),
      term: TERM_TEXT,
      version: INTEGRATION_FORM_VERSION,
      respondedAt: now,
      // Assinatura eletrônica: quem digitou o nome, o documento informado e as
      // marcas técnicas do envio. É o que sustenta o termo de veracidade.
      respondent: {
        name: String(answers.assinatura || answers.nome || "").slice(0, 120),
        doc: String(answers.assinatura_doc || "").slice(0, 40),
        ip: clientIp(req).slice(0, 60),
        ua: String(req.headers["user-agent"] || "").slice(0, 300),
        at: now,
      },
    });

    // Timeline do lead: a integração começa aqui, e o integrador precisa ver o
    // formulário no histórico do card, não só na tela dele.
    if (doc.leadId) {
      try {
        await logActivity(repo, {
          saas: doc.saas || "", lead: doc.leadId, type: "system",
          meta: { event: "integration_form", form: doc.id, summary: integrationSummary(answers) },
          author: "lead",
        });
      } catch { /* fail-open: aviso nunca derruba o envio */ }
      // Carimbo no card pra quem olha o lead saber que o formulário voltou.
      try { await repo.update("leads", doc.leadId, { integrationFormAt: now, integrationFormId: doc.id }); } catch { /* fail-open */ }
    }

    if (discord?.configured?.()) {
      try {
        await discord.integrationFormFilled({
          customerName: doc.customerName,
          productName: doc.saas,
          summary: integrationSummary(answers),
        });
      } catch { /* fail-open */ }
    }

    return reply.code(201).send({ ok: true, id: updated.id });
  });
}
