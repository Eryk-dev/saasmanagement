// Rotas públicas do form builder — a superfície anônima do Cockpit. Tudo aqui
// fica FORA da exigência de API key (ver OPEN em index.js): definição publicada,
// envio de respostas, página hospedada /f/:id e o script de embed.
//
// Endurecimento da escrita anônima: rate-limit por IP + honeypot (campo `_hp`
// preenchido = bot → responde ok e descarta) + validação estrita contra a
// definição do form. IDs são opacos; forms em rascunho não existem publicamente.

import { randomUUID } from "node:crypto";
import { publicForm, validateAnswers, leadFromSubmission, submissionTerminal, makeRateLimiter, buildSteps } from "./forms.js";
import { formPageHtml, EMBED_JS } from "./form-page.js";
import { CREATE_DEFAULTS, dispatchProposal, publicBase } from "./routes.js";
import { stageByKind, firstStage } from "./stages.js";
import { logActivity, initialNextActionAt } from "./lead-flow.js";

const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "?";

// UTM vinda da página pública: só chaves conhecidas, strings curtas. Vai no lead
// (atribuição por campanha em /api/marketing) e na submission (auditoria).
const UTM_KEYS = ["source", "medium", "campaign", "content", "term", "fbclid"];
function sanitizeUtm(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const k of UTM_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

export function registerFormRoutes(app, repo, opts = {}) {
  const discord = opts.discord; // injetado por routes.js (fail-open, pode faltar em teste direto)
  const metaCapi = opts.metaCapi; // CAPI "Lead" server-side (fail-open, pode faltar em teste direto)
  const allow = makeRateLimiter({
    limit: opts.rateLimit ?? Number(process.env.FORM_RATE_LIMIT || 10),
    windowMs: opts.rateWindowMs ?? 60_000,
  });
  // Limiter próprio dos eventos de funil: uma sessão legítima emite ~1 evento por
  // tela, então o teto por IP precisa ser bem maior que o de submissions.
  const allowEvent = makeRateLimiter({
    limit: opts.eventRateLimit ?? Number(process.env.FORM_EVENT_RATE_LIMIT || 60),
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

    const utm = sanitizeUtm(body.utm);
    // Desqualificado vai pro estágio de kind `desqualificado` do funil (perda
    // estruturada, com motivo); fallback legado "disqualified" quando o produto/
    // funil não existe. Lead qualificado nasce com o próximo toque do GPS marcado
    // pela cadência do estágio de entrada (SLA de 1º contato).
    const product = form.saas ? await repo.get("products", form.saas) : null;
    const dqStage = stageByKind(product, "desqualificado")?.stage || "disqualified";
    const nextAt = disqualified ? "" : initialNextActionAt(product, "");
    const lead = await repo.create("leads", {
      ...(CREATE_DEFAULTS.leads || {}),
      ...leadFromSubmission(form, answers),
      ...(disqualified ? { disqualified: true, stage: dqStage, lostReason: "sem_fit", lostNote: "Reprovado no funil do form" } : {}),
      ...(utm ? { utm } : {}),
      ...(nextAt ? { nextActionAt: nextAt } : {}),
      createdAt: new Date().toISOString(), // métricas de marketing filtram por período
    });
    // Timeline: nascimento do lead via form (o POST genérico tem log próprio).
    try {
      await logActivity(repo, {
        saas: form.saas || "", lead: lead.id, type: "system",
        meta: {
          event: "lead_created", via: "form", form: form.id,
          stage: lead.stage || firstStage(product),
          ...(utm ? { utm } : {}),
        },
        author: "lead",
      });
    } catch { /* fail-open */ }
    const submission = await repo.create("form_submissions", {
      form: form.id,
      saas: form.saas,
      lead: lead.id,
      answers,
      ...(utm ? { utm } : {}),
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

  // Telemetria de funil (drop-off por etapa). A página pública manda eventos
  // anônimos por sessão de visita: "view" (carregou), "start" (clicou começar),
  // "step" (chegou na tela da pergunta `key`) e "submit" (envio aceito). Nada de
  // PII aqui — o contato só existe no submission. Session id é gerado no client
  // e vive só naquele page load (cada visita é uma entrada nova no funil).
  const EVENT_TYPES = new Set(["view", "start", "step", "submit"]);
  app.post("/public/forms/:id/events", async (req, reply) => {
    if (!allowEvent(clientIp(req))) return reply.code(429).send({ error: "Muitos eventos." });
    const form = await publishedForm(req.params.id);
    if (!form) return reply.code(404).send({ error: "Not found" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const event = String(body.event || "");
    const session = String(body.session || "").slice(0, 64);
    const key = String(body.key || "").slice(0, 80);
    if (!EVENT_TYPES.has(event) || !session) return reply.code(400).send({ error: "Evento inválido" });
    if (event === "step" && !(form.questions || []).some((q) => q.key === key)) {
      return reply.code(400).send({ error: "Etapa desconhecida" });
    }
    // Id explícito: o gerador do repo é por timestamp e eventos chegam em rajada —
    // dois no mesmo milissegundo colidiriam na PK.
    await repo.create("form_events", {
      id: `fe_${randomUUID()}`,
      form: form.id,
      saas: form.saas,
      session,
      event,
      key: event === "step" ? key : "",
      createdAt: new Date().toISOString(),
      ua: String(req.headers["user-agent"] || "").slice(0, 300),
    });
    return reply.code(201).send({ ok: true });
  });

  // Funil agregado do form (autenticado): sessões únicas por tela, na ordem do
  // renderer (buildSteps), + totais de view/start/submit. `?since=` (ISO) filtra
  // o período — comparação lexicográfica funciona em ISO 8601.
  app.get("/api/forms/:id/funnel", async (req, reply) => {
    const form = await repo.get("forms", req.params.id);
    if (!form) return reply.code(404).send({ error: "Not found" });
    const since = String(req.query.since || "");
    const events = (await repo.list("form_events")).filter(
      (e) => e.form === form.id && (!since || String(e.createdAt || "") >= since),
    );
    const uniq = (pred) => new Set(events.filter(pred).map((e) => e.session)).size;
    const questions = form.questions || [];
    const steps = buildSteps(questions).map((idxs) => questions[idxs[0]]);
    return {
      views: uniq((e) => e.event === "view"),
      starts: uniq((e) => e.event === "start"),
      submits: uniq((e) => e.event === "submit"),
      steps: steps.map((q) => ({
        key: q.key,
        label: q.label || q.key,
        insight: (q.type || "text") === "insight",
        sessions: uniq((e) => e.event === "step" && e.key === q.key),
      })),
    };
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
    return { html: formPageHtml(publicForm(draft), { embed: false, preview: true }) };
  });
}
