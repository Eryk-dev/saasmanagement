// Meta Marketing API — insights de campanha (leitura) e gerenciamento
// (pausar/reativar/orçamento), via Graph API. Mesmo padrão do mp.js: single
// tenant, credencial via env (META_ACCESS_TOKEN — token longo de system user;
// ads_read pra métricas, ads_management pra gerenciar), factory com fetch
// injetável pra testar offline.
//
// A conta de anúncio é POR SAAS: `product.metaAdAccount` (ex.: act_1234567890),
// configurada em Ajustes → Integrações.

const GRAPH = "https://graph.facebook.com/v23.0";

export function makeMeta({ fetch: f = globalThis.fetch, accessToken, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const configured = () => !!accessToken;
  const acct = (id) => (String(id).startsWith("act_") ? String(id) : `act_${id}`);

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

    // Insights diários por ANÚNCIO (level=ad) — base da atribuição campanha →
    // conjunto → anúncio. Mesmo contrato do campaignInsights, linhas ganham
    // adsetId/adsetName/adId/adName + métricas de criativo (clique no link e
    // funil de vídeo: 3s e 25/50/95% assistidos).
    async adInsights(adAccountId, { since, until }) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const account = String(adAccountId).startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      const params = new URLSearchParams({
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({ since, until }),
        fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,actions,video_p25_watched_actions,video_p50_watched_actions,video_p95_watched_actions",
        limit: "500",
        access_token: accessToken,
      });
      let url = `${GRAPH}/${account}/insights?${params}`;
      const rows = [];
      let guard = 0; // paginação não pode virar loop infinito
      // Campos de vídeo voltam como [{action_type:"video_view", value}] por métrica.
      const vid = (arr) => Number((arr || []).find((a) => a.action_type === "video_view")?.value) || 0;
      while (url && guard++ < 50) {
        const body = await get(url);
        for (const r of body.data || []) {
          const leadAction = (r.actions || []).find((a) => a.action_type === "lead");
          rows.push({
            campaignId: r.campaign_id,
            campaignName: r.campaign_name,
            adsetId: r.adset_id || "",
            adsetName: r.adset_name || "",
            adId: r.ad_id || "",
            adName: r.ad_name || "",
            date: r.date_start,
            spend: Number(r.spend) || 0,
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            linkClicks: Number(r.inline_link_clicks) || 0,
            video3s: vid(r.actions),           // "video_view" nas actions = 3s assistidos
            videoP25: vid(r.video_p25_watched_actions),
            videoP50: vid(r.video_p50_watched_actions),
            videoP95: vid(r.video_p95_watched_actions),
            metaLeads: Number(leadAction?.value) || 0,
          });
        }
        url = body.paging?.next || null;
      }
      return rows;
    },

    // Insights por PLACEMENT (publisher_platform × platform_position), agregados
    // no período (sem time_increment): onde o gasto acontece — Facebook/Instagram/
    // Audience Network/Messenger e feed/stories/reels/etc. A UTM não carrega
    // placement, então os leads aqui são os reportados pela Meta (metaLeads),
    // não os do cockpit.
    async placementInsights(adAccountId, { since, until }) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = new URLSearchParams({
        level: "account",
        breakdowns: "publisher_platform,platform_position",
        time_range: JSON.stringify({ since, until }),
        fields: "spend,impressions,clicks,inline_link_clicks,actions",
        limit: "500",
        access_token: accessToken,
      });
      let url = `${GRAPH}/${acct(adAccountId)}/insights?${params}`;
      const rows = [];
      let guard = 0; // paginação não pode virar loop infinito
      while (url && guard++ < 50) {
        const body = await get(url);
        for (const r of body.data || []) {
          const leadAction = (r.actions || []).find((a) => a.action_type === "lead");
          rows.push({
            platform: r.publisher_platform || "unknown",
            position: r.platform_position || "unknown",
            spend: Number(r.spend) || 0,
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            linkClicks: Number(r.inline_link_clicks) || 0,
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

    // Conjuntos de uma campanha — destino dos anúncios novos e gerenciamento
    // nível conjunto (orçamento em REAIS quando ABO).
    async listAdsets(campaignId) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = new URLSearchParams({
        fields: "id,name,status,effective_status,daily_budget",
        limit: "100",
        access_token: accessToken,
      });
      let url = `${GRAPH}/${campaignId}/adsets?${params}`;
      const rows = [];
      let guard = 0;
      while (url && guard++ < 10) {
        const body = await get(url);
        for (const s of body.data || []) {
          rows.push({
            id: s.id, name: s.name, status: s.status, effectiveStatus: s.effective_status,
            dailyBudget: s.daily_budget != null ? Number(s.daily_budget) / 100 : null,
          });
        }
        url = body.paging?.next || null;
      }
      return rows;
    },

    // Anúncios da CONTA inteira (id → nome/conjunto/campanha + situação) —
    // alimenta o catálogo de atribuição com nomes vivos e a visão por nível
    // (estilo Gerenciador) com toggle de status.
    async listAccountAds(adAccountId) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = new URLSearchParams({
        fields: "id,name,adset_id,campaign_id,status,effective_status",
        limit: "200",
        access_token: accessToken,
      });
      let url = `${GRAPH}/${acct(adAccountId)}/ads?${params}`;
      const rows = [];
      let guard = 0;
      while (url && guard++ < 25) {
        const body = await get(url);
        for (const a of body.data || []) {
          rows.push({
            id: a.id, name: a.name, adsetId: a.adset_id || "", campaignId: a.campaign_id || "",
            status: a.status, effectiveStatus: a.effective_status,
          });
        }
        url = body.paging?.next || null;
      }
      return rows;
    },

    // Conjuntos da CONTA inteira — a visão por nível lista tudo de uma vez;
    // status/orçamento vivos pra toggle e edição inline (ABO ou orçamento total).
    async listAccountAdsets(adAccountId) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = new URLSearchParams({
        fields: "id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id",
        limit: "200",
        access_token: accessToken,
      });
      let url = `${GRAPH}/${acct(adAccountId)}/adsets?${params}`;
      const rows = [];
      let guard = 0;
      while (url && guard++ < 25) {
        const body = await get(url);
        for (const s of body.data || []) {
          rows.push({
            id: s.id, name: s.name, status: s.status, effectiveStatus: s.effective_status,
            dailyBudget: s.daily_budget != null ? Number(s.daily_budget) / 100 : null,
            lifetimeBudget: s.lifetime_budget != null ? Number(s.lifetime_budget) / 100 : null,
            campaignId: s.campaign_id || "",
          });
        }
        url = body.paging?.next || null;
      }
      return rows;
    },

    // Anúncios de um conjunto — gerenciamento nível anúncio.
    async listAds(adsetId) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = new URLSearchParams({
        fields: "id,name,status,effective_status",
        limit: "200",
        access_token: accessToken,
      });
      let url = `${GRAPH}/${adsetId}/ads?${params}`;
      const rows = [];
      let guard = 0;
      while (url && guard++ < 10) {
        const body = await get(url);
        for (const a of body.data || []) {
          rows.push({ id: a.id, name: a.name, status: a.status, effectiveStatus: a.effective_status });
        }
        url = body.paging?.next || null;
      }
      return rows;
    },

    // Descobre página (e Instagram) dos anúncios que JÁ rodam na conta — evita
    // pedir page_id na mão: o criativo novo assina com a mesma página dos atuais.
    async discoverCreativeDefaults(adAccountId) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = new URLSearchParams({
        fields: "creative{object_story_spec}",
        limit: "50",
        access_token: accessToken,
      });
      const body = await get(`${GRAPH}/${acct(adAccountId)}/ads?${params}`);
      for (const ad of body.data || []) {
        const spec = ad.creative?.object_story_spec;
        if (spec?.page_id) {
          return { pageId: String(spec.page_id), instagramUserId: spec.instagram_user_id ? String(spec.instagram_user_id) : null };
        }
      }
      return null;
    },

    // Upload do vídeo do criativo (não-resumável — cobre vídeos de anúncio
    // típicos; a Graph aceita até ~1GB nesse modo). Retorna o video_id.
    async uploadVideo(adAccountId, { buffer, filename = "video.mp4", title }) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const fd = new FormData();
      fd.append("access_token", accessToken);
      if (title) fd.append("title", title);
      fd.append("source", new Blob([buffer]), filename);
      const res = await f(`${GRAPH}/${acct(adAccountId)}/advideos`, { method: "POST", body: fd });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = {}; }
      if (res.status >= 400 || body.error) {
        const msg = body.error?.message || text.slice(0, 300);
        throw new Error(`Meta API -> ${res.status}: ${msg}`);
      }
      if (!body.id) throw new Error("Meta API: upload de vídeo não retornou id");
      return String(body.id);
    },

    // Thumbnail do vídeo (obrigatória no creative). Só existe depois que a Meta
    // processa o upload, então faz poll até aparecer (ou estourar o prazo).
    async videoThumbnail(videoId, { timeoutMs = 180000, intervalMs = 5000 } = {}) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const body = await get(`${GRAPH}/${videoId}/thumbnails?access_token=${encodeURIComponent(accessToken)}`);
        const t = (body.data || []).find((x) => x.is_preferred) || (body.data || [])[0];
        if (t?.uri) return t.uri;
        if (Date.now() >= deadline) throw new Error("Meta: vídeo ainda em processamento (thumbnail indisponível) — tente de novo em instantes");
        await sleep(intervalMs);
      }
    },

    // Creative de vídeo: página + vídeo + copy + CTA com link, e url_tags com os
    // parâmetros dinâmicos ({{campaign.id}}/{{adset.id}}/{{ad.id}}) — é o que
    // carimba o lead com a origem e fecha a atribuição por UTM no cockpit.
    async createAdCreative(adAccountId, { name, pageId, instagramUserId, videoId, imageUrl, message, title, linkUrl, ctaType = "LEARN_MORE", urlTags }) {
      const spec = {
        page_id: String(pageId),
        video_data: {
          video_id: String(videoId),
          image_url: imageUrl,
          message,
          ...(title ? { title } : {}),
          call_to_action: { type: ctaType, value: { link: linkUrl } },
        },
      };
      if (instagramUserId) spec.instagram_user_id = String(instagramUserId);
      const body = await post(`${acct(adAccountId)}/adcreatives`, {
        name,
        object_story_spec: JSON.stringify(spec),
        ...(urlTags ? { url_tags: urlTags } : {}),
      });
      return String(body.id);
    },

    // Anúncio no conjunto indicado — nasce PAUSADO por padrão: revisão humana
    // no Gerenciador antes de gastar.
    async createAd(adAccountId, { adsetId, creativeId, name, status = "PAUSED" }) {
      const body = await post(`${acct(adAccountId)}/ads`, {
        name,
        adset_id: String(adsetId),
        creative: JSON.stringify({ creative_id: String(creativeId) }),
        status,
      });
      return { id: String(body.id), name, status };
    },

    // Duplica um CONJUNTO de anúncios (deep_copy leva os anúncios dentro), na
    // mesma campanha do original e PAUSADO. É a base do "clonar e trocar o
    // vídeo": público, orçamento, posicionamento, otimização e copy vêm de
    // brinde do conjunto de origem. Retorna { adsetId, adIds } dos cópias.
    async copyAdSet(adsetId, { campaignId, statusOption = "PAUSED", deepCopy = true } = {}) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = { deep_copy: deepCopy ? "true" : "false", status_option: statusOption };
      if (campaignId) params.campaign_id = String(campaignId);
      const body = await post(`${adsetId}/copies`, params);
      const copied = String(body.copied_adset_id || body.id || "");
      if (!copied) throw new Error("Meta: cópia do conjunto não retornou id");
      const adIds = (body.ad_object_ids || [])
        .filter((x) => String(x.ad_object_type || "").toUpperCase() === "AD")
        .map((x) => String(x.copied_id))
        .filter(Boolean);
      return { adsetId: copied, adIds };
    },

    // Renomeia qualquer nó (conjunto ou anúncio) — POST {name}.
    async renameObject(objectId, name) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      await post(String(objectId), { name });
      return { id: String(objectId), name };
    },

    // object_story_spec + url_tags do criativo de um anúncio — o que a gente
    // PRESERVA ao trocar só o vídeo (página, Instagram, copy, título, CTA, link,
    // e as UTMs de atribuição).
    async getAdCreativeSpec(adId) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = new URLSearchParams({ fields: "creative{object_story_spec,url_tags}", access_token: accessToken });
      const body = await get(`${GRAPH}/${adId}?${params}`);
      const c = body.creative || {};
      return { spec: c.object_story_spec || null, urlTags: c.url_tags || "" };
    },

    // Cria um criativo NOVO a partir do object_story_spec de origem, trocando só
    // o vídeo (video_id + thumbnail) e mantendo todo o resto do spec.
    async createVideoCreativeFromSpec(adAccountId, { name, sourceSpec, videoId, imageUrl, urlTags }) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const spec = sourceSpec ? JSON.parse(JSON.stringify(sourceSpec)) : null;
      if (!spec || !spec.video_data) {
        throw new Error("o anúncio de origem não é um anúncio de vídeo simples (sem object_story_spec.video_data) — troca de vídeo não se aplica");
      }
      spec.video_data.video_id = String(videoId);
      if (imageUrl) spec.video_data.image_url = imageUrl;
      const body = await post(`${acct(adAccountId)}/adcreatives`, {
        name,
        object_story_spec: JSON.stringify(spec),
        ...(urlTags ? { url_tags: urlTags } : {}),
      });
      return String(body.id);
    },

    // Atualiza um anúncio: nome e/ou criativo (troca a arte sem recriar o ad).
    async updateAd(adId, { name, creativeId } = {}) {
      if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
      const params = {};
      if (name) params.name = name;
      if (creativeId) params.creative = JSON.stringify({ creative_id: String(creativeId) });
      if (!Object.keys(params).length) return { id: String(adId) };
      await post(String(adId), params);
      return { id: String(adId), name };
    },

    // Pausar/reativar QUALQUER nível (campanha, conjunto ou anúncio) — o nó da
    // Graph aceita o mesmo POST {status}. Só os dois estados que operamos daqui.
    async setObjectStatus(objectId, status) {
      if (status !== "ACTIVE" && status !== "PAUSED") throw new Error(`status inválido: ${status}`);
      await post(String(objectId), { status });
      return { id: String(objectId), status };
    },

    // Orçamento diário em REAIS — campanha (CBO) ou conjunto (ABO). Nó sem
    // daily_budget falha na Graph com erro claro — repassamos.
    async setObjectBudget(objectId, dailyBudgetBRL) {
      const cents = Math.round(Number(dailyBudgetBRL) * 100);
      if (!Number.isFinite(cents) || cents <= 0) throw new Error(`orçamento inválido: ${dailyBudgetBRL}`);
      await post(String(objectId), { daily_budget: String(cents) });
      return { id: String(objectId), dailyBudget: cents / 100 };
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
  adInsights: (a, r) => inst().adInsights(a, r),
  listCampaigns: (a) => inst().listCampaigns(a),
  listAdsets: (id) => inst().listAdsets(id),
  listAds: (id) => inst().listAds(id),
  listAccountAds: (a) => inst().listAccountAds(a),
  listAccountAdsets: (a) => inst().listAccountAdsets(a),
  discoverCreativeDefaults: (a) => inst().discoverCreativeDefaults(a),
  uploadVideo: (a, o) => inst().uploadVideo(a, o),
  videoThumbnail: (id, o) => inst().videoThumbnail(id, o),
  createAdCreative: (a, o) => inst().createAdCreative(a, o),
  createAd: (a, o) => inst().createAd(a, o),
  copyAdSet: (id, o) => inst().copyAdSet(id, o),
  renameObject: (id, n) => inst().renameObject(id, n),
  getAdCreativeSpec: (id) => inst().getAdCreativeSpec(id),
  createVideoCreativeFromSpec: (a, o) => inst().createVideoCreativeFromSpec(a, o),
  updateAd: (id, o) => inst().updateAd(id, o),
  setObjectStatus: (id, s) => inst().setObjectStatus(id, s),
  setObjectBudget: (id, v) => inst().setObjectBudget(id, v),
};
