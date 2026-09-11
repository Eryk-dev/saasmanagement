// Motor da redação do blog: minera pautas do digest do cockpit, rascunha UM
// post por ciclo com a IA, passa o pente fino (blog-lint.js), agenda na
// cadência (terça/quinta 9h por padrão) e publica o que venceu. Roda a cada
// 15 min (startBlogEngine) e também sob demanda pelas rotas (routes.blog.js),
// que compartilham a MESMA instância (busy() evita duas rodadas ao mesmo tempo).
//
// Regras que sustentam o desenho:
// - custo de IA com teto: 1 rodada de pautas e N rascunhos por DIA (rules),
//   1 rascunho por ciclo, 1 revisão automática por rascunho, digest em cache 6h;
// - contadores vivem no doc app_config `blog_<saas>` (blog-config.js): restart
//   não duplica rodada; `draftingAt` no post é trava macia de 10 min pra um
//   processo que morreu no meio da IA não deixar a pauta presa pra sempre;
// - publicar nunca depende da IA: publishDue roda mesmo sem chave;
// - erro de lint (preço, travessão, "clonar", nome de cliente...) BLOQUEIA
//   aprovar/agendar/publicar; aviso só aparece na tela;
// - `publishedAt` é a data SEO: preservada ao despublicar e republicar; o slug
//   trava no primeiro publish e nunca mais muda.
//
// Datas em Brasília: UTC-3 fixo (sem horário de verão desde 2019), mesma
// convenção de business-hours.js e training-reminder.js.

import { loadBlogCfg, saveBlogCfg, logLine, BLOG_DEFAULT_RULES } from "./blog-config.js";
import { newPostId, isValidSlug, uniqueSlug, injectUtm, canTransition, withDerived, pushHistory, slugify } from "./blog-posts.js";
import { lintPost, lintOk } from "./blog-lint.js";
import { buildBlogDigest } from "./blog-digest.js";
import { buildKnowledgePack, knowledgeText, tokenSet, jaccard } from "./blog-knowledge.js";
import { BLOG_PROMPT_VERSION } from "./anthropic.js";
import { leveradsResults } from "./leverads-results.js";
import { LEVERADS_DECKS } from "./flashcard-decks.leverads.js";
import { POSITIONING_RULES } from "./company.leverads.js";

const BRT_MS = 3 * 3600 * 1000;
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"]; // índice = getUTCDay()
const DIGEST_TTL_MS = 6 * 3600 * 1000;
const MINE_COOLDOWN_H = 6;
const DRAFT_LOCK_MIN = 10;
const MAX_DAYS_AHEAD = 60;

// ── Erro tipado: a rota traduz status → HTTP e devolve `lint` quando houver ──
export class BlogEngineError extends Error {
  constructor(message, { status = 409, lint = null, code = "" } = {}) {
    super(message);
    this.name = "BlogEngineError";
    this.status = status;
    this.lint = lint;
    this.code = code;
  }
}

// ── Relógio de Brasília ──────────────────────────────────────────────────────
const brtClock = (date) => new Date(new Date(date).getTime() - BRT_MS);
export const brtDay = (date) => brtClock(date).toISOString().slice(0, 10);
export const brtWeekday = (date) => WEEKDAYS[brtClock(date).getUTCDay()];
export const slotIso = (day, hhmm = "09:00") => new Date(`${day}T${hhmm}:00-03:00`).toISOString();

// Semana ISO do dia de Brasília ("2026-W38"): é a régua do cap semanal.
export function isoWeekKey(date) {
  const d = brtClock(date);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const nextDay = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const hoursSince = (iso, now) => (iso ? (now.getTime() - new Date(iso).getTime()) / 3600000 : Infinity);
const minutesSince = (iso, now) => (iso ? (now.getTime() - new Date(iso).getTime()) / 60000 : Infinity);
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const str = (v) => (v == null ? "" : String(v));
const strList = (v) => (Array.isArray(v) ? v.map((x) => str(x).trim()).filter(Boolean) : []);
const faqList = (v) => (Array.isArray(v) ? v.filter((f) => f && f.q && f.a).map((f) => ({ q: str(f.q).trim(), a: str(f.a).trim() })) : []);
const clampPriority = (p) => { const n = Math.round(Number(p)); return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3; };
const errCount = (issues) => (issues || []).filter((i) => i.level === "erro").length;
const sumUsage = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (typeof v === "number") out[k] = (Number(out[k]) || 0) + v;
  return out;
};

// Próximos `n` horários de publicação a partir de `from`: só nos dias da
// cadência, na hora configurada (BRT), pulando o passado, os já ocupados
// (`taken`: scheduledAt/publishedAt de agendados e publicados) e as semanas
// ISO que já têm `cadenciaSemanal` posts. Anda no máximo 60 dias.
export function nextSlots(rules, from, n = 1, taken = []) {
  const r = { ...BLOG_DEFAULT_RULES, ...(rules || {}) };
  const days = new Set(Array.isArray(r.diasPublicacao) ? r.diasPublicacao : []);
  const hora = /^\d{2}:\d{2}$/.test(r.horaPublicacao || "") ? r.horaPublicacao : "09:00";
  const cap = Math.max(1, Number(r.cadenciaSemanal) || 1);
  const fromMs = new Date(from).getTime();
  const takenSet = new Set();
  const weekCount = new Map();
  for (const t of taken || []) {
    if (!t) continue;
    const ms = new Date(t).getTime();
    if (!Number.isFinite(ms)) continue;
    const iso = new Date(ms).toISOString();
    takenSet.add(iso);
    const wk = isoWeekKey(iso);
    weekCount.set(wk, (weekCount.get(wk) || 0) + 1);
  }
  const out = [];
  let day = brtDay(from);
  for (let i = 0; i < MAX_DAYS_AHEAD && out.length < n; i++, day = nextDay(day)) {
    if (!days.has(brtWeekday(slotIso(day, "12:00")))) continue;
    const iso = slotIso(day, hora);
    if (new Date(iso).getTime() <= fromMs || takenSet.has(iso)) continue;
    const wk = isoWeekKey(iso);
    if ((weekCount.get(wk) || 0) >= cap) continue;
    out.push(iso);
    takenSet.add(iso);
    weekCount.set(wk, (weekCount.get(wk) || 0) + 1);
  }
  return out;
}

const ZERO_REPORT = () => ({ published: 0, scheduled: 0, drafted: 0, mined: 0, errors: [] });

export function makeBlogEngine({ repo, anthropic, results = leveradsResults, decks = LEVERADS_DECKS, log = console, now = () => new Date() } = {}) {
  const digestCache = new Map(); // saas → { digest, at }
  let inFlight = 0;

  const aiConfigured = () => !!anthropic?.configured?.();
  const busy = () => inFlight > 0;
  async function withBusy(fn) {
    inFlight++;
    try { return await fn(); } finally { inFlight--; }
  }
  const requireAi = () => {
    if (!aiConfigured()) throw new BlogEngineError("IA não configurada (OPENROUTER_API_KEY ou ANTHROPIC_API_KEY)", { status: 424, code: "ia_nao_configurada" });
  };
  async function callAi(fn) {
    try { return await fn(); } catch (err) {
      if (err instanceof BlogEngineError) throw err;
      throw new BlogEngineError(`IA falhou: ${String(err?.message || err).slice(0, 280)}`, { status: 424, code: "ia_falhou" });
    }
  }

  // ── leitura ────────────────────────────────────────────────────────────────
  async function getProduct(saas) {
    const p = saas ? await repo.get("products", saas) : null;
    if (!p) throw new BlogEngineError("Produto não encontrado", { status: 404, code: "produto" });
    return p;
  }
  async function getPost(id) {
    const doc = id ? await repo.get("blog_posts", id) : null;
    if (!doc) throw new BlogEngineError("Post não encontrado", { status: 404, code: "post" });
    return doc;
  }
  const postsOf = (saas, fields) => repo.listWhere("blog_posts", { saas }, fields ? { fields } : {});
  async function loadCfg(saas) {
    await getProduct(saas);
    return loadBlogCfg(repo, saas);
  }
  const saveCfg = (saas, cfg) => saveBlogCfg(repo, saas, cfg, { silent: true });

  // Nomes de leads e clientes do produto: o lint recusa post que cite qualquer um.
  async function namesFor(saas) {
    const [leads, customers] = await Promise.all([repo.list("leads"), repo.list("customers")]);
    return [...leads, ...customers]
      .filter((r) => !r.saas || r.saas === saas)
      .map((r) => str(r.name).trim())
      .filter((n) => n.length >= 6 && /\s/.test(n));
  }

  async function getDigest(saas, { refresh = false } = {}) {
    const t = now();
    const hit = digestCache.get(saas);
    if (hit && !refresh && t.getTime() - hit.at < DIGEST_TTL_MS) return hit.digest;
    const digest = await buildBlogDigest({ repo, saas, now: t, results });
    digestCache.set(saas, { digest, at: t.getTime() });
    return digest;
  }

  async function takenSlots(saas) {
    const rows = await postsOf(saas, ["status", "scheduledAt", "publishedAt"]);
    return rows.flatMap((p) => (p.status === "agendado" ? [p.scheduledAt] : p.status === "publicado" ? [p.publishedAt] : [])).filter(Boolean);
  }
  async function slotsFor(saas, cfg, n = 1) {
    return nextSlots(cfg.rules, now(), n, await takenSlots(saas));
  }

  // Um save: campos derivados, updatedAt e histórico sempre juntos.
  async function save(doc, patch, { by = "cockpit", action, note = "" } = {}) {
    const at = now().toISOString();
    const merged = withDerived({ ...doc, ...patch, updatedAt: at });
    merged.history = pushHistory(doc, { at, by, action, note });
    return repo.update("blog_posts", doc.id, merged);
  }

  // ── pautas ─────────────────────────────────────────────────────────────────
  async function minePautasInner(saas, cfg, { n, refresh = false, by = "cockpit" } = {}) {
    requireAi();
    const product = await getProduct(saas);
    const rules = cfg.rules;
    const count = Math.min(12, Math.max(1, Number(n) || rules.pautasPorRodada || 6));
    const digest = await getDigest(saas, { refresh });
    const existing = (await postsOf(saas, ["status", "title", "keyword"])).filter((p) => p.status !== "arquivado");
    const existingList = [...new Set(existing.flatMap((p) => [p.title, p.keyword]).map((s) => str(s).trim()).filter(Boolean))];
    const r = await callAi(() => anthropic.blogPautas({ digest: digest.text, existing: existingList, categorias: rules.categorias, n: count, productName: product.name || "LeverAds" }));
    const kws = new Set(existing.map((p) => norm(p.keyword)).filter(Boolean));
    const titles = existing.map((p) => tokenSet(p.title));
    const at = now().toISOString();
    const created = [];
    let dropped = 0;
    for (const p of Array.isArray(r?.pautas) ? r.pautas : []) {
      const title = str(p?.title).trim();
      const keyword = str(p?.keyword).trim();
      if (!title || title.length > 70) { dropped++; continue; }
      if (keyword && kws.has(norm(keyword))) { dropped++; continue; }
      const ts = tokenSet(title);
      if (titles.some((t) => jaccard(t, ts) >= 0.6)) { dropped++; continue; }
      const category = rules.categorias.includes(p.category) ? p.category : rules.categorias[0];
      const doc = {
        id: newPostId(), saas, status: "pauta",
        title, keyword, intent: str(p.intent) || "informacional", category, painCode: str(p.painCode),
        angle: str(p.angle), outline: strList(p.outline).slice(0, 8), evidence: strList(p.evidence), faqSeeds: strList(p.faqSeeds),
        priority: clampPriority(p.priority),
        slug: "", slugLocked: false, description: "", body: "", faq: [], tags: [], sources: [], lint: [],
        wordCount: 0, readingMin: 1, edited: false, draftingAt: "",
        author: by, createdAt: at, updatedAt: at, scheduledAt: "", publishedAt: "",
        ai: { model: r.model || "", promptVersion: BLOG_PROMPT_VERSION, generatedAt: at, task: "pautas", usage: r.usage || {} },
        history: pushHistory(null, { at, by, action: "pauta" }),
      };
      created.push(await repo.create("blog_posts", doc));
      if (keyword) kws.add(norm(keyword));
      titles.push(ts);
    }
    cfg.state.lastMineAt = at;
    cfg.state.pautaRounds = (Number(cfg.state.pautaRounds) || 0) + 1;
    logLine(cfg, "pautas", `${created.length} criadas, ${dropped} descartadas`);
    return { created, dropped, usage: r.usage || {} };
  }

  async function createPautaInner(saas, { title, keyword = "", category = "", angle = "", outline = [], by = "cockpit" } = {}, cfg) {
    await getProduct(saas);
    const t = str(title).trim();
    if (!t) throw new BlogEngineError("Título obrigatório", { status: 409, code: "titulo" });
    const cats = cfg.rules.categorias;
    const at = now().toISOString();
    return repo.create("blog_posts", {
      id: newPostId(), saas, status: "pauta",
      title: t.slice(0, 120), keyword: str(keyword).trim().slice(0, 80), intent: "informacional",
      category: cats.includes(category) ? category : cats[0], painCode: "",
      angle: str(angle).slice(0, 400), outline: strList(outline).slice(0, 8), evidence: [], faqSeeds: [], priority: 3,
      slug: "", slugLocked: false, description: "", body: "", faq: [], tags: [], sources: [], lint: [],
      wordCount: 0, readingMin: 1, edited: true, draftingAt: "",
      author: by, createdAt: at, updatedAt: at, scheduledAt: "", publishedAt: "",
      ai: null, history: pushHistory(null, { at, by, action: "pauta", note: "manual" }),
    });
  }

  // ── rascunho ───────────────────────────────────────────────────────────────
  const sourcesOf = (list) => strList(list).map((ref) => ({ type: ref.startsWith("digest") ? "digest" : "flashcard", ref }));

  async function knowledgeFor(saas, doc, { full = true } = {}) {
    const product = await getProduct(saas);
    const tpl = full ? await repo.get("proposal_templates", `pt_${saas}`).catch(() => null) : null;
    const pains = tpl?.calc?.catalog?.pains || {};
    const digest = full ? await getDigest(saas) : null;
    const pack = buildKnowledgePack({ pauta: doc, digest, product, pains, results, decks: full ? decks : [] });
    return { product, knowledge: knowledgeText(pack) };
  }

  async function draftPostInner(id, cfg, { by = "cockpit", force = false } = {}) {
    requireAi();
    const doc = await getPost(id);
    const saas = doc.saas;
    const t = now();
    const ok = doc.status === "pauta" || (doc.status === "rascunho" && force && !doc.slugLocked);
    if (!ok) throw new BlogEngineError(doc.slugLocked ? "Post já publicado: a URL está travada" : `Só pauta vira rascunho (status atual: ${doc.status})`, { status: 409, code: "status" });
    if (minutesSince(doc.draftingAt, t) < DRAFT_LOCK_MIN) throw new BlogEngineError("Rascunho em andamento, aguarde", { status: 409, code: "em_andamento" });
    await repo.update("blog_posts", id, { draftingAt: t.toISOString() }, { silent: true });
    try {
      const { product, knowledge } = await knowledgeFor(saas, doc);
      const rules = cfg.rules;
      const r = await callAi(() => anthropic.blogDraft({ pauta: doc, knowledge, rules: POSITIONING_RULES, ctaUrl: rules.ctaUrl, productName: product.name || "LeverAds" }));
      const draft = r?.draft || {};
      const others = (await postsOf(saas, ["slug"])).filter((p) => p.id !== id).map((p) => p.slug).filter(Boolean);
      const slug = doc.slugLocked ? doc.slug : uniqueSlug(isValidSlug(draft.slug) ? draft.slug : slugify(str(draft.title) || doc.title), others);
      const names = await namesFor(saas);
      const build = (d) => withDerived({
        ...doc,
        title: str(d.title).trim() || doc.title,
        slug,
        description: str(d.description).trim(),
        body: injectUtm(str(d.body_md), rules.ctaUrl, slug),
        faq: faqList(d.faq),
        tags: strList(d.tags).slice(0, 8),
        sources: sourcesOf(d.sourcesUsed),
      });
      let candidate = build(draft);
      let issues = lintPost(candidate, { names, ctaUrl: rules.ctaUrl });
      let usage = r.usage || {};
      let revised = false;
      if (!lintOk(issues)) {
        const r2 = await callAi(() => anthropic.blogRevise({ post: candidate, instruction: "Corrija os problemas do lint sem mudar o assunto", lintIssues: issues.filter((i) => i.level === "erro"), knowledge }));
        const cand2 = build({ ...draft, ...(r2?.revised || {}) });
        const issues2 = lintPost(cand2, { names, ctaUrl: rules.ctaUrl });
        if (errCount(issues2) < errCount(issues)) { candidate = cand2; issues = issues2; }
        usage = sumUsage(usage, r2?.usage);
        revised = true;
      }
      const at = now().toISOString();
      const saved = await repo.update("blog_posts", id, {
        ...candidate,
        status: "rascunho", lint: issues, edited: false, draftingAt: "", scheduledAt: "", updatedAt: at,
        ai: { model: r.model || "", promptVersion: BLOG_PROMPT_VERSION, generatedAt: at, task: "draft", usage },
        history: pushHistory(doc, { at, by, action: "rascunho", note: revised ? "revisado pelo lint automático" : "" }),
      });
      cfg.state.lastDraftAt = at;
      cfg.state.rascunhos = (Number(cfg.state.rascunhos) || 0) + 1;
      logLine(cfg, "rascunho", `${saved.title} (${errCount(issues)} erro(s) de lint)`);
      return { post: saved, usage };
    } catch (err) {
      await repo.update("blog_posts", id, { draftingAt: "" }, { silent: true }).catch(() => {});
      throw err;
    }
  }

  async function revisePostInner(id, cfg, { instruction = "", by = "cockpit" } = {}) {
    requireAi();
    const inst = str(instruction).trim();
    if (!inst || inst.length > 600) throw new BlogEngineError("Instrução obrigatória (até 600 caracteres)", { status: 409, code: "instrucao" });
    const doc = await getPost(id);
    if (!["rascunho", "agendado", "publicado"].includes(doc.status)) throw new BlogEngineError(`Não dá pra revisar um post ${doc.status}`, { status: 409, code: "status" });
    const rules = cfg.rules;
    const { knowledge } = await knowledgeFor(doc.saas, doc, { full: false });
    const r = await callAi(() => anthropic.blogRevise({ post: doc, instruction: inst, lintIssues: (doc.lint || []).filter((i) => i.level === "erro"), knowledge }));
    const rev = r?.revised || {};
    const candidate = withDerived({
      ...doc,
      title: str(rev.title).trim() || doc.title,
      description: str(rev.description).trim() || doc.description,
      body: injectUtm(str(rev.body_md) || doc.body, rules.ctaUrl, doc.slug),
      faq: rev.faq ? faqList(rev.faq) : doc.faq,
      tags: rev.tags ? strList(rev.tags).slice(0, 8) : doc.tags,
    });
    const issues = lintPost(candidate, { names: await namesFor(doc.saas), ctaUrl: rules.ctaUrl });
    if (doc.status === "publicado" && !lintOk(issues)) throw new BlogEngineError("A revisão deixou erro de lint num post publicado: nada foi salvo", { status: 422, lint: issues, code: "lint" });
    const status = doc.status === "agendado" ? "rascunho" : doc.status;
    const at = now().toISOString();
    const saved = await repo.update("blog_posts", id, {
      ...candidate,
      status, scheduledAt: status === "rascunho" ? "" : doc.scheduledAt, lint: issues, edited: false, updatedAt: at,
      ai: { model: r.model || "", promptVersion: BLOG_PROMPT_VERSION, generatedAt: at, task: "revise", usage: r.usage || {} },
      history: pushHistory(doc, { at, by, action: "revisao", note: inst }),
    });
    logLine(cfg, "revisao", `${saved.title}: ${str(rev.changeNote).slice(0, 120) || inst.slice(0, 120)}`);
    return { post: saved, usage: r.usage || {} };
  }

  // ── agenda e publicação (sem IA) ───────────────────────────────────────────
  async function lintOf(doc, cfg) {
    return lintPost(doc, { names: await namesFor(doc.saas), ctaUrl: cfg.rules.ctaUrl });
  }

  async function approvePostInner(id, cfg, { scheduledAt, by = "cockpit" } = {}) {
    const doc = await getPost(id);
    if (doc.status !== "rascunho") throw new BlogEngineError(`Só rascunho vai pra agenda (status atual: ${doc.status})`, { status: 409, code: "status" });
    const issues = await lintOf(doc, cfg);
    if (!lintOk(issues)) throw new BlogEngineError("Lint com erro: corrija antes de aprovar", { status: 422, lint: issues, code: "lint" });
    let at;
    if (scheduledAt) {
      const ms = new Date(scheduledAt).getTime();
      if (!Number.isFinite(ms) || ms <= now().getTime()) throw new BlogEngineError("Data de publicação inválida ou no passado", { status: 409, code: "data" });
      at = new Date(ms).toISOString();
    } else {
      at = (await slotsFor(doc.saas, cfg, 1))[0];
      if (!at) throw new BlogEngineError("Sem horário livre na cadência nos próximos 60 dias", { status: 409, code: "sem_slot" });
    }
    logLine(cfg, "agendado", `${doc.title} → ${at}`);
    return save(doc, { status: "agendado", scheduledAt: at, lint: issues }, { by, action: "agendado", note: at });
  }

  async function publishPostInner(doc, cfg, { by = "cockpit" } = {}) {
    if (!["rascunho", "agendado"].includes(doc.status)) throw new BlogEngineError(`Não dá pra publicar um post ${doc.status}`, { status: 409, code: "status" });
    const issues = await lintOf(doc, cfg);
    if (!lintOk(issues)) throw new BlogEngineError("Lint com erro: corrija antes de publicar", { status: 422, lint: issues, code: "lint" });
    const others = (await postsOf(doc.saas, ["slug", "status"])).filter((p) => p.id !== doc.id && p.slug === doc.slug);
    if (others.length) throw new BlogEngineError("Já existe um post com este slug", { status: 409, code: "slug" });
    const at = now().toISOString();
    cfg.state.lastPublishAt = at;
    logLine(cfg, "publicado", doc.title);
    return save(doc, {
      status: "publicado", publishedAt: doc.publishedAt || at, slugLocked: true, scheduledAt: "",
      body: injectUtm(doc.body, cfg.rules.ctaUrl, doc.slug), lint: issues,
    }, { by, action: "publicado" });
  }

  async function publishDueFor(saas, cfg) {
    const nowIso = now().toISOString();
    const due = (await postsOf(saas, ["status", "scheduledAt"])).filter((p) => p.status === "agendado" && p.scheduledAt && p.scheduledAt <= nowIso);
    let published = 0;
    for (const row of due) {
      const doc = await repo.get("blog_posts", row.id);
      if (!doc || doc.status !== "agendado") continue;
      const issues = await lintOf(doc, cfg);
      if (!lintOk(issues)) {
        await save(doc, { status: "rascunho", scheduledAt: "", lint: issues }, { action: "rascunho", note: "lint reprovou na hora de publicar" });
        logLine(cfg, "lint", `${doc.title}: reprovou na hora de publicar, voltou pra rascunho`);
        continue;
      }
      await publishPostInner(doc, cfg, { by: "cockpit" });
      published++;
    }
    return { published };
  }

  async function autoScheduleFor(saas, cfg) {
    const t = now();
    const rows = await postsOf(saas, ["status", "priority", "createdAt", "draftingAt"]);
    const room = (Number(cfg.rules.bufferAgendados) || 0) - rows.filter((p) => p.status === "agendado").length;
    if (room <= 0) return 0;
    const cands = rows
      .filter((p) => p.status === "rascunho" && minutesSince(p.draftingAt, t) >= DRAFT_LOCK_MIN)
      .sort((a, b) => (clampPriority(a.priority) - clampPriority(b.priority)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const slots = nextSlots(cfg.rules, t, room, await takenSlots(saas));
    let scheduled = 0;
    for (const row of cands) {
      if (scheduled >= room || !slots.length) break;
      const doc = await repo.get("blog_posts", row.id);
      if (!doc || doc.status !== "rascunho") continue;
      const issues = await lintOf(doc, cfg);
      if (!lintOk(issues)) continue;
      const at = slots.shift();
      await save(doc, { status: "agendado", scheduledAt: at, lint: issues }, { action: "agendado", note: `automático · ${at}` });
      logLine(cfg, "agendado", `${doc.title} → ${at} (automático)`);
      scheduled++;
    }
    return scheduled;
  }

  // ── ciclo ──────────────────────────────────────────────────────────────────
  async function tickProduct(product, cfg, { force = false } = {}) {
    const saas = product.id;
    const t = now();
    const today = brtDay(t);
    const report = { saas, ...ZERO_REPORT() };
    const fail = (step, err) => {
      const msg = `${step}: ${str(err?.message || err)}`.slice(0, 200);
      log.warn?.({ saas, err: msg }, "blog: passo do ciclo falhou");
      cfg.state.lastError = msg;
      report.errors.push(msg);
    };
    if (cfg.state.day !== today) { cfg.state.day = today; cfg.state.pautaRounds = 0; cfg.state.rascunhos = 0; }
    cfg.state.lastError = "";

    try { report.published = (await publishDueFor(saas, cfg)).published; } catch (err) { fail("publicar", err); }
    if (cfg.rules.autoPublicar) {
      try { report.scheduled = await autoScheduleFor(saas, cfg); } catch (err) { fail("agendar", err); }
    }

    if (!aiConfigured()) {
      if (cfg.rules.autoPauta || cfg.rules.autoRascunho) cfg.state.lastError = "IA não configurada";
      cfg.state.lastTickAt = t.toISOString();
      await saveCfg(saas, cfg);
      return report;
    }

    const count = (rows, s) => rows.filter((p) => p.status === s).length;
    let rows = await postsOf(saas, ["status", "priority", "createdAt", "draftingAt"]);
    if (cfg.rules.autoPauta && count(rows, "pauta") < cfg.rules.minPautas
      && (Number(cfg.state.pautaRounds) || 0) < cfg.rules.maxRodadasPautaDia
      && (force || hoursSince(cfg.state.lastMineAt, t) >= MINE_COOLDOWN_H)) {
      try { report.mined = (await minePautasInner(saas, cfg, { n: cfg.rules.pautasPorRodada })).created.length; } catch (err) { fail("pautas", err); }
      rows = await postsOf(saas, ["status", "priority", "createdAt", "draftingAt"]);
    }

    if (cfg.rules.autoRascunho && count(rows, "rascunho") + count(rows, "agendado") < cfg.rules.minRascunhos
      && (Number(cfg.state.rascunhos) || 0) < cfg.rules.maxRascunhosDia) {
      const cand = rows
        .filter((p) => p.status === "pauta" && minutesSince(p.draftingAt, t) >= DRAFT_LOCK_MIN)
        .sort((a, b) => (clampPriority(a.priority) - clampPriority(b.priority)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0];
      if (cand) {
        try { await draftPostInner(cand.id, cfg, { by: "cockpit" }); report.drafted = 1; } catch (err) { fail("rascunho", err); }
      }
    }

    cfg.state.lastTickAt = t.toISOString();
    await saveCfg(saas, cfg);
    return report;
  }

  async function tick({ saas, force = false } = {}) {
    return withBusy(async () => {
      const reports = [];
      if (saas) {
        const product = await repo.get("products", saas);
        if (!product) throw new BlogEngineError("Produto não encontrado", { status: 404, code: "produto" });
        const cfg = await loadBlogCfg(repo, saas);
        if (!cfg._exists) return [{ saas, skipped: "sem configuração", ...ZERO_REPORT() }];
        if (!cfg.rules.enabled) return [{ saas, skipped: "desligado", ...ZERO_REPORT() }];
        return [await tickProduct(product, cfg, { force })];
      }
      for (const product of await repo.list("products")) {
        const cfg = await loadBlogCfg(repo, product.id);
        if (!cfg._exists) continue;
        if (!cfg.rules.enabled) { reports.push({ saas: product.id, skipped: "desligado", ...ZERO_REPORT() }); continue; }
        try { reports.push(await tickProduct(product, cfg, { force })); }
        catch (err) {
          log.warn?.({ saas: product.id, err: err?.message }, "blog: ciclo falhou");
          reports.push({ saas: product.id, ...ZERO_REPORT(), errors: [str(err?.message || err).slice(0, 200)] });
        }
      }
      return reports;
    });
  }

  // ── API pública (cada operação carrega e salva o cfg do produto) ───────────
  const withCfg = (saas, fn) => withBusy(async () => {
    const cfg = await loadCfg(saas);
    const out = await fn(cfg);
    await saveCfg(saas, cfg);
    return out;
  });
  const withPostCfg = (id, fn) => withBusy(async () => {
    const doc = await getPost(id);
    const cfg = await loadCfg(doc.saas);
    const out = await fn(doc, cfg);
    await saveCfg(doc.saas, cfg);
    return out;
  });

  const simple = (from, to, action, patchOf = () => ({})) => (id, { by = "cockpit" } = {}) => withPostCfg(id, async (doc, cfg) => {
    const froms = Array.isArray(from) ? from : [from];
    if (!froms.includes(doc.status) || !canTransition(doc.status, typeof to === "function" ? to(doc) : to)) {
      throw new BlogEngineError(`Não dá pra ${action} um post ${doc.status}`, { status: 409, code: "status" });
    }
    const target = typeof to === "function" ? to(doc) : to;
    logLine(cfg, action, doc.title);
    return save(doc, { status: target, ...patchOf(doc) }, { by, action });
  });

  return {
    tick,
    minePautas: (saas, opts = {}) => withCfg(saas, (cfg) => minePautasInner(saas, cfg, opts)),
    createPauta: (saas, opts = {}) => withCfg(saas, (cfg) => createPautaInner(saas, opts, cfg)),
    draftPost: (id, opts = {}) => withPostCfg(id, (doc, cfg) => draftPostInner(id, cfg, opts)),
    revisePost: (id, opts = {}) => withPostCfg(id, (doc, cfg) => revisePostInner(id, cfg, opts)),
    approvePost: (id, opts = {}) => withPostCfg(id, (doc, cfg) => approvePostInner(id, cfg, opts)),
    publishPost: (id, opts = {}) => withPostCfg(id, (doc, cfg) => publishPostInner(doc, cfg, opts)),
    unschedulePost: simple("agendado", "rascunho", "desagendar", () => ({ scheduledAt: "" })),
    unpublishPost: simple("publicado", "rascunho", "despublicar", () => ({ unpublishedAt: now().toISOString(), scheduledAt: "" })),
    archivePost: simple(["pauta", "rascunho", "agendado", "publicado"], "arquivado", "arquivar", () => ({ scheduledAt: "" })),
    restorePost: simple("arquivado", (doc) => (doc.body ? "rascunho" : "pauta"), "restaurar"),
    publishDue: (saas) => withCfg(saas, (cfg) => publishDueFor(saas, cfg)),
    nextSlots,
    nextSlotFor: async (saas) => (await slotsFor(saas, await loadCfg(saas), 1))[0] || null,
    getDigest,
    busy,
    aiConfigured,
  };
}

// Poller de produção: a cada 15 min, single-flight, mesmo padrão do
// startCallSummaries. Primeira rodada 1 min depois do boot.
export function startBlogEngine(repo, { engine, intervalMs = 15 * 60_000, log = console } = {}) {
  if (!engine) return null;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await engine.tick(); }
    catch (err) { log.warn?.({ err: err?.message }, "blog: motor falhou"); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 60_000).unref?.();
  const ai = engine.aiConfigured?.() ? "" : "; sem IA: só publica o que já está agendado";
  log.info?.(`blog: motor ligado (ciclo a cada ${Math.round(intervalMs / 60000)} min)${ai}`);
  return { stop: () => clearInterval(timer), run };
}
