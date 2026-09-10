// Redação do blog SEO (tela Blog, grupo Marketing): pautas mineradas do cockpit,
// rascunhos por IA, revisão humana, agenda e publicação. Tudo autenticado sob
// /api/blog/:saas (screens.js mapeia o prefixo pra tela `blog`). A máquina de
// estados e as chamadas de IA vivem em blog-engine.js; aqui só HTTP: validação
// de corpo, gating de admin, códigos de resposta (nunca 5xx: o proxy do
// EasyPanel engole; ver http-status.js) e a edição direta de campos.
//
// As páginas PÚBLICAS (/public/blog/*) ficam em routes.blog-public.js.

import { isAdmin } from "./routes.flashcards.js";
import { NOT_CONFIGURED, UPSTREAM_FAILED } from "./http-status.js";
import { loadBlogCfg, saveBlogCfg, mergeBlogRules } from "./blog-config.js";
import { lintPost, lintOk } from "./blog-lint.js";
import { BLOG_STATUSES, isValidSlug, withDerived, pushHistory } from "./blog-posts.js";

const INTENTS = new Set(["informacional", "comercial", "comparativo", "guia"]);
const LIST_FIELDS = [
  "saas", "status", "title", "slug", "slugLocked", "description", "keyword", "intent", "category", "painCode",
  "tags", "priority", "lint", "wordCount", "readingMin", "edited", "draftingAt", "author", "ai",
  "createdAt", "updatedAt", "updatedBy", "scheduledAt", "publishedAt", "unpublishedAt",
];

// Chave mestre (MCP/integração) não tem authUser e vale como admin, igual ao
// PUT dos flashcards.
const adminReq = (req) => !req.authUser || isAdmin(req.authUser);
const byOf = (req) => req.authUser?.id || req.authUser?.email || "api";
const defaultPublicBase = () => process.env.COCKPIT_PUBLIC_URL || "http://localhost:8787";

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const strList = (v, max = 30) => (Array.isArray(v) ? v.map((x) => clean(x, 120)).filter(Boolean).slice(0, max) : null);

// Erros do motor (BlogEngineError) carregam status/lint; qualquer outra coisa
// (IA fora, provedor recusou) sai 424 com o motivo.
function sendErr(reply, req, err, fallback = UPSTREAM_FAILED) {
  const status = Number(err?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const body = { error: String(err.message || err).slice(0, 300) };
    if (err.lint) body.lint = err.lint;
    if (err.code) body.code = err.code;
    return reply.code(status).send(body);
  }
  req.log?.warn?.({ err: err?.message || String(err) }, "blog: operação falhou");
  return reply.code(fallback).send({ error: String(err?.message || err).slice(0, 300) });
}

export function registerBlogRoutes(app, repo, { anthropic, engine, publicBase = defaultPublicBase, env = process.env } = {}) {
  const P = "/api/blog/:saas";

  const product = async (req, reply) => {
    const p = await repo.get("products", req.params.saas);
    if (!p) { reply.code(404).send({ error: "Produto não encontrado" }); return null; }
    return p;
  };
  const post = async (req, reply) => {
    const doc = await repo.get("blog_posts", req.params.id);
    if (!doc || doc.saas !== req.params.saas) { reply.code(404).send({ error: "Post não encontrado" }); return null; }
    return doc;
  };
  const aiReady = (reply) => {
    if (!anthropic?.configured?.()) { reply.code(NOT_CONFIGURED).send({ error: "IA não configurada (OPENROUTER_API_KEY ou ANTHROPIC_API_KEY)" }); return false; }
    if (engine?.busy?.()) { reply.code(409).send({ error: "O motor do blog já está rodando, tenta em instantes" }); return false; }
    return true;
  };
  // Nomes conhecidos (leads e clientes do produto) que o lint proíbe no texto.
  async function knownNames(saas) {
    const names = [];
    for (const col of ["leads", "customers"]) {
      const rows = await repo.listWhere(col, { saas }, { fields: ["name"] }).catch(() => []);
      for (const r of rows) if (r?.name) names.push(String(r.name));
    }
    return names;
  }
  const engineCall = async (req, reply, fn) => {
    try { return await fn(); } catch (err) { sendErr(reply, req, err); return undefined; }
  };

  // ── leitura ────────────────────────────────────────────────────────────────
  app.get(P, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const saas = req.params.saas;
    const status = String(req.query?.status || "");
    const rows = await repo.listWhere("blog_posts", { saas }, { fields: LIST_FIELDS });
    const counts = Object.fromEntries(BLOG_STATUSES.map((s) => [s, 0]));
    for (const r of rows) if (counts[r.status] !== undefined) counts[r.status]++;
    const posts = rows
      .filter((r) => !status || r.status === status)
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    const cfg = await loadBlogCfg(repo, saas);
    let nextSlot = null;
    try { nextSlot = (await engine?.nextSlotFor?.(saas)) || null; } catch { nextSlot = null; }
    return { posts, counts, aiConfigured: !!anthropic?.configured?.(), rules: cfg.rules, state: cfg.state, nextSlot };
  });

  app.get(`${P}/posts/:id`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const doc = await post(req, reply);
    if (!doc) return;
    return doc;
  });

  app.get(`${P}/settings`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const cfg = await loadBlogCfg(repo, req.params.saas);
    return { rules: cfg.rules, state: cfg.state, log: cfg.log };
  });

  app.patch(`${P}/settings`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    if (!adminReq(req)) return reply.code(403).send({ error: "Só admin edita as regras do blog" });
    const patch = req.body?.rules;
    if (!patch || typeof patch !== "object") return reply.code(400).send({ error: "Corpo esperado: { rules }" });
    const cfg = await loadBlogCfg(repo, req.params.saas);
    cfg.rules = mergeBlogRules({ ...cfg.rules, ...patch });
    await saveBlogCfg(repo, req.params.saas, cfg);
    return { rules: cfg.rules, state: cfg.state };
  });

  app.get(`${P}/digest`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    return engineCall(req, reply, () => engine.getDigest(req.params.saas, { refresh: String(req.query?.refresh || "") === "1" }));
  });

  // ── motor ──────────────────────────────────────────────────────────────────
  app.post(`${P}/pautas`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    if (!aiReady(reply)) return;
    const n = Number(req.body?.n);
    return engineCall(req, reply, () => engine.minePautas(req.params.saas, {
      n: Number.isInteger(n) && n > 0 ? Math.min(n, 12) : undefined,
      refresh: !!req.body?.refresh,
      by: byOf(req),
    }));
  });

  app.post(`${P}/tick`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    if (engine?.busy?.()) return reply.code(409).send({ error: "O motor do blog já está rodando, tenta em instantes" });
    return engineCall(req, reply, async () => {
      const out = await engine.tick({ saas: req.params.saas, force: true });
      return Array.isArray(out) ? (out[0] || { saas: req.params.saas }) : out;
    });
  });

  // ── pautas e edição ────────────────────────────────────────────────────────
  app.post(`${P}/posts`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const title = clean(req.body?.title, 120);
    if (!title) return reply.code(400).send({ error: "Título é obrigatório" });
    const created = await engineCall(req, reply, () => engine.createPauta(req.params.saas, {
      title,
      keyword: clean(req.body?.keyword, 80),
      category: clean(req.body?.category, 40),
      angle: clean(req.body?.angle, 400),
      outline: strList(req.body?.outline, 12) || [],
      by: byOf(req),
    }));
    if (created === undefined) return;
    return reply.code(201).send(created);
  });

  app.patch(`${P}/posts/:id`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const doc = await post(req, reply);
    if (!doc) return;
    const b = req.body || {};
    if (doc.status === "publicado" && !adminReq(req)) return reply.code(403).send({ error: "Post publicado: só admin edita" });

    const patch = {};
    if (b.title !== undefined) patch.title = clean(b.title, 160);
    if (b.description !== undefined) patch.description = clean(b.description, 400);
    if (b.keyword !== undefined) patch.keyword = clean(b.keyword, 80);
    if (b.category !== undefined) patch.category = clean(b.category, 40);
    if (b.angle !== undefined) patch.angle = clean(b.angle, 600);
    if (b.body !== undefined) patch.body = String(b.body == null ? "" : b.body).slice(0, 60_000);
    if (b.intent !== undefined) {
      if (!INTENTS.has(String(b.intent))) return reply.code(400).send({ error: "intent inválido" });
      patch.intent = String(b.intent);
    }
    if (b.tags !== undefined) {
      const tags = strList(b.tags, 12);
      if (!tags) return reply.code(400).send({ error: "tags precisa ser uma lista" });
      patch.tags = tags;
    }
    if (b.outline !== undefined) {
      const outline = strList(b.outline, 12);
      if (!outline) return reply.code(400).send({ error: "outline precisa ser uma lista" });
      patch.outline = outline;
    }
    if (b.faq !== undefined) {
      if (!Array.isArray(b.faq) || b.faq.some((f) => !f || typeof f !== "object")) return reply.code(400).send({ error: "faq precisa ser uma lista de { q, a }" });
      patch.faq = b.faq.map((f) => ({ q: clean(f.q, 300), a: clean(f.a, 2000) })).filter((f) => f.q || f.a).slice(0, 10);
    }
    if (b.priority !== undefined) {
      const n = Math.round(Number(b.priority));
      if (!Number.isInteger(n) || n < 1 || n > 5) return reply.code(400).send({ error: "priority vai de 1 a 5" });
      patch.priority = n;
    }
    if (b.slug !== undefined && b.slug !== doc.slug) {
      if (doc.slugLocked) return reply.code(409).send({ error: "URL travada: o slug não muda depois de publicado" });
      const slug = clean(b.slug, 80);
      if (!isValidSlug(slug)) return reply.code(400).send({ error: "slug inválido (só letras minúsculas, números e hífen)" });
      const same = await repo.listWhere("blog_posts", { saas: doc.saas, slug }, { fields: [] });
      if (same.some((r) => r.id !== doc.id)) return reply.code(409).send({ error: "Já existe um post com esse slug" });
      patch.slug = slug;
    }
    if (b.scheduledAt !== undefined) {
      if (doc.status !== "agendado") return reply.code(409).send({ error: "scheduledAt só muda em post agendado" });
      const t = new Date(b.scheduledAt);
      if (!Number.isFinite(t.getTime()) || t.getTime() <= Date.now()) return reply.code(400).send({ error: "scheduledAt precisa ser uma data futura" });
      patch.scheduledAt = t.toISOString();
    }

    const cfg = await loadBlogCfg(repo, doc.saas);
    const merged = withDerived({ ...doc, ...patch });
    merged.lint = lintPost(merged, { names: await knownNames(doc.saas), ctaUrl: cfg.rules.ctaUrl });
    if (doc.status === "publicado" && !lintOk(merged.lint)) {
      return reply.code(422).send({ error: "Post publicado não pode ficar com erro de lint", lint: merged.lint });
    }
    const now = new Date().toISOString();
    const by = byOf(req);
    const saved = await repo.update("blog_posts", doc.id, {
      ...patch,
      wordCount: merged.wordCount,
      readingMin: merged.readingMin,
      lint: merged.lint,
      edited: true,
      updatedAt: now,
      updatedBy: by,
      history: pushHistory(doc, { at: now, by, action: "edit" }),
    });
    return saved;
  });

  app.delete(`${P}/posts/:id`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const doc = await post(req, reply);
    if (!doc) return;
    if (doc.status !== "pauta" && doc.status !== "arquivado") return reply.code(409).send({ error: "Só pauta ou arquivado pode ser apagado" });
    await repo.remove("blog_posts", doc.id);
    return { ok: true };
  });

  // ── IA sobre um post ───────────────────────────────────────────────────────
  app.post(`${P}/posts/:id/draft`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const doc = await post(req, reply);
    if (!doc) return;
    if (!aiReady(reply)) return;
    return engineCall(req, reply, () => engine.draftPost(doc.id, { by: byOf(req), force: String(req.query?.force || "") === "1" }));
  });

  app.post(`${P}/posts/:id/revise`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const doc = await post(req, reply);
    if (!doc) return;
    const instruction = clean(req.body?.instruction, 601);
    if (!instruction) return reply.code(400).send({ error: "instruction é obrigatória" });
    if (instruction.length > 600) return reply.code(400).send({ error: "instruction: no máximo 600 caracteres" });
    if (doc.status === "publicado" && !adminReq(req)) return reply.code(403).send({ error: "Post publicado: só admin reescreve" });
    if (!aiReady(reply)) return;
    return engineCall(req, reply, () => engine.revisePost(doc.id, { instruction, by: byOf(req) }));
  });

  // ── transições ─────────────────────────────────────────────────────────────
  const transition = (action, { admin = false, adminIfPublished = false, body } = {}) => async (req, reply) => {
    if (!(await product(req, reply))) return;
    const doc = await post(req, reply);
    if (!doc) return;
    if (admin && !adminReq(req)) return reply.code(403).send({ error: "Só admin pode fazer isso" });
    if (adminIfPublished && doc.status === "publicado" && !adminReq(req)) return reply.code(403).send({ error: "Post publicado: só admin" });
    const opts = { by: byOf(req), ...(body ? body(req) : {}) };
    return engineCall(req, reply, () => engine[action](doc.id, opts));
  };
  app.post(`${P}/posts/:id/approve`, transition("approvePost", { body: (req) => ({ scheduledAt: req.body?.scheduledAt ? String(req.body.scheduledAt) : undefined }) }));
  app.post(`${P}/posts/:id/unschedule`, transition("unschedulePost"));
  app.post(`${P}/posts/:id/publish`, transition("publishPost", { admin: true }));
  app.post(`${P}/posts/:id/unpublish`, transition("unpublishPost", { admin: true }));
  app.post(`${P}/posts/:id/archive`, transition("archivePost", { adminIfPublished: true }));
  app.post(`${P}/posts/:id/restore`, transition("restorePost"));

  // ── prévia pública assinada ────────────────────────────────────────────────
  app.get(`${P}/posts/:id/preview-url`, async (req, reply) => {
    if (!(await product(req, reply))) return;
    const doc = await post(req, reply);
    if (!doc) return;
    let mod;
    try { mod = await import("./routes.blog-public.js"); } catch (err) {
      req.log?.warn?.({ err: err?.message }, "blog: renderizador público indisponível");
      return reply.code(NOT_CONFIGURED).send({ error: "Prévia indisponível: renderizador público não carregou" });
    }
    return mod.previewUrlFor({ base: publicBase(req), id: doc.id, secret: mod.previewSecret(env), now: Date.now() });
  });
}
