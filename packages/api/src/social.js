// Publicação orgânica e métricas de rede social (Instagram + página do
// Facebook) via Graph API — o lado SOCIAL da integração Meta (o meta.js cuida
// de ADS). Mesmo padrão: single tenant, credencial via env (META_ACCESS_TOKEN,
// que precisa de instagram_basic + instagram_content_publish +
// pages_read_engagement/pages_manage_posts pra publicar na página), factory
// com fetch injetável pra testar offline.
//
// Publicar no Instagram é SEMPRE em duas fases: cria um "container" apontando
// pra URL PÚBLICA da mídia (a Meta baixa de lá — por isso o /public/social/ do
// routes.social.js fica fora do auth) e depois publica o container. Vídeo
// (reels/story de vídeo) processa assíncrono: poll de status_code até FINISHED.

const GRAPH = "https://graph.facebook.com/v23.0";

export function makeSocial({ fetch: f = globalThis.fetch, accessToken, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const configured = () => !!accessToken;

  async function call(method, path, params = {}) {
    if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
    const qs = new URLSearchParams({ ...params, access_token: params.access_token || accessToken });
    const url = method === "GET" ? `${GRAPH}/${path}?${qs}` : `${GRAPH}/${path}`;
    const res = await f(url, method === "GET" ? undefined : {
      method,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: qs.toString(),
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
  const get = (path, params) => call("GET", path, params);
  const post = (path, params) => call("POST", path, params);

  // Espera o container de vídeo processar (a publish falha antes de FINISHED).
  async function waitContainer(containerId, { timeoutMs = 300000, intervalMs = 5000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const body = await get(containerId, { fields: "status_code,status" });
      if (body.status_code === "FINISHED") return;
      if (body.status_code === "ERROR") throw new Error(`Meta: processamento da mídia falhou (${body.status || "sem detalhe"})`);
      if (Date.now() >= deadline) throw new Error("Meta: mídia ainda em processamento — tente publicar de novo em instantes");
      await sleep(intervalMs);
    }
  }

  return {
    configured,

    // ── Métricas / leitura ──────────────────────────────────────────────────
    // Perfil do Instagram business (seguidores, posts, foto).
    async igAccount(igUserId) {
      return get(String(igUserId), { fields: "username,name,followers_count,follows_count,media_count,profile_picture_url,biography" });
    },

    // Insights do perfil no período — depende de permissão/volume da conta,
    // quem chama trata erro como "sem dado" (fail-soft).
    async igInsights(igUserId, { since, until }) {
      const body = await get(`${igUserId}/insights`, {
        metric: "reach,profile_views,accounts_engaged",
        period: "day",
        metric_type: "total_value",
        since, until,
      });
      const out = {};
      for (const m of body.data || []) out[m.name] = Number(m.total_value?.value) || 0;
      return out;
    },

    // Últimos posts do perfil com engajamento — o feed da tela.
    async igMedia(igUserId, { limit = 12 } = {}) {
      const body = await get(`${igUserId}/media`, {
        fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
        limit: String(limit),
      });
      return (body.data || []).map((m) => ({
        id: m.id,
        caption: m.caption || "",
        type: m.media_type,
        mediaUrl: m.media_url || m.thumbnail_url || "",
        permalink: m.permalink || "",
        at: m.timestamp || "",
        likes: Number(m.like_count) || 0,
        comments: Number(m.comments_count) || 0,
      }));
    },

    // Página do Facebook (nome, curtidas/seguidores, foto).
    async pageInfo(pageId) {
      return get(String(pageId), { fields: "name,fan_count,followers_count,picture{url},link" });
    },

    // Token DA PÁGINA (publicar como página exige ele). Se o token de sistema
    // não enxerga, quem chama decide o fallback.
    async pageToken(pageId) {
      const body = await get(String(pageId), { fields: "access_token" });
      if (!body.access_token) throw new Error("Meta: token da página indisponível (o token precisa de pages_manage_posts)");
      return body.access_token;
    },

    // ── Publicação · Instagram ──────────────────────────────────────────────
    // items = [{ url, mime }] com URLs PÚBLICAS. format: feed|story|reel.
    // kind: image|carousel|video. Retorna { id, permalink }.
    async publishInstagram(igUserId, { format, kind, items, caption = "" }) {
      if (!items?.length) throw new Error("publicação sem mídia");
      const ig = String(igUserId);
      let containerId;

      if (kind === "carousel") {
        if (format !== "feed") throw new Error("carrossel só existe no feed");
        const children = [];
        for (const it of items) {
          const c = await post(`${ig}/media`, { image_url: it.url, is_carousel_item: "true" });
          children.push(String(c.id));
        }
        const parent = await post(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
        containerId = String(parent.id);
      } else if (kind === "video") {
        const params = format === "story"
          ? { media_type: "STORIES", video_url: items[0].url }
          : { media_type: "REELS", video_url: items[0].url, caption, share_to_feed: format === "feed" ? "true" : "false" };
        const c = await post(`${ig}/media`, params);
        containerId = String(c.id);
        await waitContainer(containerId);
      } else {
        const params = format === "story"
          ? { media_type: "STORIES", image_url: items[0].url }
          : { image_url: items[0].url, caption };
        const c = await post(`${ig}/media`, params);
        containerId = String(c.id);
      }

      const pub = await post(`${ig}/media_publish`, { creation_id: containerId });
      const mediaId = String(pub.id);
      let permalink = "";
      try { permalink = (await get(mediaId, { fields: "permalink" })).permalink || ""; } catch { /* story não tem permalink */ }
      return { id: mediaId, permalink };
    },

    // ── Publicação · página do Facebook ─────────────────────────────────────
    // Feed da página: foto, álbum (carrossel vira multi-foto) ou vídeo.
    // Stories de página ficam de fora (fluxo próprio da Meta, sem paridade).
    async publishFacebook(pageId, { format, kind, items, caption = "" }) {
      if (!items?.length) throw new Error("publicação sem mídia");
      if (format === "story") throw new Error("story de página não é suportado por aqui — publique o story no Instagram");
      const token = await this.pageToken(pageId);
      const page = String(pageId);

      if (kind === "video") {
        const body = await post(`${page}/videos`, { file_url: items[0].url, description: caption, access_token: token });
        return { id: String(body.id), permalink: "" };
      }
      if (kind === "carousel") {
        const media = [];
        for (const it of items) {
          const ph = await post(`${page}/photos`, { url: it.url, published: "false", access_token: token });
          media.push(String(ph.id));
        }
        const body = await post(`${page}/feed`, {
          message: caption,
          access_token: token,
          ...Object.fromEntries(media.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })])),
        });
        return { id: String(body.id), permalink: "" };
      }
      const body = await post(`${page}/photos`, { url: items[0].url, message: caption, access_token: token });
      return { id: String(body.post_id || body.id), permalink: "" };
    },
  };
}

// Singleton de produção (env), PREGUIÇOSO — mesmo motivo do meta.js: imports
// ESM rodam antes do dotenv.config() do index.js.
let _social = null;
const inst = () => (_social ??= makeSocial({ accessToken: process.env.META_ACCESS_TOKEN || "" }));
export const social = {
  configured: () => inst().configured(),
  igAccount: (id) => inst().igAccount(id),
  igInsights: (id, r) => inst().igInsights(id, r),
  igMedia: (id, o) => inst().igMedia(id, o),
  pageInfo: (id) => inst().pageInfo(id),
  pageToken: (id) => inst().pageToken(id),
  publishInstagram: (id, o) => inst().publishInstagram(id, o),
  publishFacebook: (id, o) => inst().publishFacebook(id, o),
};
