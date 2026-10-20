// Pacotes e pedidos (lógica em bundles.js).
//
//   GET   /api/bundles?saas=            pacotes do produto (com os itens rateados pelo preço atual)
//   POST  /api/bundles                  { saas, name, items: [{ product, planClosed }], price } (só admin)
//   PATCH /api/bundles/:id              mesmo corpo, ou { status: "archived" } (só admin)
//   POST  /api/leads/:id/bundle         { bundleId } aplica o pacote no negócio (guard do Pipeline)
//   GET   /api/customers/:id/orders     pedidos do cliente (guard de Clientes)

import { BUNDLES, ORDERS, applyBundle, assertOnePerProduct, bundleDealItems, catalogOf, cleanBundle } from "./bundles.js";

const isAdmin = (u) => !u || (u.roles || []).includes("admin");

async function guard(reply, fn) {
  try { return await fn(); }
  catch (err) {
    if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
}

export function registerBundleRoutes(app, repo) {
  app.get("/api/bundles", async (req) => {
    const saas = String(req.query?.saas || "");
    const rows = (await repo.list(BUNDLES)).filter((b) => !saas || b.saas === saas);
    const catalogs = new Map();
    const out = [];
    for (const b of rows) {
      if (!catalogs.has(b.saas)) catalogs.set(b.saas, await catalogOf(repo, b.saas));
      let items = [];
      try { items = bundleDealItems(b, catalogs.get(b.saas)); } catch { items = []; }
      out.push({ ...b, dealItems: items, listTotal: items.reduce((n, i) => n + i.listAmount, 0) });
    }
    return { bundles: out };
  });
  app.post("/api/bundles", async (req, reply) => guard(reply, async () => {
    if (!isAdmin(req.authUser)) return reply.code(403).send({ error: "Criar pacote exige etiqueta admin" });
    return reply.code(201).send(await repo.create(BUNDLES, { ...(await assertOnePerProduct(repo, cleanBundle(req.body))), createdAt: new Date().toISOString(), createdBy: req.authUser?.id || "api" }));
  }));
  app.patch("/api/bundles/:id", async (req, reply) => guard(reply, async () => {
    if (!isAdmin(req.authUser)) return reply.code(403).send({ error: "Editar pacote exige etiqueta admin" });
    const cur = await repo.get(BUNDLES, req.params.id);
    if (!cur) return reply.code(404).send({ error: "Pacote não encontrado." });
    const next = req.body?.status && Object.keys(req.body).length === 1
      ? { status: req.body.status === "archived" ? "archived" : "active" }
      : await assertOnePerProduct(repo, cleanBundle({ ...cur, ...req.body }, { saas: cur.saas }));
    return repo.update(BUNDLES, cur.id, next);
  }));
  app.post("/api/leads/:id/bundle", async (req, reply) => guard(reply, () => applyBundle(repo, req.params.id, String(req.body?.bundleId || ""))));
  app.get("/api/customers/:id/orders", async (req) => ({ orders: await repo.listWhere(ORDERS, { customer: req.params.id }) }));
}
