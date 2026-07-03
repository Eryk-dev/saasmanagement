// Meta Marketing API — insights de campanha (leitura) e gerenciamento
// (pausar/reativar/orçamento), via Graph API. Mesmo padrão do mp.js: single
// tenant, credencial via env (META_ACCESS_TOKEN — token longo de system user;
// ads_read pra métricas, ads_management pra gerenciar), factory com fetch
// injetável pra testar offline.
//
// A conta de anúncio é POR SAAS: `product.metaAdAccount` (ex.: act_1234567890),
// configurada em Ajustes → Integrações.

const GRAPH = "https://graph.facebook.com/v23.0";

export function makeMeta({ fetch: f = globalThis.fetch, accessToken } = {}) {
  const configured = () => !!accessToken;

  async function get(url) {
    const res = await f(url);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400 || body.error) {
      const msg = body.error?.message || text.slice(0, 300);
      const err = new Error(`Meta API -> ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // Escrita (status/orçamento): POST form-encoded no nó, como a Graph espera.
  async function post(path, params) {
    if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
    const res = await f(`${GRAPH}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, access_token: accessToken }).toString(),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400 || body.error) {
      const msg = body.error?.message || text.slice(0, 300);
      const err = new Error(`Meta API -> ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  return {
    configured,

    // Insights diários por campanha no intervalo [since, until] (YYYY-MM-DD).
    // Segue a paginação do Graph até o fim. Retorna linhas normalizadas:
    // { campaignId, campaignName, date, spend, impressions, clicks, metaLeads }.
    async campaignInsights(adAccountId, { since, until }) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const account = String(adAccountId).startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      const params = new URLSearchParams({
        level: "campaign",
        time_increment: "1",
        time_range: JSON.stringify({ since, until }),
        fields: "campaign_id,campaign_name,spend,impressions,clicks,actions",
        limit: "500",
        access_token: accessToken,
      });
      let url = `${GRAPH}/${account}/insights?${params}`;
      const rows = [];
      let guard = 0; // paginação não pode virar loop infinito
      while (url && guard++ < 50) {
        const body = await get(url);
        for (const r of body.data || []) {
          // "lead" é o total canônico da Meta (já agrega on-site/off-site).
          const leadAction = (r.actions || []).find((a) => a.action_type === "lead");
          rows.push({
            campaignId: r.campaign_id,
            campaignName: r.campaign_name,
            date: r.date_start,
            spend: Number(r.spend) || 0,
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            metaLeads: Number(leadAction?.value) || 0,
          });
        }
        url = body.paging?.next || null;
      }
      return rows;
    },

    // Campanhas da conta com status e orçamento — a base do gerenciamento no
    // cockpit. `dailyBudget`/`lifetimeBudget` voltam em REAIS (a Graph usa centavos).
    async listCampaigns(adAccountId) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const account = String(adAccountId).startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      const params = new URLSearchParams({
        fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
        limit: "200",
        access_token: accessToken,
      });
      let url = `${GRAPH}/${account}/campaigns?${params}`;
      const rows = [];
      let guard = 0;
      while (url && guard++ < 20) {
        const body = await get(url);
        for (const c of body.data || []) {
          rows.push({
            id: c.id,
            name: c.name,
            status: c.status,
            effectiveStatus: c.effective_status,
            objective: c.objective || "",
            dailyBudget: c.daily_budget != null ? Number(c.daily_budget) / 100 : null,
            lifetimeBudget: c.lifetime_budget != null ? Number(c.lifetime_budget) / 100 : null,
          });
        }
        url = body.paging?.next || null;
      }
      return rows;
    },

    // Pausar/reativar campanha. Só os dois estados que fazem sentido operar daqui.
    async setCampaignStatus(campaignId, status) {
      if (status !== "ACTIVE" && status !== "PAUSED") throw new Error(`status inválido: ${status}`);
      await post(String(campaignId), { status });
      return { id: String(campaignId), status };
    },

    // Orçamento diário (CBO) em REAIS. Campanha com orçamento no conjunto
    // (sem daily_budget) falha na Graph com erro claro — repassamos.
    async setCampaignBudget(campaignId, dailyBudgetBRL) {
      const cents = Math.round(Number(dailyBudgetBRL) * 100);
      if (!Number.isFinite(cents) || cents <= 0) throw new Error(`orçamento inválido: ${dailyBudgetBRL}`);
      await post(String(campaignId), { daily_budget: String(cents) });
      return { id: String(campaignId), dailyBudget: cents / 100 };
    },
  };
}

// Singleton de produção (env), PREGUIÇOSO: imports ESM são içados e rodam antes
// do dotenv.config() do index.js — ler o env no topo congelaria o token vazio no
// dev local. Testes usam makeMeta com fetch mockado.
let _meta = null;
const inst = () => (_meta ??= makeMeta({ accessToken: process.env.META_ACCESS_TOKEN || "" }));
export const meta = {
  configured: () => inst().configured(),
  campaignInsights: (a, r) => inst().campaignInsights(a, r),
  listCampaigns: (a) => inst().listCampaigns(a),
  setCampaignStatus: (id, s) => inst().setCampaignStatus(id, s),
  setCampaignBudget: (id, v) => inst().setCampaignBudget(id, v),
};
