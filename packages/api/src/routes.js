// REST routes. One generic CRUD surface over every collection, plus two
// computed/aggregated endpoints the cockpit needs: /bootstrap and /portfolio.

import { repo, COLLECTION_NAMES } from "./db.js";
import { PORTFOLIO_CONST } from "./seed-data.js";

// Collections external SaaS are allowed to write to via REST/MCP.
const WRITABLE = new Set(COLLECTION_NAMES);

function computePortfolio() {
  const saas = repo.list("products");
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

function peopleObject() {
  const list = repo.list("people");
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
  return null;
}

export function registerRoutes(app) {
  app.get("/api/health", async () => ({ ok: true, service: "cockpit-api", collections: COLLECTION_NAMES }));

  // Everything the cockpit web app needs in one shot (mirrors window.SEED).
  app.get("/api/bootstrap", async () => ({
    SAAS: repo.list("products"),
    PORTFOLIO: computePortfolio(),
    ATTENTION: repo.list("attention"),
    DEALS: repo.list("deals"),
    PEOPLE: peopleObject(),
    CUSTOMERS: repo.list("customers"),
    LEADS: repo.list("leads"),
    NPS: repo.list("nps"),
    LEADERBOARD_MONTH: repo.list("leaderboard_month"),
    LEADERBOARD_ALL: repo.list("leaderboard_all"),
    GOALS: repo.list("goals"),
    PROPOSALS: repo.list("proposals"),
  }));

  app.get("/api/portfolio", async () => computePortfolio());

  // Convenience: leaderboard by scope -> the right collection.
  app.get("/api/leaderboard", async (req) => {
    const scope = req.query.scope === "all" ? "leaderboard_all" : "leaderboard_month";
    return repo.list(scope);
  });

  // ── Generic CRUD over every collection ───────────────────────────────────
  app.get("/api/:collection", async (req, reply) => {
    const { collection } = req.params;
    if (!COLLECTION_NAMES.includes(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    let items = repo.list(collection);
    const f = listFilter(collection, req.query);
    if (f) items = items.filter(f);
    return items;
  });

  app.get("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!COLLECTION_NAMES.includes(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    const item = repo.get(collection, id);
    if (!item) return reply.code(404).send({ error: "Not found" });
    return item;
  });

  app.post("/api/:collection", async (req, reply) => {
    const { collection } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    if (!req.body || typeof req.body !== "object") return reply.code(400).send({ error: "JSON body required" });
    const created = repo.create(collection, req.body);
    return reply.code(201).send(created);
  });

  app.patch("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    if (!req.body || typeof req.body !== "object") return reply.code(400).send({ error: "JSON body required" });
    const updated = repo.update(collection, id, req.body);
    if (!updated) return reply.code(404).send({ error: "Not found" });
    return updated;
  });

  app.delete("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    const ok = repo.remove(collection, id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    return { ok: true, id };
  });
}
