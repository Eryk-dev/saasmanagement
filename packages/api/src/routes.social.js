// Mídia social — métricas do perfil, publicação orgânica e a fila de
// COMENTÁRIOS (IG + página do Facebook) direto do cockpit.
//
// Config por SaaS: `product.metaIgUser` / `product.metaPageId` (Ajustes).
// Sem eles, descobre dos anúncios que já rodam na conta (mesma página/IG dos
// criativos ativos — meta.discoverCreativeDefaults) e cacheia em memória.
//
// Mídia gerada no cockpit (PNG do editor de Estáticos, vídeo de upload) vira
// asset na collection `social_assets` (bytes em base64) servido SEM auth em
// GET /public/social/:id — a Meta baixa a mídia por essa URL pública na hora
// de criar o container. Cada publicação vira um registro em `social_posts`
// (histórico com resultado por rede).
//
// Comentários vivem em `social_comments` (ver social-comments.js) e chegam por
// duas vias: o webhook da Meta (POST /api/webhooks/social — instantâneo) e a
// varredura dos posts recentes ao abrir a tela (reconcilia o estado real).

import { social as defaultSocial } from "./social.js";
import { meta as defaultMeta } from "./meta.js";
import { publicBase } from "./routes.js";
import { upsertComment, syncComments, listComments, commentInsights, invalidateSync, postTitleOf } from "./social-comments.js";

const IMG_MAX = 15 * 1024 * 1024;   // PNG de 1080×1920 fica bem abaixo disso
const VID_MAX = 80 * 1024 * 1024;   // reel curto; acima disso o jsonb sofre

const dayStr = (d) => new Date(new Date(d).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const ALLOWED_DAYS = new Set([7, 30, 90]);

// Rótulo humano do tipo de mídia do IG (reels vem como VIDEO no media_type).
const FMT_LABEL = { VIDEO: "Reels/Vídeo", CAROUSEL_ALBUM: "Carrossel", IMAGE: "Foto" };

// Engajamento médio por FORMATO — mostra qual tipo de conteúdo puxa mais
// alcance/interação, a decisão editorial mais importante pra crescer.
function byFormat(posts) {
  const g = {};
  for (const m of posts) {
    const label = FMT_LABEL[m.type] || m.type || "Outro";
    (g[label] ||= []).push(m);
  }
  return Object.entries(g).map(([label, arr]) => {
    const n = arr.length;
    const eng = (m) => m.totalInteractions || (m.likes + m.comments);
    return {
      label, count: n,
      avgReach: Math.round(arr.reduce((s, m) => s + (m.reach || 0), 0) / n),
      avgEng: Math.round(arr.reduce((s, m) => s + eng(m), 0) / n),
    };
  }).sort((a, b) => b.avgReach - a.avgReach);
}

// Recomendações derivadas dos números — o "o que fazer pra crescer".
function growthInsights({ reachBreakdown, formats, engagement, followerGrowth, insights }) {
  const out = [];
  if (reachBreakdown) {
    const total = reachBreakdown.follower + reachBreakdown.nonFollower;
    const pct = total ? Math.round((reachBreakdown.nonFollower / total) * 100) : 0;
    if (pct >= 40) out.push({ tone: "pos", text: `${pct}% do alcance veio de NÃO-seguidores: teu conteúdo está circulando pra fora da bolha, é assim que se cresce.` });
    else if (pct <= 20) out.push({ tone: "warn", text: `Só ${pct}% do alcance foi de não-seguidores: o conteúdo está preso em quem já te segue. Aposte mais reels e use ganchos que compartilham.` });
    else out.push({ tone: "info", text: `${pct}% do alcance foi de não-seguidores. Passar de 40% acelera o crescimento.` });
  }
  if (formats.length >= 2) {
    const best = formats[0], worst = formats[formats.length - 1];
    if (best.avgReach > worst.avgReach * 1.5 && worst.avgReach > 0) {
      out.push({ tone: "info", text: `${best.label} alcança ${(best.avgReach / worst.avgReach).toFixed(1).replace(".", ",")}× mais que ${worst.label} (${best.avgReach} vs ${worst.avgReach} por post). Priorize ${best.label}.` });
    }
  }
  if (engagement) {
    if (engagement.avgSaves >= 3) out.push({ tone: "pos", text: `Teus posts são salvos (${engagement.avgSaves} em média): salvamento é o sinal mais forte pro algoritmo, o conteúdo é útil.` });
    if (engagement.rate != null) {
      if (engagement.rate >= 3) out.push({ tone: "pos", text: `Taxa de engajamento de ${String(engagement.rate).replace(".", ",")}% está ótima (média do mercado fica em 1-3%).` });
      else if (engagement.rate < 1) out.push({ tone: "warn", text: `Taxa de engajamento de ${String(engagement.rate).replace(".", ",")}% está baixa: aposte em pergunta na legenda e CTA pra comentar/salvar.` });
    }
  }
  if (followerGrowth != null) {
    if (followerGrowth > 0) out.push({ tone: "pos", text: `+${followerGrowth} seguidores no período. Mantenha a cadência de posts que trouxe esse ganho.` });
    else if (followerGrowth < 0) out.push({ tone: "warn", text: `${followerGrowth} seguidores no período: teve perda líquida. Revise o que mudou no conteúdo dos últimos posts.` });
  }
  if (insights?.profile_links_taps > 0 && insights?.reach > 0) {
    const conv = Math.round((insights.profile_links_taps / insights.reach) * 10000) / 100;
    if (conv > 0) out.push({ tone: "info", text: `${insights.profile_links_taps} cliques no link da bio no período (${String(conv).replace(".", ",")}% de quem foi alcançado).` });
  }
  return out;
}

export function registerSocialRoutes(app, repo, { social = defaultSocial, meta = defaultMeta, anthropic = null } = {}) {
  // Descoberta page/IG por saas (cache do processo; muda raro).
  const discovered = new Map();
  // O id do IG é gravado como `metaIgUser` pela descoberta do marketing
  // (routes.marketing.js) — `metaIgUserId` era o nome só desta tela e nunca
  // chegou a existir no banco. Ler os dois: com só o nome antigo, o webhook não
  // reconhecia o produto e o comentário do Instagram entrava órfão (saas vazio),
  // some da tela, que filtra por produto.
  const igIdOf = (p) => String(p?.metaIgUser || p?.metaIgUserId || "");
  async function idsFor(product) {
    let igUserId = igIdOf(product);
    let pageId = String(product.metaPageId || "");
    if (igUserId && pageId) return { igUserId, pageId };
    if (!discovered.has(product.id) && product.metaAdAccount) {
      try { discovered.set(product.id, await meta.discoverCreativeDefaults(product.metaAdAccount)); }
      catch { discovered.set(product.id, null); }
    }
    const d = discovered.get(product.id);
    return { igUserId: igUserId || String(d?.instagramUserId || ""), pageId: pageId || String(d?.pageId || "") };
  }

  async function productOr404(req, reply) {
    const saas = String(req.query?.saas || req.body?.saas || "");
    const product = saas ? await repo.get("products", saas) : null;
    if (!product) { reply.code(404).send({ error: "produto não encontrado (informe ?saas=)" }); return null; }
    return product;
  }

  // Novos seguidores recentes (~24h) pro aviso de social selling do Meu dia.
  // SÓ a contagem líquida: o Instagram/Meta NÃO expõe a lista nem o @ de quem
  // seguiu (limite da plataforma). Enxuto e liberado pra fila do SDR (today) —
  // ver ROUTE_SCREENS: /api/social/new-followers vem ANTES de /api/social.
  app.get("/api/social/new-followers/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    if (!social.configured()) return { configured: false, count: null, username: "" };
    const { igUserId } = await idsFor(product);
    if (!igUserId) return { configured: false, count: null, username: "" };
    // Janela de ~24h: o insight follower_count é diário; somamos os buckets de
    // ontem+hoje (o de hoje costuma vir parcial/atrasado, então a soma cobre bem).
    const range = { since: dayStr(Date.now() - 86400e3), until: dayStr(Date.now()) };
    let count = null, username = "";
    await Promise.all([
      social.igAccount(igUserId).then((a) => { username = a?.username || ""; }).catch(() => {}),
      social.igDailySeries(igUserId, "follower_count", range)
        .then((s) => { if (Array.isArray(s)) count = s.reduce((acc, v) => acc + (Number(v.value) || 0), 0); })
        .catch(() => {}),
    ]);
    return { configured: true, count, username };
  });

  // ── Resumo da tela: perfil + insights + últimos posts + página ────────────
  app.get("/api/social/summary", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return;
    if (!social.configured()) return { configured: false, missing: "META_ACCESS_TOKEN" };
    const { igUserId, pageId } = await idsFor(product);
    // Dores do produto (product.painMap = { código: rótulo }) — alimentam o
    // seletor de dor do "criar post". Rótulos únicos, sem os códigos vazios.
    const pains = [...new Set(Object.values(product.painMap || {}).filter((v) => v && String(v).trim()))].map((label) => ({ label }));
    const days = ALLOWED_DAYS.has(Number(req.query?.days)) ? Number(req.query.days) : 30;
    const out = {
      configured: true, days, igUserId, pageId, aiConfigured: !!anthropic?.configured?.(), pains,
      account: null, insights: null, reachBreakdown: null,
      followerSeries: null, reachSeries: null, followerGrowth: null,
      engagement: null, formats: [], insightsText: [], media: [], page: null, errors: {},
    };
    if (!igUserId && !pageId) {
      out.errors.setup = "sem Instagram/página: configure metaIgUser/metaPageId no produto ou rode um anúncio na conta pra descoberta automática";
      return out;
    }
    const range = { since: dayStr(Date.now() - (days - 1) * 86400e3), until: dayStr(Date.now()) };
    // Cada bloco falha sozinho (permissão faltando não derruba a tela inteira).
    if (igUserId) {
      await Promise.all([
        social.igAccount(igUserId).then((a) => { out.account = a; }).catch((e) => { out.errors.account = e.message; }),
        social.igMedia(igUserId, { limit: 12 }).then((m) => { out.media = m; }).catch((e) => { out.errors.media = e.message; }),
        social.igInsights(igUserId, range).then((i) => { out.insights = i; }).catch((e) => { out.errors.insights = e.message; }),
        social.igReachBreakdown(igUserId, range).then((r) => { out.reachBreakdown = r; }).catch(() => {}),
        social.igDailySeries(igUserId, "follower_count", range).then((s) => { out.followerSeries = s; }).catch(() => {}),
        social.igDailySeries(igUserId, "reach", range).then((s) => { out.reachSeries = s; }).catch(() => {}),
      ]);
      if (out.followerSeries) out.followerGrowth = out.followerSeries.reduce((s, v) => s + v.value, 0);

      // Engajamento médio dos posts (derivado; agora com alcance/salvos por post).
      const posts = out.media || [];
      if (posts.length) {
        const n = posts.length;
        const sum = (fn) => posts.reduce((s, m) => s + (fn(m) || 0), 0);
        const followers = Number(out.account?.followers_count) || 0;
        const withReach = posts.filter((m) => m.reach > 0);
        out.engagement = {
          posts: n,
          avgLikes: Math.round(sum((m) => m.likes) / n),
          avgComments: Math.round((sum((m) => m.comments) / n) * 10) / 10,
          avgSaves: Math.round((sum((m) => m.saved) / n) * 10) / 10,
          avgShares: Math.round((sum((m) => m.shares) / n) * 10) / 10,
          avgReach: withReach.length ? Math.round(withReach.reduce((s, m) => s + m.reach, 0) / withReach.length) : null,
          // taxa = interações médias por post / seguidores (padrão de mercado)
          rate: followers ? Math.round(((sum((m) => m.likes) + sum((m) => m.comments)) / n / followers) * 1000) / 10 : null,
          top: [...posts].sort((a, b) => ((b.totalInteractions || b.likes + b.comments)) - ((a.totalInteractions || a.likes + a.comments)))[0] || null,
        };
        out.formats = byFormat(posts);
      }
      out.insightsText = growthInsights({ reachBreakdown: out.reachBreakdown, formats: out.formats, engagement: out.engagement, followerGrowth: out.followerGrowth, insights: out.insights });
    }
    if (pageId) {
      await social.pageInfo(pageId).then((p) => { out.page = p; }).catch((e) => { out.errors.page = e.message; });
    }
    return out;
  });

  // ── Audiência: demografia + melhor horário (snapshot, sem intervalo) ──────
  // Separado do summary porque são chamadas caras e não dependem do período;
  // o cliente carrega em paralelo pra não travar o painel principal.
  app.get("/api/social/audience", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return;
    if (!social.configured()) return { configured: false };
    const { igUserId } = await idsFor(product);
    if (!igUserId) return { configured: true, demographics: null, onlineFollowers: null, errors: { setup: "sem Instagram configurado" } };
    const out = { configured: true, demographics: null, onlineFollowers: null, bestHours: null, errors: {} };
    await Promise.all([
      social.igDemographics(igUserId).then((d) => { out.demographics = d; }).catch((e) => { out.errors.demographics = e.message; }),
      social.igOnlineFollowers(igUserId).then((h) => { out.onlineFollowers = h; }).catch((e) => { out.errors.online = e.message; }),
    ]);
    // Melhor janela: as 3 horas de pico dos seguidores online.
    if (out.onlineFollowers) {
      out.bestHours = out.onlineFollowers
        .map((v, h) => ({ h, v }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 3)
        .map((x) => x.h)
        .sort((a, b) => a - b);
    }
    return out;
  });

  // ── Upload de mídia (multipart) → asset com URL pública ──────────────────
  app.post("/api/social/assets", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "envie o arquivo (multipart, campo file)" });
    const saas = String(data.fields?.saas?.value || "");
    const mime = data.mimetype || "application/octet-stream";
    const buffer = await data.toBuffer();
    const isVideo = mime.startsWith("video/");
    if (!isVideo && !mime.startsWith("image/")) return reply.code(400).send({ error: `tipo não suportado: ${mime}` });
    if (buffer.length > (isVideo ? VID_MAX : IMG_MAX)) {
      return reply.code(413).send({ error: `arquivo grande demais (máx ${isVideo ? "80MB de vídeo" : "15MB de imagem"})` });
    }
    const asset = await repo.create("social_assets", {
      saas, mime, name: data.filename || "midia", size: buffer.length,
      data: buffer.toString("base64"), createdAt: new Date().toISOString(),
    });
    return { id: asset.id, url: `${publicBase(req)}/public/social/${asset.id}`, mime, size: buffer.length };
  });

  // Serve a mídia pra Meta baixar (rota PÚBLICA — está em OPEN_PREFIXES).
  app.get("/public/social/:id", async (req, reply) => {
    const asset = await repo.get("social_assets", req.params.id);
    if (!asset) return reply.code(404).send({ error: "não encontrado" });
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.type(asset.mime || "application/octet-stream");
    return reply.send(Buffer.from(asset.data || "", "base64"));
  });

  // ── Publicar ──────────────────────────────────────────────────────────────
  // body: { saas, format: feed|story|reel, kind: image|carousel|video,
  //         assetIds: [], caption, networks: ["instagram","facebook"] }
  app.post("/api/social/publish", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return;
    if (!social.configured()) return reply.code(400).send({ error: "Meta não configurada — defina META_ACCESS_TOKEN" });
    const { format = "feed", kind = "image", assetIds = [], caption = "", networks = ["instagram"] } = req.body || {};
    if (!["feed", "story", "reel"].includes(format)) return reply.code(400).send({ error: `formato inválido: ${format}` });
    if (!["image", "carousel", "video", "sequence"].includes(kind)) return reply.code(400).send({ error: `tipo inválido: ${kind}` });
    if (kind === "sequence" && format !== "story") return reply.code(400).send({ error: "sequência só existe como story" });
    if (!assetIds.length) return reply.code(400).send({ error: "sem mídia (assetIds vazio)" });

    const base = publicBase(req);
    const items = [];
    for (const id of assetIds) {
      const a = await repo.get("social_assets", id);
      if (!a) return reply.code(400).send({ error: `asset não encontrado: ${id}` });
      items.push({ url: `${base}/public/social/${a.id}`, mime: a.mime });
    }

    const { igUserId, pageId } = await idsFor(product);
    const results = {};
    if (networks.includes("instagram")) {
      if (!igUserId) results.instagram = { ok: false, error: "conta do Instagram não configurada (metaIgUser)" };
      else {
        try { results.instagram = { ok: true, ...(await social.publishInstagram(igUserId, { format, kind, items, caption })) }; }
        catch (e) { results.instagram = { ok: false, error: e.message }; }
      }
    }
    if (networks.includes("facebook")) {
      if (!pageId) results.facebook = { ok: false, error: "página do Facebook não configurada (metaPageId)" };
      else {
        try { results.facebook = { ok: true, ...(await social.publishFacebook(pageId, { format, kind, items, caption })) }; }
        catch (e) { results.facebook = { ok: false, error: e.message }; }
      }
    }

    const post = await repo.create("social_posts", {
      saas: product.id, at: new Date().toISOString(), format, kind, caption,
      networks, assetIds, results,
      author: req.authUser?.id || "",
    });
    // Resultado parcial (uma rede falhou) ainda é 200: o cliente lê `results`
    // por rede e mostra o erro do lado que falhou.
    const ok = Object.values(results).some((r) => r.ok);
    return { ok, postId: post.id, results };
  });

  // ── Copy do post por IA ─────────────────────────────────────────────────
  // body: { saas, dor, suggestion, formatLabel, templateName, fields: [{key,label,example}] }
  // Devolve { fields: {key:value}, caption } pro editor pré-preencher. Nada é
  // gravado — o usuário revisa antes de publicar.
  app.post("/api/social/ai-copy", async (req, reply) => {
    if (!anthropic?.configured?.()) return reply.code(400).send({ error: "IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor" });
    const { dor = "", suggestion = "", formatLabel = "", templateName = "", fields = [] } = req.body || {};
    if (!Array.isArray(fields) || fields.length === 0) return reply.code(400).send({ error: "sem campos pra preencher" });
    try {
      const r = await anthropic.suggestSocialCopy({ dor, suggestion, formatLabel, templateName, fields });
      return { fields: r.fields, caption: r.caption };
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
  });

  // ── Comentários (IG + página do Facebook) ────────────────────────────────
  // O webhook faz o comentário novo aparecer NA HORA; a varredura (syncComments)
  // reconcilia o estado real — respostas dadas pelo app do Instagram, ocultos,
  // e o que chegou enquanto o webhook esteve fora. Ver social-comments.js.

  // @ da conta do IG por produto — é o que identifica "resposta nossa" num
  // comentário. Cacheado no processo: muda praticamente nunca.
  const usernames = new Map();
  async function igUsernameFor(product, igUserId) {
    if (!igUserId) return "";
    if (usernames.has(product.id)) return usernames.get(product.id);
    let u = "";
    try { u = (await social.igAccount(igUserId))?.username || ""; } catch { /* segue sem: só piora a detecção de resposta */ }
    usernames.set(product.id, u);
    return u;
  }

  // Mídias do IG a varrer: as recentes do perfil MAIS as usadas em anúncio.
  // "Dark post" de anúncio não está no /media do perfil, e é justamente nele
  // que cai a enxurrada de comentário de campanha (spam, dúvida, ataque). Sem
  // isso, comentário de anúncio nunca chegava na fila.
  async function igPostsForScan(product, igUserId, limit = 8) {
    const organic = await social.igMedia(igUserId, { limit }).catch(() => []);
    if (!product.metaAdAccount || typeof meta.adInstagramMedia !== "function") return organic;
    let adIds = [];
    try { adIds = await meta.adInstagramMedia(product.metaAdAccount, { limit: 25 }); }
    catch { return organic; } // sem permissão de ads: segue só com o orgânico
    const seen = new Set(organic.map((p) => String(p.id)));
    // Cada mídia custa uma chamada pra pegar legenda/permalink, então limita.
    const extra = await Promise.all(adIds.filter((id) => !seen.has(String(id))).slice(0, limit)
      .map((id) => social.igMediaInfo(id).catch(() => null)));
    return [...organic, ...extra.filter(Boolean)];
  }

  // Produto dono de um id da Meta (IG user id ou page id) — o webhook só manda
  // esse id, e é ele que diz de qual produto é o comentário. Passa pelo cache
  // de descoberta também: produto que nunca preencheu metaIgUser à mão ainda
  // assim é encontrado pelos anúncios que roda.
  async function productForMetaId(metaId) {
    const id = String(metaId || "");
    if (!id) return null;
    const products = await repo.list("products");
    const direct = products.find((p) => igIdOf(p) === id || String(p.metaPageId || "") === id);
    if (direct) return direct;
    for (const p of products) {
      const d = discovered.get(p.id);
      if (d && (String(d.instagramUserId || "") === id || String(d.pageId || "") === id)) return p;
    }
    return null;
  }

  // Webhook da Meta pros objetos `instagram` (campo comments) e `page` (campo
  // feed). Rota ABERTA (sob /api/webhooks/, ver OPEN_PREFIXES no index.js): a
  // Meta chama sem key. O verify token reaproveita o do WhatsApp quando não há
  // um próprio — é o mesmo app da Meta, e um env a menos pra configurar.
  const verifyToken = () => process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "";

  app.get("/api/webhooks/social", async (req, reply) => {
    const q = req.query || {};
    const token = verifyToken();
    if (q["hub.mode"] === "subscribe" && token && q["hub.verify_token"] === token) {
      return reply.type("text/plain").send(String(q["hub.challenge"] ?? ""));
    }
    return reply.code(403).send("forbidden");
  });

  app.post("/api/webhooks/social", async (req, reply) => {
    try {
      const object = String(req.body?.object || "");
      for (const e of req.body?.entry || []) {
        const product = await productForMetaId(e.id);
        const saas = product?.id || "";
        for (const ch of e.changes || []) {
          const v = ch.value || {};
          const field = ch.field || "";

          // Instagram: comentário (e resposta a comentário) na mídia da conta.
          // A Meta NÃO entrega os comentários da própria conta aqui, então tudo
          // que chega por esta via é de outra pessoa.
          if (object === "instagram" && (field === "comments" || field === "live_comments")) {
            const mediaId = String(v.media?.id || "");
            // O webhook manda só o id do post; sem legenda/permalink o card
            // ficaria órfão até a próxima varredura, então busca na hora.
            let post = null;
            if (mediaId) { try { post = await social.igMediaInfo(mediaId); } catch { /* fail-soft */ } }
            await upsertComment(repo, {
              id: v.id, saas, network: "instagram",
              postId: mediaId,
              postTitle: post ? postTitleOf(post.caption, "Publicação sem legenda") : "",
              permalink: post?.permalink || "",
              author: v.from?.username || "",
              authorId: String(v.from?.id || ""),
              text: v.text || "",
              at: new Date().toISOString(),
              parentId: String(v.parent_id || ""),
              ours: false, source: "webhook",
            });
          }

          // Página do Facebook: o campo `feed` cobre TUDO que acontece no mural
          // (post, curtida, comentário), então filtramos item=comment. `verb`
          // separa criação de edição/remoção.
          if (object === "page" && field === "feed" && String(v.item || "") === "comment") {
            const verb = String(v.verb || "add");
            const commentId = String(v.comment_id || "");
            if (!commentId) continue;
            if (verb === "remove") { await repo.remove("social_comments", commentId).catch(() => {}); continue; }
            const pageId = String(e.id || "");
            // Comentário DA PRÓPRIA página (nossa resposta pelo app do Facebook)
            // entra marcado como nosso — é o que tira o comentário-pai da fila.
            const ours = String(v.from?.id || "") === pageId;
            await upsertComment(repo, {
              id: commentId, saas, network: "facebook",
              postId: String(v.post_id || ""),
              author: v.from?.name || "",
              authorId: String(v.from?.id || ""),
              text: v.message || "",
              at: v.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : new Date().toISOString(),
              // parent_id do FB vem igual ao post_id quando é comentário raiz.
              parentId: v.parent_id && String(v.parent_id) !== String(v.post_id) ? String(v.parent_id) : "",
              ours, source: "webhook",
            });
          }
        }
      }
    } catch (err) { req.log?.warn?.({ err: err.message }, "social webhook falhou"); }
    return reply.code(200).send({ ok: true }); // sempre 200: erro não faz a Meta re-tentar em loop
  });

  // Fila de comentários. `status`: pending (padrão) | answered | all.
  // A varredura roda junto, com throttle de 1 min (`?sync=1` força).
  app.get("/api/social/comments", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return;
    const status = ["pending", "answered", "all"].includes(req.query?.status) ? req.query.status : "pending";
    const out = { configured: social.configured(), status, comments: [], insights: null, errors: {} };
    if (social.configured()) {
      const { igUserId, pageId } = await idsFor(product);
      if (!igUserId && !pageId) out.errors.setup = "sem Instagram/página configurados no produto";
      else {
        try {
          const [posts, igUsername] = await Promise.all([
            igUserId ? igPostsForScan(product, igUserId) : [],
            igUsernameFor(product, igUserId),
          ]);
          const r = await syncComments(repo, social, {
            saas: product.id, igUserId, pageId, igUsername, posts,
            force: String(req.query?.sync || "") === "1",
          });
          Object.assign(out.errors, r.errors || {});
        } catch (e) { out.errors.sync = e.message; }
      }
    }
    // A lista sai do banco mesmo com a varredura falhando: o que o webhook já
    // trouxe continua na tela (a Meta pode estar recusando a leitura e ainda
    // assim entregando os comentários novos).
    const [comments, insights] = await Promise.all([
      listComments(repo, { saas: product.id, status }),
      commentInsights(repo, { saas: product.id }),
    ]);
    out.comments = comments;
    out.insights = insights;
    return out;
  });

  // Contexto de UM comentário pra tela abrir a conversa: ele, a nossa resposta
  // e os vizinhos do mesmo post.
  async function commentOr404(req, reply) {
    const c = await repo.get("social_comments", req.params.id);
    if (!c) { reply.code(404).send({ error: "comentário não encontrado" }); return null; }
    return c;
  }

  // Responder. Publica na Meta e grava a resposta como um comentário NOSSO
  // filho do original — é o que tira o item da fila, no mesmo formato que a
  // varredura traria depois.
  app.post("/api/social/comments/:id/reply", async (req, reply) => {
    if (!social.configured()) return reply.code(400).send({ error: "Meta não configurada — defina META_ACCESS_TOKEN" });
    const c = await commentOr404(req, reply);
    if (!c) return;
    const text = String(req.body?.text || "").trim();
    if (!text) return reply.code(400).send({ error: "resposta vazia" });
    const product = c.saas ? await repo.get("products", c.saas) : null;
    if (!product) return reply.code(400).send({ error: "comentário sem produto — reabra a tela pra sincronizar" });
    const { igUserId, pageId } = await idsFor(product);
    const author = req.authUser?.id || "cockpit";
    const now = new Date().toISOString();
    try {
      let replyId = "";
      if (c.network === "facebook") {
        if (!pageId) return reply.code(400).send({ error: "página do Facebook não configurada (metaPageId)" });
        replyId = await social.fbReplyComment(c.id, text, { pageId });
      } else {
        replyId = await social.igReplyComment(c.id, text);
      }
      // 422 (e não 5xx) fica pro erro da Meta: o proxy da hospedagem troca o
      // corpo de respostas 5xx pela página de erro dele e o motivo real some.
      await upsertComment(repo, {
        id: replyId || `local_${c.id}_${Date.now()}`,
        saas: c.saas, network: c.network, postId: c.postId, postTitle: c.postTitle, permalink: c.permalink,
        author: c.network === "facebook" ? "página" : (await igUsernameFor(product, igUserId)) || "nós",
        text, at: now, parentId: c.id, ours: true, replyBy: author, source: "cockpit",
      });
      await upsertComment(repo, { id: c.id, repliedAt: now, replyBy: author });
      invalidateSync(c.saas);
      return { ok: true, replyId };
    } catch (e) {
      return reply.code(422).send({ error: String(e.message || e).slice(0, 300) });
    }
  });

  // Ocultar/mostrar — o movimento certo pra spam e ataque: some pra todo mundo
  // menos pra quem escreveu, sem virar print de "apagaram meu comentário".
  app.post("/api/social/comments/:id/hide", async (req, reply) => {
    if (!social.configured()) return reply.code(400).send({ error: "Meta não configurada — defina META_ACCESS_TOKEN" });
    const c = await commentOr404(req, reply);
    if (!c) return;
    const hide = req.body?.hide !== false;
    const product = c.saas ? await repo.get("products", c.saas) : null;
    try {
      if (c.network === "facebook") {
        const { pageId } = product ? await idsFor(product) : {};
        if (!pageId) return reply.code(400).send({ error: "página do Facebook não configurada (metaPageId)" });
        await social.fbHideComment(c.id, hide, { pageId });
      } else {
        await social.igHideComment(c.id, hide);
      }
      await upsertComment(repo, { id: c.id, hidden: hide });
      invalidateSync(c.saas);
      return { ok: true, hidden: hide };
    } catch (e) {
      return reply.code(422).send({ error: String(e.message || e).slice(0, 300) });
    }
  });

  // Resolver sem responder (emoji, elogio, coisa já tratada no direct). Só
  // muda o estado AQUI — nada é publicado nem apagado na Meta.
  app.post("/api/social/comments/:id/done", async (req, reply) => {
    const c = await commentOr404(req, reply);
    if (!c) return;
    const done = req.body?.done !== false;
    await upsertComment(repo, { id: c.id, done });
    return { ok: true, done };
  });

  // Histórico de publicações feitas pelo cockpit.
  app.get("/api/social/posts", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return;
    const all = await repo.list("social_posts");
    return all.filter((p) => p.saas === product.id)
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .slice(0, 30);
  });
}
