// Análises do Elo App (workspace "elo") — B2C self-serve: aqui não tem SDR nem
// call, então a leitura de performance vem do PRODUTO: funil do checkout web
// (pedido → pago → conta ativada), assinaturas por canal (web/IAP), casais,
// missões e streaks. O cockpit lê AGREGADOS direto do Postgres do app (projeto
// Supabase do Elo) com a role read-only `cockpit_reader`, que só enxerga as
// funções do schema `analytics` — sem SELECT em tabela, sem PII.
//
// ELO_DB_URL: connection string da role no session pooler do projeto do Elo.
// Sem ela as rotas respondem { configured: false } e a tela mostra o passo de
// configuração — nada quebra.
//
// Beacon de landing pages (/public/lp/events): as páginas públicas do Elo
// (/lp, /checkout, /obrigado) mandam eventos anônimos por sessão de visita —
// "view" (carregou) e "cta" (clicou num botão de ação). Mesma postura do funil
// de forms: rate-limit por IP, UTM sanitizada, zero PII. O cruzamento com o
// dinheiro (pedidos/pagamentos por UTM) vem do banco do Elo.

import pg from "pg";
import { randomUUID } from "node:crypto";
import { makeRateLimiter } from "./forms.js";
import { clientIp, sanitizeUtm, normalizeMetaSource, referrerSource } from "./routes.forms.js";
import { UPSTREAM_FAILED } from "./http-status.js";

// Lazy pool — mesma postura do db.js: importar nunca conecta; a primeira rota
// que precisar conecta (e falha com mensagem clara se a URL estiver errada).
let _pool;
function getEloPool() {
  if (!_pool) {
    const url = new URL(process.env.ELO_DB_URL);
    const sslDisabled = url.searchParams.get("sslmode") === "disable";
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    _pool = new pg.Pool({
      connectionString: url.toString(),
      max: 3,
      ssl: sslDisabled ? false : { rejectUnauthorized: false },
    });
  }
  return _pool;
}

const configured = () => Boolean(process.env.ELO_DB_URL);

// Janela em dias vinda da query string, com teto — os agregados varrem as
// tabelas do app, então a janela não pode crescer sem limite.
const clampDays = (q) => Math.min(365, Math.max(7, Number(q) || 30));

// As funções são as ÚNICAS coisas que a cockpit_reader alcança no banco do Elo.
const ELO_FNS = new Set(["elo_overview", "elo_lp_conversions"]);

export function registerEloRoutes(app, repo, opts = {}) {
  // Cache curto por (função, janela): a tela re-pede a cada troca de período e
  // o SSE de escritas do cockpit não invalida nada aqui (dados vêm de fora).
  const CACHE_MS = opts.cacheMs ?? 60_000;
  const cache = new Map();
  async function callFn(fn, days) {
    if (!ELO_FNS.has(fn)) throw new Error(`função desconhecida: ${fn}`);
    const key = `${fn}:${days}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const { rows } = await getEloPool().query(`select analytics.${fn}($1)::text as j`, [days]);
    const data = JSON.parse(rows[0]?.j || "null");
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  // Visão de produto do Elo (tela "Análise do App").
  app.get("/api/elo/overview", async (req, reply) => {
    if (!configured()) return { configured: false };
    const days = clampDays(req.query?.days);
    try {
      return { configured: true, ...(await callFn("elo_overview", days)) };
    } catch (err) {
      req.log.error({ err }, "elo_overview falhou");
      return reply.code(UPSTREAM_FAILED).send({ error: "O banco do Elo não respondeu — tente de novo em instantes." });
    }
  });

  // Beacon público das landing pages — evento anônimo por sessão de visita.
  const allowEvent = makeRateLimiter({
    limit: opts.eventRateLimit ?? Number(process.env.LP_EVENT_RATE_LIMIT || 60),
    windowMs: opts.rateWindowMs ?? 60_000,
  });
  const EVENT_TYPES = new Set(["view", "cta"]);
  app.post("/public/lp/events", async (req, reply) => {
    if (!allowEvent(clientIp(req))) return reply.code(429).send({ error: "Muitos eventos." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const event = String(body.event || "");
    const session = String(body.session || "").slice(0, 64);
    if (!EVENT_TYPES.has(event) || !session) return reply.code(400).send({ error: "Evento inválido" });
    const saas = (String(body.saas || "").slice(0, 40) || "elo").toLowerCase();
    // Página normalizada a partir do pathname ("/lp" → "lp"); raiz vira "home".
    const page = (String(body.page || "").replace(/^\/+|\/+$/g, "").slice(0, 60) || "home").toLowerCase();
    const label = String(body.label || "").slice(0, 80); // cta: qual botão
    // Visita sem UTM mas com referrer ganha origem derivada (google/instagram/
    // …) — senão busca orgânica e bio ficam invisíveis na quebra por origem.
    let utm = normalizeMetaSource(sanitizeUtm(body.utm));
    if ((!utm || !utm.source) && body.referrer) {
      const src = referrerSource(String(body.referrer));
      if (src) utm = { ...(utm || {}), source: src };
    }
    // Id explícito: eventos chegam em rajada e o gerador do repo é por timestamp.
    await repo.create("lp_events", {
      id: `lp_${randomUUID()}`,
      saas,
      page,
      event,
      session,
      ...(label ? { label } : {}),
      ...(utm ? { utm } : {}),
      createdAt: new Date().toISOString(),
      ua: String(req.headers["user-agent"] || "").slice(0, 300),
    });
    return reply.code(201).send({ ok: true });
  });

  // Resumo das landing pages (tela "Landing pages"): visitas do beacon +
  // conversão em dinheiro do banco do Elo (quando configurado), por origem.
  app.get("/api/lp/summary", async (req, reply) => {
    const days = clampDays(req.query?.days);
    const saas = (String(req.query?.saas || "elo").slice(0, 40)).toLowerCase();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const events = await repo.listWhere(
      "lp_events",
      { saas, createdAt: { gte: since } },
      { fields: ["page", "event", "session", "utm", "label", "createdAt"] },
    );

    // Sessões únicas por página/origem/dia — cada page load é uma sessão nova
    // (mesmo desenho do funil de forms), então "sessões" ≈ visitas.
    const pages = new Map();   // page -> { views:Set, ctas:Set, ctaClicks }
    const sources = new Map(); // source -> { sessions:Set, ctas:Set }
    const daily = new Map();   // yyyy-mm-dd -> { page -> Set(session) }
    const ctaLabels = new Map(); // label -> cliques
    for (const e of events) {
      const p = pages.get(e.page) || { views: new Set(), ctas: new Set(), ctaClicks: 0 };
      if (e.event === "view") p.views.add(e.session);
      if (e.event === "cta") { p.ctas.add(e.session); p.ctaClicks += 1; }
      pages.set(e.page, p);

      const src = e.utm?.source || "(direto)";
      const s = sources.get(src) || { sessions: new Set(), ctas: new Set() };
      s.sessions.add(e.session);
      if (e.event === "cta") s.ctas.add(e.session);
      sources.set(src, s);

      const d = String(e.createdAt || "").slice(0, 10);
      if (d) {
        const byPage = daily.get(d) || new Map();
        const set = byPage.get(e.page) || new Set();
        set.add(e.session);
        byPage.set(e.page, set);
        daily.set(d, byPage);
      }

      if (e.event === "cta" && e.label) ctaLabels.set(e.label, (ctaLabels.get(e.label) || 0) + 1);
    }

    let conversions = null;
    if (saas === "elo" && configured()) {
      try {
        conversions = await callFn("elo_lp_conversions", days);
      } catch (err) {
        req.log.error({ err }, "elo_lp_conversions falhou");
        // Fail-open: a parte de visitas continua útil sem a parte do dinheiro.
      }
    }

    return {
      configured: configured(),
      days,
      saas,
      pages: [...pages.entries()]
        .map(([page, p]) => ({ page, sessions: p.views.size, ctaSessions: p.ctas.size, ctaClicks: p.ctaClicks }))
        .sort((a, b) => b.sessions - a.sessions),
      sources: [...sources.entries()]
        .map(([source, s]) => ({ source, sessions: s.sessions.size, ctaSessions: s.ctas.size }))
        .sort((a, b) => b.sessions - a.sessions),
      daily: [...daily.entries()]
        .map(([d, byPage]) => ({
          d,
          ...Object.fromEntries([...byPage.entries()].map(([page, set]) => [page, set.size])),
        }))
        .sort((a, b) => (a.d < b.d ? -1 : 1)),
      ctaLabels: [...ctaLabels.entries()]
        .map(([label, clicks]) => ({ label, clicks }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 20),
      conversions,
    };
  });
}
