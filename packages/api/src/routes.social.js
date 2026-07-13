// Mídia social — métricas do perfil + publicação orgânica direto do cockpit.
//
// Config por SaaS: `product.metaIgUserId` / `product.metaPageId` (Ajustes).
// Sem eles, descobre dos anúncios que já rodam na conta (mesma página/IG dos
// criativos ativos — meta.discoverCreativeDefaults) e cacheia em memória.
//
// Mídia gerada no cockpit (PNG do editor de Estáticos, vídeo de upload) vira
// asset na collection `social_assets` (bytes em base64) servido SEM auth em
// GET /public/social/:id — a Meta baixa a mídia por essa URL pública na hora
// de criar o container. Cada publicação vira um registro em `social_posts`
// (histórico com resultado por rede).

import { social as defaultSocial } from "./social.js";
import { meta as defaultMeta } from "./meta.js";
import { publicBase } from "./routes.js";

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
  async function idsFor(product) {
    let igUserId = String(product.metaIgUserId || "");
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
      out.errors.setup = "sem Instagram/página: configure metaIgUserId/metaPageId no produto ou rode um anúncio na conta pra descoberta automática";
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
      if (!igUserId) results.instagram = { ok: false, error: "conta do Instagram não configurada (metaIgUserId)" };
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
