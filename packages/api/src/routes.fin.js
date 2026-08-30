// Financeiro completo — a leitura ÚNICA do mês, no modelo Conta Azul + P&L de
// SaaS (setores COGS / S&M / R&D / G&A com margem bruta):
//   · Contas a RECEBER = invoices (régua existente, baixa automática pelo MP).
//   · Contas a PAGAR = `payables`: competência, vencimento, situação, favorecido
//     (colaborador → Folha, fornecedor), categoria com SETOR; recorrência no
//     padrão fatura (template + instância por mês, ensurePayables).
//   · CONCILIAÇÃO com APRENDIZADO: `fin_rules` — quando o Leo vincula ou
//     desconsidera um pagador e pede pra lembrar, vira regra; toda leitura
//     aplica as regras nas pendências sozinha (vincular dispara a MESMA baixa
//     do vínculo manual) e o mesmo pagador nunca mais é perguntado. Pendência
//     sem regra ganha SUGESTÃO (fatura aberta de valor igual / nome parecido).
//   · SAÍDAS da conta MP = `mp_movements`, importadas do settlement report
//     ("Dinheiro em conta", a única janela da API pra saque/transferência:
//     CSV assíncrono, tipos WITHDRAWAL/PAYOUT, SEM identidade do favorecido —
//     conciliação por valor+data contra as contas a pagar).
//   · Custos automáticos/percentuais seguem em `expenses` (aba Custos) e
//     entram no fluxo/DRE por competência; IA e WhatsApp (APIs externas) ficam
//     fora deste endpoint de propósito — a UI soma pelo /api/expenses/summary.

import { monthKey, dayKey, isSaleLead, winsIn, tcvOf, customerStartMap, cashCollectedIn, card12xBaseIn, paymentMethodOf } from "./metrics-core.js";
import { settleTarget, settleInvoice } from "./mp-payments.js";

const round2 = (n) => Math.round(n * 100) / 100;
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
// até `endMonth` inclusivo — cada ocorrência tem baixa própria.
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
// Cada linha ecoa `pctBase` pro DRE setorizar: imposto (received) é dedução da
// receita; checkout (cartao12x) é taxa de pagamento (COGS).
function expensesOfMonth({ product, expenses, insights, invoices, leads, starts, mp, methodOf }, month) {
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
  // Base do checkout: dinheiro de cartão que ENTROU no mês (espelho MP, D+0)
  // — card12xBaseIn é a MESMA régua do /api/expenses/summary.
  if (needed.has("cartao12x")) bases.cartao12x = card12xBaseIn(mp, month);
  if (needed.has("received")) bases.received = cashCollectedIn(invoices, month, methodOf);
  const rows = mine.map((e) => (Number(e.pct) > 0
    ? { category: e.category || "outros", pctBase: pctBaseOf(e), amount: round2((Number(e.pct) / 100) * bases[pctBaseOf(e)]) }
    : { category: e.category || "outros", pctBase: "", amount: Number(e.amount) || 0 }));
  const total = round2(rows.reduce((a, r) => a + r.amount, 0) + ads);
  return { ads, rows, total };
}

// ── Regras de conciliação aprendidas ─────────────────────────────────────────
// Identidade do pagador em ordem de força: documento > e-mail > nome. A regra
// guarda o valor NORMALIZADO e casa contra o pagamento normalizado igual.
const NORM = {
  payerDoc: (v) => String(v || "").replace(/\D+/g, ""),
  payerEmail: (v) => String(v || "").trim().toLowerCase(),
  payerName: (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " "),
};
export const normalizeRuleValue = (field, value) => (NORM[field] ? NORM[field](value) : "");
const ruleMatches = (r, p) => {
  const f = NORM[r.matchField];
  if (!f) return false;
  const v = f(r.matchValue);
  return !!v && v === f(p[r.matchField]);
};

// ── Settlement report CSV → movimentos de saída ──────────────────────────────
// Header em qualquer ordem, delimitador ; ou , — só WITHDRAWAL/PAYOUT viram
// movimento (o dinheiro que SAIU: saque pra conta bancária ou pix enviado).
export function parseSettlementCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const split = (line) => line.split(delim).map((c) => c.replace(/^"|"$/g, "").trim());
  const header = split(lines[0]).map((h) => h.toUpperCase());
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const iType = col("TRANSACTION_TYPE", "RECORD_TYPE", "DESCRIPTION");
  const iDate = col("TRANSACTION_DATE", "SETTLEMENT_DATE", "MONEY_RELEASE_DATE", "DATE");
  const iId = col("SOURCE_ID", "EXTERNAL_ID", "REFERENCE_ID", "TRANSACTION_ID");
  const iNet = col("SETTLEMENT_NET_AMOUNT", "NET_DEBIT_AMOUNT", "TRANSACTION_AMOUNT", "GROSS_AMOUNT", "REAL_AMOUNT");
  const iFee = col("FEE_AMOUNT");
  if (iType < 0 || iNet < 0) return [];
  // "1.234,56" (pt-BR) e "1234.56" viram número; sinal não importa (saída).
  const num = (v) => {
    const s = String(v || "").trim();
    const br = s.includes(",");
    return Math.abs(Number(br ? s.replace(/\./g, "").replace(",", ".") : s)) || 0;
  };
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const type = String(cells[iType] || "").toUpperCase();
    if (type !== "WITHDRAWAL" && type !== "PAYOUT") continue;
    const amount = num(cells[iNet]);
    if (!(amount > 0)) continue;
    const date = String(iDate >= 0 ? cells[iDate] : "").slice(0, 10);
    const sourceId = String(iId >= 0 ? cells[iId] : "").trim() || `${type}_${date}_${amount}`;
    out.push({ sourceId, type, date, amount: round2(amount), fee: iFee >= 0 ? round2(num(cells[iFee])) : 0 });
  }
  return out;
}

export function registerFinRoutes(app, repo, { mp } = {}) {
  // A leitura do mês inteira numa chamada: aplica as regras de conciliação nas
  // pendências, materializa recorrências, e devolve contas a pagar, tiles,
  // receber, conciliação (com sugestões), fluxo de 6 meses e DRE por setor.
  app.get("/api/fin/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const month = MONTH_RE.test(String(req.query.month || "")) ? String(req.query.month) : monthKey(new Date());
    const today = dayKey(new Date());
    const window = monthsBack(month, 6);

    for (const m of window) await ensurePayables(repo, product.id, m);

    const [allPayables, allInvoices, allExpenses, allInsights, allLeads, allCustomers, allMp, allRules, allMovs] = await Promise.all([
      repo.list("payables"), repo.list("invoices"), repo.list("expenses"),
      repo.list("ad_insights"), repo.list("leads"), repo.list("customers"),
      repo.list("mp_payments"), repo.list("fin_rules"), repo.list("mp_movements"),
    ]);
    const payables = allPayables.filter((p) => p.saas === product.id);
    const invoices = allInvoices.filter((i) => i.saas === product.id);
    const espelho = allMp.filter((p) => !p.saas || p.saas === product.id);
    const customers = allCustomers.filter((c) => c.saas === product.id);
    const ctx = {
      product,
      mp: espelho,
      expenses: allExpenses.filter((e) => e.saas === product.id),
      insights: allInsights.filter((r) => r.saas === product.id),
      invoices,
      // Base do VENDIDO no Financeiro (custo % e DRE): a mentoria entra como
      // venda normal (Leo, 16/08).
      leads: allLeads.filter((l) => l.saas === product.id && isSaleLead(l)),
      starts: customerStartMap(customers),
      // Meio de pagamento por cliente: a fatura que nasce paga no fechamento só
      // é RECEBIDO no à vista/cartão 12x (metrics-core.isRealReceipt).
      methodOf: paymentMethodOf(customers),
    };

    // ── Regras aprendidas nas pendências: o mesmo pagador não pergunta 2x. ───
    const rules = allRules.filter((r) => !r.saas || r.saas === product.id);
    let autoAplicadas = 0;
    for (const p of espelho) {
      if (!rules.length) break;
      if (p.status !== "approved" || p.customer || p.finIgnored) continue;
      const rule = rules.find((r) => ruleMatches(r, p));
      if (!rule) continue;
      if (rule.action === "desconsiderar") {
        await repo.update("mp_payments", p.id, { finIgnored: true, finIgnoredReason: rule.reason || "regra", finRuleId: rule.id }, { silent: true });
        p.finIgnored = true; p.finIgnoredReason = rule.reason || "regra";
      } else if (rule.action === "vincular" && rule.customer) {
        await repo.update("mp_payments", p.id, { customer: rule.customer, matchedBy: "rule", finRuleId: rule.id }, { silent: true });
        p.customer = rule.customer; p.matchedBy = "rule";
        // Baixa automática pela MESMA régua do vínculo manual: fatura aberta
        // única com valor exato (settleTarget) — idempotente pelo mpPaymentId.
        if (p.mpId && !invoices.some((i) => i.mpPaymentId === p.mpId)) {
          const alvo = settleTarget(invoices, { customer: rule.customer }, p);
          if (alvo) {
            // settleInvoice fala o dialeto CRU da API do MP — traduz do espelho.
            await settleInvoice(repo, alvo, {
              id: p.mpId, date_approved: p.dateApproved, date_created: p.dateCreated,
              payment_method_id: p.method, payment_type_id: p.methodType, installments: p.installments,
            }, {});
            alvo.status = "paid"; alvo.paidAt = p.dateApproved || new Date().toISOString(); alvo.mpPaymentId = p.mpId;
          }
        }
      } else {
        continue;
      }
      await repo.update("fin_rules", rule.id, { autoCount: (Number(rule.autoCount) || 0) + 1, lastAppliedAt: new Date().toISOString() }, { silent: true });
      autoAplicadas++;
    }

    // ── Fluxo de caixa: entrada = faturas pagas; saída = contas pagas (baixa)
    // + custos do mês (competência). Previsto do mês pedido usa vencimento.
    const paidInMonth = (m) => payables.filter((p) => p.status === "paga" && monthKey(p.paidAt) === m);
    const custosByMonth = Object.fromEntries(window.map((m) => [m, expensesOfMonth(ctx, m)]));
    const fluxo = window.map((m) => ({
      month: m,
      entrada: round2(cashCollectedIn(invoices, m, ctx.methodOf)),
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
    const recebidosMes = round2(cashCollectedIn(invoices, month, ctx.methodOf));

    // ── Conciliação: o que sobrou sem regra vira pendência COM SUGESTÃO ──────
    const pendentes = espelho.filter((p) => p.status === "approved" && !p.customer && !p.finIgnored);
    const espelhoMes = espelho.filter((p) => p.status === "approved" && monthKey(p.dateApproved || p.dateCreated) === month);
    const sugestoes = {};
    for (const p of pendentes) {
      const fatura = openInv.find((i) => Math.abs((Number(i.amount) || 0) - (Number(p.amount) || 0)) <= 0.01);
      if (fatura) {
        const c = customers.find((x) => x.id === fatura.customer);
        sugestoes[p.id] = { customer: fatura.customer, invoiceId: fatura.id, motivo: `fatura aberta de ${c?.name || "cliente"} com o mesmo valor` };
        continue;
      }
      const nome = NORM.payerName(p.payerName);
      if (nome.length >= 5) {
        const c = customers.find((x) => {
          const cn = NORM.payerName(x.name);
          return cn.length >= 5 && (cn.includes(nome) || nome.includes(cn));
        });
        if (c) sugestoes[p.id] = { customer: c.id, motivo: `nome parecido com ${c.name}` };
      }
    }

    // Saídas da conta MP (settlement report) ainda sem dono.
    const movsPend = allMovs.filter((m) => !m.payableId && !m.finIgnored);

    // ── DRE por SETOR: receita por tipo de fatura (caixa) → deduções → COGS
    // (margem bruta na UI) → S&M → R&D → G&A. Percentuais setorizam pela BASE:
    // imposto (received) é dedução; checkout (cartao12x) é taxa de pagamento.
    const receita = {};
    for (const i of invoices.filter((x) => x.status === "paid" && monthKey(x.paidAt) === month)) {
      const k = i.kind || "manual";
      receita[k] = round2((receita[k] || 0) + (Number(i.amount) || 0));
    }
    const setores = Object.fromEntries(SECTOR_KEYS.map((k) => [k, {}]));
    const addSet = (sector, cat, v) => { if (v > 0) setores[sector][cat] = round2((setores[sector][cat] || 0) + v); };
    for (const p of payables.filter((x) => x.month === month)) addSet(sectorOf(p.category), p.category || "outros", Number(p.amount) || 0);
    for (const r of custosByMonth[month].rows) {
      if (r.pctBase === "received") addSet("deducoes", "imposto", r.amount);
      else if (r.pctBase === "cartao12x") addSet("cogs", "taxas", r.amount);
      else addSet(sectorOf(r.category), r.category || "outros", r.amount);
    }
    addSet("sm", "ads", custosByMonth[month].ads);
    const despesasMes = round2(SECTOR_KEYS.reduce((a, k) => a + Object.values(setores[k]).reduce((x, v) => x + v, 0), 0));

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
        ignoradas: espelho.filter((p) => p.finIgnored).length,
        autoAplicadas,
        regras: rules.length,
        sugestoes,
        saidasPendentes: { n: movsPend.length, total: round2(movsPend.reduce((a, m) => a + (Number(m.amount) || 0), 0)) },
      },
      fluxo,
      previsto: {
        entrada: somaInv(openInv.filter((i) => monthKey(i.dueDate) === month)),
        saida: round2(soma(abertas.filter((p) => p.month === month)) + custosByMonth[month].total),
      },
      dre: { receita, setores, despesasMes, resultado: round2(recebidosMes - despesasMes) },
    };
  });

  // Importa as SAÍDAS da conta MP (settlement report "Dinheiro em conta").
  // Assíncrono do lado do MP: importa os arquivos prontos e, se não houver
  // relatório fresco (24h), pede um novo — a próxima sincronização traz.
  app.post("/api/fin/:saas/mp-out/sync", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    if (!mp?.configured?.()) return reply.code(400).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
    try {
      const listRaw = await mp.settlementReportList();
      const files = (Array.isArray(listRaw) ? listRaw : listRaw?.files || listRaw?.results || [])
        .map((x) => ({ name: x.file_name || x.fileName || x.name || "", createdAt: x.date_created || x.created_at || x.createdAt || "" }))
        .filter((x) => x.name);
      files.sort((a, b) => String(b.createdAt || b.name).localeCompare(String(a.createdAt || a.name)));
      const byId = new Set((await repo.list("mp_movements")).map((m) => m.id));
      let imported = 0, filesRead = 0;
      for (const f of files.slice(0, 3)) {
        const text = await mp.settlementReportDownload(f.name).catch(() => null);
        if (!text) continue;
        filesRead++;
        for (const row of parseSettlementCsv(text)) {
          const id = `mov_${row.sourceId}`;
          if (byId.has(id)) continue;
          byId.add(id);
          await repo.create("mp_movements", {
            id, saas: "", type: row.type, date: row.date, amount: row.amount, fee: row.fee,
            fileName: f.name, payableId: "", finIgnored: false, createdAt: new Date().toISOString(),
          });
          imported++;
        }
      }
      const DAY = 86_400_000;
      const fresh = files.some((f) => f.createdAt && Date.now() - new Date(f.createdAt).getTime() < DAY);
      let requested = false;
      let requestError = "";
      if (!fresh) {
        const end = new Date();
        const begin = new Date(end.getTime() - 59 * DAY); // teto da API: 60 dias por relatório
        // O pedido do relatório NÃO pode falhar em silêncio: foi assim que a
        // tela ficou meses dizendo "sincronize de novo" com zero relatório
        // gerado do lado do MP. Conta sem a CONFIG do settlement report recusa
        // o create — tenta criar uma config mínima e pedir de novo; persistindo
        // o erro, ele vai na resposta pra aparecer na tela.
        try {
          await mp.settlementReportCreate(begin.toISOString(), end.toISOString());
          requested = true;
        } catch (err1) {
          try {
            // O MP valida `columns` e `frequency` como OBRIGATÓRIOS na config
            // (erro real de 30/08: "Columns: required · Frequency: required").
            // As colunas são as que o parseSettlementCsv lê + contexto útil;
            // frequency é exigida mesmo sem agendamento ligado.
            await mp.settlementReportConfigCreate({
              file_name_prefix: "cockpit-settlement",
              display_timezone: "GMT-03",
              columns: [
                { key: "TRANSACTION_TYPE" }, { key: "TRANSACTION_DATE" }, { key: "SOURCE_ID" },
                { key: "SETTLEMENT_NET_AMOUNT" }, { key: "FEE_AMOUNT" },
                { key: "TRANSACTION_AMOUNT" }, { key: "EXTERNAL_REFERENCE" }, { key: "PAYMENT_METHOD" },
              ],
              frequency: { hour: 3, type: "daily", value: 0 },
            });
            await mp.settlementReportCreate(begin.toISOString(), end.toISOString());
            requested = true;
          } catch (err2) {
            requestError = String(err1?.message || err1).slice(0, 300);
            const second = String(err2?.message || err2).slice(0, 200);
            if (second && second !== requestError) requestError += ` · após criar config: ${second}`;
            req.log.warn({ err: requestError }, "MP settlement: pedido de relatório falhou");
          }
        }
      }
      return { ok: true, filesRead, filesTotal: files.length, imported, requested, ...(requestError ? { requestError } : {}) };
    } catch (e) {
      // Serviço externo falhou → 4xx SEMPRE (5xx vira "Service is not
      // reachable" atrás do proxy do EasyPanel e a mensagem some).
      return reply.code(400).send({ error: `Mercado Pago: ${String(e.message || e).slice(0, 200)}` });
    }
  });
}
