// REST routes. One generic CRUD surface over every collection, plus two
// computed/aggregated endpoints the cockpit needs: /bootstrap and /portfolio.

import { repo as defaultRepo, COLLECTION_NAMES } from "./db.js";
import { PORTFOLIO_CONST } from "./seed-data.js";
import { openapi, docsHtml } from "./openapi.js";
import { runProposal, integrationStatus } from "./levercopy.js";
import { registerFormRoutes } from "./routes.forms.js";
import { registerProposalRoutes } from "./routes.proposals.js";
import { runNativeProposal } from "./proposal.js";
import { registerBillingRoutes } from "./routes.billing.js";
import { initSubscription, syncCustomerArr } from "./billing.js";
import { registerAuthRoutes } from "./auth.js";
import { registerMpRoutes, mirrorSubscriptionToMp } from "./routes.mp.js";
import { mp as defaultMpClient } from "./mp.js";
import { registerMarketingRoutes } from "./routes.marketing.js";
import { meta as defaultMetaClient } from "./meta.js";

// Auth interna fica FORA do CRUD genérico: passwordHash/token de sessão nunca
// saem pela API. Gestão via rotas dedicadas (/api/auth/*).
const PRIVATE = new Set(["users", "sessions"]);
const isExposed = (c) => COLLECTION_NAMES.includes(c) && !PRIVATE.has(c);

// Collections external SaaS are allowed to write to via REST/MCP.
const WRITABLE = new Set(COLLECTION_NAMES.filter((c) => !PRIVATE.has(c)));

// Defaults applied on create so a minimally-specified record still renders in the
// UI (which iterates over array fields). User-provided fields always win.
// (Exported: as rotas públicas de form criam leads fora do CRUD genérico.)
export const CREATE_DEFAULTS = {
  products: {
    health: 0, healthDelta: 0, healthTrend: "stable",
    mrr: 0, mrrDelta: 0, arr: 0, nrr: 1, nrrDelta: 0, grr: 1, logoRetention: 1, churnRate: 0,
    nnm: { new: 0, expansion: 0, contraction: 0, churn: 0 },
    tcv: 0, tcvDelta: 0, pipelineCoverage: null, acv: 0, acvDelta: 0,
    winRate: 0, winRateDelta: 0, velocity: 100, velocityDelta: 0,
    funnel: [], activation: 0, activationDelta: 0, nps: 0, npsDelta: 0,
    mrrSeries: [], healthSeries: [], customers: 0, customersDelta: 0,
    accent: 240, tag: "", plan: "", motion: "", ticketBand: "", cycleDays: 0,
    // Config por SaaS (fase 3): campos custom por entidade, pesos da saúde (em %,
    // somam 100) e definição do Aha — editados em Ajustes.
    customFields: { deals: [], customers: [], leads: [] },
    healthWeights: { funil: 25, vendas: 25, cliente: 25, uso: 25 },
    aha: { conditions: [] },
  },
  // Métricas de cliente não são mais editáveis no form (saúde/uso/NPS/renovação são
  // alimentadas por automação); o create precisa de defaults pra UI não ler `undefined`.
  customers: { flags: [], health: 0, delta: 0, nps: 0, usage: "", lastTouch: "—", renewal: "—" },
  nps: { tags: [] },
  leads: { priority: "P2", score: 0, icp: 0, value: "", amount: 0, owner: "", reason: "", source: "Form", age: "agora", stage: "" },
  // `current`/`projected` saem do form (leitura ao vivo da meta) — default 0 até serem alimentados.
  goals: { current: 0, projected: 0 },
  forms: { status: "draft", theme: {}, welcome: null, questions: [], thanks: {}, mapping: {} },
  proposal_templates: { status: "draft", theme: {}, slides: [], calc: {}, acceptStage: "" },
  // Billing (fase 5). Datas de período/fatura inicial são dinâmicas — preenchidas
  // por initSubscription no POST genérico, não aqui.
  plans: { name: "", cycle: "monthly", price: 0 },
  subscriptions: { status: "active", cycle: "monthly", price: 0, plan: "", pendingChange: null },
  invoices: { status: "open", amount: 0, kind: "manual" },
};

// Receita e nº de clientes são DERIVADOS da coleção `customers`, não dos campos
// crus do produto — assim um SaaS nunca exibe receita sem clientes registrados.
// `customers` = qtd de clientes daquele saas; `arr` = soma do ARR deles; `mrr` = arr/12.
function rollupProduct(p, customers) {
  const mine = customers.filter((c) => c.saas === p.id);
  const arr = mine.reduce((a, c) => a + (Number(c.arr) || 0), 0);
  return { ...p, customers: mine.length, arr, mrr: Math.round(arr / 12) };
}
const rollupProducts = (products, customers) => products.map((p) => rollupProduct(p, customers));

async function computePortfolio(repo) {
  const [products, customers] = await Promise.all([repo.list("products"), repo.list("customers")]);
  const saas = rollupProducts(products, customers);
  const sum = (k) => saas.reduce((a, s) => a + (Number(s[k]) || 0), 0);
  return {
    mrr: sum("mrr"),
    arr: sum("arr"),
    mrrDelta: sum("mrrDelta"),
    tcv: sum("tcv"),
    customers: sum("customers"),
    nrr: PORTFOLIO_CONST.nrr,
    mrrSeries30d: PORTFOLIO_CONST.mrrSeries30d,
  };
}

async function peopleObject(repo) {
  const list = await repo.list("people");
  const obj = {};
  for (const p of list) obj[p.id] = p;
  return obj;
}

// Filters applied to GET list endpoints. Each returns a predicate or null.
function listFilter(collection, q) {
  if (collection === "deals") {
    return (d) =>
      (!q.saas || d.saas === q.saas) &&
      (!q.stage || d.stage === q.stage) &&
      (!q.owner || d.owner === q.owner) &&
      (!q.score || d.score === q.score);
  }
  if (collection === "customers") {
    return (c) => {
      if (q.band === "red") return c.health < 50;
      if (q.band === "yellow") return c.health >= 50 && c.health < 70;
      if (q.band === "green") return c.health >= 70;
      if (q.saas) return c.saas === q.saas;
      return true;
    };
  }
  if (collection === "leads") return (l) => !q.priority || l.priority === q.priority;
  if (collection === "nps") return (n) => !q.saas || n.saas === q.saas;
  if (collection === "goals") return (g) => !q.scope || g.scope === q.scope;
  if (collection === "forms") return (f) => !q.saas || f.saas === q.saas;
  if (collection === "form_submissions") return (s) => (!q.form || s.form === q.form) && (!q.saas || s.saas === q.saas);
  if (collection === "proposal_templates") return (t) => !q.saas || t.saas === q.saas;
  if (collection === "proposals") return (p) => (!q.saas || p.saas === q.saas) && (!q.lead || p.lead === q.lead) && (!q.template || p.template === q.template);
  if (collection === "plans") return (p) => !q.saas || p.saas === q.saas;
  if (collection === "subscriptions") return (s) => (!q.saas || s.saas === q.saas) && (!q.customer || s.customer === q.customer) && (!q.status || s.status === q.status);
  if (collection === "invoices") return (i) => (!q.saas || i.saas === q.saas) && (!q.customer || i.customer === q.customer) && (!q.subscription || i.subscription === q.subscription) && (!q.status || i.status === q.status);
  if (collection === "ad_insights") return (r) => (!q.saas || r.saas === q.saas) && (!q.campaign || r.campaignId === q.campaign);
  return null;
}

export function registerRoutes(app, repo = defaultRepo, opts = {}) {
  app.get("/api/health", async () => ({ ok: true, service: "cockpit-api", collections: COLLECTION_NAMES }));

  // Superfície pública do form builder (/public/forms, /f/:id, /embed.js).
  registerFormRoutes(app, repo, opts.forms || {});
  // Superfície pública do proposal builder (/p/:id, aceite, painel do closer).
  registerProposalRoutes(app, repo, opts.proposals || {});
  // Billing (fase 5): mudança de plano c/ pró-rata, baixa de fatura, tick do motor.
  const mpClient = opts.mp || defaultMpClient;
  registerBillingRoutes(app, repo, { mp: mpClient });
  // Mercado Pago (fase 4): link de assinatura + webhook de baixa automática.
  registerMpRoutes(app, repo, { mp: mpClient });
  // Marketing: sync de insights da Meta + métricas cruzadas com o funil.
  const metaClient = opts.meta || defaultMetaClient;
  registerMarketingRoutes(app, repo, { meta: metaClient });
  // Usuários do time: login/logout/me + gestão mínima (rotas dedicadas).
  registerAuthRoutes(app, repo);

  // API documentation (OpenAPI spec + Redoc page). The MCP server consumes this.
  app.get("/api/openapi.json", async () => openapi);
  app.get("/api/docs", async (_req, reply) => reply.type("text/html").send(docsHtml));

  // Everything the cockpit web app needs in one shot (mirrors window.SEED).
  app.get("/api/bootstrap", async () => {
    const [products, customers, attention, leads, nps, lbMonth, lbAll, goals, portfolio, people] =
      await Promise.all([
        repo.list("products"),
        repo.list("customers"),
        repo.list("attention"),
        repo.list("leads"),
        repo.list("nps"),
        repo.list("leaderboard_month"),
        repo.list("leaderboard_all"),
        repo.list("goals"),
        computePortfolio(repo),
        peopleObject(repo),
      ]);
    return {
      SAAS: rollupProducts(products, customers),
      PORTFOLIO: portfolio,
      ATTENTION: attention,
      PEOPLE: people,
      CUSTOMERS: customers,
      LEADS: leads,
      NPS: nps,
      LEADERBOARD_MONTH: lbMonth,
      LEADERBOARD_ALL: lbAll,
      GOALS: goals,
      // Estado de integrações que a UI precisa pra decidir o que renderizar
      // (ex.: mostrar o botão "Gerar proposta" nos leads de SaaS com provider).
      CONFIG: {
        levercopy: integrationStatus(),
        proposals: { nativeSaas: (await repo.list("proposal_templates")).filter((t) => t.status === "published").map((t) => t.saas) },
        mp: { configured: mpClient.configured() },
        meta: { configured: metaClient.configured() },
      },
    };
  });

  app.get("/api/portfolio", async () => await computePortfolio(repo));

  // Convenience: leaderboard by scope -> the right collection.
  app.get("/api/leaderboard", async (req) => {
    const scope = req.query.scope === "all" ? "leaderboard_all" : "leaderboard_month";
    return await repo.list(scope);
  });

  // ── Generic CRUD over every collection ───────────────────────────────────
  app.get("/api/:collection", async (req, reply) => {
    const { collection } = req.params;
    if (!isExposed(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    let items = await repo.list(collection);
    const f = listFilter(collection, req.query);
    if (f) items = items.filter(f);
    if (collection === "products") items = rollupProducts(items, await repo.list("customers"));
    return items;
  });

  app.get("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!isExposed(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    const item = await repo.get(collection, id);
    if (!item) return reply.code(404).send({ error: "Not found" });
    return collection === "products" ? rollupProduct(item, await repo.list("customers")) : item;
  });

  app.post("/api/:collection", async (req, reply) => {
    const { collection } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    if (!req.body || typeof req.body !== "object") return reply.code(400).send({ error: "JSON body required" });
    const stamp = collection === "leads" && !req.body.createdAt ? { createdAt: new Date().toISOString() } : {};
    let created = await repo.create(collection, { ...(CREATE_DEFAULTS[collection] || {}), ...req.body, ...stamp });
    // Assinatura nova: janela do 1º ciclo + fatura inicial + customer.arr
    // (invariante: receita do produto deriva de customers).
    if (collection === "subscriptions") created = await initSubscription(repo, created);
    return reply.code(201).send(created);
  });

  app.patch("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    if (!req.body || typeof req.body !== "object") return reply.code(400).send({ error: "JSON body required" });
    const before = collection === "subscriptions" ? await repo.get(collection, id) : null;
    const updated = await repo.update(collection, id, req.body);
    if (!updated) return reply.code(404).send({ error: "Not found" });
    if (collection === "subscriptions") {
      await syncCustomerArr(repo, updated.customer);
      if (before && before.customer && before.customer !== updated.customer) await syncCustomerArr(repo, before.customer);
      // Cancelar/pausar/reativar aqui não pode deixar o MP cobrando (fail-open).
      await mirrorSubscriptionToMp(mpClient, before, updated, req.log);
    }
    return updated;
  });

  app.delete("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    const subCustomer = collection === "subscriptions" ? (await repo.get(collection, id))?.customer : null;
    const ok = await repo.remove(collection, id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    if (subCustomer) await syncCustomerArr(repo, subCustomer);
    return { ok: true, id };
  });

  // ── Funil do produto com migração de renomes (fase 3) ────────────────────
  // `lead.stage`/`deal.stage` guardam o NOME do estágio sem FK — renomear via
  // PATCH cru órfã os cards. Este endpoint grava o funil e migra os registros:
  // body { funnel: [...], renames: { "Nome antigo": "Nome novo" } }.
  app.put("/api/products/:id/funnel", async (req, reply) => {
    const product = await repo.get("products", req.params.id);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { funnel, renames } = req.body || {};
    if (!Array.isArray(funnel)) return reply.code(400).send({ error: "funnel array required" });
    const map = renames && typeof renames === "object" ? renames : {};
    const valid = new Set(funnel.map((f) => f.stage));
    let migrated = 0;
    for (const collection of ["leads", "deals"]) {
      for (const item of await repo.list(collection)) {
        if (item.saas !== product.id) continue;
        const to = map[item.stage];
        if (to && to !== item.stage && valid.has(to)) {
          await repo.update(collection, item.id, { stage: to });
          migrated++;
        }
      }
    }
    const updated = await repo.update("products", product.id, { funnel });
    return { ok: true, migrated, product: updated };
  });

  // ── Geração de proposta de um lead — dispatcher native | levercopy ────────
  // `?auto=1`  → gatilho automático (a UI chama após criar um lead): respeita a
  //              idempotência (pula se já tem proposta) e a elegibilidade (saas/config).
  // `?force=1` → re-gerar manual: sobrescreve as URLs salvas.
  // Provider: `product.proposalProvider` explícito vence; sem ele, usa 'native'
  // quando o SaaS tem template publicado, senão 'levercopy' (preserva o caminho
  // de produção do LeverAds até existir template nativo).
  // Best-effort: só 404 (lead inexistente) é erro; skip/falha de geração voltam 200
  // com { ok:false, ... } pra UI mostrar o estado sem quebrar nada (fail-open).
  app.post("/api/leads/:id/proposal", async (req, reply) => {
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const auto = req.query.auto === "1" || req.query.auto === "true";
    const force = req.query.force === "1" || req.query.force === "true";

    const product = await repo.get("products", lead.saas);
    let provider = product?.proposalProvider;
    if (provider !== "native" && provider !== "levercopy") {
      const templates = await repo.list("proposal_templates");
      provider = templates.some((t) => t.saas === lead.saas && t.status === "published") ? "native" : "levercopy";
    }

    const result = provider === "native"
      ? await runNativeProposal(repo, lead, { auto, force, baseUrl: PUBLIC_BASE })
      : await runProposal(repo, lead, { auto, force });
    if (!result.ok && result.error) {
      req.log.warn({ leadId: lead.id, provider, status: result.status, err: result.error }, "proposal generation failed");
    }
    return { provider, ...result };
  });
}

// Base das URLs públicas gravadas no lead (proposalUrl). Em dev cai no host da
// própria API; em produção configurar COCKPIT_PUBLIC_URL.
const PUBLIC_BASE = (process.env.COCKPIT_PUBLIC_URL || `http://localhost:${process.env.API_PORT || 8787}`).replace(/\/+$/, "");
