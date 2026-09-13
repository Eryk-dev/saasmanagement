// Rotas dos cases: o rascunho que nasce da ficha do cliente, o gate de
// publicação e o JSON público que o site consome.

import { validateCase, publishBlockers, publicCase, pickCases } from "./cases.js";
import { influencedByOrg } from "./leverads-results.js";

const money = (n) => `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;

export function registerCaseRoutes(app, repo, { influenced = influencedByOrg } = {}) {
  // Rascunho a partir de um cliente: o número já vem do painel, que é o único
  // jeito de o slide poder prometer "conferido no painel" sem alguém digitar.
  app.post("/api/cases/from-customer", async (req, reply) => {
    const customer = await repo.get("customers", String(req.body?.customer || ""));
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado." });
    const lead = customer.leadId ? await repo.get("leads", customer.leadId).catch(() => null) : null;
    const metrics = [];
    if (customer.leveradsOrgId) {
      const map = await influenced([customer.leveradsOrgId]).catch(() => new Map());
      const gmv = map.get(String(customer.leveradsOrgId));
      if (gmv > 0) {
        metrics.push({ label: "vendidos pelos anúncios da Lever", value: money(gmv), period: "últimos 30 dias", source: "painel", proofUrl: "" });
      }
    }
    const doc = await repo.create("cases", validateCase({
      saas: customer.saas || "",
      customerId: customer.id,
      name: customer.name || "",
      niche: lead?.niche || "",
      headline: "",
      metrics,
      quote: "",
      quoteAuthor: customer.contact || "",
      authorizedAt: "",
      authorizedBy: "",
      authorizedVia: "",
      public: false,
      order: 0,
      createdAt: new Date().toISOString(),
    }));
    return reply.code(201).send({ ...doc, blockers: publishBlockers(doc) });
  });

  // Gate de publicação: o 422 devolve o que falta, pra tela dizer em vez de só
  // recusar.
  app.post("/api/cases/:id/publish", async (req, reply) => {
    const doc = await repo.get("cases", req.params.id);
    if (!doc) return reply.code(404).send({ error: "Case não encontrado." });
    const querPublicar = req.body?.public !== false;
    if (!querPublicar) {
      const saved = await repo.update("cases", doc.id, { public: false, updatedAt: new Date().toISOString() });
      return { ...saved, blockers: publishBlockers(saved) };
    }
    const faltando = publishBlockers(doc);
    if (faltando.length) {
      return reply.code(422).send({
        error: `Falta ${faltando.join(", ")} pra publicar este case.`,
        code: "case_incomplete",
        blockers: faltando,
      });
    }
    const saved = await repo.update("cases", doc.id, { public: true, updatedAt: new Date().toISOString() });
    return { ...saved, blockers: [] };
  });

  // JSON público que o site consome (via proxy com cache no FastAPI de lá).
  // Nunca 5xx: o EasyPanel transforma 5xx em "Service is not reachable" e a
  // home do site ficaria sem a seção inteira por causa de um hiccup aqui.
  app.get("/public/cases.json", async (req, reply) => {
    reply.header("cache-control", "public, max-age=300, stale-while-revalidate=3600");
    try {
      const all = await repo.list("cases");
      const cases = pickCases(all, { limit: 12 }).map(publicCase);
      return { cases, count: cases.length, at: new Date().toISOString() };
    } catch {
      return { cases: [], count: 0, at: new Date().toISOString() };
    }
  });
}
