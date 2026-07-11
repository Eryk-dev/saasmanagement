// Marketing (Meta Ads × funil) — sincroniza insights NÍVEL ANÚNCIO pra
// collection `ad_insights` (upsert idempotente por saas+anúncio+dia) e expõe as
// métricas cruzadas com os leads do Cockpit:
//   CPL real        = spend / leads criados no período (collection leads)
//   custo por etapa = spend / leads que PASSARAM por cada estágio (histórico da
//     timeline quando existe; aproximação pelo estágio atual pra leads antigos —
//     helper compartilhado stagePassCounts em routes.funnel-metrics.js)
//   por campanha/conjunto/anúncio = spend Meta + leads atribuídos por UTM.
// Convenção de UTM nos anúncios (parâmetros dinâmicos da Meta):
//   utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}
//   &utm_term={{adset.id}}&utm_content={{ad.id}}
// O match aceita id OU nome, então utm_campaign={{campaign.name}} também vale.

import { meta as defaultMeta } from "./meta.js";
import { stagePassCounts } from "./routes.funnel-metrics.js";
import { isWon } from "./stages.js";

const DAY_MS = 86400000;
const dayStr = (d) => new Date(d).toISOString().slice(0, 10);

// UTMs dos criativos criados pelo cockpit — a MESMA convenção documentada acima,
// via parâmetros dinâmicos da Meta (resolvidos na entrega do anúncio).
export const CREATIVE_URL_TAGS =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

// Código da dor na nomenclatura do anúncio: "[X]" em QUALQUER posição do nome
// ("[A] v3 depoimento" ou "1303 [B]"). Código = 1-3 alfanuméricos — colchete
// com outra coisa ("[TESTE]") não vira dor fantasma no relatório.
export function painCode(adName) {
  const m = String(adName || "").match(/\[([A-Za-z0-9]{1,3})\]/);
  return m ? m[1].toUpperCase() : null;
}

function rangeFromQuery(q, now = new Date()) {
  const until = q.until || dayStr(now);
  const since = q.since || dayStr(new Date(now.getTime() - 29 * DAY_MS));
  return { since, until };
}

// Upsert por id determinístico (1 linha por saas+anúncio+dia; fallback por
// campanha quando a linha não tem ad — compat com dados/mocks antigos).
// Linha idêntica NÃO regrava: cada escrita no repo acorda o SSE de todos os
// clientes, e o auto-sync roda o dia inteiro — só o que mudou vira evento.
async function upsertInsight(repo, row) {
  const id = `ai_${row.saas}_${row.adId || row.campaignId}_${row.date}`;
  const existing = await repo.get("ad_insights", id);
  if (existing) {
    const changed = Object.keys(row).some((k) => JSON.stringify(existing[k]) !== JSON.stringify(row[k]));
    if (!changed) return existing;
    return repo.update("ad_insights", id, row);
  }
  return repo.create("ad_insights", { id, ...row });
}

// Sync de UM produto (rota manual e auto-sync do servidor passam por aqui):
// puxa insights nível anúncio, limpa legado nível-campanha da janela e faz o
// upsert idempotente. Carimba o horário pro "ao vivo" da tela.
const lastSyncAt = new Map(); // saas -> ISO do último sync (memória do processo)
async function syncProductInsights(repo, meta, product, { since, until }) {
  const rows = await meta.adInsights(product.metaAdAccount, { since, until });
  const legacy = (await repo.list("ad_insights")).filter(
    (r) => r.saas === product.id && !r.adId && !String(r.campaignId || "").startsWith("manual_") && r.date >= since && r.date <= until,
  );
  for (const r of legacy) await repo.remove("ad_insights", r.id);
  for (const r of rows) await upsertInsight(repo, { saas: product.id, ...r });
  lastSyncAt.set(product.id, new Date().toISOString());
  return rows.length;
}

// Sync automático NO SERVIDOR — chamado só pelo index.js (testes montam o app
// sem ele). Uma execução por vez pro time inteiro: substitui o polling por aba
// do SPA, que multiplicava chamadas à Meta por usuário logado. Janela curta
// (ontem+hoje); histórico maior continua vindo do botão/rota manual.
export function startMarketingAutoSync(repo, { meta = defaultMeta, intervalMs = 180_000, log = console, immediate = true } = {}) {
  let running = false;
  async function tick() {
    if (running || !meta.configured()) return;
    running = true;
    try {
      const products = (await repo.list("products")).filter((p) => p.metaAdAccount);
      const range = { since: dayStr(Date.now() - DAY_MS), until: dayStr(Date.now()) };
      for (const p of products) {
        try {
          await syncProductInsights(repo, meta, p, range);
        } catch (err) {
          log.warn?.(`Meta auto-sync falhou (${p.id}): ${String(err.message || err).slice(0, 200)}`);
        }
      }
    } finally {
      running = false;
    }
  }
  const id = setInterval(tick, intervalMs);
  id.unref?.(); // não segura o processo vivo no shutdown
  if (immediate) tick(); // primeira leva já na subida (testes desligam pra controlar o tick)
  return { tick, stop: () => clearInterval(id) };
}

export function registerMarketingRoutes(app, repo, { meta = defaultMeta } = {}) {
  // Puxa os insights da Meta pro período (default: últimos 30 dias) — de UM SaaS
  // (?saas=) ou de todos que têm metaAdAccount configurado.
  app.post("/api/marketing/sync", async (req, reply) => {
    if (!meta.configured()) return reply.code(503).send({ error: "Meta não configurada (META_ACCESS_TOKEN)" });
    const { since, until } = rangeFromQuery(req.body || {});
    const products = (await repo.list("products"))
      .filter((p) => p.metaAdAccount && (!req.body?.saas || p.id === req.body.saas));
    if (!products.length) return reply.code(400).send({ error: "nenhum SaaS com metaAdAccount configurado (Ajustes → Integrações)" });

    const report = {};
    for (const p of products) {
      try {
        report[p.id] = { ok: true, rows: await syncProductInsights(repo, meta, p, { since, until }) };
      } catch (err) {
        req.log.warn({ saas: p.id, err: err.message }, "Meta: sync falhou");
        report[p.id] = { ok: false, error: String(err.message || err).slice(0, 200) };
      }
    }
    return { ok: true, since, until, report };
  });

  // ── Gerenciamento de campanha (precisa de ads_management no token) ────────
  // Lista ao vivo da conta do produto: status, orçamento, objetivo.
  app.get("/api/marketing/:saas/campaigns", async (req, reply) => {
    if (!meta.configured()) return reply.code(503).send({ error: "Meta não configurada (META_ACCESS_TOKEN)" });
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    if (!product.metaAdAccount) return reply.code(400).send({ error: "conta de anúncio não configurada (Ajustes → Integrações)" });
    try {
      return { campaigns: await meta.listCampaigns(product.metaAdAccount) };
    } catch (err) {
      req.log.warn({ err: err.message }, "Meta: listCampaigns falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Pausar/reativar em QUALQUER nível — campanha, conjunto ou anúncio (o id do
  // nó da Graph decide). O corpo diz o estado alvo; a resposta ecoa o aplicado.
  // /campaigns/:id/status continua valendo (compat com integrações antigas).
  const statusHandler = async (req, reply) => {
    if (!meta.configured()) return reply.code(503).send({ error: "Meta não configurada (META_ACCESS_TOKEN)" });
    const status = req.body?.status;
    if (status !== "ACTIVE" && status !== "PAUSED") return reply.code(400).send({ error: "status deve ser ACTIVE ou PAUSED" });
    try {
      return { ok: true, ...(await meta.setObjectStatus(req.params.id, status)) };
    } catch (err) {
      req.log.warn({ err: err.message, object: req.params.id }, "Meta: setObjectStatus falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  };
  app.post("/api/marketing/campaigns/:id/status", statusHandler);
  app.post("/api/marketing/objects/:id/status", statusHandler);

  // Orçamento diário (R$) — campanha CBO ou conjunto ABO.
  const budgetHandler = async (req, reply) => {
    if (!meta.configured()) return reply.code(503).send({ error: "Meta não configurada (META_ACCESS_TOKEN)" });
    const dailyBudget = Number(req.body?.dailyBudget);
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) return reply.code(400).send({ error: "dailyBudget (R$) deve ser um número positivo" });
    try {
      return { ok: true, ...(await meta.setObjectBudget(req.params.id, dailyBudget)) };
    } catch (err) {
      req.log.warn({ err: err.message, object: req.params.id }, "Meta: setObjectBudget falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  };
  app.post("/api/marketing/campaigns/:id/budget", budgetHandler);
  app.post("/api/marketing/objects/:id/budget", budgetHandler);

  // Anúncios de um conjunto — gerenciamento nível anúncio no mesmo bloco.
  app.get("/api/marketing/adsets/:id/ads", async (req, reply) => {
    if (!meta.configured()) return reply.code(503).send({ error: "Meta não configurada (META_ACCESS_TOKEN)" });
    try {
      return { ads: await meta.listAds(req.params.id) };
    } catch (err) {
      req.log.warn({ err: err.message, adset: req.params.id }, "Meta: listAds falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Os TRÊS níveis ao vivo da conta (campanhas, conjuntos, anúncios) — base da
  // visão estilo Gerenciador no SPA (abas por nível + toggle + orçamento).
  app.get("/api/marketing/:saas/adobjects", async (req, reply) => {
    if (!meta.configured()) return reply.code(503).send({ error: "Meta não configurada (META_ACCESS_TOKEN)" });
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    if (!product.metaAdAccount) return reply.code(400).send({ error: "conta de anúncio não configurada (Ajustes → Integrações)" });
    // allSettled: um nível com erro (rate limit numa página, etc.) não derruba
    // os outros — devolve o que veio + `errors` por nível. Arquivados/deletados
    // ficam de fora (a Graph retorna ARCHIVED por padrão e toggle neles não faz
    // sentido; o catálogo de ATRIBUIÇÃO continua vendo tudo, é outra rota).
    const settled = await Promise.allSettled([
      meta.listCampaigns(product.metaAdAccount),
      meta.listAccountAdsets(product.metaAdAccount),
      meta.listAccountAds(product.metaAdAccount),
    ]);
    const KEYS = ["campaigns", "adsets", "ads"];
    if (settled.every((r) => r.status === "rejected")) {
      req.log.warn({ err: settled[0].reason?.message }, "Meta: adobjects falhou");
      return reply.code(502).send({ error: String(settled[0].reason?.message || "Meta indisponível").slice(0, 300) });
    }
    const alive = (o) => o.effectiveStatus !== "ARCHIVED" && o.effectiveStatus !== "DELETED";
    const out = {};
    const errors = {};
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") out[KEYS[i]] = r.value.filter(alive);
      else {
        out[KEYS[i]] = [];
        errors[KEYS[i]] = String(r.reason?.message || r.reason).slice(0, 200);
        req.log.warn({ level: KEYS[i], err: errors[KEYS[i]] }, "Meta: adobjects nível falhou");
      }
    });
    return Object.keys(errors).length ? { ...out, errors } : out;
  });

  // Conjuntos de uma campanha — o formulário de novo criativo escolhe o destino.
  app.get("/api/marketing/campaigns/:id/adsets", async (req, reply) => {
    if (!meta.configured()) return reply.code(503).send({ error: "Meta não configurada (META_ACCESS_TOKEN)" });
    try {
      return { adsets: await meta.listAdsets(req.params.id) };
    } catch (err) {
      req.log.warn({ err: err.message, campaign: req.params.id }, "Meta: listAdsets falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Defaults do formulário de novo criativo: página que assina (descoberta dos
  // anúncios atuais e persistida no produto), link da última vez e mapa de dores.
  app.get("/api/marketing/:saas/creative-defaults", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    let pageId = product.metaPageId || null;
    let instagramUserId = product.metaIgUser || null;
    if (!pageId && meta.configured() && product.metaAdAccount) {
      try {
        const d = await meta.discoverCreativeDefaults(product.metaAdAccount);
        if (d) {
          pageId = d.pageId;
          instagramUserId = d.instagramUserId;
          await repo.update("products", product.id, { metaPageId: pageId, metaIgUser: instagramUserId });
        }
      } catch (err) {
        req.log.warn({ err: err.message }, "Meta: discoverCreativeDefaults falhou");
      }
    }
    return { pageId, instagramUserId, link: product.metaLink || "", painMap: product.painMap || {} };
  });

  // Novo criativo: recebe o vídeo (multipart) + copy e cria o anúncio PAUSADO
  // no conjunto indicado, já com a nomenclatura da dor ("[A] …") e as UTMs da
  // convenção — o lead que vier desse anúncio chega carimbado com a origem.
  app.post("/api/marketing/:saas/creatives", async (req, reply) => {
    if (!meta.configured()) return reply.code(503).send({ error: "Meta não configurada (META_ACCESS_TOKEN)" });
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    if (!product.metaAdAccount) return reply.code(400).send({ error: "conta de anúncio não configurada (Ajustes → Integrações)" });

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "envie o arquivo de vídeo no campo 'video'" });
    const field = (k) => {
      const v = data.fields?.[k];
      const one = Array.isArray(v) ? v[0] : v;
      return String(one?.value ?? "").trim();
    };
    const adsetId = field("adsetId");
    const message = field("message");
    const link = field("link");
    const title = field("title");
    const ctaType = field("ctaType") || "LEARN_MORE";
    const code = painCode(`[${field("painCode")}]`) || null; // normaliza (maiúscula/limite)
    const painLabel = field("painLabel");
    let name = field("name");
    if (!adsetId || !name || !message || !link) {
      return reply.code(400).send({ error: "campos obrigatórios: adsetId, name, message, link (+ vídeo)" });
    }
    if (code && !painCode(name)) name = `[${code}] ${name}`; // garante a convenção no nome

    try {
      const buffer = await data.toBuffer();
      // Página que assina o anúncio: config do produto ou descoberta dos atuais.
      let pageId = product.metaPageId;
      let instagramUserId = product.metaIgUser || null;
      if (!pageId) {
        const d = await meta.discoverCreativeDefaults(product.metaAdAccount);
        if (!d) return reply.code(400).send({ error: "não achei a página dos anúncios atuais — configure metaPageId no produto" });
        pageId = d.pageId;
        instagramUserId = d.instagramUserId;
        await repo.update("products", product.id, { metaPageId: pageId, metaIgUser: instagramUserId });
      }

      const videoId = await meta.uploadVideo(product.metaAdAccount, { buffer, filename: data.filename, title: name });
      const imageUrl = await meta.videoThumbnail(videoId);
      const creativeId = await meta.createAdCreative(product.metaAdAccount, {
        name, pageId, instagramUserId, videoId, imageUrl,
        message, title, linkUrl: link, ctaType, urlTags: CREATIVE_URL_TAGS,
      });
      const ad = await meta.createAd(product.metaAdAccount, { adsetId, creativeId, name });

      // Aprendizados pro próximo criativo: dor nova entra no mapa, link vira default.
      const patch = {};
      if (code && painLabel && (product.painMap || {})[code] !== painLabel) {
        patch.painMap = { ...(product.painMap || {}), [code]: painLabel };
      }
      if (link && link !== product.metaLink) patch.metaLink = link;
      if (Object.keys(patch).length) await repo.update("products", product.id, patch);

      return { ok: true, adId: ad.id, creativeId, videoId, name, status: ad.status };
    } catch (err) {
      req.log.warn({ err: err.message }, "Meta: criação de criativo falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Métricas do período — spend da Meta cruzado com os leads/funil do Cockpit.
  app.get("/api/marketing/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { since, until } = rangeFromQuery(req.query || {});

    // Ordena por data: a resolução de nome (campanha/conjunto) é last-write-wins
    // no loop abaixo, e o sync só rescreve o nome nas linhas da janela — a linha
    // mais recente é a que tem o nome atual (repo.list vem em ordem de id).
    const rows = (await repo.list("ad_insights"))
      .filter((r) => r.saas === product.id && r.date >= since && r.date <= until)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const leads = (await repo.list("leads"))
      .filter((l) => l.saas === product.id && l.createdAt && dayStr(l.createdAt) >= since && dayStr(l.createdAt) <= until);

    // Visitas no form (páginas públicas do produto, sessões únicas no período):
    // o topo REAL do funil de aquisição, antes do lead existir.
    const formEvents = (await repo.list("form_events")).filter(
      (e) => e.saas === product.id && dayStr(e.createdAt) >= since && dayStr(e.createdAt) <= until,
    );
    const formSessions = (ev) => new Set(formEvents.filter((e) => e.event === ev).map((e) => e.session)).size;

    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const spend = sum("spend");
    const impressions = sum("impressions");
    const clicks = sum("clicks");
    const linkClicks = sum("linkClicks");
    const metaLeads = sum("metaLeads");
    const per = (n) => (n > 0 ? Math.round((spend / n) * 100) / 100 : null);

    // Custo por etapa: leads que PASSARAM por cada estágio da régua de progresso
    // (até o kind `ganho`). Lead com histórico na timeline conta cada estágio
    // tocado (mesmo que depois caiu pra Perdido — a call aconteceu); lead antigo
    // sem histórico cai na aproximação pelo estágio atual (comportamento
    // pré-CRM). Terminais de perda não são progresso.
    const stageActsByLead = new Map();
    for (const a of await repo.list("activities")) {
      if (a.saas !== product.id || a.type !== "stage" || !a.lead) continue;
      if (!stageActsByLead.has(a.lead)) stageActsByLead.set(a.lead, []);
      stageActsByLead.get(a.lead).push(a);
    }
    const { ladder, counts } = stagePassCounts(product, leads, stageActsByLead);
    const perStage = ladder.map((stage, i) => ({ stage, count: counts[i], costPer: per(counts[i]) }));

    // Somas por grupo (linhas antigas sem os campos de vídeo/link contam 0).
    const SUM_KEYS = ["spend", "impressions", "clicks", "metaLeads", "linkClicks", "video3s", "videoP25", "videoP50", "videoP95"];
    const newGroup = (base) => ({ ...base, ...Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) });
    const addRow = (g, r) => { for (const k of SUM_KEYS) g[k] += Number(r[k]) || 0; };

    const byCampaign = {};
    for (const r of rows) {
      const c = byCampaign[r.campaignId] || (byCampaign[r.campaignId] = newGroup({ id: r.campaignId, name: r.campaignName }));
      addRow(c, r);
      c.name = r.campaignName || c.name;
    }
    // Atribuição real por campanha/conjunto/anúncio: o lead casa pelo UTM
    // (utm.campaign ↔ campanha, utm.term ↔ conjunto, utm.content ↔ anúncio),
    // por ID ou por NOME. CPL real por nível sai daqui.
    const leadUtm = (l, key) => (l.utm && typeof l.utm === "object" ? String(l.utm[key] || "") : "");
    const matching = (key, g) => leads.filter((l) => {
      const v = leadUtm(l, key);
      return v && (v === String(g.id || "") || v === String(g.name || ""));
    });
    const finishGroup = (key) => (g) => {
      const matched = matching(key, g);
      const n = matched.length;
      const won = matched.filter((l) => isWon(product, l.stage)).length;
      return {
        ...g,
        spend: Math.round(g.spend * 100) / 100,
        cplMeta: g.metaLeads > 0 ? Math.round((g.spend / g.metaLeads) * 100) / 100 : null,
        leads: n,
        cpl: n > 0 ? Math.round((g.spend / n) * 100) / 100 : null,
        won,
        costPerWin: won > 0 ? Math.round((g.spend / won) * 100) / 100 : null,
        // CTR de CLIQUE NO LINK (inline_link_clicks / impressões) — o CTR "all"
        // infla com qualquer interação (perfil, expandir legenda, etc.).
        ctr: g.impressions > 0 ? Math.round((g.linkClicks / g.impressions) * 10000) / 100 : null, // %
        cpm: g.impressions > 0 ? Math.round((g.spend / g.impressions) * 1000 * 100) / 100 : null,
        costPerLinkClick: g.linkClicks > 0 ? Math.round((g.spend / g.linkClicks) * 100) / 100 : null,
      };
    };
    const campaigns = Object.values(byCampaign).map(finishGroup("campaign")).sort((a, b) => b.spend - a.spend);

    // Conjuntos e anúncios (linhas nível-ad do sync; some quando só há legado).
    const byAdset = {};
    const byAd = {};
    for (const r of rows) {
      if (r.adsetId) {
        const g = byAdset[r.adsetId] || (byAdset[r.adsetId] = newGroup({ id: r.adsetId, name: r.adsetName, campaignId: r.campaignId }));
        addRow(g, r);
        g.name = r.adsetName || g.name;
      }
      if (r.adId) {
        const g = byAd[r.adId] || (byAd[r.adId] = newGroup({ id: r.adId, name: r.adName, adsetId: r.adsetId, campaignId: r.campaignId }));
        addRow(g, r);
        g.name = r.adName || g.name;
      }
    }
    const adsets = Object.values(byAdset).map(finishGroup("term")).sort((a, b) => b.spend - a.spend);
    const ads = Object.values(byAd).map(finishGroup("content")).sort((a, b) => b.spend - a.spend);

    // Quebra por DOR — o código "[A]" no nome do anúncio agrupa spend/leads;
    // rótulo humano vem de product.painMap. "won" = leads atribuídos ao anúncio
    // (por UTM content) que estão em estágio de ganho — a resposta pra "qual dor
    // traz lead que FECHA", não só lead barato.
    const byPain = {};
    for (const a of ads) {
      const code = painCode(a.name);
      const k = code || "_sem";
      const p = byPain[k] || (byPain[k] = {
        code, label: code ? (product.painMap || {})[code] || code : "Sem código",
        spend: 0, leads: 0, won: 0, adsCount: 0,
      });
      p.spend += a.spend;
      p.leads += a.leads;
      p.adsCount += 1;
      p.won += a.won; // já calculado por anúncio no finishGroup
    }
    const pains = Object.values(byPain)
      .map((p) => ({
        ...p,
        spend: Math.round(p.spend * 100) / 100,
        cpl: p.leads > 0 ? Math.round((p.spend / p.leads) * 100) / 100 : null,
        costPerWin: p.won > 0 ? Math.round((p.spend / p.won) * 100) / 100 : null,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Série diária (spend Meta + leads Cockpit) pro gráfico.
    const byDay = {};
    for (const r of rows) (byDay[r.date] = byDay[r.date] || { date: r.date, spend: 0, leads: 0 }).spend += Number(r.spend) || 0;
    for (const l of leads) {
      const d = dayStr(l.createdAt);
      (byDay[d] = byDay[d] || { date: d, spend: 0, leads: 0 }).leads += 1;
    }
    const series = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, spend: Math.round(d.spend * 100) / 100 }));

    return {
      saas: product.id, since, until,
      totals: {
        spend: Math.round(spend * 100) / 100,
        impressions, clicks, metaLeads,
        leads: leads.length,
        formViews: formSessions("view"),   // visitas no form no período
        formStarts: formSessions("start"), // clicaram em começar
        cpl: per(leads.length),          // custo por lead REAL (criados no Cockpit)
        cplMeta: per(metaLeads),         // custo por lead reportado pela Meta
        cpc: per(clicks),
        cpm: impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : null,
        // link CTR (cliques no link / impressões), igual às linhas da tabela
        ctr: impressions > 0 ? Math.round((linkClicks / impressions) * 10000) / 100 : null, // %
      },
      perStage, campaigns, adsets, ads, pains, series,
      synced: rows.length > 0,
      syncedAt: lastSyncAt.get(product.id) || null, // "ao vivo" da tela lê daqui
    };
  });

  // Catálogo id → nome (campanha/conjunto/anúncio) a partir do ad_insights já
  // sincronizado — o drawer do lead resolve o UTM cru pra nomes legíveis sem
  // nenhuma chamada à Meta. Complemento: a listagem VIVA de anúncios da conta
  // preenche ids que ainda não têm insight (anúncio recém-criado resolve nome
  // e dor antes do 1º sync), com cache curto pra não bater na Graph à toa.
  const liveAdsCache = new Map(); // saas -> { at, rows }
  app.get("/api/marketing/:saas/attribution", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const campaigns = {};
    const adsets = {};
    const ads = {};
    // Ordena por data pelo mesmo motivo do /api/marketing/:saas: o último a
    // escrever vence, e o nome atual (pós-rename) vive nas linhas mais novas.
    const catalogRows = (await repo.list("ad_insights"))
      .filter((r) => r.saas === product.id)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const r of catalogRows) {
      if (r.campaignId) campaigns[r.campaignId] = { name: r.campaignName || "" };
      if (r.adsetId) adsets[r.adsetId] = { name: r.adsetName || "", campaignId: r.campaignId || "" };
      if (r.adId) ads[r.adId] = { name: r.adName || "", adsetId: r.adsetId || "", campaignId: r.campaignId || "" };
    }
    if (meta.configured() && product.metaAdAccount) {
      try {
        let cached = liveAdsCache.get(product.id);
        if (!cached || Date.now() - cached.at >= 300_000) {
          cached = { at: Date.now(), rows: await meta.listAccountAds(product.metaAdAccount) };
          liveAdsCache.set(product.id, cached);
        }
        for (const a of cached.rows) {
          if (a.id && a.name && !ads[a.id]) ads[a.id] = { name: a.name, adsetId: a.adsetId || "", campaignId: a.campaignId || "" };
        }
      } catch (err) {
        req.log.warn({ err: err.message }, "Meta: listAccountAds falhou (catálogo segue só do insights)");
      }
    }
    return { campaigns, adsets, ads };
  });
}
