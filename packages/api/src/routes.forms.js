// Rotas públicas do form builder — a superfície anônima do Cockpit. Tudo aqui
// fica FORA da exigência de API key (ver OPEN em index.js): definição publicada,
// envio de respostas, página hospedada /f/:id e o script de embed.
//
// Endurecimento da escrita anônima: rate-limit por IP + honeypot (campo `_hp`
// preenchido = bot → responde ok e descarta) + validação estrita contra a
// definição do form. IDs são opacos; forms em rascunho não existem publicamente.

import { publicForm, validateAnswers, leadFromSubmission, submissionTerminal, makeRateLimiter } from "./forms.js";
import { formPageHtml, EMBED_JS } from "./form-page.js";
import { CREATE_DEFAULTS, dispatchProposal, publicBase } from "./routes.js";

const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "?";

export function registerFormRoutes(app, repo, opts = {}) {
  const discord = opts.discord; // injetado por routes.js (fail-open, pode faltar em teste direto)
  const metaCapi = opts.metaCapi; // CAPI "Lead" server-side (fail-open, pode faltar em teste direto)
  const allow = makeRateLimiter({
    limit: opts.rateLimit ?? Number(process.env.FORM_RATE_LIMIT || 10),
    windowMs: opts.rateWindowMs ?? 60_000,
  });

  // Form publicado, só os campos que a página precisa (sem mapping/saas).
  async function publishedForm(id) {
    const form = await repo.get("forms", id);
    return form && form.status === "published" ? form : null;
  }

  app.get("/public/forms/:id", async (req, reply) => {
    const form = await publishedForm(req.params.id);
    if (!form) return reply.code(404).send({ error: "Not found" });
    return publicForm(form);
  });

  app.post("/public/forms/:id/submissions", async (req, reply) => {
    if (!allow(clientIp(req))) {
      return reply.code(429).send({ error: "Muitos envios. Tente de novo em instantes." });
    }
    const form = await publishedForm(req.params.id);
    if (!form) return reply.code(404).send({ error: "Not found" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    // Honeypot: bot preencheu o campo invisível → finge sucesso, não grava nada.
    if (String(body._hp || "").trim() !== "") return { ok: true };

    const answers = body.answers;
    const errors = validateAnswers(form, answers);
    if (errors.length) return reply.code(400).send({ error: "Respostas inválidas", details: errors });

    // Terminal "_reject" = a pessoa caiu numa saída de NÃO-qualificado (decisão
    // server-authoritative). Captura o contato marcado, mas sem proposta e sem
    // contar como conversão (Lead Pixel/CAPI) — pra não otimizar anúncio nesse público.
    const disqualified = submissionTerminal(form.questions || [], answers) === "_reject";

    const lead = await repo.create("leads", {
      ...(CREATE_DEFAULTS.leads || {}),
      ...leadFromSubmission(form, answers),
      ...(disqualified ? { disqualified: true, stage: "disqualified" } : {}),
      createdAt: new Date().toISOString(), // métricas de marketing filtram por período
    });
    const submission = await repo.create("form_submissions", {
      form: form.id,
      saas: form.saas,
      lead: lead.id,
      answers,
      createdAt: new Date().toISOString(),
      ua: String(req.headers["user-agent"] || "").slice(0, 300),
    });
    // Meta CAPI "Lead" server-side: deduplicado com o Pixel client-side via
    // event_id que a página manda no body (eventId), junto de fbp/fbc dos cookies
    // do Pixel. IP/UA vêm da request. PII (email/phone) é hasheada no módulo.
    // Best-effort: nenhuma falha de CAPI pode quebrar o envio do form.
    // Desqualificado NÃO conta como conversão (espelha o Pixel client-side).
    if (!disqualified && metaCapi?.configured()) {
      try {
        await metaCapi.sendLead({
          eventId: body.eventId || submission.id,
          eventSourceUrl: body.sourceUrl || `${publicBase(req)}/f/${form.id}`,
          leadId: lead.id,
          email: lead.email,
          phone: lead.phone,
          fbp: body.fbp || undefined,
          fbc: body.fbc || undefined,
          clientIp: clientIp(req),
          userAgent: String(req.headers["user-agent"] || "") || undefined,
          customData: { content_name: form.name },
        });
      } catch (err) {
        req.log?.warn?.({ err }, "meta_capi.sendLead falhou (envio do form segue)");
      }
    }

    // Mesmo gatilho best-effort do EntityForm: lead novo tenta gerar proposta
    // pelo MESMO dispatcher da rota manual (native quando há template publicado);
    // elegibilidade/config é decisão do provider e nunca quebra o envio.
    // Desqualificado não recebe proposta.
    if (!disqualified) {
      try { await dispatchProposal(repo, lead, { auto: true, baseUrl: publicBase(req) }); } catch { /* fail-open */ }
    }

    // Aviso no Discord: lead re-buscado pra incluir o link da proposta que o
    // dispatcher acabou de gravar (se gerou). Nunca quebra o envio.
    if (discord?.configured()) {
      const fresh = (await repo.get("leads", lead.id)) || lead;
      const product = await repo.get("products", form.saas);
      await discord.leadNew({ lead: fresh, productName: product?.name });
    }

    return reply.code(201).send({ ok: true, id: submission.id });
  });

  // Página hospedada. `?embed=1` = modo iframe (sem altura cheia, posta a altura).
  app.get("/f/:id", async (req, reply) => {
    const form = await publishedForm(req.params.id);
    if (!form) {
      return reply.code(404).type("text/html").send("<!doctype html><meta charset=utf-8><title>404</title><p style='font-family:system-ui;padding:40px'>Formulário não encontrado.</p>");
    }
    const embed = req.query.embed === "1" || req.query.embed === "true";
    return reply.type("text/html").send(formPageHtml(publicForm(form), { embed }));
  });

  app.get("/embed.js", async (_req, reply) => reply.type("text/javascript").send(EMBED_JS));

  // Preview autenticado pro builder (rota /api → exige key): recebe o rascunho
  // inteiro no body e devolve o MESMO HTML da página pública, sem persistir nada.
  // O SPA injeta via iframe.srcdoc — fidelidade total, zero duplicação de renderer.
  app.post("/api/forms/preview", async (req, reply) => {
    const draft = req.body && typeof req.body === "object" ? req.body : null;
    if (!draft) return reply.code(400).send({ error: "JSON body required" });
    return { html: formPageHtml(publicForm(draft), { embed: false }) };
  });
}
