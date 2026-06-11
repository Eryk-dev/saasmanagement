// Marketing (Meta Ads × funil) — sincroniza insights de campanha pra collection
// `ad_insights` (upsert idempotente por saas+campanha+dia) e expõe as métricas
// cruzadas com os leads do Cockpit:
//   CPL real        = spend / leads criados no período (collection leads)
//   custo por etapa = spend / leads que CHEGARAM em cada estágio do funil
//     (aproximação: estágio ATUAL do lead >= índice do estágio — não há
//      histórico de transições; "custo por call", "custo por ganho" etc. saem
//      daqui pra qualquer funil, sem config extra)
//   por campanha    = spend/leads da própria Meta (CPL Meta)

import { meta as defaultMeta } from "./meta.js";

const DAY_MS = 86400000;
const dayStr = (d) => new Date(d).toISOString().slice(0, 10);

function rangeFromQuery(q, now = new Date()) {
  const until = q.until || dayStr(now);
  const since = q.since || dayStr(new Date(now.getTime() - 29 * DAY_MS));
  return { since, until };
}

// Upsert por id determinístico (1 linha por saas+campanha+dia).
async function upsertInsight(repo, row) {
  const id = `ai_${row.saas}_${row.campaignId}_${row.date}`;
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
        const rows = await meta.campaignInsights(p.metaAdAccount, { since, until });
        for (const r of rows) await upsertInsight(repo, { saas: p.id, ...r });
        report[p.id] = { ok: true, rows: rows.length };
      } catch (err) {
        req.log.warn({ saas: p.id, err: err.message }, "Meta: sync falhou");
        report[p.id] = { ok: false, error: String(err.message || err).slice(0, 200) };
      }
    }
    return { ok: true, since, until, report };
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

    // Custo por etapa: leads cujo estágio ATUAL é o estágio i ou um posterior.
    const stages = (product.funnel || []).map((f) => f.stage);
    const idx = (stage) => { const i = stages.indexOf(stage); return i < 0 ? 0 : i; };
    const perStage = stages.map((stage, i) => {
      const count = leads.filter((l) => idx(l.stage) >= i).length;
      return { stage, count, costPer: per(count) };
    });

    const byCampaign = {};
    for (const r of rows) {
      const c = byCampaign[r.campaignId] || (byCampaign[r.campaignId] = { id: r.campaignId, name: r.campaignName, spend: 0, impressions: 0, clicks: 0, metaLeads: 0 });
      c.spend += Number(r.spend) || 0;
      c.impressions += Number(r.impressions) || 0;
      c.clicks += Number(r.clicks) || 0;
      c.metaLeads += Number(r.metaLeads) || 0;
      c.name = r.campaignName || c.name;
    }
    const campaigns = Object.values(byCampaign)
      .map((c) => ({ ...c, spend: Math.round(c.spend * 100) / 100, cplMeta: c.metaLeads > 0 ? Math.round((c.spend / c.metaLeads) * 100) / 100 : null }))
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
      perStage, campaigns, series,
      synced: rows.length > 0,
    };
  });
}
