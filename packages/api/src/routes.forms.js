// Rotas públicas do form builder — a superfície anônima do Cockpit. Tudo aqui
// fica FORA da exigência de API key (ver OPEN em index.js): definição publicada,
// envio de respostas, página hospedada /f/:id e o script de embed.
//
// Endurecimento da escrita anônima: rate-limit por IP + honeypot (campo `_hp`
// preenchido = bot → responde ok e descarta) + validação estrita contra a
// definição do form. IDs são opacos; forms em rascunho não existem publicamente.

import { randomUUID } from "node:crypto";
import { publicForm, validateAnswers, leadFromSubmission, submissionTerminal, makeRateLimiter, buildSteps, variantHeadline } from "./forms.js";
import { painCode, leadGrade } from "./routes.marketing.js";
import { isWon } from "./stages.js";
import { formPageHtml, EMBED_JS } from "./form-page.js";
import { CREATE_DEFAULTS, dispatchProposal, publicBase } from "./routes.js";
import { stageByKind, firstStage } from "./stages.js";
import { logActivity, initialNextActionAt, autoLeadOwner } from "./lead-flow.js";

const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "?";

// UTM vinda da página pública: só chaves conhecidas, strings curtas. Vai no lead
// (atribuição por campanha em /api/marketing) e na submission (auditoria).
// Click-ids de cada plataforma (fbclid/gclid/ttclid) + referrer externo entram
// no mesmo objeto — atribuição não fica restrita à Meta.
const UTM_KEYS = ["source", "medium", "campaign", "content", "term", "placement", "fbclid", "gclid", "ttclid", "referrer"];
function sanitizeUtm(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const k of UTM_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, k === "referrer" ? 300 : 200);
  }
  return Object.keys(out).length ? out : null;
}

// Anúncio criado direto no Gerenciador costuma vir com utm_source =
// {{site_source_name}} (fb/ig/an/msg = plataforma), enquanto a convenção do
// cockpit usa utm_source=meta fixo — duas grafias pra MESMA coisa (tráfego pago
// da Meta) sujavam a leitura por origem. Normaliza: source vira "meta" e a
// plataforma sobrevive em utm.placement (a convenção nova do cockpit também
// manda utm_placement={{site_source_name}}).
const META_PLATFORM_CODES = new Set(["fb", "ig", "an", "msg"]);
export function normalizeMetaSource(utm) {
  if (!utm || !META_PLATFORM_CODES.has(utm.source)) return utm;
  return { ...utm, source: "meta", placement: utm.placement || utm.source };
}

// Origem derivada do REFERRER quando a visita chega sem UTM: é o que enxerga
// bio do Instagram (l.instagram.com), busca do Google e a própria home do site
// (que manda o visitante pro form). Rótulos estáveis pros conhecidos; o resto
// fica com o hostname limpo.
export function referrerSource(referrer) {
  let host = "";
  try { host = new URL(String(referrer)).hostname.toLowerCase(); } catch { return ""; }
  host = host.replace(/^(www|m|l|lm|out)\./, "");
  if (host.includes("google.")) return "google";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("facebook.com") || host === "fb.com") return "facebook";
  if (host.includes("bing.")) return "bing";
  if (host.includes("leverads.com.br")) return "site leverads";
  return host.slice(0, 60);
}

export function registerFormRoutes(app, repo, opts = {}) {
  const discord = opts.discord; // injetado por routes.js (fail-open, pode faltar em teste direto)
  const metaCapi = opts.metaCapi; // CAPI "Lead" server-side (fail-open, pode faltar em teste direto)
  const anthropic = opts.anthropic; // IA da variante de welcome (503 quando falta chave)
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

    let utm = normalizeMetaSource(sanitizeUtm(body.utm));
    // Orgânico ganha origem legível pelo referrer (google, instagram, site) —
    // sem isso o lead sem UTM aparece "sem origem" no drawer e nos relatórios.
    if (utm && !utm.source && !utm.campaign && utm.referrer) {
      const src = referrerSource(utm.referrer);
      if (src) utm = { ...utm, source: src };
    }
    const variant = String(body.variant || "").slice(0, 40); // versão da welcome que converteu
    const pain = String(body.pain || "").slice(0, 8);         // dor da welcome mostrada
    // Headline exato que o lead viu (variante A/B da welcome) — denormalizado no
    // lead pra tela do SDR, sobrevive a edição posterior do form.
    const headline = variant ? variantHeadline(form, variant, pain) : "";
    const internal = body.internal === true;                  // teste da equipe (não suja métrica nem CAPI)
    // fbp/fbc dos cookies do Pixel + página de entrada persistem NO LEAD (antes
    // iam só pro CAPI do Lead e eram descartados): o Purchase do ganho reusa o
    // match, e o drawer mostra por onde a pessoa entrou. Sem cookie _fbc (Pixel
    // bloqueado/atrasado), deriva do fbclid da URL no formato oficial da Meta —
    // recupera a atribuição de clique que se perdia.
    const fbp = String(body.fbp || "").slice(0, 120);
    const fbc = String(body.fbc || "").slice(0, 400)
      || (utm?.fbclid ? `fb.1.${Date.now()}.${utm.fbclid}` : "");
    const sourceUrl = String(body.sourceUrl || "").slice(0, 500);
    // Desqualificado vai pro estágio de kind `desqualificado` do funil (perda
    // estruturada, com motivo); fallback legado "disqualified" quando o produto/
    // funil não existe. Lead qualificado nasce com o próximo toque do GPS marcado
    // pela cadência do estágio de entrada (SLA de 1º contato).
    const product = form.saas ? await repo.get("products", form.saas) : null;
    const dqStage = stageByKind(product, "desqualificado")?.stage || "disqualified";
    const nextAt = disqualified ? "" : initialNextActionAt(product, "");
    // Lead qualificado entra com o SDR do produto como dono; desqualificado vai
    // pro cemitério sem responsável (ninguém trabalha ele agora).
    const owner = disqualified ? null : await autoLeadOwner(repo, form.saas);
    const lead = await repo.create("leads", {
      ...(CREATE_DEFAULTS.leads || {}),
      ...leadFromSubmission(form, answers),
      ...(disqualified ? { disqualified: true, stage: dqStage, lostReason: "sem_fit", lostNote: "Reprovado no funil do form" } : {}),
      ...(owner ? { owner } : {}),
      ...(utm ? { utm } : {}),
      ...(fbp ? { fbp } : {}),
      ...(fbc ? { fbc } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(variant ? { formVariant: variant } : {}),
      ...(headline ? { formHeadline: headline } : {}),
      ...(nextAt ? { nextActionAt: nextAt } : {}),
      ...(internal ? { internal: true, source: `Form · ${form.name || form.id} · teste da equipe` } : {}),
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
      ...(variant ? { variant } : {}),
      ...(pain ? { pain } : {}),
      ...(internal ? { internal: true } : {}),
      createdAt: new Date().toISOString(),
      ua: String(req.headers["user-agent"] || "").slice(0, 300),
    });
    // Meta CAPI "Lead" server-side: deduplicado com o Pixel client-side via
    // event_id que a página manda no body (eventId), junto de fbp/fbc dos cookies
    // do Pixel. IP/UA vêm da request. PII (email/phone) é hasheada no módulo.
    // Best-effort: nenhuma falha de CAPI pode quebrar o envio do form.
    // Desqualificado NÃO conta como conversão (espelha o Pixel client-side).
    if (!disqualified && !internal && metaCapi?.configured(product?.metaPixelId)) {
      try {
        await metaCapi.sendLead({
          eventId: body.eventId || submission.id,
          eventSourceUrl: sourceUrl || `${publicBase(req)}/f/${form.id}`,
          leadId: lead.id,
          email: lead.email,
          phone: lead.phone,
          fbp: fbp || undefined,
          fbc: fbc || undefined,
          clientIp: clientIp(req),
          userAgent: String(req.headers["user-agent"] || "") || undefined,
          customData: { content_name: form.name },
          pixelId: product?.metaPixelId || undefined, // pixel do SaaS do form (fallback env)
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
    const variant = String(body.variant || "").slice(0, 40); // teste A/B da welcome
    const pain = String(body.pain || "").slice(0, 8);         // dor do anúncio de origem
    // Origem no evento (slim: só chaves de atribuição, sem referrer/click-ids) —
    // é o que permite medir o drop-off POR ORIGEM/ANÚNCIO, não só variante/dor.
    // Visita sem UTM mas com referrer vira origem derivada (google/instagram/
    // site), senão bio do IG, busca e home ficam invisíveis na quebra.
    const rawUtm = normalizeMetaSource(sanitizeUtm(body.utm));
    let utm = rawUtm
      ? Object.fromEntries(["source", "medium", "campaign", "content", "term", "placement"].filter((k) => rawUtm[k]).map((k) => [k, rawUtm[k]]))
      : null;
    if ((!utm || (!utm.source && !utm.campaign)) && rawUtm?.referrer) {
      const src = referrerSource(rawUtm.referrer);
      if (src) utm = { ...(utm || {}), source: src };
    }
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
      ...(variant ? { variant } : {}),
      ...(pain ? { pain } : {}),
      ...(utm && Object.keys(utm).length ? { utm } : {}),
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
    const until = String(req.query.until || ""); // range fechado (hoje/ontem/data custom)
    const events = (await repo.list("form_events")).filter(
      (e) => e.form === form.id && (!since || String(e.createdAt || "") >= since) && (!until || String(e.createdAt || "") <= until),
    );
    const uniq = (pred) => new Set(events.filter(pred).map((e) => e.session)).size;
    const questions = form.questions || [];
    const steps = buildSteps(questions).map((idxs) => questions[idxs[0]]);
    // Teste A/B: sessões carimbadas com variante viram um funil paralelo por
    // versão da welcome (view → start → submit). Sem variantes, o array some.
    const groupKeys = [...new Set(events.filter((e) => e.variant).map((e) => `${e.pain || ""}|${e.variant}`))].sort();
    // Fechamento por variante: submission carimbada → lead → estágio de ganho.
    // É o que elege campeã de verdade (headline que vira CONTRATO, não clique).
    const product = form.saas ? await repo.get("products", form.saas) : null;
    const subs = groupKeys.length
      ? (await repo.list("form_submissions")).filter((x) => x.form === form.id && !x.internal && (!since || String(x.createdAt || "") >= since) && (!until || String(x.createdAt || "") <= until))
      : [];
    const leadsById = groupKeys.length ? new Map((await repo.list("leads")).map((l) => [l.id, l])) : new Map();
    const variants = groupKeys.map((gk) => {
      const [pain, vid] = gk.split("|");
      const mine = (e) => (e.variant || "") === vid && (e.pain || "") === pain;
      const vu = (ev) => new Set(events.filter((e) => mine(e) && e.event === ev).map((e) => e.session)).size;
      const vSubs = subs.filter((x) => String(x.variant || "") === vid && String(x.pain || "") === pain);
      const vLeads = vSubs.map((x) => leadsById.get(x.lead)).filter(Boolean);
      // Potencial dos leads que a variante trouxe (cliente A/B/C, régua do
      // leadGrade) + fechamento: quantos ganharam e a receita (amount) deles —
      // a headline campeã é a que traz cliente grande e contrato, não clique.
      const grades = { A: 0, B: 0, C: 0 };
      for (const l of vLeads) { const g = leadGrade(l); if (g) grades[g] += 1; }
      const wonLeads = vLeads.filter((l) => isWon(product, l.stage));
      const revenue = wonLeads.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const times = events.filter(mine).map((e) => String(e.createdAt || "")).filter(Boolean).sort();
      return {
        id: vid, ...(pain ? { pain } : {}),
        sessions: new Set(events.filter(mine).map((e) => e.session)).size,
        views: vu("view"), starts: vu("start"), submits: vu("submit"),
        leads: vSubs.length, won: wonLeads.length, grades, revenue,
        firstAt: times[0] || null, lastAt: times[times.length - 1] || null,
      };
    });
    // Drop-off por ORIGEM (utm carimbada nos eventos): funil paralelo por
    // source|campaign|content — o ANÚNCIO (utm_content = ad id) é o nível que
    // decide criativo, a campanha fica de contexto/fallback. Ids dinâmicos da
    // Meta; o SPA resolve nomes pelo catálogo de atribuição (useAttribution).
    // Orgânico derivado do referrer entra só com source (google/instagram/site).
    // normalizeMetaSource também na LEITURA: evento antigo gravado antes da
    // normalização (source fb/ig/an) agrupa junto dos novos, como "meta".
    const originKey = (e) => {
      const u = normalizeMetaSource(e.utm);
      return u && (u.source || u.campaign || u.content)
        ? `${u.source || ""}|${u.campaign || ""}|${u.content || ""}|${u.placement || ""}` : "";
    };
    const originKeys = [...new Set(events.map(originKey).filter(Boolean))].sort();
    const origins = originKeys.map((k) => {
      const [source, campaign, content, placement] = k.split("|");
      const mine = (e) => originKey(e) === k;
      const ou = (ev) => new Set(events.filter((e) => mine(e) && e.event === ev).map((e) => e.session)).size;
      return {
        ...(source ? { source } : {}), ...(campaign ? { campaign } : {}), ...(content ? { content } : {}), ...(placement ? { placement } : {}),
        sessions: new Set(events.filter(mine).map((e) => e.session)).size,
        views: ou("view"), starts: ou("start"), submits: ou("submit"),
      };
    }).sort((a, b) => b.views - a.views);
    return {
      views: uniq((e) => e.event === "view"),
      starts: uniq((e) => e.event === "start"),
      submits: uniq((e) => e.event === "submit"),
      ...(variants.length ? { variants } : {}),
      ...(origins.length ? { origins } : {}),
      steps: steps.map((q) => ({
        key: q.key,
        label: q.label || q.key,
        insight: (q.type || "text") === "insight",
        sessions: uniq((e) => e.event === "step" && e.key === q.key),
      })),
    };
  });

  // Dor do anúncio de origem: utm_content = ad id → nome do anúncio (insights
  // sincronizados) → código "[X]". "" quando não dá pra resolver (sem utm, ad
  // ainda sem sync) — a página cai na welcome base.
  async function adPainOf(content) {
    if (!content) return "";
    const row = (await repo.list("ad_insights")).find((r) => String(r.adId || "") === String(content));
    return row ? (painCode(row.adName) || "") : "";
  }
  // welcome específica da dor sobrescreve a base (título/CTA/variantes da dor);
  // byPain nunca vai pro client inteiro — só a versão já resolvida.
  function resolveWelcome(pf, pain) {
    const w = pf.welcome;
    if (!w) return pf;
    const byPain = w.byPain || {};
    const chosen = pain && byPain[pain] ? { ...w, ...byPain[pain] } : w;
    const { byPain: _drop, ...clean } = chosen;
    return { ...pf, welcome: clean };
  }

  // Página hospedada. `?embed=1` = modo iframe (sem altura cheia, posta a altura).
  app.get("/f/:id", async (req, reply) => {
    const form = await publishedForm(req.params.id);
    if (!form) {
      return reply.code(404).type("text/html").send("<!doctype html><meta charset=utf-8><title>404</title><p style='font-family:system-ui;padding:40px'>Formulário não encontrado.</p>");
    }
    const embed = req.query.embed === "1" || req.query.embed === "true";
    // Pixel por produto: o form dispara o pixel do SaaS dele (fallback env).
    const product = form.saas ? await repo.get("products", form.saas) : null;
    const pain = await adPainOf(String(req.query.utm_content || ""));
    return reply.type("text/html").send(formPageHtml(resolveWelcome(publicForm(form), pain), { embed, pixelId: product?.metaPixelId || "", pain }));
  });

  app.get("/embed.js", async (_req, reply) => reply.type("text/javascript").send(EMBED_JS));

  // Variante de welcome por IA (título/subtítulo/botão) — o "aplicar" do
  // insight de welcome fraca no dashboard. NÃO grava nada: o client mostra a
  // copy pra edição e é o PATCH do form que publica a variante. Contexto que
  // vai pro modelo: welcome atual + títulos já testados (base e por dor, pra
  // não repetir ângulo) + taxa de início que disparou o insight.
  app.post("/api/forms/:id/suggest-welcome", async (req, reply) => {
    const form = await repo.get("forms", req.params.id);
    if (!form) return reply.code(404).send({ error: "Not found" });
    if (!anthropic?.configured()) return reply.code(503).send({ error: "IA não configurada (OPENROUTER_API_KEY ou ANTHROPIC_API_KEY)" });
    const product = form.saas ? await repo.get("products", form.saas) : null;
    const w = form.welcome || {};
    const tested = [
      ...(w.variants || []),
      ...Object.values(w.byPain || {}).flatMap((p) => p.variants || []),
    ].map((v) => v.title).filter(Boolean);
    try {
      const { suggestion } = await anthropic.suggestWelcome({
        productName: product?.name || "",
        pitch: product?.pitch || product?.description || "",
        welcome: { title: w.title || "", subtitle: w.subtitle || "", button: w.button || "" },
        variants: tested,
        startRate: req.body?.startRate != null ? Number(req.body.startRate) : null,
      });
      return suggestion;
    } catch (err) {
      req.log?.warn?.({ err }, "suggest-welcome falhou");
      return reply.code(502).send({ error: String(err?.message || err).slice(0, 300) });
    }
  });

  // Preview autenticado pro builder (rota /api → exige key): recebe o rascunho
  // inteiro no body e devolve o MESMO HTML da página pública, sem persistir nada.
  // O SPA injeta via iframe.srcdoc — fidelidade total, zero duplicação de renderer.
  app.post("/api/forms/preview", async (req, reply) => {
    const draft = req.body && typeof req.body === "object" ? req.body : null;
    if (!draft) return reply.code(400).send({ error: "JSON body required" });
    return { html: formPageHtml(resolveWelcome(publicForm(draft), ""), { embed: false, preview: true }) };
  });
}
