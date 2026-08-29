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
import { NOT_CONFIGURED } from "./http-status.js";
import {
  DAY_MS, round2, dayKey, monthKey, isRealLead, isSaleLead,
  winsIn, customerStartMap, tcvOf, cashCollectedIn, card12xBaseIn, paymentMethodOf,
} from "./metrics-core.js";

const monthOf = monthKey; // mês do dia do NEGÓCIO (metrics-core), não UTC

export function registerMetricsRoutes(app, repo, { ai = defaultAiCosts, getWhatsapp = () => null } = {}) {
  // Gasto com IA (OpenRouter/OpenAI/Anthropic) — agregado em USD pro período.
  app.get("/api/ai-costs", async (req, reply) => {
    if (!ai.configured()) return reply.code(NOT_CONFIGURED).send({ error: "nenhuma chave de IA configurada (OPENROUTER_API_KEY / OPENAI_ADMIN_KEY / ANTHROPIC_ADMIN_KEY)" });
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    return ai.report(days);
  });

  // Custos operacionais do mês: publicidade (ad_insights) + IA (série dos
  // provedores convertida em R$) automáticos, mais os lançamentos manuais da
  // collection expenses. Base da aba Custos do Financeiro e do resultado na Visão geral.
  app.get("/api/expenses/summary/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : monthKey(new Date());

    const [insights, expenses] = await Promise.all([repo.list("ad_insights"), repo.list("expenses")]);
    const round2 = (n) => Math.round(n * 100) / 100;
    const ads = round2(insights
      .filter((r) => r.saas === product.id && String(r.date || "").startsWith(month))
      .reduce((a, r) => a + (Number(r.spend) || 0), 0));

    // IA do mês: soma as séries diárias dos provedores dentro do mês pedido.
    // A janela das APIs cobre ~6 meses; mês mais antigo volta null (sem dado).
    // O custo de IA é GLOBAL (uma conta por provedor) — atribui inteiro ao
    // PRIMEIRO produto do portfólio (ordem de id, determinística) pra não
    // contar em dobro quando existe mais de um SaaS.
    const aiOwner = (await repo.list("products"))[0]?.id === product.id;
    let aiUSD = null, aiBRL = null, usdBrl = null;
    if (aiOwner && ai.configured()) {
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
    // Custo PERCENTUAL (e.pct): calculado mês a mês sobre a BASE do lançamento
    // (e.base) — cada taxa incide sobre o dinheiro certo:
    //   · "won" (padrão)  — GANHOS do pipeline no mês (lead.amount por wonAt),
    //     a mesma base do "Resultado do mês" da Visão geral;
    //   · "cartao12x"     — dinheiro de cartão de crédito que ENTROU no mês
    //     (espelho MP, card12xBaseIn no metrics-core): com antecipação D+0 a
    //     taxa incide inteira no mês em que o dinheiro cai — nunca sobre a
    //     marcação do fechamento (Leo, 08/08);
    //   · "received"      — RECEBIDOS no mês (faturas pagas por paidAt, régua
    //     cashCollectedIn do metrics-core) — imposto por regime de caixa: o
    //     faturado em 12 boletos só paga imposto conforme as parcelas entram.
    const pctBaseOf = (e) => (e.base === "cartao12x" || e.base === "received" ? e.base : "won");
    const basesNeeded = new Set(expenses
      .filter((e) => e.saas === product.id && Number(e.pct) > 0 && applies(e))
      .map(pctBaseOf));
    const bases = { won: 0, cartao12x: 0, received: 0 };
    if (basesNeeded.has("won")) {
      const [allLeads, allCustomers] = await Promise.all([repo.list("leads"), repo.list("customers")]);
      // Base do custo % sobre o VENDIDO: a mentoria entra (Leo, 16/08) — a taxa
      // do checkout incide no dinheiro dela igual.
      const leads = allLeads.filter((l) => l.saas === product.id && isSaleLead(l));
      const starts = customerStartMap(allCustomers.filter((c) => c.saas === product.id));
      const wins = winsIn(product, leads, (iso) => monthKey(iso) === month, starts);
      bases.won = tcvOf(leads.filter((l) => wins.has(l.id)));
    }
    if (basesNeeded.has("cartao12x")) {
      const mp = (await repo.list("mp_payments")).filter((p) => !p.saas || p.saas === product.id);
      bases.cartao12x = card12xBaseIn(mp, month);
    }
    if (basesNeeded.has("received")) {
      const [allInv, allCust] = await Promise.all([repo.list("invoices"), repo.list("customers")]);
      const invoices = allInv.filter((i) => i.saas === product.id);
      // O meio de pagamento do cliente decide se a fatura que nasce paga no
      // fechamento é recebimento de verdade (isRealReceipt do metrics-core).
      bases.received = cashCollectedIn(invoices, month, paymentMethodOf(allCust.filter((c) => c.saas === product.id)));
    }
    // WhatsApp do mês: custo REAL das conversas (conversation_analytics da
    // conta, em BRL). Conta é GLOBAL como a IA → atribui ao primeiro produto
    // (quando cada SaaS tiver número próprio, refinar por telefone).
    let wa = null, waConversations = null;
    const waClient = getWhatsapp();
    if (aiOwner && waClient?.configured?.()) {
      try {
        const { resolveWabaId } = await import("./wa-health.js");
        const wabaId = await resolveWabaId(repo, waClient);
        if (wabaId) {
          const startMs = new Date(`${month}-01T00:00:00-03:00`).getTime();
          const endRef = new Date(`${month}-01T00:00:00-03:00`); endRef.setMonth(endRef.getMonth() + 1);
          const r = await waClient.conversationCosts(wabaId, {
            start: Math.floor(startMs / 1000),
            end: Math.floor(Math.min(endRef.getTime(), Date.now()) / 1000),
          });
          wa = round2(r.cost); waConversations = r.conversations;
        }
      } catch { /* fail-open: WhatsApp fica null */ }
    }

    const manual = expenses
      .filter((e) => e.saas === product.id && applies(e))
      .map((e) => (Number(e.pct) > 0
        ? { ...e, base: pctBaseOf(e), amount: round2((Number(e.pct) / 100) * bases[pctBaseOf(e)]) }
        : e))
      .sort((a, b) => (b.recurring === true) - (a.recurring === true) || String(a.category).localeCompare(String(b.category)));
    const manualTotal = round2(manual.reduce((a, e) => a + (Number(e.amount) || 0), 0));
    // Contas a pagar do mês (competência) entram no total: o "Resultado do
    // mês" que consome este summary passa a incluir folha e fornecedores —
    // mesma conta do Financeiro (aba Resumo), sem dupla contagem (coleções
    // distintas: regra/automático aqui, conta com favorecido em payables).
    const payablesMonth = (await repo.list("payables")).filter((p) => p.saas === product.id && p.month === month);
    const payablesTotal = round2(payablesMonth.reduce((a, p) => a + (Number(p.amount) || 0), 0));
    const total = round2(ads + (aiBRL || 0) + (wa || 0) + manualTotal + payablesTotal);
    return {
      month, ads, ai: aiBRL, aiUSD, usdBrl, wa, waConversations, manual, manualTotal,
      payablesTotal, payablesCount: payablesMonth.length, total,
      wonBase: basesNeeded.has("won") ? round2(bases.won) : undefined,
      cardBase: basesNeeded.has("cartao12x") ? round2(bases.cartao12x) : undefined,
      receivedBase: basesNeeded.has("received") ? round2(bases.received) : undefined,
    };
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
    const L = leads.filter((l) => l.saas === product.id && isRealLead(l));
    const A = insights.filter((r) => r.saas === product.id);

    // Janela corrente (?days=): últimos N dias do NEGÓCIO com hoje incluso — a
    // mesma régua de dia/janela do resto do cockpit (metrics-core). Antes
    // cortava por instante UTC e divergia do tile de Leads ao lado.
    const sinceDay = dayKey(new Date(Date.now() - (days - 1) * DAY_MS));
    const spendWin = A.filter((r) => String(r.date) >= sinceDay).reduce((a, r) => a + (Number(r.spend) || 0), 0);
    const newCustWin = C.filter((c) => c.startedAt && dayKey(c.startedAt) >= sinceDay).length;
    const leadsWin = L.filter((l) => l.createdAt && dayKey(l.createdAt) >= sinceDay).length;
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
      // Cliente sem startedAt (cadastro antigo/manual) conta como base desde
      // sempre; churnado (endedAt) sai da série a partir do mês da saída — o
      // arr congelado no churn preserva os meses anteriores.
      const mrr = C.filter((c) => (!c.startedAt || c.startedAt < endIso) && !(c.endedAt && String(c.endedAt) < endIso))
        .reduce((a, c) => a + (c.arr || 0) / 12, 0);
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
