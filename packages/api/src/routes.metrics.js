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

  // Custos operacionais do mês: publicidade (ad_insights) + IA (série dos
  // provedores convertida em R$) automáticos, mais os lançamentos manuais da
  // collection expenses. Base da tela Custos e do resultado na Visão geral.
  app.get("/api/expenses/summary/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : new Date().toISOString().slice(0, 7);

    const [insights, expenses] = await Promise.all([repo.list("ad_insights"), repo.list("expenses")]);
    const round2 = (n) => Math.round(n * 100) / 100;
    const ads = round2(insights
      .filter((r) => r.saas === product.id && String(r.date || "").startsWith(month))
      .reduce((a, r) => a + (Number(r.spend) || 0), 0));

    // IA do mês: soma as séries diárias dos provedores dentro do mês pedido.
    // A janela das APIs cobre ~6 meses; mês mais antigo volta null (sem dado).
    let aiUSD = null, aiBRL = null, usdBrl = null;
    if (ai.configured()) {
      try {
        const monthStart = new Date(`${month}-01T00:00:00Z`).getTime();
        const days = Math.min(180, Math.max(35, Math.ceil((Date.now() - monthStart) / 86400000) + 2));
        if (days <= 180) {
          const rep = await ai.report(days);
          usdBrl = rep.usdBrl;
          let sum = 0, has = false;
          for (const p of rep.providers) {
            for (const s of p.series || []) {
              if (String(s.date).startsWith(month)) { sum += Number(s.spend) || 0; has = true; }
            }
          }
          if (has) { aiUSD = round2(sum); aiBRL = usdBrl ? round2(sum * usdBrl) : null; }
        }
      } catch { /* fail-open: IA fica null */ }
    }

    // Lançamento normal vale só no seu mês; recorrente vale de `month` em
    // diante até `endMonth` (inclusivo), sem re-cadastro mês a mês.
    const applies = (e) => e.recurring
      ? String(e.month) <= month && (!e.endMonth || String(e.endMonth) >= month)
      : e.month === month;
    const manual = expenses
      .filter((e) => e.saas === product.id && applies(e))
      .sort((a, b) => (b.recurring === true) - (a.recurring === true) || String(a.category).localeCompare(String(b.category)));
    const manualTotal = round2(manual.reduce((a, e) => a + (Number(e.amount) || 0), 0));
    const total = round2(ads + (aiBRL || 0) + manualTotal);
    return { month, ads, ai: aiBRL, aiUSD, usdBrl, manual, manualTotal, total };
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
