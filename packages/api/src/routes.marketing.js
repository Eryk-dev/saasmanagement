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
// ("[A] v3 depoimento" ou "1303 [B]"). É o que liga anúncio → dor no relatório.
export function painCode(adName) {
  const m = String(adName || "").match(/\[([^\]]{1,12})\]/);
  return m ? m[1].trim().toUpperCase() : null;
}

function rangeFromQuery(q, now = new Date()) {
  const until = q.until || dayStr(now);
  const since = q.since || dayStr(new Date(now.getTime() - 29 * DAY_MS));
  return { since, until };
}

// Upsert por id determinístico (1 linha por saas+anúncio+dia; fallback por
// campanha quando a linha não tem ad — compat com dados/mocks antigos).
async function upsertInsight(repo, row) {
  const id = `ai_${row.saas}_${row.adId || row.campaignId}_${row.date}`;
  const existing = await repo.get("ad_insights", id);
  if (existing) return repo.update("ad_insights", id, row);
  return repo.create("ad_insights", { id, ...row });
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
        const rows = await meta.adInsights(p.metaAdAccount, { since, until });
        // Linhas legadas nível-campanha (sem adId) NA JANELA sincronizada viram
        // dupla contagem com as linhas nível-anúncio — remove antes do upsert.
        // Fora da janela ficam (histórico antigo continua certo em consultas de
        // períodos antigos, que só têm linhas de um nível). Gasto MANUAL
        // (campaignId "manual_*", tela Publicidade) nunca é tocado.
        const legacy = (await repo.list("ad_insights")).filter(
          (r) => r.saas === p.id && !r.adId && !String(r.campaignId || "").startsWith("manual_") && r.date >= since && r.date <= until,
        );
        for (const r of legacy) await repo.remove("ad_insights", r.id);
        for (const r of rows) await upsertInsight(repo, { saas: p.id, ...r });
        report[p.id] = { ok: true, rows: rows.length };
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

    const rows = (await repo.list("ad_insights"))
      .filter((r) => r.saas === product.id && r.date >= since && r.date <= until);
    const leads = (await repo.list("leads"))
      .filter((l) => l.saas === product.id && l.createdAt && dayStr(l.createdAt) >= since && dayStr(l.createdAt) <= until);

    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const spend = sum("spend");
    const impressions = sum("impressions");
    const clicks = sum("clicks");
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

    const byCampaign = {};
    for (const r of rows) {
      const c = byCampaign[r.campaignId] || (byCampaign[r.campaignId] = { id: r.campaignId, name: r.campaignName, spend: 0, impressions: 0, clicks: 0, metaLeads: 0 });
      c.spend += Number(r.spend) || 0;
      c.impressions += Number(r.impressions) || 0;
      c.clicks += Number(r.clicks) || 0;
      c.metaLeads += Number(r.metaLeads) || 0;
      c.name = r.campaignName || c.name;
    }
    // Atribuição real por campanha/conjunto/anúncio: o lead casa pelo UTM
    // (utm.campaign ↔ campanha, utm.term ↔ conjunto, utm.content ↔ anúncio),
    // por ID ou por NOME. CPL real por nível sai daqui.
    const leadUtm = (l, key) => (l.utm && typeof l.utm === "object" ? String(l.utm[key] || "") : "");
    const leadsMatching = (key, g) => leads.filter((l) => {
      const v = leadUtm(l, key);
      return v && (v === String(g.id || "") || v === String(g.name || ""));
    }).length;
    const finishGroup = (key) => (g) => {
      const n = leadsMatching(key, g);
      return {
        ...g,
        spend: Math.round(g.spend * 100) / 100,
        cplMeta: g.metaLeads > 0 ? Math.round((g.spend / g.metaLeads) * 100) / 100 : null,
        leads: n,
        cpl: n > 0 ? Math.round((g.spend / n) * 100) / 100 : null,
      };
    };
    const campaigns = Object.values(byCampaign).map(finishGroup("campaign")).sort((a, b) => b.spend - a.spend);

    // Conjuntos e anúncios (linhas nível-ad do sync; some quando só há legado).
    const byAdset = {};
    const byAd = {};
    for (const r of rows) {
      if (r.adsetId) {
        const g = byAdset[r.adsetId] || (byAdset[r.adsetId] = { id: r.adsetId, name: r.adsetName, campaignId: r.campaignId, spend: 0, impressions: 0, clicks: 0, metaLeads: 0 });
        g.spend += Number(r.spend) || 0;
        g.impressions += Number(r.impressions) || 0;
        g.clicks += Number(r.clicks) || 0;
        g.metaLeads += Number(r.metaLeads) || 0;
        g.name = r.adsetName || g.name;
      }
      if (r.adId) {
        const g = byAd[r.adId] || (byAd[r.adId] = { id: r.adId, name: r.adName, adsetId: r.adsetId, campaignId: r.campaignId, spend: 0, impressions: 0, clicks: 0, metaLeads: 0 });
        g.spend += Number(r.spend) || 0;
        g.impressions += Number(r.impressions) || 0;
        g.clicks += Number(r.clicks) || 0;
        g.metaLeads += Number(r.metaLeads) || 0;
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
      p.won += leads.filter((l) => {
        const v = leadUtm(l, "content");
        return v && (v === String(a.id || "") || v === String(a.name || "")) && isWon(product, l.stage);
      }).length;
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
        cpl: per(leads.length),          // custo por lead REAL (criados no Cockpit)
        cplMeta: per(metaLeads),         // custo por lead reportado pela Meta
        cpc: per(clicks),
        cpm: impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : null,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null, // %
      },
      perStage, campaigns, adsets, ads, pains, series,
      synced: rows.length > 0,
    };
  });

  // Catálogo id → nome (campanha/conjunto/anúncio) a partir do ad_insights já
  // sincronizado — o drawer do lead resolve o UTM cru pra nomes legíveis sem
  // nenhuma chamada à Meta.
  app.get("/api/marketing/:saas/attribution", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const campaigns = {};
    const adsets = {};
    const ads = {};
    for (const r of await repo.list("ad_insights")) {
      if (r.saas !== product.id) continue;
      if (r.campaignId) campaigns[r.campaignId] = { name: r.campaignName || "" };
      if (r.adsetId) adsets[r.adsetId] = { name: r.adsetName || "", campaignId: r.campaignId || "" };
      if (r.adId) ads[r.adId] = { name: r.adName || "", adsetId: r.adsetId || "", campaignId: r.campaignId || "" };
    }
    return { campaigns, adsets, ads };
  });
}
