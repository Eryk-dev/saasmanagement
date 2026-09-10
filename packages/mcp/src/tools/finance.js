// Dinheiro (telas Financeiro, Assinaturas e Links de pagamento).
//
// Três verdades diferentes moram aqui, e misturá-las é o erro clássico do
// relatório financeiro — por isso cada tool diz de qual está falando:
//
//   · RECONHECIDO (caixa)   — fatura baixada de verdade no mês. É o
//     `recebidosMes` do /api/fin, que aplica a régua de recebimento real
//     (fatura que nasce paga num fechamento faturado NÃO conta).
//   · A RECEBER              — fatura em aberto/vencida: promessa, não caixa.
//   · CONTRATADO (TCV/ARR)   — o que as assinaturas vivas valem por ano
//     (annualized(price, cycle) do billing.js). Contrato assinado não é
//     dinheiro na conta; somar com o recebido conta a mesma venda duas vezes.
//
// Tudo em REAIS (a API nunca guarda centavos), inclusive o espelho do Mercado
// Pago. A única exceção do produto — /api/ai-costs em USD — mora em
// report_ai_costs, fora deste módulo.

import { z } from "zod";
import { http } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, delta, today } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, groupBy, round2, num } from "../core/shape.js";

// Unidade de TODA métrica numérica que sai daqui. Sem isto o consumidor não tem
// como saber se `amount` é real ou centavo (a API não devolve unidade nenhuma).
const UNITS = {
  amount: "BRL", total: "BRL", valor: "BRL", saldo: "BRL", entrada: "BRL", saida: "BRL",
  recebidoMes: "BRL", receitaReconhecidaDre: "BRL", espelhoMpMes: "BRL",
  aReceberEmAberto: "BRL", aReceberVencido: "BRL", aReceberPrevistoMes: "BRL",
  mrrContratado: "BRL", arrContratado: "BRL", mrr: "BRL", arr: "BRL", price: "BRL",
  despesasMes: "BRL", deducoes: "BRL", cogs: "BRL", sm: "BRL", rd: "BRL", ga: "BRL",
  lucroBruto: "BRL", receitaLiquida: "BRL", resultadoMes: "BRL",
  aPagarVencido: "BRL", aPagarVenceHoje: "BRL", aPagarAVencer: "BRL", aPagarAberto: "BRL", pagoMes: "BRL",
  previstoEntrada: "BRL", previstoSaida: "BRL",
  pendentesValor: "BRL", saidasSemDonoValor: "BRL", ignoradasValor: "BRL",
  aberto: "BRL", vencido: "BRL", pago: "BRL", prorata: "BRL",
  aprovado: "BRL", liquido: "BRL", estornado: "BRL", recusado: "BRL", pendente: "BRL",
  recebido: "BRL", contratado: "BRL", aReceber: "BRL", chargedAmount: "BRL", lastChargedAmount: "BRL",
  netAmount: "BRL", pagoValor: "BRL", esperandoValor: "BRL",
  folha: "BRL", ticketMedio: "BRL", ticketMedioMrr: "BRL", mrrAutorizado: "BRL",
  diferencaEspelhoVsRecebido: "BRL",
  margemBruta: "%", conversao: "%", pctPago: "%",
  diasAtraso: "dias", diasParaRenovar: "dias",
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthOf = (v) => String(v || "").slice(0, 7);
const dayOf = (v) => String(v || "").slice(0, 10);

const prevMonth = (m) => {
  const [y, mm] = m.split("-").map(Number);
  return `${mm === 1 ? y - 1 : y}-${String(mm === 1 ? 12 : mm - 1).padStart(2, "0")}`;
};

// O Financeiro fecha por MÊS CALENDÁRIO. Aceitar `period` mesmo assim evita que
// o modelo tenha que converter "mês passado" em "2026-08" na mão (e erre a
// virada); o mês escolhido volta escrito no envelope.
function resolveMonth({ month, period, since, until }) {
  if (MONTH_RE.test(String(month || ""))) return { month: String(month), from: "month" };
  if (!period && !since && !until) return { month: monthOf(today()), from: "mês corrente" };
  const p = resolvePeriod({ period, since, until });
  return { month: monthOf(p.until), from: `${p.label} (${p.since} → ${p.until})`, period: p };
}

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };
const mrrOf = (price, cycle) => round2(num(price) / (CYCLE_MONTHS[cycle] || 1));
const arrOf = (price, cycle) => round2(num(price) * (12 / (CYCLE_MONTHS[cycle] || 1)));

// Plano de categorias por setor — espelha CAT_SECTOR do routes.fin.js (a API não
// devolve o setor por lançamento, só o DRE já somado).
const CAT_SECTOR = {
  imposto: "deducoes",
  infra: "cogs", apis: "cogs", suporte: "cogs", taxas: "cogs", ia: "cogs", wa: "cogs",
  ads: "sm", midia: "sm", pessoal_com: "sm", comissao: "sm", mkt: "sm", marketing: "sm",
  pessoal_dev: "rd", dev: "rd",
  prolabore: "ga", pessoal_adm: "ga", contab: "ga", escritorio: "ga", bancos: "ga", outros: "ga",
  fixo: "ga", ferramenta: "ga", pessoal: "ga", estrutura: "ga",
};
const sectorOf = (cat) => CAT_SECTOR[cat] || "ga";
const SECTOR_LABEL = { deducoes: "deduções da receita", cogs: "custo do serviço", sm: "vendas & marketing", rd: "produto & dev", ga: "administrativo" };
const RECEITA_LABEL = { renewal: "assinaturas", installment: "parcelas de contrato", manual: "cobranças avulsas", upsell: "upsell", prorata: "upgrade de plano" };

const DAY_MS = 86_400_000;
const diasDe = (day, ref = today()) => {
  const a = Date.parse(`${dayOf(day)}T12:00:00Z`);
  const b = Date.parse(`${ref}T12:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : null;
};

const somaDe = (obj) => round2(Object.values(obj || {}).reduce((a, v) => a + num(v), 0));
const somaCampo = (rows, campo) => round2((rows || []).reduce((a, r) => a + num(r[campo]), 0));

// Nome do cliente por id: quase toda tabela de dinheiro guarda só o id, e um
// relatório com "cus_17..." na coluna não serve pra ninguém.
async function customerIndex(saas) {
  const rows = await http.get("/api/customers", saas ? { saas } : undefined).catch(() => []);
  return new Map((rows || []).map((c) => [c.id, c]));
}

// Corte com aviso: tabela extra não tem o bloco `page` do envelope, então a
// nota é o único lugar onde "cortei 300 linhas" aparece.
function corta(rows, limit, notes, nome) {
  const s = select(rows || [], { limit });
  if (s.page.truncated) notes.push(`${nome}: mostrando ${s.page.returned} de ${s.page.total} linhas (aumente limit ou filtre).`);
  return s.rows;
}

export function registerFinanceTools(tool) {
  const G_FIN = "Financeiro";
  const G_SUB = "Assinaturas e faturas";
  const G_MP = "Mercado Pago";
  const G_LINK = "Links de pagamento";

  // ── Fechamento do mês ─────────────────────────────────────────────────────
  tool("finance_report", {
    group: G_FIN,
    title: "Fechamento do mês",
    description: "Fechamento do mês: recebido, a receber, contas a pagar, despesas, fluxo de caixa e DRE por setor, com o mês anterior.",
    input: {
      saas: z.string().optional(),
      month: z.string().optional().describe('"YYYY-MM"; padrão o mês corrente.'),
      ...periodInput(z),
      compare: z.boolean().optional().describe("Padrão true."),
      include: z.array(z.enum(["fluxo", "dre", "receita", "payables", "all"])).optional().describe("Padrão: fluxo, dre, receita."),
      limit: z.number().int().optional().describe("Por tabela; padrão 30."),
    },
    hint: "confira o produto com report_portfolio e o mês no formato YYYY-MM.",
  }, async ({ saas, month, period, since, until, compare = true, include, limit = 30 }) => {
    const product = await resolveProduct(saas);
    const m = resolveMonth({ month, period, since, until });
    const inc = new Set(include?.includes("all") ? ["fluxo", "dre", "receita", "payables"] : (include?.length ? include : ["fluxo", "dre", "receita"]));
    const notes = [];

    const fin = await http.get(`/api/fin/${encodeURIComponent(product.id)}`, { month: m.month });
    let ant = null;
    if (compare) {
      // Comparação é bônus: sem ela o fechamento ainda vale.
      try { ant = await http.get(`/api/fin/${encodeURIComponent(product.id)}`, { month: prevMonth(m.month) }); } catch { /* segue sem comparativo */ }
    }
    // Falha aqui zeraria o CONTRATADO em silêncio — e zero mudo mente no
    // fechamento; a nota diz que o número não existe, em vez de "é zero".
    const subs = await http.get("/api/subscriptions", { saas: product.id })
      .catch((e) => { notes.push(`não deu para ler as assinaturas (${e.message}): mrrContratado/arrContratado saíram ZERADOS — não são zero de verdade.`); return []; });
    const vivas = (subs || []).filter((s) => s.status === "active" || s.status === "past_due");

    // DRE: a mesma conta da tela (receita → deduções → COGS → margem → setores).
    const linha = (f) => {
      const S = f?.dre?.setores || {};
      const receita = somaDe(f?.dre?.receita);
      const ded = somaDe(S.deducoes), cogs = somaDe(S.cogs), sm = somaDe(S.sm), rd = somaDe(S.rd), ga = somaDe(S.ga);
      const liquida = round2(receita - ded);
      const bruto = round2(liquida - cogs);
      return {
        recebidoMes: num(f?.receber?.recebidosMes),
        receitaReconhecidaDre: receita,
        espelhoMpMes: num(f?.conciliacao?.espelhoMes),
        aReceberEmAberto: num(f?.receber?.emAberto?.total),
        aReceberVencido: num(f?.receber?.vencidas?.total),
        despesasMes: num(f?.dre?.despesasMes),
        deducoes: ded, cogs, sm, rd, ga,
        receitaLiquida: liquida,
        lucroBruto: bruto,
        margemBruta: liquida > 0 ? round2((bruto / liquida) * 100) : null,
        resultadoMes: round2(bruto - sm - rd - ga),
        aPagarVencido: num(f?.tiles?.vencidos?.total),
        pagoMes: num(f?.tiles?.pagos?.total),
      };
    };
    const atual = linha(fin);
    const anterior = ant ? linha(ant) : null;

    const totals = {
      ...atual,
      aPagarVenceHoje: num(fin.tiles?.vencemHoje?.total),
      aPagarAVencer: num(fin.tiles?.aVencer?.total),
      aPagarAberto: round2(num(fin.tiles?.vencidos?.total) + num(fin.tiles?.vencemHoje?.total) + num(fin.tiles?.aVencer?.total)),
      previstoEntrada: num(fin.previsto?.entrada),
      previstoSaida: num(fin.previsto?.saida),
      faturasEmAberto: num(fin.receber?.emAberto?.n),
      faturasVencidas: num(fin.receber?.vencidas?.n),
      // CONTRATADO — outra grandeza: o que as assinaturas vivas valem por ano.
      mrrContratado: round2(vivas.reduce((a, s) => a + mrrOf(s.price, s.cycle), 0)),
      arrContratado: round2(vivas.reduce((a, s) => a + arrOf(s.price, s.cycle), 0)),
      assinaturasVivas: vivas.length,
      pendentesConciliacao: num(fin.conciliacao?.pendentes?.n),
      pendentesValor: num(fin.conciliacao?.pendentes?.total),
      saidasSemDono: num(fin.conciliacao?.saidasPendentes?.n),
      saidasSemDonoValor: num(fin.conciliacao?.saidasPendentes?.total),
    };

    const tables = {};
    if (anterior) {
      tables.comparativo = {
        label: `Comparativo vs ${prevMonth(m.month)}`,
        columns: ["metrica", "atual", "anterior", "variacao", "variacao_pct"],
        rows: Object.keys(atual).map((k) => {
          const d = delta(atual[k], anterior[k]);
          return d && { metrica: k, atual: d.current, anterior: d.previous, variacao: d.abs, variacao_pct: d.pct };
        }).filter(Boolean),
      };
    }
    if (inc.has("fluxo")) {
      tables.fluxo = {
        label: "Fluxo de caixa (6 meses)",
        columns: ["month", "entrada", "saida", "saldo"],
        rows: (fin.fluxo || []).map((f) => ({ ...f, saldo: round2(num(f.entrada) - num(f.saida)) })),
      };
    }
    if (inc.has("receita")) {
      tables.receita = {
        label: "Receita recebida por tipo de fatura",
        columns: ["tipo", "kind", "valor"],
        rows: Object.entries(fin.dre?.receita || {})
          .map(([k, v]) => ({ tipo: RECEITA_LABEL[k] || k, kind: k, valor: round2(num(v)) }))
          .sort((a, b) => b.valor - a.valor),
      };
    }
    if (inc.has("dre")) {
      tables.dre = {
        label: "DRE por setor e categoria",
        columns: ["setor", "categoria", "valor"],
        rows: Object.entries(fin.dre?.setores || {}).flatMap(([sec, cats]) =>
          Object.entries(cats || {}).map(([cat, v]) => ({ setor: SECTOR_LABEL[sec] || sec, categoria: cat, valor: round2(num(v)) })))
          .sort((a, b) => b.valor - a.valor),
      };
    }
    if (inc.has("payables")) {
      tables.payables = {
        label: "Contas a pagar do mês (e as vencidas de qualquer mês)",
        columns: ["dueDate", "description", "category", "amount", "status", "counterpartyType", "supplierName", "id"],
        rows: corta(fin.payables, limit, notes, "contas a pagar"),
      };
    }

    notes.push("recebidoMes é CAIXA (fatura baixada de verdade); aReceberEmAberto é promessa; mrrContratado/arrContratado é o valor CONTRATADO das assinaturas vivas — as três são grandezas diferentes, não some.");
    notes.push("receitaReconhecidaDre soma TODA fatura marcada paga no mês; recebidoMes aplica a régua de recebimento real (a fatura que nasce paga num fechamento faturado fica de fora) — por isso os dois podem divergir.");
    notes.push("IA e WhatsApp não entram neste endpoint de propósito: o COGS aqui não inclui os dois. Para o custo total use report_expenses / report_ai_costs.");
    notes.push("ler o Financeiro TEM efeito colateral no servidor: materializa as contas recorrentes do mês e aplica as regras de conciliação aprendidas (que podem baixar fatura sozinhas).");
    if (num(fin.conciliacao?.autoAplicadas) > 0) notes.push(`${fin.conciliacao.autoAplicadas} pagamento(s) foram tratados automaticamente por regra aprendida nesta leitura.`);

    return result({
      kind: "finance.report",
      title: `Financeiro · ${product.name || product.id} · ${m.month}`,
      scope: { saas: product.id, month: m.month, janela: m.from },
      units: UNITS,
      totals,
      tables,
      notes,
      source: { endpoint: `GET /api/fin/${product.id}?month=${m.month}`, hoje: fin.today || today() },
    });
  });

  // ── Conciliação ───────────────────────────────────────────────────────────
  tool("finance_reconcile", {
    group: G_FIN,
    title: "Conciliação bancária",
    description: "Fila de conciliação: entradas do Mercado Pago sem dono, saídas sem conta a pagar e regras.",
    input: {
      saas: z.string().optional(),
      month: z.string().optional().describe('"YYYY-MM"; padrão o mês corrente.'),
      limit: z.number().int().optional().describe("Por tabela; padrão 40."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, month, limit = 40, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const m = resolveMonth({ month });
    const notes = [];

    const [fin, espelho, regras, movs, clientes] = await Promise.all([
      http.get(`/api/fin/${encodeURIComponent(product.id)}`, { month: m.month }),
      http.get("/api/mp/payments", { saas: product.id }),
      // Lista que não veio vira ZERO na fila — e fila vazia por falha de leitura
      // é pior que erro: o operador conclui que não há nada para conciliar.
      http.get("/api/fin_rules").catch((e) => { notes.push(`não deu para ler as regras aprendidas (${e.message}): a tabela saiu vazia por falha, não por não existir regra.`); return []; }),
      http.get("/api/mp_movements").catch((e) => { notes.push(`não deu para ler as saídas da conta MP (${e.message}): a tabela saiu vazia por falha, não por estar tudo conciliado.`); return []; }),
      customerIndex(product.id),
    ]);
    const pagamentos = espelho.payments || [];
    const sugestoes = fin.conciliacao?.sugestoes || {};
    const pendentes = pagamentos
      .filter((p) => p.status === "approved" && !p.customer && !p.finIgnored)
      .sort((a, b) => String(b.dateApproved || b.dateCreated || "").localeCompare(String(a.dateApproved || a.dateCreated || "")))
      .map((p) => ({
        id: p.id, data: dayOf(p.dateApproved || p.dateCreated), amount: num(p.amount),
        payerName: p.payerName || "", payerEmail: p.payerEmail || "", payerDoc: p.payerDoc || "",
        method: p.method || "", sugestaoCliente: clientes.get(sugestoes[p.id]?.customer)?.name || sugestoes[p.id]?.customer || "",
        sugestaoMotivo: sugestoes[p.id]?.motivo || "", mpId: p.mpId,
      }));
    const ignoradas = pagamentos.filter((p) => p.finIgnored);
    const saidas = (movs || [])
      .filter((x) => !x.payableId && !x.finIgnored)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .map((x) => {
        const alvo = (fin.payables || []).find((p) => Math.abs(num(p.amount) - num(x.amount)) <= 0.01);
        return { id: x.id, date: x.date, type: x.type, amount: num(x.amount), fee: num(x.fee), sugestaoConta: alvo?.description || "", sugestaoContaId: alvo?.id || "" };
      });
    const minhasRegras = (regras || []).filter((r) => !r.saas || r.saas === product.id);
    const s = select(pendentes, { limit, offset });

    notes.push("pendência sem sugestão é normal: o servidor só sugere quando existe fatura aberta de valor exato ou nome muito parecido.");
    notes.push("as saídas da conta MP vêm do settlement report e NÃO trazem favorecido — o casamento é por valor e data contra as contas a pagar.");
    notes.push("ler a conciliação TEM efeito colateral no servidor: as regras aprendidas rodam nesta leitura e podem vincular pagamento e baixar fatura sozinhas.");
    if (!espelho.configured) notes.push("Mercado Pago não configurado no servidor: o espelho não atualiza.");

    return result({
      kind: "finance.reconcile",
      title: `Conciliação · ${product.name || product.id} · ${m.month}`,
      scope: { saas: product.id, month: m.month },
      units: UNITS,
      totals: {
        pendentes: pendentes.length,
        pendentesValor: somaCampo(pendentes, "amount"),
        espelhoMpMes: num(fin.conciliacao?.espelhoMes),
        recebidoMes: num(fin.receber?.recebidosMes),
        diferencaEspelhoVsRecebido: round2(num(fin.conciliacao?.espelhoMes) - num(fin.receber?.recebidosMes)),
        saidasSemDono: saidas.length,
        saidasSemDonoValor: somaCampo(saidas, "amount"),
        ignoradas: ignoradas.length,
        ignoradasValor: somaCampo(ignoradas, "amount"),
        regras: minhasRegras.length,
        autoAplicadasNestaLeitura: num(fin.conciliacao?.autoAplicadas),
      },
      columns: ["id", "data", "amount", "payerName", "payerEmail", "payerDoc", "method", "sugestaoCliente", "sugestaoMotivo", "mpId"],
      rows: s.rows,
      rowsLabel: "Entradas sem dono",
      page: s.page,
      tables: {
        saidas: { label: "Saídas da conta MP sem conta a pagar", columns: ["id", "date", "type", "amount", "fee", "sugestaoConta", "sugestaoContaId"], rows: corta(saidas, limit, notes, "saídas") },
        regras: {
          label: "Regras aprendidas (pagador → ação automática)",
          columns: ["id", "matchField", "matchValue", "action", "cliente", "reason", "autoCount", "lastAppliedAt"],
          rows: corta(minhasRegras.map((r) => ({ ...r, cliente: clientes.get(r.customer)?.name || r.customer || "" })), limit, notes, "regras"),
        },
      },
      notes,
      source: { endpoint: "GET /api/fin + /api/mp/payments + /api/fin_rules + /api/mp_movements" },
    });
  });

  tool("finance_reconcile_apply", {
    group: G_FIN,
    title: "Resolver item da conciliação",
    description: "Casa uma saída do Mercado Pago com a conta que ela quitou, desconsidera a saída ou apaga uma regra.",
    write: true, destructive: true,
    danger: "casar uma saída BAIXA a conta a pagar de verdade (declara que o dinheiro saiu).",
    input: {
      action: z.enum(["link_outflow", "ignore_outflow", "forget_rule"]),
      movement_id: z.string().optional().describe("mov_… (link_outflow, ignore_outflow)."),
      payable_id: z.string().optional().describe("conta que a saída quita (link_outflow)."),
      rule_id: z.string().optional().describe("forget_rule."),
    },
    hint: "os ids vêm de finance_reconcile (saídas e regras) e de finance_payables (contas).",
  }, async ({ action, movement_id, payable_id, rule_id }) => {
    const feito = [];
    if (action === "link_outflow") {
      if (!movement_id || !payable_id) throw new Error("link_outflow exige movement_id e payable_id.");
      const mov = await http.get(`/api/mp_movements/${encodeURIComponent(movement_id)}`);
      const conta = await http.get(`/api/payables/${encodeURIComponent(payable_id)}`);
      await http.patch(`/api/mp_movements/${encodeURIComponent(movement_id)}`, { payableId: payable_id });
      if (conta.status !== "paga") {
        // Casar a saída É a baixa: o dinheiro já saiu da conta do MP.
        await http.patch(`/api/payables/${encodeURIComponent(payable_id)}`, {
          status: "paga", paidAt: `${dayOf(mov?.date) || today()}T12:00:00.000Z`, paidVia: "mp",
        });
        feito.push(`saída de R$ ${num(mov?.amount)} casada e a conta "${conta.description || payable_id}" foi baixada`);
      } else {
        feito.push(`saída casada com a conta "${conta.description || payable_id}" (que já estava paga)`);
      }
      if (Math.abs(num(mov?.amount) - num(conta.amount)) > 0.01) {
        feito.push(`atenção: valores diferentes — saída R$ ${num(mov?.amount)} × conta R$ ${num(conta.amount)}`);
      }
    } else if (action === "ignore_outflow") {
      if (!movement_id) throw new Error("ignore_outflow exige movement_id.");
      await http.patch(`/api/mp_movements/${encodeURIComponent(movement_id)}`, { finIgnored: true });
      feito.push(`saída ${movement_id} desconsiderada na conciliação`);
    } else {
      if (!rule_id) throw new Error("forget_rule exige rule_id.");
      await http.del(`/api/fin_rules/${encodeURIComponent(rule_id)}`);
      feito.push(`regra ${rule_id} apagada — aquele pagador volta a aparecer na fila`);
    }
    return result({
      kind: "finance.reconcile_apply",
      title: `Conciliação · ${action}`,
      scope: { action, movement: movement_id || "", payable: payable_id || "", rule: rule_id || "" },
      units: UNITS,
      columns: ["resultado"],
      rows: feito.map((t) => ({ resultado: t })),
      rowsLabel: "Resultado",
      source: { endpoint: "PATCH /api/mp_movements · PATCH /api/payables · DELETE /api/fin_rules" },
    });
  });

  // ── Contas a pagar / folha ────────────────────────────────────────────────
  tool("finance_payables", {
    group: G_FIN,
    title: "Contas a pagar e folha",
    description: "Contas a pagar com vencimento, situação, setor e favorecido; agrupa por categoria, setor, pessoa ou mês.",
    input: {
      saas: z.string().optional(),
      month: z.string().optional().describe('Competência "YYYY-MM"; "all" traz todos. Padrão o mês corrente.'),
      status: z.enum(["aberta", "paga", "vencida", "any"]).optional().describe('Padrão any. "aberta" inclui as vencidas.'),
      category: z.string().optional().describe("ex.: prolabore, contab, infra."),
      sector: z.enum(["deducoes", "cogs", "sm", "rd", "ga"]).optional(),
      counterparty: z.enum(["colaborador", "fornecedor"]).optional(),
      user_id: z.string().optional(),
      q: z.string().optional(),
      group_by: z.enum(["none", "category", "sector", "person", "month"]).optional().describe("Padrão none."),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, month, status = "any", category, sector, counterparty, user_id, q, group_by = "none", limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const todos = String(month || "").toLowerCase() === "all";
    const mes = todos ? null : resolveMonth({ month }).month;
    const hoje = today();
    const notes = [];

    const all = await http.get("/api/payables");
    let rows = (all || [])
      .filter((p) => p.saas === product.id)
      .filter((p) => (todos ? true : p.month === mes))
      .map((p) => ({
        id: p.id, dueDate: dayOf(p.dueDate), description: p.description || "", category: p.category || "outros",
        setor: sectorOf(p.category), amount: num(p.amount),
        status: p.status === "paga" ? "paga" : (p.dueDate && dayOf(p.dueDate) < hoje ? "vencida" : "aberta"),
        counterpartyType: p.counterpartyType || "", userId: p.userId || "", supplierName: p.supplierName || "",
        month: p.month, paidAt: dayOf(p.paidAt), paidVia: p.paidVia || "",
        recurring: !!p.recurring, templateId: p.templateId || "", endMonth: p.endMonth || "",
        diasAtraso: p.status !== "paga" && p.dueDate && dayOf(p.dueDate) < hoje ? diasDe(p.dueDate, hoje) : null,
      }));

    if (status !== "any") rows = rows.filter((r) => (status === "paga" ? r.status === "paga" : status === "vencida" ? r.status === "vencida" : r.status !== "paga"));
    if (category) rows = rows.filter((r) => r.category === category);
    if (sector) rows = rows.filter((r) => r.setor === sector);
    if (counterparty) rows = rows.filter((r) => r.counterpartyType === counterparty);
    if (user_id) rows = rows.filter((r) => r.userId === user_id);

    const abertas = rows.filter((r) => r.status !== "paga");
    const totals = {
      contas: rows.length,
      total: somaCampo(rows, "amount"),
      aberto: somaCampo(abertas, "amount"),
      vencido: somaCampo(rows.filter((r) => r.status === "vencida"), "amount"),
      pago: somaCampo(rows.filter((r) => r.status === "paga"), "amount"),
      folha: somaCampo(rows.filter((r) => r.counterpartyType === "colaborador"), "amount"),
      recorrentes: rows.filter((r) => r.recurring).length,
    };

    let saida = rows;
    let columns = ["dueDate", "description", "category", "setor", "amount", "status", "diasAtraso", "counterpartyType", "supplierName", "userId", "recurring", "id"];
    if (group_by !== "none") {
      const by = group_by === "person" ? ((r) => r.userId || r.supplierName || "—") : group_by === "sector" ? "setor" : group_by === "month" ? "month" : "category";
      saida = groupBy(rows, { by, sum: ["amount"], count: "contas", label: group_by })
        .sort((a, b) => b.amount - a.amount);
      columns = [group_by, "contas", "amount"];
    }
    const s = select(saida, {
      q, qFields: group_by === "none" ? ["description", "supplierName", "category"] : [group_by],
      sort: group_by === "none" ? "dueDate" : undefined, limit, offset,
    });

    notes.push("as ocorrências do mês de uma conta RECORRENTE só nascem quando o Financeiro do mês é lido — se faltar um lançamento repetido, rode finance_report daquele mês antes.");
    notes.push("mídia paga, IA e WhatsApp NÃO são contas a pagar: são custos automáticos da aba Custos (report_expenses).");

    return result({
      kind: "finance.payables",
      title: `Contas a pagar · ${product.name || product.id}${todos ? "" : ` · ${mes}`}`,
      scope: { saas: product.id, month: todos ? "todos" : mes, status, group_by },
      units: UNITS,
      totals,
      columns,
      rows: s.rows,
      rowsLabel: group_by === "none" ? "Contas" : "Grupos",
      page: s.page,
      notes,
      source: { endpoint: "GET /api/payables" },
    });
  });

  tool("finance_payable_write", {
    group: G_FIN,
    title: "Lançar / baixar conta a pagar",
    description: "Cria, edita, baixa, reabre, encerra a recorrência ou exclui uma conta a pagar.",
    write: true, destructive: true,
    danger: "mexe no contas a pagar de verdade: baixar diz que o dinheiro saiu e excluir apaga o lançamento.",
    input: {
      action: z.enum(["create", "update", "pay", "reopen", "end_recurrence", "delete"]),
      saas: z.string().optional().describe("Obrigatório em create."),
      id: z.string().optional().describe("Tudo menos create."),
      description: z.string().optional(),
      amount: z.number().optional().describe("Em R$."),
      due_date: z.string().optional().describe("YYYY-MM-DD; define a competência."),
      category: z.string().optional().describe("Setor no DRE: imposto; infra/apis/suporte/taxas/ia/wa; midia/mkt/comissao/pessoal_com; dev/pessoal_dev; prolabore/contab/escritorio/bancos/pessoal_adm/outros."),
      counterparty_type: z.enum(["colaborador", "fornecedor"]).optional(),
      user_id: z.string().optional().describe("Quando counterparty_type=colaborador."),
      supplier_name: z.string().optional(),
      recurring: z.boolean().optional().describe("Repete todo mês até encerrar."),
      end_month: z.string().optional().describe('Último mês "YYYY-MM".'),
      paid_via: z.string().optional().describe("ex.: mp, pix, boleto."),
      notes: z.string().optional(),
    },
    hint: "use finance_payables para achar o id da conta.",
  }, async (a) => {
    const acao = a.action;
    let doc;
    if (acao === "create") {
      const product = await resolveProduct(a.saas);
      const due = dayOf(a.due_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("create exige due_date no formato YYYY-MM-DD.");
      if (!(num(a.amount) > 0)) throw new Error("create exige amount positivo (em reais).");
      if (!String(a.description || "").trim()) throw new Error("create exige description.");
      doc = await http.post("/api/payables", {
        saas: product.id,
        description: String(a.description).trim(),
        category: a.category || "outros",
        counterpartyType: a.counterparty_type || "fornecedor",
        userId: a.counterparty_type === "colaborador" ? (a.user_id || "") : "",
        supplierName: a.counterparty_type === "colaborador" ? "" : (a.supplier_name || ""),
        amount: round2(num(a.amount)),
        month: monthOf(due), dueDate: due,
        status: "aberta", paidAt: "", paidVia: "",
        recurring: !!a.recurring, endMonth: a.recurring ? (a.end_month || "") : "",
        templateId: "", notes: a.notes || "", createdAt: new Date().toISOString(),
      });
    } else {
      if (!a.id) throw new Error(`${acao} exige o id da conta.`);
      const path = `/api/payables/${encodeURIComponent(a.id)}`;
      if (acao === "delete") {
        await http.del(path);
        doc = { id: a.id, removido: true };
      } else if (acao === "pay") {
        doc = await http.patch(path, { status: "paga", paidAt: new Date().toISOString(), paidVia: a.paid_via || "" });
      } else if (acao === "reopen") {
        doc = await http.patch(path, { status: "aberta", paidAt: "", paidVia: "" });
      } else if (acao === "end_recurrence") {
        doc = await http.patch(path, { endMonth: a.end_month || monthOf(today()) });
      } else {
        const patch = {};
        if (a.description != null) patch.description = a.description;
        if (a.amount != null) patch.amount = round2(num(a.amount));
        if (a.due_date) { patch.dueDate = dayOf(a.due_date); patch.month = monthOf(a.due_date); }
        if (a.category) patch.category = a.category;
        if (a.counterparty_type) patch.counterpartyType = a.counterparty_type;
        if (a.user_id != null) patch.userId = a.user_id;
        if (a.supplier_name != null) patch.supplierName = a.supplier_name;
        if (a.recurring != null) patch.recurring = !!a.recurring;
        if (a.end_month != null) patch.endMonth = a.end_month;
        if (a.notes != null) patch.notes = a.notes;
        if (!Object.keys(patch).length) throw new Error("update sem nenhum campo para mudar.");
        doc = await http.patch(path, patch);
      }
    }
    return result({
      kind: "finance.payable_write",
      title: `Conta a pagar · ${acao}`,
      scope: { action: acao, id: doc?.id || a.id || "" },
      units: UNITS,
      detail: doc,
      notes: acao === "end_recurrence" ? ["encerrar a recorrência para os meses seguintes; as ocorrências já lançadas continuam."] : [],
      source: { endpoint: `${acao === "create" ? "POST" : acao === "delete" ? "DELETE" : "PATCH"} /api/payables` },
    });
  });

  // ── Faturas ───────────────────────────────────────────────────────────────
  tool("invoices_list", {
    group: G_SUB,
    title: "Faturas (a receber e recebido)",
    description: "Faturas com cliente, situação, atraso e aging: o que há a receber, o que venceu e quem deve.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["open", "overdue", "paid", "aberta", "any"]).optional().describe('Padrão any. "aberta" = open + overdue.'),
      customer: z.string().optional(),
      subscription: z.string().optional(),
      kind: z.enum(["renewal", "installment", "manual", "upsell", "prorata"]).optional(),
      ...periodInput(z),
      date_field: z.enum(["dueDate", "paidAt", "createdAt"]).optional().describe("Comparado ao período; padrão dueDate."),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "any", customer, subscription, kind, period, since, until, date_field = "dueDate", q, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const temPeriodo = !!(period || since || until);
    const p = temPeriodo ? resolvePeriod({ period, since, until }) : null;
    const hoje = today();
    const notes = [];

    const [brutas, clientes] = await Promise.all([
      http.get("/api/invoices", { saas: product.id, customer, subscription, status: status === "aberta" || status === "any" ? undefined : status }),
      customerIndex(product.id),
    ]);
    let rows = (brutas || []).map((i) => ({
      id: i.id,
      cliente: clientes.get(i.customer)?.name || i.customer || "",
      customer: i.customer || "",
      title: i.title || RECEITA_LABEL[i.kind] || i.kind || "",
      kind: i.kind || "manual",
      amount: num(i.amount),
      status: i.status,
      dueDate: dayOf(i.dueDate),
      paidAt: dayOf(i.paidAt),
      diasAtraso: i.status !== "paid" && i.dueDate && dayOf(i.dueDate) < hoje ? diasDe(i.dueDate, hoje) : null,
      parcela: i.installmentN ? `${i.installmentN}/${i.installmentOf}` : "",
      subscription: i.subscription || "",
      paidMethod: i.paidMethod || "",
      mpPaymentId: i.mpPaymentId || "",
      temLink: !!i.mpInitPoint,
      periodStart: dayOf(i.periodStart), periodEnd: dayOf(i.periodEnd),
    }));
    if (status === "aberta") rows = rows.filter((r) => r.status === "open" || r.status === "overdue");
    if (kind) rows = rows.filter((r) => r.kind === kind);
    if (p) rows = rows.filter((r) => { const d = r[date_field]; return d && d >= p.since && d <= p.until; });

    const abertas = rows.filter((r) => r.status === "open" || r.status === "overdue");
    const vencidas = rows.filter((r) => r.status === "overdue" || (r.status === "open" && r.diasAtraso > 0));
    const pagas = rows.filter((r) => r.status === "paid");
    const faixa = (min, max) => somaCampo(vencidas.filter((r) => num(r.diasAtraso) >= min && (max == null || num(r.diasAtraso) <= max)), "amount");

    const totals = {
      faturas: rows.length,
      aberto: somaCampo(abertas, "amount"),
      faturasAbertas: abertas.length,
      vencido: somaCampo(vencidas, "amount"),
      faturasVencidas: vencidas.length,
      pago: somaCampo(pagas, "amount"),
      faturasPagas: pagas.length,
      ticketMedio: rows.length ? round2(somaCampo(rows, "amount") / rows.length) : 0,
    };

    const s = select(rows, { q, qFields: ["cliente", "title", "id"], sort: "dueDate:desc", limit, offset });
    notes.push("aberto/vencido é A RECEBER (promessa); pago é caixa. Fatura paga pelo Mercado Pago traz mpPaymentId — essa não dá para desmarcar.");
    if (!temPeriodo) notes.push("sem período: são TODAS as faturas do produto, de qualquer mês.");

    return result({
      kind: "invoices.list",
      title: `Faturas · ${product.name || product.id}`,
      scope: { saas: product.id, status, date_field },
      period: p || undefined,
      units: UNITS,
      totals,
      columns: ["dueDate", "cliente", "title", "kind", "amount", "status", "diasAtraso", "parcela", "paidAt", "paidMethod", "id"],
      rows: s.rows,
      rowsLabel: "Faturas",
      page: s.page,
      tables: {
        aging: {
          label: "Aging do vencido",
          columns: ["faixa", "valor"],
          rows: [
            { faixa: "1 a 7 dias", valor: faixa(1, 7) },
            { faixa: "8 a 30 dias", valor: faixa(8, 30) },
            { faixa: "31 a 60 dias", valor: faixa(31, 60) },
            { faixa: "60+ dias", valor: faixa(61, null) },
          ],
          units: { valor: "BRL" },
        },
        por_tipo: {
          label: "Por tipo de fatura",
          columns: ["kind", "n", "amount"],
          rows: groupBy(rows, { by: "kind", sum: ["amount"], count: "n", label: "kind" }).sort((a, b) => b.amount - a.amount),
        },
      },
      notes,
      source: { endpoint: "GET /api/invoices" },
    });
  });

  tool("invoice_pay", {
    group: G_SUB,
    title: "Marcar fatura como paga",
    description: "Dá baixa manual numa fatura, para dinheiro que entrou fora do Mercado Pago.",
    write: true, destructive: true,
    danger: "declara que o dinheiro entrou: entra no recebido do mês e avisa no Discord.",
    input: { invoice_id: z.string() },
    hint: "confirme o id em invoices_list; a baixa pelo Mercado Pago acontece sozinha.",
  }, async ({ invoice_id }) => {
    const inv = await http.post(`/api/invoices/${encodeURIComponent(invoice_id)}/pay`);
    return result({
      kind: "invoices.pay",
      title: `Fatura ${invoice_id} baixada`,
      scope: { invoice: invoice_id, customer: inv.customer || "" },
      units: UNITS,
      totals: { amount: num(inv.amount), status: inv.status, paidAt: inv.paidAt || "" },
      detail: inv,
      source: { endpoint: `POST /api/invoices/${invoice_id}/pay` },
    });
  });

  tool("invoice_unpay", {
    group: G_SUB,
    title: "Desfazer baixa de fatura",
    description: "Reabre uma fatura baixada na mão; a paga pelo Mercado Pago não desmarca.",
    write: true, destructive: true,
    danger: "tira dinheiro do recebido do mês e pode derrubar a assinatura para inadimplente.",
    input: { invoice_id: z.string() },
    hint: "se a fatura tem mpPaymentId a API recusa (409): o dinheiro existiu de verdade.",
  }, async ({ invoice_id }) => {
    const inv = await http.post(`/api/invoices/${encodeURIComponent(invoice_id)}/unpay`);
    return result({
      kind: "invoices.unpay",
      title: `Fatura ${invoice_id} reaberta`,
      scope: { invoice: invoice_id },
      units: UNITS,
      totals: { amount: num(inv.amount), status: inv.status },
      detail: inv,
      source: { endpoint: `POST /api/invoices/${invoice_id}/unpay` },
    });
  });

  tool("invoice_payment_link", {
    group: G_LINK,
    title: "Link de pagamento de uma fatura",
    description: "Gera no Mercado Pago o link de checkout de uma fatura em aberto, com baixa automática.",
    write: true, external: true,
    danger: "cria uma cobrança REAL no Mercado Pago para mandar a um cliente de verdade.",
    input: {
      invoice_id: z.string().describe("Fatura em aberto."),
      title: z.string().optional().describe("Visto pelo cliente no checkout."),
      max_installments: z.number().int().optional().describe("Parcelas no cartão."),
    },
    hint: "fatura já paga ou sem valor é recusada pela API; confira em invoices_list.",
  }, async ({ invoice_id, title, max_installments }) => {
    const r = await http.post(`/api/invoices/${encodeURIComponent(invoice_id)}/mp/link`, {
      ...(title ? { title } : {}), ...(max_installments ? { maxInstallments: max_installments } : {}),
    });
    return result({
      kind: "invoices.payment_link",
      title: `Link de pagamento da fatura ${invoice_id}`,
      scope: { invoice: invoice_id },
      units: UNITS,
      totals: { amount: num(r.invoice?.amount), url: r.url || "" },
      notes: ["o link é do Mercado Pago e a baixa é automática (external_reference = id da fatura) — não marque a fatura como paga na mão depois."],
      source: { endpoint: `POST /api/invoices/${invoice_id}/mp/link` },
    });
  });

  // ── Assinaturas ───────────────────────────────────────────────────────────
  tool("subscriptions_list", {
    group: G_SUB,
    title: "Assinaturas e receita contratada",
    description: "Assinaturas com MRR/ARR contratado, ciclo, renovação e vínculo com o Mercado Pago — contratado, não caixa.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["active", "past_due", "paused", "canceled", "vivas", "any"]).optional().describe("Padrão vivas (active + past_due)."),
      customer: z.string().optional(),
      cycle: z.enum(["monthly", "quarterly", "semiannual", "annual"]).optional(),
      group_by: z.enum(["none", "cycle", "plan", "status"]).optional().describe("Padrão none."),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "vivas", customer, cycle, group_by = "none", q, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const [brutas, planos, clientes] = await Promise.all([
      http.get("/api/subscriptions", { saas: product.id, customer }),
      http.get("/api/plans", { saas: product.id }).catch(() => []),
      customerIndex(product.id),
    ]);
    const planName = (id) => (planos || []).find((p) => p.id === id)?.name || (id ? id : "avulso");

    let rows = (brutas || []).map((s) => ({
      id: s.id,
      cliente: clientes.get(s.customer)?.name || s.customer || "",
      customer: s.customer || "",
      plano: planName(s.plan),
      status: s.status,
      cycle: s.cycle, ciclo: CYCLE_LABEL[s.cycle] || s.cycle,
      price: num(s.price),
      mrr: mrrOf(s.price, s.cycle),
      arr: arrOf(s.price, s.cycle),
      periodStart: dayOf(s.periodStart), periodEnd: dayOf(s.periodEnd),
      diasParaRenovar: diasDe(s.periodEnd) == null ? null : -diasDe(s.periodEnd),
      mudancaAgendada: s.pendingChange ? `${s.pendingChange.price ?? ""} ${s.pendingChange.cycle || ""} em ${dayOf(s.pendingChange.applyAt)}`.trim() : "",
      mpPreapprovalId: s.mpPreapprovalId || "",
      mpStatus: s.mpStatus || "",
    }));
    if (status === "vivas") rows = rows.filter((r) => r.status === "active" || r.status === "past_due");
    else if (status !== "any") rows = rows.filter((r) => r.status === status);
    if (cycle) rows = rows.filter((r) => r.cycle === cycle);

    const vivas = rows.filter((r) => r.status === "active" || r.status === "past_due");
    const totals = {
      assinaturas: rows.length,
      ativas: rows.filter((r) => r.status === "active").length,
      inadimplentes: rows.filter((r) => r.status === "past_due").length,
      pausadas: rows.filter((r) => r.status === "paused").length,
      canceladas: rows.filter((r) => r.status === "canceled").length,
      mrrContratado: somaCampo(vivas, "mrr"),
      arrContratado: somaCampo(vivas, "arr"),
      ticketMedioMrr: vivas.length ? round2(somaCampo(vivas, "mrr") / vivas.length) : 0,
      comRecorrenciaNoMp: rows.filter((r) => r.mpPreapprovalId).length,
      mudancasAgendadas: rows.filter((r) => r.mudancaAgendada).length,
    };

    let saida = rows;
    let columns = ["cliente", "plano", "status", "ciclo", "price", "mrr", "arr", "periodEnd", "diasParaRenovar", "mudancaAgendada", "mpStatus", "id"];
    if (group_by !== "none") {
      const by = group_by === "plan" ? "plano" : group_by === "cycle" ? "ciclo" : "status";
      saida = groupBy(rows, { by, sum: ["price", "mrr", "arr"], count: "assinaturas", label: group_by }).sort((a, b) => b.arr - a.arr);
      columns = [group_by, "assinaturas", "mrr", "arr"];
    }
    const s = select(saida, {
      q, qFields: group_by === "none" ? ["cliente", "plano", "id"] : [group_by],
      sort: group_by === "none" ? "arr:desc" : undefined, limit, offset,
    });

    return result({
      kind: "subscriptions.list",
      title: `Assinaturas · ${product.name || product.id}`,
      scope: { saas: product.id, status, group_by },
      units: UNITS,
      totals,
      columns,
      rows: s.rows,
      rowsLabel: group_by === "none" ? "Assinaturas" : "Grupos",
      page: s.page,
      tables: {
        planos: { label: "Planos do produto", columns: ["id", "name", "price", "cycle"], rows: (planos || []).map((p) => ({ id: p.id, name: p.name, price: num(p.price), cycle: p.cycle })) },
      },
      notes: [
        "MRR/ARR aqui é CONTRATADO (preço × 12/meses do ciclo), incluindo inadimplente — é o que o cliente se comprometeu a pagar, não o que entrou no caixa. Para caixa use finance_report.",
        "customer.arr é reescrito pelo servidor a cada mutação de assinatura: mexer aqui muda o MRR do produto inteiro.",
      ],
      source: { endpoint: "GET /api/subscriptions" },
    });
  });

  tool("subscription_change", {
    group: G_SUB,
    title: "Mudar plano, preço ou ciclo",
    description: "Muda preço, plano ou ciclo: upgrade aplica na hora com pró-rata; downgrade e ciclo agendados.",
    write: true, destructive: true, external: true,
    danger: "altera a cobrança de um cliente real — upgrade cria fatura pró-rata e, se houver recorrência no Mercado Pago, o valor é atualizado lá.",
    input: {
      subscription_id: z.string(),
      price: z.number().optional().describe("Preço POR CICLO, em R$."),
      cycle: z.enum(["monthly", "quarterly", "semiannual", "annual"]).optional().describe("Agendado para o fim do ciclo."),
      plan: z.string().optional(),
    },
    hint: "mande ao menos price, cycle ou plan; sem mudança real a API devolve no_op.",
  }, async ({ subscription_id, price, cycle, plan }) => {
    if (price == null && !cycle && plan == null) throw new Error("informe ao menos price, cycle ou plan.");
    const r = await http.post(`/api/subscriptions/${encodeURIComponent(subscription_id)}/change`, {
      ...(price != null ? { price } : {}), ...(cycle ? { cycle } : {}), ...(plan != null ? { plan } : {}),
    });
    const sub = r.subscription || {};
    return result({
      kind: "subscriptions.change",
      title: `Assinatura ${subscription_id} · ${r.changeType}`,
      scope: { subscription: subscription_id, customer: sub.customer || "" },
      units: UNITS,
      totals: {
        changeType: r.changeType, prorata: num(r.prorata), applyAt: r.applyAt || "imediato",
        price: num(sub.price), mrr: mrrOf(sub.price, sub.cycle), arr: arrOf(sub.price, sub.cycle),
        ...(r.mpSync ? { mercadoPago: r.mpSync } : {}),
      },
      notes: [
        r.changeType === "no_op" ? "nada mudou: o preço/plano enviado é igual ao atual." : "",
        r.changeType === "upgrade_mid_cycle" ? "a fatura pró-rata nasceu ABERTA — gere o link com invoice_payment_link ou baixe com invoice_pay." : "",
        r.changeType && r.changeType !== "upgrade_mid_cycle" && r.changeType !== "no_op" ? "mudança AGENDADA: o motor (billing_run) aplica no fim do ciclo." : "",
      ].filter(Boolean),
      source: { endpoint: `POST /api/subscriptions/${subscription_id}/change` },
    });
  });

  tool("subscription_status", {
    group: G_SUB,
    title: "Pausar, cancelar ou reativar assinatura",
    description: "Muda o status da assinatura, espelhando no Mercado Pago quando há recorrência.",
    write: true, destructive: true, external: true,
    danger: "cancelar corta a cobrança recorrente real do cliente no Mercado Pago e derruba o MRR do produto.",
    input: {
      subscription_id: z.string(),
      status: z.enum(["active", "paused", "canceled", "past_due"]),
    },
    hint: "para registrar a SAÍDA do cliente (churn) use a tool de clientes; aqui só a assinatura muda.",
  }, async ({ subscription_id, status }) => {
    const sub = await http.patch(`/api/subscriptions/${encodeURIComponent(subscription_id)}`, {
      status, ...(status === "canceled" ? { canceledAt: new Date().toISOString() } : {}),
    });
    return result({
      kind: "subscriptions.status",
      title: `Assinatura ${subscription_id} → ${status}`,
      scope: { subscription: subscription_id, customer: sub.customer || "" },
      units: UNITS,
      totals: { status: sub.status, price: num(sub.price), mrr: mrrOf(sub.price, sub.cycle), arr: arrOf(sub.price, sub.cycle), mpPreapprovalId: sub.mpPreapprovalId || "" },
      notes: ["o servidor reescreve customer.arr nesta mudança: o MRR/receita do produto muda junto."],
      source: { endpoint: `PATCH /api/subscriptions/${subscription_id}` },
    });
  });

  tool("subscription_payment_link", {
    group: G_LINK,
    title: "Autorização recorrente",
    description: "Cria o preapproval no Mercado Pago e devolve o link de autorização da cobrança.",
    write: true, external: true,
    danger: "autoriza cobrança RECORRENTE de verdade: quando o cliente aceitar, o Mercado Pago passa a cobrar sozinho a cada ciclo.",
    input: {
      subscription_id: z.string(),
      payer_email: z.string().optional().describe("Padrão: o e-mail do cliente, exigido pelo MP."),
    },
    hint: "cliente sem e-mail dá 400 — preencha o e-mail do cliente ou mande payer_email.",
  }, async ({ subscription_id, payer_email }) => {
    const r = await http.post(`/api/subscriptions/${encodeURIComponent(subscription_id)}/mp/link`, payer_email ? { payerEmail: payer_email } : {});
    return result({
      kind: "subscriptions.payment_link",
      title: `Autorização recorrente · assinatura ${subscription_id}`,
      scope: { subscription: subscription_id },
      units: UNITS,
      totals: { initPoint: r.initPoint || "", preapprovalId: r.preapprovalId || "", price: num(r.subscription?.price), status: r.subscription?.mpStatus || "" },
      notes: ["enquanto o cliente não autorizar, a recorrência fica pending — o webhook ativa e passa a dar baixa nas faturas sozinho."],
      source: { endpoint: `POST /api/subscriptions/${subscription_id}/mp/link` },
    });
  });

  // ── Motor de billing ──────────────────────────────────────────────────────
  tool("billing_run", {
    group: G_SUB,
    title: "Rodar o motor de billing",
    description: "Um tick do motor: aplica mudanças agendadas, gera faturas de renovação e roda o dunning.",
    write: true, destructive: true,
    danger: "cria faturas de renovação de verdade e marca clientes como inadimplentes (com aviso no Discord).",
    input: {
      grace_days: z.number().int().optional().describe("Carência antes de vencer a fatura; padrão 3."),
    },
  }, async ({ grace_days }) => {
    const r = await http.post("/api/billing/run", grace_days != null ? { graceDays: grace_days } : {}, { timeoutMs: 300_000 });
    return result({
      kind: "billing.run",
      title: "Motor de billing",
      totals: {
        mudancasAplicadas: num(r.applied), renovacoesGeradas: num(r.renewed),
        faturasVencidas: num(r.overdue), inadimplentes: num(r.pastDue), recuperadas: num(r.recovered),
      },
      notes: ["os números são TRANSIÇÕES deste tick, não estoque: 0 vencidas não quer dizer que não há fatura vencida (para o estoque use invoices_list status=overdue)."],
      source: { endpoint: "POST /api/billing/run" },
    });
  });

  tool("billing_received", {
    group: G_SUB,
    title: "Recebido por cliente",
    description: "Quanto cada cliente realmente pagou, com o contratado ao lado para ver quem está em dia.",
    input: {
      saas: z.string().optional(),
      only_gap: z.boolean().optional().describe("Só quem pagou menos que o contratado."),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, only_gap = false, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const [recebido, clientes, subs] = await Promise.all([
      http.get(`/api/billing/received/${encodeURIComponent(product.id)}`),
      customerIndex(product.id),
      http.get("/api/subscriptions", { saas: product.id }).catch(() => []),
    ]);
    const arrDe = new Map();
    for (const s of subs || []) {
      if (s.status !== "active" && s.status !== "past_due") continue;
      arrDe.set(s.customer, round2((arrDe.get(s.customer) || 0) + arrOf(s.price, s.cycle)));
    }
    let rows = [...clientes.values()].map((c) => ({
      customer: c.id, cliente: c.name || c.id,
      recebido: round2(num(recebido?.[c.id])),
      contratado: round2(num(arrDe.get(c.id) ?? c.arr)),
      churn: c.endedAt ? dayOf(c.endedAt) : "",
      health: c.health ?? null,
    })).map((r) => ({ ...r, pctPago: r.contratado > 0 ? round2((r.recebido / r.contratado) * 100) : null }));
    if (only_gap) rows = rows.filter((r) => r.contratado > 0 && r.recebido < r.contratado);

    const s = select(rows, { sort: "recebido:desc", limit, offset });
    return result({
      kind: "billing.received",
      title: `Recebido por cliente · ${product.name || product.id}`,
      scope: { saas: product.id },
      units: { ...UNITS, health: "0-100" },
      totals: {
        clientes: rows.length,
        recebido: somaCampo(rows, "recebido"),
        contratado: somaCampo(rows, "contratado"),
        semNenhumRecebimento: rows.filter((r) => !r.recebido).length,
      },
      columns: ["cliente", "recebido", "contratado", "pctPago", "churn", "health", "customer"],
      rows: s.rows,
      rowsLabel: "Clientes",
      page: s.page,
      notes: [
        "recebido conta só FATO: pagamento aprovado no espelho do MP e fatura baixada de verdade. A fatura que nasce paga no fechamento fica de fora de propósito.",
        "contratado é o ARR das assinaturas vivas (ou o arr carimbado do cliente) — comparar os dois só faz sentido dentro do mesmo horizonte de tempo.",
      ],
      source: { endpoint: `GET /api/billing/received/${product.id}` },
    });
  });

  // ── Mercado Pago ──────────────────────────────────────────────────────────
  tool("mp_payments", {
    group: G_MP,
    title: "Pagamentos do Mercado Pago",
    description: "Pagamentos recebidos na conta do Mercado Pago: pagador, valor, método, status e o que casou.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      status: z.enum(["approved", "pending", "in_process", "rejected", "refunded", "cancelled", "charged_back", "any"]).optional().describe("Padrão any."),
      customer: z.string().optional(),
      method: z.string().optional().describe("ex.: pix, master, visa, bolbradesco."),
      only_unmatched: z.boolean().optional().describe("Só aprovados sem cliente."),
      include_ignored: z.boolean().optional().describe("Padrão false."),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, status = "any", customer, method, only_unmatched = false, include_ignored = false, q, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const temPeriodo = !!(period || since || until);
    const p = temPeriodo ? resolvePeriod({ period, since, until }) : null;
    const [espelho, clientes] = await Promise.all([
      http.get("/api/mp/payments", {
        saas: product.id, customer,
        ...(p ? { from: p.since, to: `${p.until}T23:59:59` } : {}),
        ...(status !== "any" ? { status } : {}),
      }),
      customerIndex(product.id),
    ]);
    let rows = (espelho.payments || []).map((x) => ({
      id: x.id, mpId: x.mpId,
      data: dayOf(x.dateApproved || x.dateCreated),
      amount: num(x.amount), netAmount: num(x.netAmount),
      status: x.status, statusDetail: x.statusDetail || "",
      method: x.method || "", methodType: x.methodType || "", installments: num(x.installments),
      payerName: x.payerName || "", payerEmail: x.payerEmail || "", payerDoc: x.payerDoc || "", payerBank: x.payerBank || "",
      cliente: clientes.get(x.customer)?.name || "", customer: x.customer || "",
      lead: x.lead || "", invoice: x.invoice || "", matchedBy: x.matchedBy || "",
      finIgnored: !!x.finIgnored, finIgnoredReason: x.finIgnoredReason || "",
      description: x.description || "",
    }));
    if (!include_ignored) rows = rows.filter((r) => !r.finIgnored);
    if (method) rows = rows.filter((r) => r.method === method);
    if (only_unmatched) rows = rows.filter((r) => r.status === "approved" && !r.customer && !r.finIgnored);

    const aprovados = rows.filter((r) => r.status === "approved");
    const totals = {
      pagamentos: rows.length,
      aprovado: somaCampo(aprovados, "amount"),
      liquido: somaCampo(aprovados, "netAmount"),
      aprovados: aprovados.length,
      pendente: somaCampo(rows.filter((r) => r.status === "pending" || r.status === "in_process"), "amount"),
      recusado: somaCampo(rows.filter((r) => r.status === "rejected"), "amount"),
      estornado: somaCampo(rows.filter((r) => r.status === "refunded" || r.status === "charged_back"), "amount"),
      semDono: aprovados.filter((r) => !r.customer).length,
      ultimoSync: espelho.sync?.lastAt || "",
    };
    const s = select(rows, { q, qFields: ["payerName", "payerEmail", "payerDoc", "description", "mpId"], sort: "data:desc", limit, offset });

    const notes = [];
    if (!espelho.configured) notes.push("MERCADOPAGO_ACCESS_TOKEN ausente no servidor: o espelho não é atualizado (rode mp_sync depois de configurar).");
    notes.push("liquido (net) só existe nos pagamentos que o MP já liquidou — onde vier 0, use amount.");
    notes.push("pagamento sem produto aparece em qualquer produto até alguém vincular (finance_reconcile / mp_link).");

    return result({
      kind: "mp.payments",
      title: `Pagamentos do Mercado Pago · ${product.name || product.id}`,
      scope: { saas: product.id, status },
      period: p || undefined,
      units: UNITS,
      totals,
      columns: ["data", "amount", "status", "method", "installments", "payerName", "cliente", "matchedBy", "invoice", "mpId"],
      rows: s.rows,
      rowsLabel: "Pagamentos",
      page: s.page,
      tables: {
        por_metodo: { label: "Por método (aprovados)", columns: ["method", "n", "amount"], rows: groupBy(aprovados, { by: "method", sum: ["amount"], count: "n", label: "method" }).sort((a, b) => b.amount - a.amount) },
        por_status: { label: "Por status", columns: ["status", "n", "amount"], rows: groupBy(rows, { by: "status", sum: ["amount"], count: "n", label: "status" }).sort((a, b) => b.amount - a.amount) },
      },
      notes,
      source: { endpoint: "GET /api/mp/payments", syncedAt: espelho.sync?.lastAt || null },
    });
  });

  tool("mp_preapprovals", {
    group: G_MP,
    title: "Recorrências do Mercado Pago",
    description: "Recorrências que a conta do Mercado Pago cobra: valor, ciclo, próxima cobrança e assinatura vinculada.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["authorized", "pending", "paused", "cancelled", "any"]).optional().describe("Padrão any."),
      only_unlinked: z.boolean().optional().describe("Só as sem assinatura vinculada."),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "any", only_unlinked = false, q, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const [espelho, clientes] = await Promise.all([
      http.get("/api/mp/preapprovals", { saas: product.id, ...(status !== "any" ? { status } : {}) }),
      customerIndex(product.id),
    ]);
    let rows = (espelho.preapprovals || []).map((x) => ({
      id: x.id, mpId: x.mpId, status: x.status,
      reason: x.reason || "",
      amount: num(x.amount),
      ciclo: CYCLE_LABEL[x.cycle] || `${x.frequency} ${x.frequencyType}`,
      mrr: x.cycle ? mrrOf(x.amount, x.cycle) : num(x.amount),
      payerEmail: x.payerEmail || "",
      cliente: clientes.get(x.customer)?.name || "", customer: x.customer || "",
      subscription: x.subscription || "",
      sugestaoCliente: clientes.get(x.suggestedCustomer)?.name || x.suggestedCustomer || "",
      matchedBy: x.matchedBy || "",
      nextPaymentDate: dayOf(x.nextPaymentDate), lastChargedDate: dayOf(x.lastChargedDate),
      chargedQuantity: num(x.chargedQuantity), chargedAmount: num(x.chargedAmount),
    }));
    if (only_unlinked) rows = rows.filter((r) => !r.subscription);
    const autorizadas = rows.filter((r) => r.status === "authorized");
    const s = select(rows, { q, qFields: ["payerEmail", "reason", "mpId"], sort: "status", limit, offset });

    return result({
      kind: "mp.preapprovals",
      title: `Recorrências do Mercado Pago · ${product.name || product.id}`,
      scope: { saas: product.id, status },
      units: UNITS,
      totals: {
        recorrencias: rows.length,
        autorizadas: autorizadas.length,
        mrrAutorizado: somaCampo(autorizadas, "mrr"),
        semVinculo: rows.filter((r) => !r.subscription).length,
        canceladas: rows.filter((r) => r.status === "cancelled").length,
        ultimoSync: espelho.sync?.lastAt || "",
      },
      columns: ["status", "amount", "ciclo", "mrr", "payerEmail", "cliente", "subscription", "sugestaoCliente", "nextPaymentDate", "lastChargedDate", "chargedQuantity", "id"],
      rows: s.rows,
      rowsLabel: "Recorrências",
      page: s.page,
      notes: [
        "vincular é decisão humana (mp_link): o vínculo carimba mpPreapprovalId na assinatura e, daí em diante, cancelar no cockpit CANCELA no Mercado Pago.",
        "mrrAutorizado é o que o MP cobra por mês nas recorrências autorizadas — compare com o mrrContratado de subscriptions_list para achar cliente cobrando fora do cockpit (ou assinatura sem cobrança).",
      ],
      source: { endpoint: "GET /api/mp/preapprovals", syncedAt: espelho.sync?.lastAt || null },
    });
  });

  tool("mp_sync", {
    group: G_MP,
    title: "Sincronizar com o Mercado Pago",
    description: "Puxa do Mercado Pago pagamentos, recorrências e/ou saídas: atualiza o espelho e baixa faturas.",
    write: true, external: true, idempotent: true,
    input: {
      target: z.enum(["payments", "preapprovals", "outflows", "all"]).optional().describe("Padrão payments."),
      saas: z.string().optional().describe("Necessário para outflows."),
    },
    hint: "sem MERCADOPAGO_ACCESS_TOKEN no servidor tudo aqui falha (424).",
  }, async ({ target = "payments", saas }) => {
    const alvos = target === "all" ? ["payments", "preapprovals", "outflows"] : [target];
    const product = alvos.includes("outflows") ? await resolveProduct(saas) : null;
    const rows = [];
    const notes = [];
    for (const t of alvos) {
      try {
        if (t === "payments") {
          const r = await http.post("/api/mp/sync", {}, { timeoutMs: 300_000 });
          rows.push({ alvo: "entradas", ok: r.ok !== false, lidos: num(r.seen), casados: num(r.matched), faturasBaixadas: num(r.settled), desde: r.since || "" });
        } else if (t === "preapprovals") {
          const r = await http.post("/api/mp/preapprovals/sync", {}, { timeoutMs: 300_000 });
          rows.push({ alvo: "recorrências", ok: r.ok !== false, lidos: num(r.seen), casados: num(r.linked), semVinculo: num(r.unlinked) });
        } else {
          const r = await http.post(`/api/fin/${encodeURIComponent(product.id)}/mp-out/sync`, {}, { timeoutMs: 300_000 });
          rows.push({ alvo: "saídas", ok: r.ok !== false, importados: num(r.imported), relatoriosLidos: num(r.filesRead), relatoriosNaConta: num(r.filesTotal), pediuRelatorio: !!r.requested });
          if (r.requestError) notes.push(`o MP recusou gerar um relatório novo de saídas: ${r.requestError}`);
          if (r.requested) notes.push("relatório de saídas novo foi PEDIDO ao MP (assíncrono): rode de novo em alguns minutos para importar.");
        }
      } catch (err) {
        // Um alvo fora do ar não pode derrubar os outros — o resultado parcial vale.
        rows.push({ alvo: t, ok: false, erro: String(err.message || err).slice(0, 200) });
      }
    }
    return result({
      kind: "mp.sync",
      title: `Sync do Mercado Pago (${alvos.join(", ")})`,
      scope: product ? { saas: product.id } : undefined,
      totals: { alvos: rows.length, falhas: rows.filter((r) => !r.ok).length, faturasBaixadas: rows.reduce((a, r) => a + num(r.faturasBaixadas), 0) },
      columns: ["alvo", "ok", "lidos", "casados", "faturasBaixadas", "importados", "relatoriosLidos", "erro"],
      rows,
      rowsLabel: "Sincronizações",
      notes,
      source: { endpoint: "POST /api/mp/sync · /api/mp/preapprovals/sync · /api/fin/:saas/mp-out/sync" },
    });
  });

  tool("mp_link", {
    group: G_MP,
    title: "Vincular pagamento ou recorrência",
    description: "Liga pagamento do espelho a cliente ou recorrência a assinatura; também desconsidera e aprende a regra.",
    write: true, destructive: true,
    danger: "vincular pagamento pode dar BAIXA em fatura, e vincular recorrência faz o cancelamento no cockpit cancelar a cobrança real no Mercado Pago.",
    input: {
      target: z.enum(["payment", "preapproval"]),
      id: z.string().describe("mpp_… pagamento, mps_… recorrência."),
      action: z.enum(["link", "unlink", "ignore", "unignore"]).optional().describe("Padrão link. ignore/unignore só para pagamento."),
      customer: z.string().optional(),
      subscription: z.string().optional().describe("Se o cliente tem mais de uma."),
      reason: z.string().optional().describe("Motivo ao desconsiderar."),
      remember: z.boolean().optional().describe("Cria regra do pagador (doc > e-mail > nome). Padrão false."),
      saas: z.string().optional().describe("Produto da regra."),
    },
    hint: "os ids são os do espelho (campo id), não o mpId do Mercado Pago.",
  }, async ({ target, id, action = "link", customer, subscription, reason, remember = false, saas }) => {
    const notes = [];
    let doc;
    if (target === "preapproval") {
      if (action === "ignore" || action === "unignore") throw new Error("ignore/unignore só existe para pagamento.");
      const body = action === "unlink" ? {} : { ...(subscription ? { subscription } : {}), ...(customer ? { customer } : {}) };
      if (action === "link" && !subscription && !customer) throw new Error("link de recorrência exige subscription ou customer.");
      const r = await http.post(`/api/mp/preapprovals/${encodeURIComponent(id)}/link`, body);
      doc = r.preapproval;
      if (r.subscription) notes.push(`assinatura ${r.subscription.id} agora responde pela recorrência ${doc?.mpId || id}.`);
    } else if (action === "ignore" || action === "unignore") {
      doc = await http.patch(`/api/mp_payments/${encodeURIComponent(id)}`, action === "ignore"
        ? { finIgnored: true, finIgnoredReason: reason || "outro" }
        : { finIgnored: false, finIgnoredReason: "" });
    } else {
      if (action === "link" && !customer) throw new Error("link de pagamento exige customer (use action=unlink para desvincular).");
      const r = await http.post(`/api/mp/payments/${encodeURIComponent(id)}/link`, action === "unlink" ? {} : { customer });
      doc = r.payment;
      if (r.invoice) notes.push(`fatura ${r.invoice} foi baixada por este pagamento (valor exato, única em aberto).`);
    }

    // Aprendizado: a mesma regra que a tela cria quando "lembrar" está ligado.
    if (remember && target === "payment" && (action === "link" || action === "ignore")) {
      const campo = String(doc?.payerDoc || "").replace(/\D+/g, "") ? "payerDoc" : doc?.payerEmail ? "payerEmail" : doc?.payerName ? "payerName" : "";
      if (!campo) notes.push("não deu para aprender a regra: o pagamento não tem documento, e-mail nem nome do pagador.");
      else {
        const product = await resolveProduct(saas || doc?.saas).catch(() => null);
        await http.post("/api/fin_rules", {
          saas: product?.id || doc?.saas || "",
          matchField: campo, matchValue: doc[campo],
          action: action === "link" ? "vincular" : "desconsiderar",
          ...(action === "link" ? { customer } : { reason: reason || "outro" }),
          createdAt: new Date().toISOString(),
        }).catch((e) => notes.push(`regra não foi criada: ${e.message}`));
        notes.push(`regra criada por ${campo}: esse pagador é tratado sozinho nas próximas leituras do Financeiro.`);
      }
    }

    return result({
      kind: "mp.link",
      title: `${target === "payment" ? "Pagamento" : "Recorrência"} ${id} · ${action}`,
      scope: { target, id, action },
      units: UNITS,
      detail: doc,
      notes,
      source: { endpoint: `POST /api/mp/${target === "payment" ? "payments" : "preapprovals"}/${id}/link` },
    });
  });

  // ── Links de pagamento ────────────────────────────────────────────────────
  tool("payment_links_list", {
    group: G_LINK,
    title: "Links de pagamento gerados",
    description: "Histórico dos links gerados e o status do dinheiro: pago, esperando ou substituído.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["paid", "waiting", "superseded", "outros", "any"]).optional().describe("Padrão any. waiting = ainda não pago; outros = não aprovado."),
      kind: z.enum(["lead", "customer", "invoice"]).optional().describe("Origem do link."),
      ...periodInput(z),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "any", kind, period, since, until, q, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const temPeriodo = !!(period || since || until);
    const p = temPeriodo ? resolvePeriod({ period, since, until }) : null;
    const r = await http.get("/api/payment-links", { saas: product.id });
    let rows = (r.links || []).map((l) => ({
      id: l.id, criadoEm: dayOf(l.createdAt),
      kind: l.kind, origin: l.origin,
      alvo: l.targetName || l.payerEmail || l.lead || l.customer || "",
      title: l.title || "", amount: num(l.amount),
      status: l.status, paidAt: dayOf(l.paidAt),
      recorrente: !!l.recurring, frequencyMonths: num(l.frequencyMonths),
      metodo: l.payment?.method || "", parcelas: num(l.payment?.installments),
      pagador: l.payment?.payerName || "",
      invoice: l.invoice || "", invoiceStatus: l.invoiceStatus || "",
      lead: l.lead || "", customer: l.customer || "",
      url: l.url || "", createdBy: l.createdBy || "",
    }));
    if (kind) rows = rows.filter((x) => x.kind === kind);
    if (p) rows = rows.filter((x) => x.criadoEm >= p.since && x.criadoEm <= p.until);
    // O status do link é o status do PAGAMENTO quando existe um: além de paid/
    // waiting/superseded ele pode vir rejected, pending, refunded… — sem o balde
    // `outros` esses links sumiriam da soma e o total não fecharia com a lista.
    const OUTRO = (st) => st !== "paid" && st !== "waiting" && st !== "superseded";
    if (status === "outros") rows = rows.filter((x) => OUTRO(x.status));
    else if (status !== "any") rows = rows.filter((x) => x.status === status);

    const pagos = rows.filter((x) => x.status === "paid");
    const esperando = rows.filter((x) => x.status === "waiting");
    const outros = rows.filter((x) => OUTRO(x.status));
    const s = select(rows, { q, qFields: ["alvo", "title", "pagador", "id"], sort: "criadoEm:desc", limit, offset });

    return result({
      kind: "payment_links.list",
      title: `Links de pagamento · ${product.name || product.id}`,
      scope: { saas: product.id, status },
      period: p || undefined,
      units: UNITS,
      totals: {
        links: rows.length,
        total: somaCampo(rows, "amount"),
        pagos: pagos.length, pagoValor: somaCampo(pagos, "amount"),
        esperando: esperando.length, esperandoValor: somaCampo(esperando, "amount"),
        substituidos: rows.filter((x) => x.status === "superseded").length,
        outros: outros.length,
        conversao: rows.length ? round2((pagos.length / rows.length) * 100) : null,
      },
      columns: ["criadoEm", "alvo", "title", "amount", "status", "paidAt", "kind", "origin", "recorrente", "metodo", "pagador", "url"],
      rows: s.rows,
      rowsLabel: "Links",
      page: s.page,
      notes: [
        "substituído = link sem pagamento que já tem outro mais novo para o mesmo alvo e valor; não é cobrança esperando.",
        "outros = o link tem pagamento, mas não aprovado (recusado, pendente, estornado): não é dinheiro na conta nem cobrança esperando.",
        "cada pagamento é atribuído a UM link só (do mais novo para o mais velho): gerar o link de novo não conta o mesmo dinheiro duas vezes.",
      ],
      source: { endpoint: "GET /api/payment-links" },
    });
  });

  tool("charge_customer", {
    group: G_LINK,
    title: "Cobrança avulsa de um cliente",
    description: "Cria uma fatura avulsa (ou upsell) para um cliente e devolve o link de pagamento.",
    write: true, external: true,
    danger: "gera uma cobrança REAL para um cliente de verdade — o link já sai pronto para ser enviado.",
    input: {
      customer_id: z.string(),
      amount: z.number().positive().describe("Em R$ (597 = R$ 597,00)."),
      title: z.string().optional().describe("Visto pelo cliente no checkout."),
      kind: z.enum(["manual", "upsell"]).optional().describe("Padrão manual."),
      due_date: z.string().optional().describe("ISO ou YYYY-MM-DD. Padrão hoje."),
      max_installments: z.number().int().optional().describe("Parcelas no cartão."),
    },
    hint: "se o MP recusar, a fatura criada é removida sozinha — nada fica órfão.",
  }, async ({ customer_id, amount, title, kind = "manual", due_date, max_installments }) => {
    const r = await http.post(`/api/customers/${encodeURIComponent(customer_id)}/charge`, {
      amount, kind,
      ...(title ? { title } : {}),
      ...(due_date ? { dueDate: due_date } : {}),
      ...(max_installments ? { maxInstallments: max_installments } : {}),
      origin: "cliente",
    });
    return result({
      kind: "payment_links.charge",
      title: `Cobrança de R$ ${round2(num(amount))} · cliente ${customer_id}`,
      scope: { customer: customer_id, invoice: r.invoice?.id || "" },
      units: UNITS,
      totals: { amount: num(r.invoice?.amount), invoice: r.invoice?.id || "", status: r.invoice?.status || "", url: r.url || "" },
      notes: ["a fatura nasce ABERTA: ela vira caixa quando o pagamento cair (webhook/sync do MP) — não marque como paga na mão."],
      source: { endpoint: `POST /api/customers/${customer_id}/charge` },
    });
  });

}
