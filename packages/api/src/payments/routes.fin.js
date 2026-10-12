// Financeiro completo — a leitura ÚNICA do mês, no modelo Conta Azul + P&L de
// SaaS (setores COGS / S&M / R&D / G&A com margem bruta):
//   · RECEBIDO = metrics-core.cashIn, a régua única do caixa (pagamento de
//     cliente aprovado no espelho do MP + fatura baixada com prova; a fatura
//     que nasceu paga no fechamento é PRESUMIDA e fica em balde próprio).
//   · Contas a PAGAR = `payables`: competência, vencimento, situação, favorecido
//     (colaborador → Folha, fornecedor), categoria com SETOR; recorrência no
//     padrão fatura (template + instância por mês — payables.js, materializada
//     pelo tick do billing e pelo POST /materialize, nunca pelo GET).
//   · CONCILIAÇÃO com APRENDIZADO: `fin_rules` — quando o Leo vincula ou
//     desconsidera um pagador e pede pra lembrar, vira regra; o ingest do
//     espelho aplica nas chegadas e o POST /rules/apply nas pendências. O GET
//     só LÊ: pendência sem regra ganha SUGESTÃO (fatura aberta de valor igual /
//     nome parecido) — sugestão é sugestão, nunca vínculo automático.
//   · Espelho do MP classificado (mp-classify.js): só venda/maquininha soma;
//     reserva interna, saída paga com o saldo e ruído ficam em baldes próprios.
//   · SAÍDAS da conta MP = `mp_movements`, importadas do settlement report
//     (mp-outflow.js) — conciliação por valor+data contra as contas a pagar.
//   · Custos automáticos/percentuais seguem em `expenses` (aba Custos) e
//     entram no fluxo/DRE por competência; IA e WhatsApp (APIs externas) ficam
//     fora deste endpoint de propósito — a UI soma pelo /api/expenses/summary e
//     desconta do `dre.resultado` daqui (uma fórmula só).

import { monthKey, dayKey, isSaleLead, winsIn, tcvOf, customerStartMap, cashIn, card12xBaseIn, mpFeesIn, PCT_BASES, upsellSalesIn, upsellContractedOf } from "../metrics/metrics-core.js";
import { applyFinRulesToPending } from "./mp-payments.js";
import { isMpSale, SALE_KINDS } from "./mp-classify.js";
import { normalizeRuleValue, ruleMatches, rulesFor } from "./fin-rules.js";
import { ensurePayables, missingInstances } from "./payables.js";
import { round2, syncMpOutflows } from "./mp-outflow.js";

export { ensurePayables, normalizeRuleValue };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ── Plano de categorias por SETOR (P&L de SaaS adaptado ao Brasil) ───────────
// deducoes = impostos sobre a receita (DAS) · cogs = custo de entregar o
// serviço (infra, APIs, suporte, taxas de pagamento) · sm = vendas & marketing
// · rd = produto & desenvolvimento · ga = administrativo. Ids legados das duas
// coleções (expenses e payables v1) mapeados pra não órfãozar lançamento velho.
export const CAT_SECTOR = {
  imposto: "deducoes",
  infra: "cogs", apis: "cogs", suporte: "cogs", taxas: "cogs", ia: "cogs", wa: "cogs",
  ads: "sm", midia: "sm", pessoal_com: "sm", comissao: "sm", mkt: "sm", marketing: "sm",
  pessoal_dev: "rd", dev: "rd",
  prolabore: "ga", pessoal_adm: "ga", contab: "ga", escritorio: "ga", bancos: "ga", outros: "ga",
  fixo: "ga", ferramenta: "ga", pessoal: "ga", estrutura: "ga",
};
export const sectorOf = (cat) => CAT_SECTOR[cat] || "ga";
const SECTOR_KEYS = ["deducoes", "cogs", "sm", "rd", "ga"];

const monthsBack = (month, n) => {
  const out = [];
  const d = new Date(`${month}-15T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d); m.setUTCMonth(m.getUTCMonth() - i);
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
};

// Custos da collection expenses num mês, SÓ com o que mora no banco (ads +
// manuais + percentuais). Mesmas regras do /api/expenses/summary (base `won`
// inclui o upsell, como lá); IA/WhatsApp (chamadas externas) ficam de fora —
// a UI soma pelo summary. Cada linha ecoa `pctBase` pro DRE setorizar:
// imposto (received) é dedução da receita; checkout/taxa real é COGS.
function expensesOfMonth({ product, expenses, insights, invoices, leads, starts, mp, customers }, month) {
  const applies = (e) => e.recurring
    ? String(e.month) <= month && (!e.endMonth || String(e.endMonth) >= month)
    : e.month === month;
  const inMonth = (iso) => monthKey(iso) === month;
  const ads = round2(insights
    .filter((r) => String(r.date || "").startsWith(month))
    .reduce((a, r) => a + (Number(r.spend) || 0), 0));
  const mine = expenses.filter((e) => applies(e));
  const pctBaseOf = (e) => (PCT_BASES.has(e.base) ? e.base : "won");
  const needed = new Set(mine.filter((e) => Number(e.pct) > 0).map(pctBaseOf));
  const bases = { won: 0, cartao12x: 0, received: 0, taxa_real: 0 };
  if (needed.has("won")) {
    const wins = winsIn(product, leads, inMonth, starts);
    const upsells = upsellSalesIn(invoices, inMonth, { saas: product.id });
    bases.won = round2(tcvOf(leads.filter((l) => wins.has(l.id))) + upsellContractedOf(upsells));
  }
  if (needed.has("cartao12x")) bases.cartao12x = card12xBaseIn(mp, month);
  if (needed.has("received")) bases.received = cashIn({ customers, invoices, mpPayments: mp, saas: product.id, inWin: inMonth }).total;
  const rows = mine.map((e) => {
    if (!(Number(e.pct) > 0)) return { category: e.category || "outros", pctBase: "", amount: Number(e.amount) || 0 };
    const base = pctBaseOf(e);
    // taxa_real: o valor É a taxa que o MP descontou (feeAmount do espelho);
    // o % do lançamento só serve de fallback pra pagamento sem líquido.
    const amount = base === "taxa_real"
      ? mpFeesIn(mp, month, { fallbackPct: Number(e.pct) })
      : round2((Number(e.pct) / 100) * bases[base]);
    return { category: e.category || "outros", pctBase: base, amount };
  });
  const total = round2(rows.reduce((a, r) => a + r.amount, 0) + ads);
  return { ads, rows, total };
}

export function registerFinRoutes(app, repo, { mp, discord } = {}) {
  // A leitura do mês inteira numa chamada, SEM efeito colateral: contas a
  // pagar, tiles, receber (com o presumido), conciliação (com sugestões),
  // fluxo de 6 meses e DRE por setor.
  app.get("/api/fin/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const month = MONTH_RE.test(String(req.query.month || "")) ? String(req.query.month) : monthKey(new Date());
    const today = dayKey(new Date());
    const window = monthsBack(month, 6);

    const [allPayables, allInvoices, allExpenses, allInsights, allLeads, allCustomers, allMp, allRules, allMovs] = await Promise.all([
      repo.list("payables"), repo.list("invoices"), repo.list("expenses"),
      repo.list("ad_insights"), repo.list("leads"), repo.list("customers"),
      repo.list("mp_payments"), repo.list("fin_rules"), repo.list("mp_movements"),
    ]);
    const payables = allPayables.filter((p) => p.saas === product.id);
    const invoices = allInvoices.filter((i) => i.saas === product.id);
    const customers = allCustomers.filter((c) => c.saas === product.id);
    // Espelho do produto: vinculado a ele, ou ainda sem dono (saas vazio).
    // `espelho` = dinheiro de cliente (venda/maquininha); o resto fica em
    // baldes próprios da conciliação e NUNCA soma como recebido.
    const espelhoTodo = allMp.filter((p) => !p.saas || p.saas === product.id);
    const espelho = espelhoTodo.filter((p) => !p.kind || SALE_KINDS.has(p.kind));
    const kindBucket = (kind) => espelhoTodo.filter((p) => p.status === "approved" && p.kind === kind && !p.finIgnored);
    const somaMp = (list) => round2(list.reduce((a, p) => a + (Number(p.amount) || 0), 0));
    const ctx = {
      product,
      mp: espelho,
      customers,
      expenses: allExpenses.filter((e) => e.saas === product.id),
      insights: allInsights.filter((r) => r.saas === product.id),
      invoices,
      // Base do VENDIDO no Financeiro (custo % e DRE): a mentoria entra como
      // venda normal (Leo, 16/08).
      leads: allLeads.filter((l) => l.saas === product.id && isSaleLead(l)),
      starts: customerStartMap(customers),
    };

    // ── Caixa por mês: a régua única (cashIn) ───────────────────────────────
    const caixaDe = (m) => cashIn({ customers, invoices, mpPayments: allMp, saas: product.id, inWin: (iso) => monthKey(iso) === m });
    const caixaMes = caixaDe(month);
    const recebidosMes = caixaMes.total;

    // ── Fluxo de caixa: entrada = caixa; saída = contas pagas (baixa) +
    // custos do mês (competência). Previsto do mês pedido usa vencimento.
    const paidInMonth = (m) => payables.filter((p) => p.status === "paga" && monthKey(p.paidAt) === m);
    const custosByMonth = Object.fromEntries(window.map((m) => [m, expensesOfMonth(ctx, m)]));
    const fluxo = window.map((m) => ({
      month: m,
      entrada: m === month ? recebidosMes : caixaDe(m).total,
      saida: round2(paidInMonth(m).reduce((a, p) => a + (Number(p.amount) || 0), 0) + custosByMonth[m].total),
    }));

    const abertas = payables.filter((p) => p.status !== "paga");
    const soma = (list) => round2(list.reduce((a, p) => a + (Number(p.amount) || 0), 0));
    const vencidas = abertas.filter((p) => p.dueDate && p.dueDate < today);
    const vencemHoje = abertas.filter((p) => p.dueDate === today);
    const aVencer = abertas.filter((p) => p.month === month && p.dueDate > today);
    const pagasMes = paidInMonth(month);

    const openInv = invoices.filter((i) => i.status === "open" || i.status === "overdue");
    const invVencidas = openInv.filter((i) => i.dueDate && dayKey(i.dueDate) < today);
    const somaInv = (list) => round2(list.reduce((a, i) => a + (Number(i.amount) || 0), 0));

    // Presumido = fatura que nasceu paga no fechamento à vista e ninguém
    // provou (nem o MP casou, nem baixa com data/meio). Lista inteira do
    // produto (não só do mês) pra confirmação 1 a 1 na tela.
    const presumidoTodo = cashIn({ customers, invoices, mpPayments: allMp, saas: product.id }).presumido;
    const nameOf = new Map(customers.map((c) => [c.id, c.name || c.contact || ""]));
    const presumido = {
      mes: { n: caixaMes.presumido.n, total: caixaMes.presumido.total },
      n: presumidoTodo.n, total: presumidoTodo.total,
      items: presumidoTodo.items
        .map((i) => ({ ...i, customerName: nameOf.get(i.customer) || "" }))
        .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)))
        .slice(0, 200),
    };

    // ── Conciliação: pendência COM SUGESTÃO (só leitura) ───────────────────
    const pendentes = espelho.filter((p) => isMpSale(p) && !p.customer);
    const espelhoMes = espelho.filter((p) => isMpSale(p) && monthKey(p.dateApproved || p.dateCreated) === month);
    const internas = kindBucket("interna"), saidasMp = kindBucket("saida"), ruido = kindBucket("ruido");
    const heuristicas = espelhoTodo.filter((p) => p.status === "approved" && p.kindSource === "heuristic").length;
    const rules = rulesFor(allRules, product.id);
    const regrasPendentes = pendentes.filter((p) => rules.some((r) => ruleMatches(r, p))).length;
    const sugestoes = {};
    const normName = (v) => normalizeRuleValue("payerName", v);
    for (const p of pendentes) {
      const fatura = openInv.find((i) => Math.abs((Number(i.amount) || 0) - (Number(p.amount) || 0)) <= 0.01);
      if (fatura) {
        const c = customers.find((x) => x.id === fatura.customer);
        sugestoes[p.id] = { customer: fatura.customer, invoiceId: fatura.id, motivo: `fatura aberta de ${c?.name || "cliente"} com o mesmo valor` };
        continue;
      }
      const nome = normName(p.payerName);
      if (nome.length >= 5) {
        const c = customers.find((x) => {
          const cn = normName(x.name);
          return cn.length >= 5 && (cn.includes(nome) || nome.includes(cn));
        });
        if (c) sugestoes[p.id] = { customer: c.id, motivo: `nome parecido com ${c.name}` };
      }
    }

    // Saídas da conta MP (settlement report) ainda sem dono.
    const movsPend = allMovs.filter((m) => !m.payableId && !m.finIgnored);

    // ── DRE por SETOR: receita por tipo de fatura (caixa, a MESMA régua do
    // recebido) → deduções → COGS (margem bruta) → S&M → R&D → G&A.
    // Percentuais setorizam pela BASE: imposto (received) é dedução; checkout /
    // taxa real do MP é taxa de pagamento (COGS).
    const receita = { ...caixaMes.byKind };
    const setores = Object.fromEntries(SECTOR_KEYS.map((k) => [k, {}]));
    const addSet = (sector, cat, v) => { if (v > 0) setores[sector][cat] = round2((setores[sector][cat] || 0) + v); };
    for (const p of payables.filter((x) => x.month === month)) addSet(sectorOf(p.category), p.category || "outros", Number(p.amount) || 0);
    for (const r of custosByMonth[month].rows) {
      if (r.pctBase === "received") addSet("deducoes", "imposto", r.amount);
      else if (r.pctBase === "cartao12x" || r.pctBase === "taxa_real") addSet("cogs", "taxas", r.amount);
      else addSet(sectorOf(r.category), r.category || "outros", r.amount);
    }
    addSet("sm", "ads", custosByMonth[month].ads);
    const somaSetor = (k) => round2(Object.values(setores[k]).reduce((x, v) => x + v, 0));
    const despesasMes = round2(SECTOR_KEYS.reduce((a, k) => a + somaSetor(k), 0));
    const receitaLiquida = round2(recebidosMes - somaSetor("deducoes"));
    const lucroBruto = round2(receitaLiquida - somaSetor("cogs"));

    return {
      month, today,
      payables: payables
        .filter((p) => p.month === month || (p.status !== "paga" && p.dueDate && p.dueDate < today))
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
      // Templates recorrentes sem instância neste mês: a tela chama o POST
      // /materialize (o GET não cria nada).
      payablesMissing: missingInstances(allPayables, product.id, month).length,
      tiles: {
        vencidos: { n: vencidas.length, total: soma(vencidas) },
        vencemHoje: { n: vencemHoje.length, total: soma(vencemHoje) },
        aVencer: { n: aVencer.length, total: soma(aVencer) },
        pagos: { n: pagasMes.length, total: soma(pagasMes) },
      },
      receber: {
        recebidosMes,
        presumido,
        emAberto: { n: openInv.length, total: somaInv(openInv) },
        vencidas: { n: invVencidas.length, total: somaInv(invVencidas) },
      },
      conciliacao: {
        pendentes: { n: pendentes.length, total: somaMp(pendentes) },
        espelhoMes: somaMp(espelhoMes),
        taxasMes: mpFeesIn(espelho, month),
        // O que o espelho traz e NÃO é venda: reserva/transferência da própria
        // casa, pagamento feito com o saldo (vira conta a pagar) e ruído.
        internas: { n: internas.length, total: somaMp(internas) },
        saidasMp: { n: saidasMp.length, total: somaMp(saidasMp) },
        ruido: { n: ruido.length, total: somaMp(ruido) },
        heuristicas,
        ignoradas: espelhoTodo.filter((p) => p.finIgnored).length,
        regras: rules.length,
        regrasPendentes,
        sugestoes,
        saidasPendentes: { n: movsPend.length, total: round2(movsPend.reduce((a, m) => a + (Number(m.amount) || 0), 0)) },
      },
      fluxo,
      previsto: {
        entrada: somaInv(openInv.filter((i) => monthKey(i.dueDate) === month)),
        saida: round2(soma(abertas.filter((p) => p.month === month)) + custosByMonth[month].total),
      },
      // Uma fórmula só (a UI não recalcula): resultado = recebido − despesas
      // do banco. IA/WhatsApp vêm do /api/expenses/summary e a UI desconta
      // dos dois (despesasMes e resultado) — mesmo número nas duas telas.
      dre: {
        receita, receitaTotal: recebidosMes, setores,
        deducoes: somaSetor("deducoes"), receitaLiquida, cogs: somaSetor("cogs"), lucroBruto,
        margemBruta: recebidosMes > 0 ? round2(lucroBruto / recebidosMes) : null,
        sm: somaSetor("sm"), rd: somaSetor("rd"), ga: somaSetor("ga"),
        despesasMes, resultado: round2(recebidosMes - despesasMes),
      },
    };
  });

  // Materializa as contas a pagar recorrentes do mês (e dos 5 anteriores, a
  // janela do fluxo). Idempotente por id determinístico (payables.js).
  app.post("/api/fin/:saas/materialize", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const month = MONTH_RE.test(String(req.query.month || "")) ? String(req.query.month) : monthKey(new Date());
    let created = 0;
    for (const m of monthsBack(month, 6)) created += await ensurePayables(repo, product.id, m);
    return { ok: true, month, created };
  });

  // Aplica as regras aprendidas nas pendências do espelho (o mesmo que o
  // ingest faz quando o pagamento chega). Vincular dá a mesma baixa do manual.
  app.post("/api/fin/:saas/rules/apply", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    return { ok: true, ...(await applyFinRulesToPending(repo, { saas: product.id, discord, log: req.log })) };
  });

  // Importa as SAÍDAS da conta MP (settlement report "Dinheiro em conta").
  // Assíncrono do lado do MP: importa os arquivos prontos e, se não houver
  // relatório fresco (24h), pede um novo — a próxima sincronização traz.
  app.post("/api/fin/:saas/mp-out/sync", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    if (!mp?.configured?.()) return reply.code(400).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
    try {
      return await syncMpOutflows(repo, mp, { log: req.log });
    } catch (e) {
      // Serviço externo falhou → 4xx SEMPRE (5xx vira "Service is not
      // reachable" atrás do proxy do EasyPanel e a mensagem some).
      return reply.code(400).send({ error: `Mercado Pago: ${String(e.message || e).slice(0, 200)}` });
    }
  });
}
