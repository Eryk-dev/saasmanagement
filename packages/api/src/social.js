// Publicação orgânica, métricas e comentários de rede social (Instagram +
// página do Facebook) via Graph API — o lado SOCIAL da integração Meta (o
// meta.js cuida de ADS). Mesmo padrão: single tenant, credencial via env
// (META_ACCESS_TOKEN), factory com fetch injetável pra testar offline.
//
// Permissões do token, por funcionalidade (ver .env.example):
//   métricas      instagram_basic, instagram_manage_insights, pages_read_engagement
//   publicar      instagram_content_publish, pages_manage_posts
//   comentários   instagram_manage_comments (IG),
//                 pages_manage_engagement + pages_read_user_content (página)
//
// Publicar no Instagram é SEMPRE em duas fases: cria um "container" apontando
// pra URL PÚBLICA da mídia (a Meta baixa de lá — por isso o /public/social/ do
// routes.social.js fica fora do auth) e depois publica o container. Vídeo
// (reels/story de vídeo) processa assíncrono: poll de status_code até FINISHED.

const GRAPH = "https://graph.facebook.com/v23.0";
const DAY = 86400000;

// A API de insights por dia limita o intervalo a 30 dias por chamada; pra
// janelas maiores (90d) quebramos em pedaços de ≤30 dias e agregamos.
function dayChunks(since, until, maxDays = 30) {
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  const out = [];
  let s = new Date(since + "T12:00:00Z").getTime();
  const u = new Date(until + "T12:00:00Z").getTime();
  while (s <= u) {
    const e = Math.min(u, s + (maxDays - 1) * DAY);
    out.push({ since: fmt(s), until: fmt(e) });
    s = e + DAY;
  }
  return out;
}

export function makeSocial({ fetch: f = globalThis.fetch, accessToken, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const configured = () => !!accessToken;

  async function call(method, path, params = {}) {
    if (!configured()) throw new Error("Meta não configurada — defina META_ACCESS_TOKEN");
    const qs = new URLSearchParams({ ...params, access_token: params.access_token || accessToken });
    // DELETE, como GET, leva tudo na query string (a Graph não lê corpo nele).
    const inQuery = method === "GET" || method === "DELETE";
    const url = inQuery ? `${GRAPH}/${path}?${qs}` : `${GRAPH}/${path}`;
    const res = await f(url, method === "GET" ? undefined : {
      method,
      ...(inQuery ? {} : {
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: qs.toString(),
      }),
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
  const del = (path, params) => call("DELETE", path, params);

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

    // Insights AGREGADOS do perfil no período. Cada lote é fail-soft (métrica
    // que a conta não tem não zera as outras) e chunkado em ≤30 dias. Métricas
    // aditivas (interações, cliques) somam certo; alcance/contas engajadas são
    // únicos por janela, então a soma de janelas em 90d é uma aproximação.
    async igInsights(igUserId, { since, until }) {
      const out = {};
      const add = (name, v) => { out[name] = (out[name] || 0) + v; };
      const fetchBatch = async (metric, win) => {
        try {
          const body = await get(`${igUserId}/insights`, { metric, period: "day", metric_type: "total_value", since: win.since, until: win.until });
          for (const m of body.data || []) add(m.name, Number(m.total_value?.value) || 0);
        } catch { /* métrica indisponível — segue sem ela */ }
      };
      for (const win of dayChunks(since, until)) {
        await fetchBatch("reach,profile_views,accounts_engaged,total_interactions", win);
        await fetchBatch("likes,comments,shares,saves,views", win);
        await fetchBatch("website_clicks,profile_links_taps", win);
      }
      return out;
    },

    // Alcance separado entre SEGUIDORES e NÃO-SEGUIDORES (breakdown follow_type)
    // — a métrica-chave de crescimento: quanto do alcance é gente nova. null se
    // a conta não libera.
    async igReachBreakdown(igUserId, { since, until }) {
      let follower = 0, nonFollower = 0, any = false;
      for (const win of dayChunks(since, until)) {
        try {
          const body = await get(`${igUserId}/insights`, { metric: "reach", period: "day", metric_type: "total_value", breakdown: "follow_type", since: win.since, until: win.until });
          const results = body.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
          for (const r of results) {
            const key = String(r.dimension_values?.[0] || "").toUpperCase();
            const v = Number(r.value) || 0;
            if (key.includes("NON")) nonFollower += v; else follower += v;
            any = true;
          }
        } catch { /* fail-soft */ }
      }
      return any ? { follower, nonFollower } : null;
    },

    // Série diária de um insight (values[]) — pros gráficos de linha. `metric`
    // = follower_count (variação líquida/dia) ou reach. null quando indisponível.
    async igDailySeries(igUserId, metric, { since, until }) {
      const series = [];
      for (const win of dayChunks(since, until)) {
        try {
          const body = await get(`${igUserId}/insights`, { metric, period: "day", since: win.since, until: win.until });
          for (const v of body.data?.[0]?.values || []) series.push({ date: String(v.end_time || "").slice(0, 10), value: Number(v.value) || 0 });
        } catch { /* fail-soft */ }
      }
      return series.length ? series : null;
    },

    // Últimos posts com engajamento E insights por post (alcance/salvos/
    // compartilhamentos/interações), pedidos de uma vez via insights aninhado no
    // edge de mídia; se a Graph recusar o combo, cai pros campos básicos.
    async igMedia(igUserId, { limit = 12 } = {}) {
      const base = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{media_url,thumbnail_url}";
      let data;
      try {
        data = (await get(`${igUserId}/media`, { fields: `${base},insights.metric(reach,saved,shares,total_interactions)`, limit: String(limit) })).data || [];
      } catch {
        data = (await get(`${igUserId}/media`, { fields: base, limit: String(limit) })).data || [];
      }
      // Métricas de vídeo (views, tempo médio assistido, skip nos 3 primeiros
      // segundos) não entram no combo aninhado acima — foto rejeita métrica de
      // reel e a Graph derruba o lote inteiro — então cada vídeo ganha uma
      // chamada própria, em paralelo e fail-soft; se o skip_rate não existir
      // pra mídia (vídeo antigo, pré-reels), tenta o conjunto sem ele.
      const video = {};
      await Promise.all(data.filter((m) => m.media_type === "VIDEO").map(async (m) => {
        for (const metric of ["views,ig_reels_avg_watch_time,reels_skip_rate", "views,ig_reels_avg_watch_time"]) {
          try {
            const body = await get(`${m.id}/insights`, { metric });
            const val = (name) => {
              const v = (body.data || []).find((x) => x.name === name)?.values?.[0]?.value;
              return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
            };
            video[m.id] = { views: val("views"), avgWatchMs: val("ig_reels_avg_watch_time"), skipRate: val("reels_skip_rate") };
            return;
          } catch { /* tenta o conjunto menor; sem ele, segue sem métricas de vídeo */ }
        }
      }));
      const child = (m) => m.children?.data?.[0];
      const ins = (m, name) => Number((m.insights?.data || []).find((x) => x.name === name)?.values?.[0]?.value) || 0;
      return data.map((m) => ({
        id: m.id,
        caption: m.caption || "",
        type: m.media_type,
        // vídeo usa thumbnail_url (o media_url é o arquivo do vídeo); carrossel
        // cai no primeiro filho.
        mediaUrl: m.thumbnail_url || m.media_url || child(m)?.media_url || child(m)?.thumbnail_url || "",
        permalink: m.permalink || "",
        at: m.timestamp || "",
        likes: Number(m.like_count) || 0,
        comments: Number(m.comments_count) || 0,
        reach: ins(m, "reach"),
        saved: ins(m, "saved"),
        shares: ins(m, "shares"),
        totalInteractions: ins(m, "total_interactions"),
        // Só vídeo tem: views, tempo médio (ms), % de skip nos 3s e a URL do
        // arquivo (o front lê a duração dos metadados dele pra calcular
        // retenção — a Graph não expõe duração). null/"" nos demais formatos.
        views: video[m.id]?.views ?? null,
        avgWatchMs: video[m.id]?.avgWatchMs ?? null,
        skipRate: video[m.id]?.skipRate ?? null,
        videoUrl: m.media_type === "VIDEO" ? (m.media_url || "") : "",
      }));
    },

    // Demografia dos seguidores (snapshot lifetime): país, cidade, idade, gênero.
    // Cada quebra é fail-soft; conta com <100 seguidores costuma vir vazia.
    async igDemographics(igUserId) {
      const out = { countries: [], cities: [], ages: [], genders: [] };
      const one = async (breakdown, dest) => {
        try {
          const body = await get(`${igUserId}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown });
          const results = body.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
          out[dest] = results
            .map((r) => ({ key: String(r.dimension_values?.[0] ?? "?"), value: Number(r.value) || 0 }))
            .sort((a, b) => b.value - a.value);
        } catch { /* fail-soft */ }
      };
      await one("country", "countries");
      await one("city", "cities");
      await one("age", "ages");
      await one("gender", "genders");
      return out;
    },

    // Melhor horário pra postar: média de seguidores online por hora (0..23),
    // agregada dos dias que a Graph devolve. null quando indisponível.
    async igOnlineFollowers(igUserId) {
      try {
        const body = await get(`${igUserId}/insights`, { metric: "online_followers", period: "lifetime" });
        const values = body.data?.[0]?.values || [];
        const sum = new Array(24).fill(0), cnt = new Array(24).fill(0);
        for (const v of values) {
          for (const [h, c] of Object.entries(v.value || {})) {
            const hi = Number(h);
            if (hi >= 0 && hi < 24) { sum[hi] += Number(c) || 0; cnt[hi]++; }
          }
        }
        const hours = sum.map((s, i) => (cnt[i] ? Math.round(s / cnt[i]) : 0));
        return hours.some((h) => h > 0) ? hours : null;
      } catch { return null; }
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

    // ── Comentários ─────────────────────────────────────────────────────────
    // Exige instagram_manage_comments (IG) e pages_manage_engagement +
    // pages_read_user_content (página do FB) no token.
    //
    // A forma dos dois lados é diferente (IG: text/username/timestamp; FB:
    // message/from.name/created_time), então cada leitura já devolve o formato
    // NORMALIZADO — quem consome (social-comments.js) não fica com um if por
    // rede espalhado.

    // Comentários de uma mídia do Instagram, com as respostas aninhadas.
    // `replies` vem junto: um comentário respondido pela própria conta é o que
    // marca "já resolvido", e sem elas todo comentário pareceria pendente.
    async igComments(mediaId, { limit = 50 } = {}) {
      const fields = "id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp,like_count,hidden}";
      const body = await get(`${mediaId}/comments`, { fields, limit: String(limit) });
      const one = (c, parentId = "") => ({
        id: String(c.id),
        text: c.text || "",
        author: c.username || "",
        at: c.timestamp ? new Date(c.timestamp).toISOString() : "",
        likes: Number(c.like_count) || 0,
        hidden: !!c.hidden,
        parentId,
      });
      const out = [];
      for (const c of body.data || []) {
        out.push(one(c));
        for (const r of c.replies?.data || []) out.push(one(r, String(c.id)));
      }
      return out;
    },

    // Legenda/permalink de UMA mídia — o webhook de comentário só manda o id do
    // post, e sem isso o comentário chegaria órfão ("post 178…") até a próxima
    // varredura.
    async igMediaInfo(mediaId) {
      const m = await get(String(mediaId), { fields: "id,caption,permalink,media_type,timestamp" });
      return {
        id: String(m.id),
        caption: m.caption || "",
        permalink: m.permalink || "",
        type: m.media_type || "",
        at: m.timestamp ? new Date(m.timestamp).toISOString() : "",
      };
    },

    async igReplyComment(commentId, message) {
      const body = await post(`${commentId}/replies`, { message });
      return String(body.id || "");
    },

    // Ocultar tira o comentário da vista de todo mundo menos de quem escreveu —
    // é o movimento certo pra spam/ataque (excluir gera print de "censura").
    async igHideComment(commentId, hide = true) {
      await post(String(commentId), { hide: hide ? "true" : "false" });
      return true;
    },

    async igDeleteComment(commentId) {
      await del(String(commentId));
      return true;
    },

    // Posts recentes da página do Facebook (pra varrer os comentários deles).
    async fbPosts(pageId, { limit = 12, token } = {}) {
      const access_token = token || (await this.pageToken(pageId));
      const body = await get(`${pageId}/posts`, {
        fields: "id,message,created_time,permalink_url",
        limit: String(limit), access_token,
      });
      return (body.data || []).map((p) => ({
        id: String(p.id),
        caption: p.message || "",
        permalink: p.permalink_url || "",
        at: p.created_time ? new Date(p.created_time).toISOString() : "",
      }));
    },

    // Posts de ANÚNCIO da página ("dark posts"). NÃO saem no /posts, que lista
    // só o que foi publicado no mural — mas é neles que cai a maior parte dos
    // comentários enquanto a campanha roda. Sem esta leitura, comentário de
    // anúncio é invisível pro cockpit.
    async fbAdsPosts(pageId, { limit = 10, token } = {}) {
      const access_token = token || (await this.pageToken(pageId));
      const body = await get(`${pageId}/ads_posts`, {
        fields: "id,message,created_time,permalink_url",
        limit: String(limit), access_token,
      });
      return (body.data || []).map((p) => ({
        id: String(p.id),
        caption: p.message || "",
        permalink: p.permalink_url || "",
        at: p.created_time ? new Date(p.created_time).toISOString() : "",
      }));
    },

    // Comentários de um post da página, com as respostas aninhadas. `from` só
    // vem preenchido com pages_read_user_content; sem ele a Meta devolve o
    // comentário sem autor, e aí o card mostra "alguém".
    async fbComments(postId, { limit = 50, token, pageId } = {}) {
      const access_token = token || (await this.pageToken(pageId));
      const fields = "id,message,created_time,like_count,is_hidden,from{id,name},comments{id,message,created_time,like_count,is_hidden,from{id,name}}";
      const body = await get(`${postId}/comments`, { fields, limit: String(limit), filter: "stream", access_token });
      const one = (c, parentId = "") => ({
        id: String(c.id),
        text: c.message || "",
        author: c.from?.name || "",
        authorId: String(c.from?.id || ""),
        at: c.created_time ? new Date(c.created_time).toISOString() : "",
        likes: Number(c.like_count) || 0,
        hidden: !!c.is_hidden,
        parentId,
      });
      const out = [];
      for (const c of body.data || []) {
        out.push(one(c));
        for (const r of c.comments?.data || []) out.push(one(r, String(c.id)));
      }
      return out;
    },

    // Responder na página = criar um comentário FILHO do comentário (o edge
    // /comments do próprio comentário), sempre com o token DA PÁGINA pra sair
    // assinado como a página e não como pessoa.
    async fbReplyComment(commentId, message, { token, pageId } = {}) {
      const access_token = token || (await this.pageToken(pageId));
      const body = await post(`${commentId}/comments`, { message, access_token });
      return String(body.id || "");
    },

    async fbHideComment(commentId, hide = true, { token, pageId } = {}) {
      const access_token = token || (await this.pageToken(pageId));
      await post(String(commentId), { is_hidden: hide ? "true" : "false", access_token });
      return true;
    },

    async fbDeleteComment(commentId, { token, pageId } = {}) {
      const access_token = token || (await this.pageToken(pageId));
      await del(String(commentId), { access_token });
      return true;
    },

    // ── Publicação · Instagram ──────────────────────────────────────────────
    // items = [{ url, mime }] com URLs PÚBLICAS. format: feed|story|reel.
    // kind: image|carousel|video|sequence. Retorna { id, permalink }.
    async publishInstagram(igUserId, { format, kind, items, caption = "" }) {
      if (!items?.length) throw new Error("publicação sem mídia");
      const ig = String(igUserId);
      let containerId;

      if (kind === "sequence") {
        // "Carrossel de story": não existe na Graph — é uma sequência de
        // stories publicados EM ORDEM (um container+publish por item), que o
        // espectador vê como um story só, deslizando de um pro outro.
        if (format !== "story") throw new Error("sequência é formato de story");
        const ids = [];
        for (const it of items) {
          const isVid = String(it.mime || "").startsWith("video/");
          const c = await post(`${ig}/media`, isVid
            ? { media_type: "STORIES", video_url: it.url }
            : { media_type: "STORIES", image_url: it.url });
          if (isVid) await waitContainer(String(c.id));
          const pub = await post(`${ig}/media_publish`, { creation_id: String(c.id) });
          ids.push(String(pub.id));
        }
        return { id: ids[0] || "", ids, count: ids.length, permalink: "" };
      }

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
  igReachBreakdown: (id, r) => inst().igReachBreakdown(id, r),
  igDailySeries: (id, m, r) => inst().igDailySeries(id, m, r),
  igMedia: (id, o) => inst().igMedia(id, o),
  igDemographics: (id) => inst().igDemographics(id),
  igOnlineFollowers: (id) => inst().igOnlineFollowers(id),
  pageInfo: (id) => inst().pageInfo(id),
  pageToken: (id) => inst().pageToken(id),
  igComments: (id, o) => inst().igComments(id, o),
  igReplyComment: (id, m) => inst().igReplyComment(id, m),
  igHideComment: (id, h) => inst().igHideComment(id, h),
  igDeleteComment: (id) => inst().igDeleteComment(id),
  igMediaInfo: (id) => inst().igMediaInfo(id),
  fbPosts: (id, o) => inst().fbPosts(id, o),
  fbAdsPosts: (id, o) => inst().fbAdsPosts(id, o),
  fbComments: (id, o) => inst().fbComments(id, o),
  fbReplyComment: (id, m, o) => inst().fbReplyComment(id, m, o),
  fbHideComment: (id, h, o) => inst().fbHideComment(id, h, o),
  fbDeleteComment: (id, o) => inst().fbDeleteComment(id, o),
  publishInstagram: (id, o) => inst().publishInstagram(id, o),
  publishFacebook: (id, o) => inst().publishFacebook(id, o),
};
