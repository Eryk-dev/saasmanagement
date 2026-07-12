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

export function registerSocialRoutes(app, repo, { social = defaultSocial, meta = defaultMeta } = {}) {
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

  // ── Resumo da tela: perfil + insights + últimos posts + página ────────────
  app.get("/api/social/summary", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return;
    if (!social.configured()) return { configured: false, missing: "META_ACCESS_TOKEN" };
    const { igUserId, pageId } = await idsFor(product);
    const out = { configured: true, igUserId, pageId, account: null, insights: null, media: [], page: null, errors: {} };
    if (!igUserId && !pageId) {
      out.errors.setup = "sem Instagram/página: configure metaIgUserId/metaPageId no produto ou rode um anúncio na conta pra descoberta automática";
      return out;
    }
    // Cada bloco falha sozinho (permissão faltando não derruba a tela inteira).
    if (igUserId) {
      await Promise.all([
        social.igAccount(igUserId).then((a) => { out.account = a; }).catch((e) => { out.errors.account = e.message; }),
        social.igMedia(igUserId, { limit: 12 }).then((m) => { out.media = m; }).catch((e) => { out.errors.media = e.message; }),
        social.igInsights(igUserId, { since: dayStr(Date.now() - 29 * 86400e3), until: dayStr(Date.now()) })
          .then((i) => { out.insights = i; }).catch((e) => { out.errors.insights = e.message; }),
      ]);
    }
    if (pageId) {
      await social.pageInfo(pageId).then((p) => { out.page = p; }).catch((e) => { out.errors.page = e.message; });
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
    if (!["image", "carousel", "video"].includes(kind)) return reply.code(400).send({ error: `tipo inválido: ${kind}` });
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
