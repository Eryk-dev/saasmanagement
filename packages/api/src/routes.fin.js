// Financeiro completo — a leitura ÚNICA do mês, no modelo do Conta Azul
// adaptado ao que o cockpit já tem:
//   · Contas a RECEBER = invoices (a régua existente: open/overdue/paid,
//     vencimento, baixa automática pelo espelho do Mercado Pago). Receita
//     NUNCA nasce aqui — fatura é a fonte.
//   · Contas a PAGAR = collection `payables` (nova): lançamento com competência
//     (month), vencimento (dueDate), situação (aberta/paga) e FAVORECIDO —
//     colaborador (userId, vira a Folha) ou fornecedor (texto livre).
//     Recorrência no padrão fatura: o doc `recurring: true` é o template E a
//     1ª ocorrência; os meses seguintes viram INSTÂNCIAS (templateId) que este
//     endpoint materializa sob demanda — cada mês tem a própria baixa.
//   · Custos automáticos e percentuais (ads, IA, WhatsApp, checkout 12%,
//     imposto) continuam na collection `expenses` (aba Custos): são REGRAS por
//     competência, sem ciclo de pagamento. Aqui eles entram no fluxo e no DRE
//     pra conta fechar — sem dupla contagem porque são coleções distintas.
//   · Conciliação = espelho MP: pagamento aprovado sem cliente e não
//     desconsiderado (finIgnored) é pendência. Vincular/desconsiderar usam o
//     endpoint do MP e o CRUD genérico de mp_payments.
// IA e WhatsApp (custos de APIs externas) ficam FORA deste endpoint de
// propósito: a tela soma pelo /api/expenses/summary do mês corrente — aqui é
// só banco, rápido e testável.

import { monthKey, dayKey, isRealLead, winsIn, tcvOf, customerStartMap, cashCollectedIn } from "./metrics-core.js";

const round2 = (n) => Math.round(n * 100) / 100;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Categorias financeiras das contas a pagar (plano de contas gerencial
// simplificado; os rótulos moram na UI). `expenses` segue com o enum próprio
// (fixo/ferramenta/pessoal/taxas/outros) — o DRE junta os dois.
export const PAYABLE_CATS = ["pessoal", "comissao", "marketing", "ferramenta", "estrutura", "imposto", "taxas", "outros"];

// "2026-08" + dia preferido → data de vencimento válida (fev sem dia 31).
const dueDayIn = (month, day) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const d = Math.min(Math.max(1, Number(day) || 5), last);
  return `${month}-${String(d).padStart(2, "0")}`;
};

const monthsBack = (month, n) => {
  const out = [];
  const d = new Date(`${month}-15T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d); m.setUTCMonth(m.getUTCMonth() - i);
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
};

// Materializa as instâncias dos templates recorrentes pro mês pedido (uma por
// template por mês, idempotente). O template vale do próprio `month` em diante
// até `endMonth` inclusivo — igual à regra do expenses, mas gerando doc por
// mês porque cada ocorrência tem baixa própria.
export async function ensurePayables(repo, saas, month) {
  const all = (await repo.list("payables")).filter((p) => p.saas === saas);
  const templates = all.filter((p) => p.recurring && !p.templateId);
  let created = 0;
  for (const t of templates) {
    if (!(String(t.month) < month)) continue; // o template já É a ocorrência do mês inicial
    if (t.endMonth && String(t.endMonth) < month) continue;
    if (all.some((p) => p.templateId === t.id && p.month === month)) continue;
    await repo.create("payables", {
      saas,
      description: t.description, category: t.category,
      counterpartyType: t.counterpartyType, userId: t.userId || "", supplierName: t.supplierName || "",
      amount: Number(t.amount) || 0,
      month, dueDate: dueDayIn(month, String(t.dueDate || "").slice(8, 10)),
      status: "aberta", paidAt: "", paidVia: "",
      recurring: false, endMonth: "", templateId: t.id, notes: t.notes || "",
      createdAt: new Date().toISOString(),
    });
    created++;
  }
  return created;
}

// Custos da collection expenses num mês, SÓ com o que mora no banco (ads +
// manuais + percentuais). Mesmas regras do /api/expenses/summary; IA/WhatsApp
// (chamadas externas) ficam de fora — a UI soma pelo summary quando precisa.
function expensesOfMonth({ product, expenses, insights, invoices, leads, starts, mp }, month) {
  const applies = (e) => e.recurring
    ? String(e.month) <= month && (!e.endMonth || String(e.endMonth) >= month)
    : e.month === month;
  const ads = round2(insights
    .filter((r) => String(r.date || "").startsWith(month))
    .reduce((a, r) => a + (Number(r.spend) || 0), 0));
  const mine = expenses.filter((e) => applies(e));
  const pctBaseOf = (e) => (e.base === "cartao12x" || e.base === "received" ? e.base : "won");
  const needed = new Set(mine.filter((e) => Number(e.pct) > 0).map(pctBaseOf));
  const bases = { won: 0, cartao12x: 0, received: 0 };
  if (needed.has("won")) {
    const wins = winsIn(product, leads, (iso) => monthKey(iso) === month, starts);
    bases.won = tcvOf(leads.filter((l) => wins.has(l.id)));
  }
  // Base do checkout: o que ENTROU no cartão no mês (espelho MP, aprovados) —
  // a MESMA régua do /api/expenses/summary, senão as duas telas brigam.
  if (needed.has("cartao12x")) {
    bases.cartao12x = round2((mp || [])
      .filter((p) => p.status === "approved" && p.methodType === "credit_card"
        && monthKey(p.dateApproved || p.dateCreated) === month)
      .reduce((a, p) => a + (Number(p.amount) || 0), 0));
  }
  if (needed.has("received")) bases.received = cashCollectedIn(invoices, month);
  const rows = mine.map((e) => (Number(e.pct) > 0
    ? { category: e.category || "outros", amount: round2((Number(e.pct) / 100) * bases[pctBaseOf(e)]) }
    : { category: e.category || "outros", amount: Number(e.amount) || 0 }));
  const total = round2(rows.reduce((a, r) => a + r.amount, 0) + ads);
  return { ads, rows, total };
}

export function registerFinRoutes(app, repo) {
  // A leitura do mês inteira numa chamada: contas a pagar (materializadas),
  // tiles no padrão Conta Azul (Vencidos/Vencem hoje/A vencer/Pagos), contas a
  // receber, pendências de conciliação, fluxo de caixa de 6 meses (realizado +
  // previsto do mês pedido) e DRE por categoria.
  app.get("/api/fin/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const month = MONTH_RE.test(String(req.query.month || "")) ? String(req.query.month) : monthKey(new Date());
    const today = dayKey(new Date());
    const window = monthsBack(month, 6);

    // Materializa a janela inteira: mês pulado (ninguém abriu a tela) não pode
    // sumir com o salário recorrente do fluxo.
    for (const m of window) await ensurePayables(repo, product.id, m);

    const [allPayables, allInvoices, allExpenses, allInsights, allLeads, allCustomers, allMp] = await Promise.all([
      repo.list("payables"), repo.list("invoices"), repo.list("expenses"),
      repo.list("ad_insights"), repo.list("leads"), repo.list("customers"),
      repo.list("mp_payments"),
    ]);
    const payables = allPayables.filter((p) => p.saas === product.id);
    const invoices = allInvoices.filter((i) => i.saas === product.id);
    const mp = allMp.filter((p) => !p.saas || p.saas === product.id);
    const ctx = {
      mp,
      product,
      expenses: allExpenses.filter((e) => e.saas === product.id),
      insights: allInsights.filter((r) => r.saas === product.id),
      invoices,
      leads: allLeads.filter((l) => l.saas === product.id && isRealLead(l)),
      starts: customerStartMap(allCustomers.filter((c) => c.saas === product.id)),
    };

    // ── Fluxo de caixa (realizado): entrada = faturas pagas no mês (a MESMA
    // régua cashCollectedIn do resto do cockpit); saída = contas pagas no mês
    // (pela data da baixa) + custos do mês (competência — regra/automático não
    // tem baixa). O previsto do mês pedido usa vencimento, padrão Conta Azul.
    const paidInMonth = (m) => payables.filter((p) => p.status === "paga" && monthKey(p.paidAt) === m);
    const custosByMonth = Object.fromEntries(window.map((m) => [m, expensesOfMonth(ctx, m)]));
    const fluxo = window.map((m) => ({
      month: m,
      entrada: round2(cashCollectedIn(invoices, m)),
      saida: round2(paidInMonth(m).reduce((a, p) => a + (Number(p.amount) || 0), 0) + custosByMonth[m].total),
    }));

    const abertas = payables.filter((p) => p.status !== "paga");
    const soma = (list) => round2(list.reduce((a, p) => a + (Number(p.amount) || 0), 0));
    const vencidas = abertas.filter((p) => p.dueDate && p.dueDate < today);
    const vencemHoje = abertas.filter((p) => p.dueDate === today);
    const aVencer = abertas.filter((p) => p.month === month && p.dueDate > today);
    const pagasMes = paidInMonth(month);

    // Contas a receber: em aberto é FOTO (tudo que está aberto agora, qualquer
    // mês); o recebido é do mês pedido.
    const openInv = invoices.filter((i) => i.status === "open" || i.status === "overdue");
    const invVencidas = openInv.filter((i) => i.dueDate && dayKey(i.dueDate) < today);
    const somaInv = (list) => round2(list.reduce((a, i) => a + (Number(i.amount) || 0), 0));
    const recebidosMes = round2(cashCollectedIn(invoices, month));

    // Conciliação: pagamento aprovado do espelho sem cliente e não
    // desconsiderado = pendência (não dá pra fechar o mês com dinheiro sem dono).
    const pendentes = mp.filter((p) => p.status === "approved" && !p.customer && !p.finIgnored);
    const espelhoMes = mp.filter((p) => p.status === "approved" && monthKey(p.dateApproved || p.dateCreated) === month);

    // ── DRE do mês: receita por tipo de fatura (regime de caixa, paidAt no
    // mês) e despesa por categoria (contas a pagar por competência + expenses
    // + mídia paga). Deduções (taxas/imposto) separadas na UI pela categoria.
    const receita = {};
    for (const i of invoices.filter((x) => x.status === "paid" && monthKey(x.paidAt) === month)) {
      const k = i.kind || "manual";
      receita[k] = round2((receita[k] || 0) + (Number(i.amount) || 0));
    }
    const despesas = {};
    const addDesp = (cat, v) => { if (v > 0) despesas[cat] = round2((despesas[cat] || 0) + v); };
    for (const p of payables.filter((x) => x.month === month)) addDesp(p.category || "outros", Number(p.amount) || 0);
    for (const r of custosByMonth[month].rows) addDesp(r.category, r.amount);
    addDesp("ads", custosByMonth[month].ads);

    const despesasMes = round2(Object.values(despesas).reduce((a, v) => a + v, 0));
    return {
      month, today,
      payables: payables
        .filter((p) => p.month === month || (p.status !== "paga" && p.dueDate && p.dueDate < today))
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
      tiles: {
        vencidos: { n: vencidas.length, total: soma(vencidas) },
        vencemHoje: { n: vencemHoje.length, total: soma(vencemHoje) },
        aVencer: { n: aVencer.length, total: soma(aVencer) },
        pagos: { n: pagasMes.length, total: soma(pagasMes) },
      },
      receber: {
        recebidosMes,
        emAberto: { n: openInv.length, total: somaInv(openInv) },
        vencidas: { n: invVencidas.length, total: somaInv(invVencidas) },
      },
      conciliacao: {
        pendentes: { n: pendentes.length, total: round2(pendentes.reduce((a, p) => a + (Number(p.amount) || 0), 0)) },
        espelhoMes: round2(espelhoMes.reduce((a, p) => a + (Number(p.amount) || 0), 0)),
        ignoradas: mp.filter((p) => p.finIgnored).length,
      },
      fluxo,
      previsto: {
        entrada: somaInv(openInv.filter((i) => monthKey(i.dueDate) === month)),
        saida: round2(soma(abertas.filter((p) => p.month === month)) + custosByMonth[month].total),
      },
      dre: { receita, despesas, despesasMes, resultado: round2(recebidosMes - despesasMes) },
    };
  });
}
