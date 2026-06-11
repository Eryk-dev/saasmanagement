// Meta Marketing API (insights de campanha) — spend/impressões/cliques/leads
// por campanha e por dia, via Graph API. Mesmo padrão do mp.js: single tenant,
// credencial via env (META_ACCESS_TOKEN — token longo de system user com
// ads_read), factory com fetch injetável pra testar offline.
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
  };
}

// Singleton de produção (env). Testes usam makeMeta com fetch mockado.
export const meta = makeMeta({ accessToken: process.env.META_ACCESS_TOKEN || "" });
