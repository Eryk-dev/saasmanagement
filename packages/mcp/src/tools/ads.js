// Meta Ads (tela "Publicidade") — o bloco que faltava inteiro no MCP.
//
// A API já cruza o gasto da Meta com o funil do Cockpit (routes.marketing.js):
// CPL real por campanha/conjunto/anúncio/dor, ganho e receita atribuídos por
// UTM, comparecimento em call, custo por etapa. O trabalho aqui é entregar isso
// pronto pra relatório: janela nomeada, unidades declaradas, totais somados e
// a comparação com o período anterior — que é o que transforma "gastei 12 mil"
// em "gastei 12 mil, 18% a mais, com CPL 9% menor".

import { z } from "zod";
import { http } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, delta } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, groupBy, round2, num } from "../core/shape.js";

const UNITS = {
  spend: "BRL", revenue: "BRL", cpl: "BRL", cplMeta: "BRL", cpc: "BRL", cpm: "BRL",
  costPerWin: "BRL", costPerLinkClick: "BRL", costPer: "BRL", dailyBudget: "BRL",
  ctr: "%", bookRate: "%", showRate: "%", roas: "x",
};

const COLS = {
  grupo: ["name", "spend", "leads", "cpl", "calls", "bookRate", "showRate", "won", "costPerWin", "revenue", "roas", "impressions", "ctr", "cpm", "id"],
  pains: ["label", "code", "adsCount", "spend", "leads", "cpl", "calls", "won", "costPerWin", "revenue", "roas"],
  stages: ["stage", "count", "costPer"],
  series: ["date", "spend", "leads"],
  placements: ["publisherPlatform", "platformPosition", "spend", "impressions", "clicks", "metaLeads", "cplMeta", "cpm"],
  objetos: ["level", "name", "effectiveStatus", "status", "dailyBudget", "objective", "id", "campaignId", "adsetId"],
};

// Métricas que valem comparar com o período anterior num relatório.
const COMPARAR = ["spend", "leads", "cpl", "won", "revenue", "roas", "metaLeads", "cplMeta", "formViews", "clicks", "impressions"];

const INCLUDES = ["campaigns", "adsets", "ads", "pains", "origins", "stages", "series"];

export function registerAdsTools(tool) {
  tool("ads_report", {
    group: "Publicidade (Meta Ads)",
    title: "Relatório de publicidade",
    description: "Gasto, CPL real, calls, ganhos, receita e ROAS por campanha, conjunto, anúncio e dor, com comparação com o período anterior.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      include: z.array(z.enum([...INCLUDES, "all"])).optional().describe("Padrão: campaigns, pains."),
      compare: z.boolean().optional().describe("Padrão true."),
      limit: z.number().int().optional(),
      min_spend: z.number().optional().describe("Gasto mínimo por linha."),
    },
  }, async ({ saas, period, since, until, include, compare = true, limit = 25, min_spend }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const inc = new Set(include?.includes("all") ? INCLUDES : (include?.length ? include : ["campaigns", "pains"]));

    const atual = await http.get(`/api/marketing/${encodeURIComponent(product.id)}`, { since: p.since, until: p.until });
    let anterior = null;
    if (compare) {
      try {
        anterior = await http.get(`/api/marketing/${encodeURIComponent(product.id)}`, { since: p.previous.since, until: p.previous.until });
      } catch { /* comparação é bônus: sem ela o relatório ainda vale */ }
    }

    const corta = (rows = []) => {
      const filtered = min_spend ? rows.filter((r) => num(r.spend) >= min_spend) : rows;
      return select(filtered, { limit });
    };

    const tables = {};
    if (inc.has("campaigns")) { const s = corta(atual.campaigns); tables.campaigns = { label: "Campanhas", columns: COLS.grupo, rows: s.rows, page: s.page }; }
    if (inc.has("adsets")) { const s = corta(atual.adsets); tables.adsets = { label: "Conjuntos", columns: COLS.grupo, rows: s.rows, page: s.page }; }
    if (inc.has("ads")) { const s = corta(atual.ads); tables.ads = { label: "Anúncios", columns: COLS.grupo, rows: s.rows, page: s.page }; }
    if (inc.has("pains")) { const s = corta(atual.pains); tables.pains = { label: "Dores (código no nome do anúncio)", columns: COLS.pains, rows: s.rows, page: s.page }; }
    if (inc.has("origins")) tables.origins = { label: "Origem dos leads", rows: atual.origins || [] };
    if (inc.has("stages")) tables.stages = { label: "Custo por etapa do funil", columns: COLS.stages, rows: atual.perStage || [] };
    if (inc.has("series")) tables.series = { label: "Série diária", columns: COLS.series, rows: atual.series || [] };

    if (anterior) {
      tables.comparativo = {
        label: `Comparativo vs ${p.previous.since} → ${p.previous.until}`,
        columns: ["metrica", "atual", "anterior", "variacao", "variacao_pct"],
        rows: COMPARAR.map((k) => {
          const d = delta(atual.totals?.[k], anterior.totals?.[k]);
          return d && { metrica: k, atual: d.current, anterior: d.previous, variacao: d.abs, variacao_pct: d.pct };
        }).filter(Boolean),
      };
    }

    const notes = [];
    if (!atual.synced) notes.push("nenhuma linha de insight da Meta nessa janela — rode ads_sync ou confira se a conta de anúncio está ligada.");
    if (!product.metaAdAccount) notes.push(`o produto ${product.id} não tem metaAdAccount configurado: os números de gasto vêm vazios.`);
    notes.push("CPL/leads usam a coorte de leads criados na janela; ganho e receita usam a DATA DA VENDA, então um lead antigo que fechou agora credita a campanha dele neste período.");

    return result({
      kind: "ads.report",
      title: `Publicidade · ${product.name || product.id}`,
      scope: { saas: product.id, adAccount: product.metaAdAccount || null },
      period: p,
      units: UNITS,
      totals: atual.totals || {},
      tables,
      notes,
      source: { endpoint: `GET /api/marketing/${product.id}`, syncedAt: atual.syncedAt || null },
    });
  });

  tool("ads_objects", {
    group: "Publicidade (Meta Ads)",
    title: "Objetos de anúncio ao vivo",
    description: "Estado ao vivo na Meta de campanhas, conjuntos e anúncios: status, orçamento diário e objetivo.",
    external: true,
    input: {
      saas: z.string().optional(),
      level: z.enum(["campaigns", "adsets", "ads", "all"]).optional().describe("Padrão all."),
      status: z.enum(["ACTIVE", "PAUSED", "any"]).optional().describe("Padrão any."),
      q: z.string().optional(),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, level = "all", status = "any", q, limit = 100 }) => {
    const product = await resolveProduct(saas, { requireAdAccount: true });
    const data = await http.get(`/api/marketing/${encodeURIComponent(product.id)}/adobjects`);
    const niveis = level === "all" ? ["campaigns", "adsets", "ads"] : [level];
    const todos = niveis.flatMap((n) => (data[n] || []).map((o) => ({ level: n.replace(/s$/, ""), ...o })));
    const s = select(todos, {
      where: status === "any" ? undefined : { effectiveStatus: status },
      q, qFields: ["name", "id"],
      sort: "name", limit,
    });
    return result({
      kind: "ads.objects",
      title: `Objetos de anúncio ao vivo · ${product.name || product.id}`,
      scope: { saas: product.id, adAccount: product.metaAdAccount },
      units: UNITS,
      totals: {
        campanhas: (data.campaigns || []).length,
        conjuntos: (data.adsets || []).length,
        anuncios: (data.ads || []).length,
        ativos: todos.filter((o) => o.effectiveStatus === "ACTIVE").length,
      },
      columns: COLS.objetos,
      rows: s.rows,
      rowsLabel: "Objetos",
      page: s.page,
      notes: Object.entries(data.errors || {}).map(([k, v]) => `nível ${k} falhou na Meta: ${v}`),
      source: { endpoint: `GET /api/marketing/${product.id}/adobjects` },
    });
  });

  tool("ads_accounts", {
    group: "Publicidade (Meta Ads)",
    title: "Contas de anúncio da Meta",
    description: "Contas de anúncio que o token alcança e qual produto do Cockpit está ligado a cada uma.",
    external: true,
  }, async () => {
    const [contas, produtos] = await Promise.all([
      http.get("/api/marketing/meta/adaccounts").catch((e) => ({ configured: false, accounts: [], erro: e.message })),
      http.get("/api/products"),
    ]);
    const ligados = new Map(produtos.filter((p) => p.metaAdAccount).map((p) => [String(p.metaAdAccount), p.id]));
    const rows = (contas.accounts || []).map((a) => ({ ...a, saas: ligados.get(String(a.id)) || null }));
    return result({
      kind: "ads.accounts",
      title: "Contas de anúncio da Meta",
      totals: { configurada: !!contas.configured, contas: rows.length, ligadas: rows.filter((r) => r.saas).length },
      rows,
      rowsLabel: "Contas",
      tables: {
        produtos: {
          label: "Produtos do Cockpit",
          columns: ["id", "name", "metaAdAccount", "metaPageId"],
          rows: produtos.map((p) => ({ id: p.id, name: p.name, metaAdAccount: p.metaAdAccount || null, metaPageId: p.metaPageId || null })),
        },
      },
      notes: contas.configured ? [] : ["META_ACCESS_TOKEN não configurado no servidor: nenhuma leitura ao vivo da Meta funciona."],
      source: { endpoint: "GET /api/marketing/meta/adaccounts" },
    });
  });

  tool("ads_sync", {
    group: "Publicidade (Meta Ads)",
    title: "Puxar insights da Meta",
    description: "Puxa da Meta os insights do período e grava em ad_insights, que alimenta ads_report.",
    write: true, external: true, idempotent: true,
    input: { saas: z.string().optional(), ...periodInput(z) },
  }, async ({ saas, period, since, until }) => {
    const p = resolvePeriod({ period, since, until });
    const body = { since: p.since, until: p.until };
    if (saas) body.saas = (await resolveProduct(saas)).id;
    const r = await http.post("/api/marketing/sync", body, { timeoutMs: 300_000 });
    const rows = Object.entries(r.report || {}).map(([id, v]) => ({ saas: id, ok: v.ok, linhas: v.rows ?? 0, erro: v.error || null }));
    return result({
      kind: "ads.sync",
      title: "Sync da Meta",
      period: p,
      totals: { produtos: rows.length, linhas: rows.reduce((a, r2) => a + num(r2.linhas), 0), falhas: rows.filter((r2) => !r2.ok).length },
      columns: ["saas", "ok", "linhas", "erro"],
      rows,
      source: { endpoint: "POST /api/marketing/sync" },
    });
  });

  tool("ads_set_status", {
    group: "Publicidade (Meta Ads)",
    title: "Pausar / reativar anúncio",
    description: "Liga (ACTIVE) ou pausa (PAUSED) uma campanha, conjunto ou anúncio na Meta.",
    write: true, external: true, destructive: true,
    danger: "muda a veiculação real na conta de anúncios — reativar volta a gastar dinheiro.",
    input: {
      object_id: z.string().describe("id vindo de ads_objects."),
      status: z.enum(["ACTIVE", "PAUSED"]),
    },
  }, async ({ object_id, status }) => {
    const r = await http.post(`/api/marketing/objects/${encodeURIComponent(object_id)}/status`, { status });
    return result({
      kind: "ads.status",
      title: `Status aplicado: ${status}`,
      totals: { objeto: object_id, status, ...r },
      source: { endpoint: `POST /api/marketing/objects/${object_id}/status` },
    });
  });

  tool("ads_set_budget", {
    group: "Publicidade (Meta Ads)",
    title: "Orçamento diário",
    description: "Define o orçamento diário de uma campanha (CBO) ou conjunto (ABO).",
    write: true, external: true, destructive: true,
    danger: "altera quanto a conta gasta por dia, de verdade.",
    input: {
      object_id: z.string().describe("id da campanha (CBO) ou conjunto (ABO)."),
      daily_budget: z.number().positive().describe("Reais por dia (150 = R$ 150,00)."),
    },
  }, async ({ object_id, daily_budget }) => {
    const r = await http.post(`/api/marketing/objects/${encodeURIComponent(object_id)}/budget`, { dailyBudget: daily_budget });
    return result({
      kind: "ads.budget",
      title: `Orçamento diário: R$ ${daily_budget}`,
      units: UNITS,
      totals: { objeto: object_id, dailyBudget: daily_budget, ...r },
      source: { endpoint: `POST /api/marketing/objects/${object_id}/budget` },
    });
  });

  tool("ads_placements", {
    group: "Publicidade (Meta Ads)",
    title: "Posicionamentos",
    description: "Gasto, CPL e CPM por posicionamento (Facebook/Instagram/Audience Network × feed, stories, reels).",
    external: true,
    input: { saas: z.string().optional(), ...periodInput(z) },
  }, async ({ saas, period, since, until }) => {
    const product = await resolveProduct(saas, { requireAdAccount: true });
    const p = resolvePeriod({ period, since, until });
    const r = await http.get(`/api/marketing/${encodeURIComponent(product.id)}/placements`, { since: p.since, until: p.until });
    const rows = r.placements || [];
    return result({
      kind: "ads.placements",
      title: `Posicionamentos · ${product.name || product.id}`,
      scope: { saas: product.id },
      period: p,
      units: UNITS,
      totals: {
        spend: round2(rows.reduce((a, x) => a + num(x.spend), 0)),
        impressions: rows.reduce((a, x) => a + num(x.impressions), 0),
        metaLeads: rows.reduce((a, x) => a + num(x.metaLeads), 0),
      },
      columns: COLS.placements,
      rows,
      rowsLabel: "Posicionamentos",
      notes: r.configured === false ? ["Meta não configurada ou produto sem conta de anúncio."] : [],
      source: { endpoint: `GET /api/marketing/${product.id}/placements` },
    });
  });

  tool("ads_insights_daily", {
    group: "Publicidade (Meta Ads)",
    title: "Insights crus por dia",
    description: "Linhas cruas de ad_insights já sincronizadas (dia × campanha × conjunto × anúncio), com agrupamento livre.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      group_by: z.enum(["date", "campaignName", "adsetName", "adName", "none"]).optional().describe("Padrão date."),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, group_by = "date", limit = 200 }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const all = await http.get("/api/ad_insights", { saas: product.id });
    const janela = (all || []).filter((r) => r.saas === product.id && r.date >= p.since && r.date <= p.until);
    const SUM = ["spend", "impressions", "clicks", "linkClicks", "metaLeads", "video3s", "videoP25", "videoP50", "videoP95"];
    const rows = group_by === "none"
      ? select(janela, { sort: "date:desc", limit }).rows
      : groupBy(janela, {
        by: group_by, sum: SUM, label: group_by,
        derive: (g) => ({
          cplMeta: g.metaLeads > 0 ? round2(g.spend / g.metaLeads) : null,
          cpm: g.impressions > 0 ? round2((g.spend / g.impressions) * 1000) : null,
          ctr: g.impressions > 0 ? round2((g.linkClicks / g.impressions) * 100) : null,
        }),
      }).sort((a, b) => (group_by === "date" ? String(a[group_by]).localeCompare(String(b[group_by])) : b.spend - a.spend)).slice(0, limit);

    return result({
      kind: "ads.insights",
      title: `Insights diários · ${product.name || product.id}`,
      scope: { saas: product.id, group_by },
      period: p,
      units: UNITS,
      totals: Object.fromEntries(SUM.map((k) => [k, round2(janela.reduce((a, r) => a + num(r[k]), 0))])),
      rows,
      rowsLabel: "Linhas",
      notes: janela.length ? [] : ["nenhuma linha sincronizada nessa janela — rode ads_sync."],
      source: { endpoint: "GET /api/ad_insights" },
    });
  });

  tool("ads_attribution", {
    group: "Publicidade (Meta Ads)",
    title: "Catálogo id → nome",
    description: "Traduz ids de campanha, conjunto e anúncio (os do UTM do lead) para nomes.",
    input: { saas: z.string().optional(), q: z.string().optional() },
  }, async ({ saas, q }) => {
    const product = await resolveProduct(saas);
    const cat = await http.get(`/api/marketing/${encodeURIComponent(product.id)}/attribution`);
    const linhas = (nivel, obj) => Object.entries(obj || {}).map(([id, v]) => ({ nivel, id, name: v.name || "", campaignId: v.campaignId || "", adsetId: v.adsetId || "" }));
    const todos = [...linhas("campanha", cat.campaigns), ...linhas("conjunto", cat.adsets), ...linhas("anuncio", cat.ads)];
    const s = select(todos, { q, qFields: ["id", "name"], sort: "nivel", limit: 500 });
    return result({
      kind: "ads.attribution",
      title: `Catálogo de anúncios · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: { campanhas: Object.keys(cat.campaigns || {}).length, conjuntos: Object.keys(cat.adsets || {}).length, anuncios: Object.keys(cat.ads || {}).length },
      columns: ["nivel", "id", "name", "campaignId", "adsetId"],
      rows: s.rows,
      page: s.page,
      source: { endpoint: `GET /api/marketing/${product.id}/attribution` },
    });
  });

  tool("ads_delivery_rules", {
    group: "Publicidade (Meta Ads)",
    title: "Regras de veiculação",
    description: "Lê ou grava as regras automáticas de veiculação; action=tick avalia agora.",
    write: false, external: true,
    input: {
      saas: z.string().optional(),
      action: z.enum(["get", "set", "tick"]).optional().describe("Padrão get."),
      rules: z.record(z.any()).optional().describe("Só com action=set; substitui o objeto inteiro."),
    },
  }, async ({ saas, action = "get", rules }) => {
    const product = await resolveProduct(saas);
    const base = `/api/marketing/${encodeURIComponent(product.id)}/delivery-rules`;
    let data;
    if (action === "set") {
      if (!rules) throw new Error("action=set exige o objeto `rules` (leia com action=get primeiro).");
      data = await http.put(base, rules);
    } else if (action === "tick") {
      data = await http.post(`${base}/tick`);
    } else {
      data = await http.get(base);
    }
    return result({
      kind: "ads.delivery_rules",
      title: `Regras de veiculação · ${product.name || product.id} (${action})`,
      scope: { saas: product.id },
      detail: data,
      source: { endpoint: `${action === "get" ? "GET" : action === "set" ? "PUT" : "POST"} ${base}` },
    });
  });

  tool("ads_creative", {
    group: "Publicidade (Meta Ads)",
    title: "Criativo de um anúncio",
    description: "Mídia e copy do criativo de um anúncio (URLs temporárias).",
    external: true,
    input: { saas: z.string().optional(), ad_id: z.string() },
  }, async ({ saas, ad_id }) => {
    const product = await resolveProduct(saas, { requireAdAccount: true });
    const data = await http.get(`/api/marketing/${encodeURIComponent(product.id)}/ad/${encodeURIComponent(ad_id)}/creative`);
    return result({
      kind: "ads.creative",
      title: `Criativo do anúncio ${ad_id}`,
      scope: { saas: product.id, ad_id },
      detail: data,
      source: { endpoint: `GET /api/marketing/${product.id}/ad/${ad_id}/creative` },
    });
  });

  tool("ads_video_job", {
    group: "Publicidade (Meta Ads)",
    title: "Status do anúncio por vídeo",
    description: "Andamento do trabalho de criar anúncio a partir de vídeo.",
    input: { job_id: z.string() },
  }, async ({ job_id }) => {
    const data = await http.get(`/api/marketing/job/${encodeURIComponent(job_id)}`);
    return result({ kind: "ads.job", title: `Trabalho de vídeo ${job_id}`, detail: data, source: { endpoint: `GET /api/marketing/job/${job_id}` } });
  });
}
