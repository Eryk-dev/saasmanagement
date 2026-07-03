// Métricas de receita/aquisição — CAC e LTV do produto, com série mensal.
//   CAC        = gasto em anúncios (ad_insights) / clientes novos no período
//   LTV        = ticket médio mensal (assinaturas ativas) × permanência estimada
//                (product.ltvMonths, premissa configurável até existir churn real)
//   conversão  = clientes novos / leads criados no período
// "Cliente novo" = customer.startedAt no período (carimbado na conversão
// automática lead→cliente, ver convertWonLead em routes.js).
//
// MRR da série mensal é APROXIMADO: soma o arr/12 atual dos clientes que já
// existiam no fim de cada mês (sem histórico de churn/preço — melhora quando
// cancelamentos forem carimbados).

import { annualized } from "./billing.js";
import { aiCosts as defaultAiCosts } from "./ai-costs.js";

const round2 = (n) => Math.round(n * 100) / 100;
const monthOf = (iso) => String(iso || "").slice(0, 7);

export function registerMetricsRoutes(app, repo, { ai = defaultAiCosts } = {}) {
  // Gasto com IA (OpenRouter/OpenAI/Anthropic) — agregado em USD pro período.
  app.get("/api/ai-costs", async (req, reply) => {
    if (!ai.configured()) return reply.code(503).send({ error: "nenhuma chave de IA configurada (OPENROUTER_API_KEY / OPENAI_ADMIN_KEY / ANTHROPIC_ADMIN_KEY)" });
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    return ai.report(days);
  });

  app.get("/api/metrics/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
    const months = Math.min(24, Math.max(3, Number(req.query.months) || 12));

    const [customers, subs, leads, insights] = await Promise.all([
      repo.list("customers"), repo.list("subscriptions"), repo.list("leads"), repo.list("ad_insights"),
    ]);
    const C = customers.filter((c) => c.saas === product.id);
    const S = subs.filter((s) => s.saas === product.id);
    const L = leads.filter((l) => l.saas === product.id);
    const A = insights.filter((r) => r.saas === product.id);

    // Janela corrente (?days=), pra CAC/conversão "agora".
    const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();
    const cutoffDay = cutoffIso.slice(0, 10);
    const spendWin = A.filter((r) => String(r.date) >= cutoffDay).reduce((a, r) => a + (Number(r.spend) || 0), 0);
    const newCustWin = C.filter((c) => c.startedAt && c.startedAt >= cutoffIso).length;
    const leadsWin = L.filter((l) => l.createdAt && l.createdAt >= cutoffIso).length;
    const cac = newCustWin > 0 && spendWin > 0 ? round2(spendWin / newCustWin) : null;
    const convRate = leadsWin > 0 ? round2((newCustWin / leadsWin) * 100) : null;

    // LTV: ticket médio mensal das assinaturas ativas × premissa de permanência.
    const activeSubs = S.filter((s) => s.status === "active" || s.status === "past_due");
    const mrrNow = activeSubs.reduce((a, s) => a + annualized(s.price, s.cycle) / 12, 0);
    const paying = new Set(activeSubs.map((s) => s.customer).filter(Boolean)).size;
    const ticket = paying > 0 ? round2(mrrNow / paying) : null;
    const ltvMonths = Number(product.ltvMonths) > 0 ? Number(product.ltvMonths) : 12;
    const ltv = ticket != null ? round2(ticket * ltvMonths) : null;

    // Série mensal (últimos N meses).
    const now = new Date();
    const series = [];
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const mk = start.toISOString().slice(0, 7);
      const endIso = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
      const spend = A.filter((r) => monthOf(r.date) === mk).reduce((a, r) => a + (Number(r.spend) || 0), 0);
      const nl = L.filter((l) => monthOf(l.createdAt) === mk).length;
      const nc = C.filter((c) => monthOf(c.startedAt) === mk).length;
      // Cliente sem startedAt (cadastro antigo/manual) conta como base desde sempre.
      const mrr = C.filter((c) => !c.startedAt || c.startedAt < endIso).reduce((a, c) => a + (c.arr || 0) / 12, 0);
      series.push({
        month: mk,
        spend: round2(spend),
        leads: nl,
        newCustomers: nc,
        cac: nc > 0 && spend > 0 ? round2(spend / nc) : null,
        mrr: round2(mrr),
      });
    }

    return {
      saas: product.id, days, months,
      window: { spend: round2(spendWin), leads: leadsWin, newCustomers: newCustWin, cac, convRate },
      ltv: { ticket, months: ltvMonths, value: ltv, ltvCac: ltv != null && cac ? round2(ltv / cac) : null, payingCustomers: paying },
      series,
    };
  });
}
