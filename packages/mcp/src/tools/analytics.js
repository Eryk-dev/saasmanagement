// Relatórios. É aqui que mora o pedido "quero gerar relatório mais rápido e
// mais preciso": cada tool devolve o bloco JÁ fechado — meta, realizado, ritmo
// necessário, taxa por etapa, por pessoa — em vez de linhas cruas pra alguém
// somar de novo (e somar diferente do cockpit, que era o erro de sempre).
//
// A régua é a mesma da API (metrics-core.js): dia do negócio em São Paulo,
// receita RECONHECIDA vs contratada (TCV) separadas, lead interno fora.

import { z } from "zod";
import { http } from "../core/http.js";
import { resolveProduct, listProducts } from "../core/products.js";
import { resolvePeriod, periodInput, delta, today } from "../core/period.js";
import { result } from "../core/envelope.js";
import { round2, num } from "../core/shape.js";

const BRL = "BRL";
const UNITS = {
  target: BRL, sold: BRL, contracted: BRL, gap: BRL, revenue: BRL, collected: BRL,
  expectedToDate: BRL, projected: BRL, actualDailyPace: BRL, requiredDailyPace: BRL,
  ticket: BRL, spend: BRL, cac: BRL, upsellRevenue: BRL, keyRevenue: BRL,
  contactRate: "%", bookingRate: "%", showRate: "%", winRateCall: "%", callWinRate: "%",
  closeRate: "%", retentionRate: "%", conversaoCall: "%", convRate: "%", followupWinRate: "%",
  progress: "0..1", expectedProgress: "0..1",
};

const COLS = {
  sdr: ["name", "leadsNew", "contacted", "contactRate", "callsBooked", "bookingRate", "shown", "noShow", "showRate", "won", "revenue", "firstTouchMedianH", "withinSla", "breached"],
  closer: ["name", "calls", "callsShown", "won", "lost", "winRateCall", "revenue", "contracted", "ticket", "cycleDays", "followupWinRate"],
  cs: ["name", "activeAccounts", "newAccounts", "churned", "retentionRate", "nps", "npsCount", "upsells", "upsellRevenue", "referrals"],
  funil: ["stage", "kind", "entered", "current", "convToNext", "medianDaysInStage"],
};

export function registerAnalyticsTools(tool) {
  tool("report_pace", {
    group: "Relatórios",
    title: "Pace do mês",
    description: "Ritmo do mês contra a meta: vendido, contratado, caixa, gap e projeção.",
    input: {
      saas: z.string().optional(),
      since: z.string().optional().describe("YYYY-MM-DD (com until); padrão mês corrente."),
      until: z.string().optional(),
    },
  }, async ({ saas, since, until }) => {
    const product = await resolveProduct(saas);
    const janela = since && until;
    const data = janela
      ? await http.get(`/api/pipeline-pace/${encodeURIComponent(product.id)}/window`, { since, until })
      : await http.get(`/api/pipeline-pace/${encodeURIComponent(product.id)}`);

    const blocos = ["sale", "contracts", "cash"].filter((k) => data[k]);
    const totals = {};
    // A unidade acompanha a chave PREFIXADA (`sale.target`), senão o relatório
    // sai com "120000" sem dizer que é real — que é o tipo de número que alguém
    // copia errado pro slide.
    const units = {};
    for (const b of blocos) for (const [k, v] of Object.entries(data[b])) {
      if (v !== null && typeof v === "object") continue; // byDay/superMetas viram tabela
      totals[`${b}.${k}`] = v;
      if (UNITS[k]) units[`${b}.${k}`] = b === "contracts" && UNITS[k] === BRL ? "contratos" : UNITS[k];
    }
    const tables = {};
    if (data.sale?.byDay?.length) {
      tables.porDia = {
        label: "Receita reconhecida por dia do mês",
        columns: ["dia", "revenue"],
        rows: data.sale.byDay.map((v, i) => ({ dia: i + 1, revenue: round2(v) })).filter((r) => r.revenue),
      };
    }
    if (data.sale?.superMetas?.length) {
      tables.superMetas = { label: "Super metas", columns: ["pct", "mult", "value", "hit"], rows: data.sale.superMetas };
    }
    if (data.keyAccount) tables.keyAccount = { label: "Key accounts (fora da meta padrão)", rows: [data.keyAccount] };

    return result({
      kind: "report.pace",
      title: `Pace · ${product.name || product.id}${janela ? ` (${since} → ${until})` : ` (${data.month})`}`,
      scope: { saas: product.id, mes: data.month || null, hoje: data.today || today() },
      units: { ...units, revenue: BRL },
      totals,
      tables,
      notes: [
        "`sold` é receita RECONHECIDA no mês; `contracted` é o valor cheio do contrato (TCV). Não some os dois.",
        data.sale?.targetConfigured === false ? "meta de venda NÃO configurada — o alvo mostrado é o padrão do sistema." : null,
      ].filter(Boolean),
      source: { endpoint: janela ? `GET /api/pipeline-pace/${product.id}/window` : `GET /api/pipeline-pace/${product.id}` },
    });
  });

  tool("report_scoreboard", {
    group: "Relatórios",
    title: "Placar do time",
    description: "Performance por pessoa e do time: leads, contato, agendamento, comparecimento, fechamento e receita.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      roles: z.array(z.enum(["sdr", "closer", "cs", "team"])).optional().describe("Padrão: todos."),
      compare: z.boolean().optional().describe("Compara com o período anterior."),
    },
  }, async ({ saas, period, since, until, roles, compare = false }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const inc = new Set(roles?.length ? roles : ["sdr", "closer", "cs", "team"]);
    const data = await http.get(`/api/scoreboard/${encodeURIComponent(product.id)}`, {
      since: p.since, until: p.until, prevSince: p.previous.since, prevUntil: p.previous.until,
    });

    const tables = {};
    if (inc.has("sdr")) tables.sdr = { label: "SDR", columns: COLS.sdr, rows: data.sdr || [] };
    if (inc.has("closer")) tables.closer = { label: "Closer", columns: COLS.closer, rows: data.closer || [] };
    if (inc.has("cs")) tables.cs = { label: "CS", columns: COLS.cs, rows: data.cs || [] };

    const t = data.team || {};
    const totals = inc.has("team") ? Object.fromEntries(
      Object.entries(t).filter(([, v]) => v === null || typeof v !== "object"),
    ) : {};

    if (inc.has("team")) {
      if (t.classes) tables.classes = { label: "Por classe de lead", columns: ["classe", "leads", "won", "revenue"], rows: Object.entries(t.classes).map(([k, v]) => ({ classe: k, ...v })) };
      if (t.cash) tables.caixa = { label: "Caixa por natureza", rows: [t.cash] };
      if (t.firstTouch) tables.primeiroToque = { label: "Primeiro toque (SLA)", rows: [t.firstTouch] };
      if (t.firstResponse) tables.primeiraResposta = { label: "Primeira resposta", rows: [t.firstResponse] };
      if (t.pipelineCreated) tables.pipelineCriado = { label: "Pipeline criado", rows: [t.pipelineCreated] };
      if (t.stalled?.items?.length) tables.parados = { label: `Leads parados (${t.stalled.count})`, columns: ["id", "name", "stage", "days"], rows: t.stalled.items };
      if (t.contactedBy?.length) tables.contatoPor = { label: "Contato por pessoa", columns: ["name", "leads"], rows: t.contactedBy };
      if (t.keyAccount) tables.keyAccount = { label: "Key accounts", rows: [t.keyAccount] };
    }

    if (compare) {
      const ant = await http.get(`/api/scoreboard/${encodeURIComponent(product.id)}`, { since: p.previous.since, until: p.previous.until }).catch(() => null);
      if (ant?.team) {
        const chaves = ["leadsNew", "contacted", "callsBooked", "shown", "won", "revenue", "contracted", "showRate", "callWinRate"];
        tables.comparativo = {
          label: `Time vs ${p.previous.since} → ${p.previous.until}`,
          columns: ["metrica", "atual", "anterior", "variacao", "variacao_pct"],
          rows: chaves.map((k) => {
            const d = delta(t[k], ant.team[k]);
            return d && { metrica: k, atual: d.current, anterior: d.previous, variacao: d.abs, variacao_pct: d.pct };
          }).filter(Boolean),
        };
      }
    }

    return result({
      kind: "report.scoreboard",
      title: `Placar · ${product.name || product.id}`,
      scope: { saas: product.id },
      period: p,
      units: UNITS,
      totals,
      tables,
      notes: [
        "`contacted` é carga de trabalho (todo lead tocado na janela); `contactedCohort` é o número do funil (tocados entre os leads CRIADOS na janela). Relatório de conversão usa o cohort.",
        "`revenue` é receita reconhecida; `contracted` é TCV.",
      ],
      source: { endpoint: `GET /api/scoreboard/${product.id}` },
    });
  });

  tool("report_funnel", {
    group: "Relatórios",
    title: "Funil e conversão",
    description: "Conversão etapa a etapa no período, tempo por etapa e motivos de perda.",
    input: { saas: z.string().optional(), ...periodInput(z) },
  }, async ({ saas, period, since, until }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const d = await http.get(`/api/funnel/${encodeURIComponent(product.id)}`, { since: p.since, until: p.until });
    return result({
      kind: "report.funnel",
      title: `Funil · ${product.name || product.id}`,
      scope: { saas: product.id },
      period: p,
      units: { winRate: "0..1", convToNext: "0..1" },
      totals: {
        winRate: d.winRate, wonCount: d.wonCount, lostCount: d.lostCount, dqCount: d.dqCount,
        leadsNaCoorte: d.coverage?.leads ?? null, comHistorico: d.coverage?.withHistory ?? null,
        primeiroToqueMedianoH: d.firstTouch?.medianHours ?? null,
        tocados: d.firstTouch?.touched ?? null, semToque: d.firstTouch?.untouched ?? null,
      },
      columns: COLS.funil,
      rows: d.stages || [],
      rowsLabel: "Etapas",
      tables: {
        perdas: { label: "Motivos de perda", columns: ["reason", "count"], rows: d.lossReasons || [] },
        toque: { label: "Primeiro toque por faixa", columns: ["ate_1h", "ate_4h", "ate_24h"], rows: [{ ate_1h: d.firstTouch?.buckets?.h1 ?? null, ate_4h: d.firstTouch?.buckets?.h4 ?? null, ate_24h: d.firstTouch?.buckets?.h24 ?? null }] },
      },
      notes: d.coverage && d.coverage.withHistory < d.coverage.leads
        ? [`${d.coverage.leads - d.coverage.withHistory} leads da coorte não têm histórico de estágio e caem na aproximação pelo estágio atual.`]
        : [],
      source: { endpoint: `GET /api/funnel/${product.id}` },
    });
  });

  tool("report_unit_economics", {
    group: "Relatórios",
    title: "CAC e LTV",
    description: "CAC, ticket, LTV, LTV/CAC e série mensal de gasto, leads, clientes novos e MRR.",
    input: {
      saas: z.string().optional(),
      days: z.number().int().optional().describe("7 a 365, padrão 30."),
      months: z.number().int().optional().describe("3 a 24, padrão 12."),
    },
  }, async ({ saas, days, months }) => {
    const product = await resolveProduct(saas);
    const d = await http.get(`/api/metrics/${encodeURIComponent(product.id)}`, { days, months });
    return result({
      kind: "report.unit_economics",
      title: `Unit economics · ${product.name || product.id}`,
      scope: { saas: product.id, days: d.days, months: d.months },
      units: { ...UNITS, spend: BRL, ticket: BRL, value: BRL, mrr: BRL },
      totals: {
        janela_spend: d.window?.spend ?? null,
        janela_leads: d.window?.leads ?? null,
        janela_novosClientes: d.window?.newCustomers ?? null,
        cac: d.window?.cac ?? null,
        convRate: d.window?.convRate ?? null,
        ltv_ticket: d.ltv?.ticket ?? null,
        ltv_meses: d.ltv?.months ?? null,
        ltv_valor: d.ltv?.value ?? null,
        ltv_cac: d.ltv?.ltvCac ?? null,
        clientesPagantes: d.ltv?.payingCustomers ?? null,
      },
      columns: ["month", "spend", "leads", "newCustomers", "cac", "mrr"],
      rows: d.series || [],
      rowsLabel: "Série mensal",
      notes: ["`ltv.months` é uma PREMISSA do produto (product.ltvMonths), não churn medido. Diga isso no relatório."],
      source: { endpoint: `GET /api/metrics/${product.id}` },
    });
  });

  tool("report_expenses", {
    group: "Relatórios",
    title: "Custos do mês",
    description: "Custos do mês: anúncios, IA, WhatsApp, custos manuais e contas a pagar.",
    input: {
      saas: z.string().optional(),
      month: z.string().optional().describe("YYYY-MM, padrão mês corrente."),
    },
  }, async ({ saas, month }) => {
    const product = await resolveProduct(saas);
    const d = await http.get(`/api/expenses/summary/${encodeURIComponent(product.id)}`, { month });
    return result({
      kind: "report.expenses",
      title: `Custos · ${product.name || product.id} · ${d.month}`,
      scope: { saas: product.id, mes: d.month },
      units: { ads: BRL, ai: BRL, wa: BRL, manualTotal: BRL, payablesTotal: BRL, total: BRL, wonBase: BRL, cardBase: BRL, receivedBase: BRL, aiUSD: "USD" },
      totals: {
        total: d.total, ads: d.ads, ai: d.ai, aiUSD: d.aiUSD, usdBrl: d.usdBrl,
        wa: d.wa, waConversations: d.waConversations,
        manualTotal: d.manualTotal, payablesTotal: d.payablesTotal, payablesCount: d.payablesCount,
        wonBase: d.wonBase ?? null, cardBase: d.cardBase ?? null, receivedBase: d.receivedBase ?? null,
      },
      tables: { manuais: { label: "Custos manuais", rows: d.manual || [] } },
      source: { endpoint: `GET /api/expenses/summary/${product.id}` },
    });
  });

  tool("report_ai_costs", {
    group: "Relatórios",
    title: "Custo de IA",
    description: "Gasto com provedores de IA em dólar, com série diária e crédito restante.",
    external: true,
    input: { days: z.number().int().optional().describe("7 a 90, padrão 30.") },
  }, async ({ days }) => {
    const d = await http.get("/api/ai-costs", { days });
    return result({
      kind: "report.ai_costs",
      title: "Custo de IA",
      scope: { days: d.days },
      units: { totalPeriod: "USD", spend: "USD", lifetimeSpend: "USD", credits: "USD", remaining: "USD" },
      totals: { totalPeriod: d.totalPeriod, usdBrl: d.usdBrl, totalBRL: d.usdBrl ? round2(num(d.totalPeriod) * num(d.usdBrl)) : null },
      columns: ["label", "provider", "ok", "spend", "lifetimeSpend", "remaining", "error"],
      rows: (d.providers || []).map(({ series, ...r }) => r), // eslint-disable-line no-unused-vars
      rowsLabel: "Provedores",
      source: { endpoint: "GET /api/ai-costs" },
    });
  });

  tool("report_goals", {
    group: "Relatórios",
    title: "Metas e desdobramento",
    description: "Metas por papel, por pessoa e de caixa, com desdobramento em leads, calls e fechamentos.",
    input: { saas: z.string().optional() },
  }, async ({ saas }) => {
    const product = await resolveProduct(saas);
    const d = await http.get(`/api/metas/${encodeURIComponent(product.id)}`);
    const dv = d.derived || {};
    return result({
      kind: "report.goals",
      title: `Metas · ${product.name || product.id}`,
      scope: { saas: product.id },
      units: { target: BRL, base: BRL, ticket: BRL, cashTarget: BRL },
      totals: {
        cashTarget: d.company?.cashTarget ?? null,
        contractsTarget: d.company?.contractsTarget ?? null,
        growthPct: d.company?.growthPct ?? null,
        target: dv.target ?? null, base: dv.base ?? null, ticket: dv.ticket ?? null,
        precisaGanhos: dv.won ?? null, precisaCallsFeitas: dv.callsShown ?? null,
        precisaCallsAgendadas: dv.callsBooked ?? null, precisaContatos: dv.contacts ?? null, precisaLeads: dv.leads ?? null,
        travadoPor: dv.blockedBy ?? null,
      },
      tables: {
        meses: { label: "Meta por mês", columns: ["month", "target", "effective", "source", "current"], rows: d.company?.months || [] },
        taxas: { label: "Taxas usadas no desdobramento", rows: dv.rates ? [dv.rates] : [] },
        porPessoa: { label: "Metas por pessoa", columns: ["key", "metric", "target"], rows: d.userGoals || [] },
        pessoas: { label: "Equipe", columns: ["id", "name", "roles", "compLevel"], rows: d.users || [] },
      },
      notes: ["`derived` mostra o que a meta EXIGE dadas as taxas atuais; `blockedBy` é a taxa que mais aperta."],
      source: { endpoint: `GET /api/metas/${product.id}` },
    });
  });

  tool("report_portfolio", {
    group: "Relatórios",
    title: "Portfólio",
    description: "Consolidado do portfólio: MRR, ARR, clientes e pace do mês por produto.",
    input: { include_pace: z.boolean().optional().describe("Padrão true.") },
  }, async ({ include_pace = true }) => {
    const [portfolio, produtos] = await Promise.all([http.get("/api/portfolio"), listProducts({ fresh: true })]);
    const rows = produtos.map((p) => ({
      id: p.id, name: p.name, mrr: p.mrr, arr: p.arr, customers: p.customers,
      health: p.health, nrr: p.nrr, churnRate: p.churnRate, metaAdAccount: p.metaAdAccount || null,
    }));
    const tables = {};
    if (include_pace) {
      const paces = await Promise.all(produtos.map((p) =>
        http.get(`/api/pipeline-pace/${encodeURIComponent(p.id)}`).then((d) => ({
          saas: p.id, mes: d.month,
          meta: d.sale?.target ?? null, vendido: d.sale?.sold ?? null, contratado: d.sale?.contracted ?? null,
          gap: d.sale?.gap ?? null, projecao: d.sale?.projected ?? null, status: d.sale?.status ?? null,
          caixa: d.cash?.collected ?? null, metaCaixa: d.cash?.target ?? null,
        })).catch(() => null)));
      tables.pace = { label: "Pace do mês por produto", columns: ["saas", "mes", "meta", "vendido", "contratado", "gap", "projecao", "status", "caixa", "metaCaixa"], rows: paces.filter(Boolean) };
    }
    return result({
      kind: "report.portfolio",
      title: "Portfólio",
      units: { mrr: BRL, arr: BRL, meta: BRL, vendido: BRL, contratado: BRL, gap: BRL, projecao: BRL, caixa: BRL, metaCaixa: BRL },
      totals: portfolio || {},
      columns: ["id", "name", "mrr", "arr", "customers", "health", "nrr", "churnRate", "metaAdAccount"],
      rows,
      rowsLabel: "Produtos",
      tables,
      notes: ["`nrr` e `mrrSeries30d` do portfólio são constantes de seed, não são calculados — não cite como medição."],
      source: { endpoint: "GET /api/portfolio" },
    });
  });

  tool("report_elo_app", {
    group: "Relatórios",
    title: "Elo · app",
    description: "Métricas do app Elo: assinaturas, pedidos, receita, casais, streaks, trials e missões.",
    input: { days: z.number().int().optional().describe("7 a 365, padrão 30.") },
  }, async ({ days }) => {
    const d = await http.get("/api/elo/overview", { days });
    if (!d.configured) {
      return result({ kind: "report.elo_app", title: "Elo · app", totals: { configured: false }, notes: ["ELO_DB_URL não configurado no servidor: sem acesso ao banco do app."], source: { endpoint: "GET /api/elo/overview" } });
    }
    return result({
      kind: "report.elo_app",
      title: "Elo · app",
      scope: { days: d.days },
      units: { revenue_cents_period: "centavos" },
      totals: {
        ...d.orders,
        casais_total: d.couples?.total, casais_aceitos: d.couples?.accepted, casais_novos: d.couples?.new_period,
        streaks_ativos: d.streaks?.active, trials_ativos: d.trials?.active, trials_novos: d.trials?.new_period,
        missoes_reveladas: d.missions_period?.revealed,
      },
      tables: {
        assinaturas: { label: "Assinaturas", columns: ["status", "channel", "plan", "n"], rows: d.subs || [] },
        pedidosDia: { label: "Pedidos aprovados por dia", columns: ["d", "approved"], rows: d.orders_daily || [] },
        streaks: { label: "Faixas de streak", rows: d.streaks ? [d.streaks] : [] },
        missoesDia: { label: "Missões por dia", columns: ["d", "revealed", "solo"], rows: d.missions_daily || [] },
      },
      source: { endpoint: "GET /api/elo/overview" },
    });
  });

  tool("report_landing_pages", {
    group: "Relatórios",
    title: "Landing pages",
    description: "Visitas, cliques em CTA e conversão das landing pages por página e origem.",
    input: { saas: z.string().optional().describe("Padrão elo."), days: z.number().int().optional() },
  }, async ({ saas, days }) => {
    const d = await http.get("/api/lp/summary", { saas, days });
    return result({
      kind: "report.landing_pages",
      title: `Landing pages · ${d.saas}`,
      scope: { saas: d.saas, days: d.days },
      totals: {
        configured: d.configured,
        sessoes: (d.pages || []).reduce((a, p) => a + num(p.sessions), 0),
        ctaSessoes: (d.pages || []).reduce((a, p) => a + num(p.ctaSessions), 0),
        ctaCliques: (d.pages || []).reduce((a, p) => a + num(p.ctaClicks), 0),
      },
      columns: ["page", "sessions", "ctaSessions", "ctaClicks"],
      rows: d.pages || [],
      rowsLabel: "Páginas",
      tables: {
        origens: { label: "Origem do tráfego", columns: ["source", "sessions", "ctaSessions"], rows: d.sources || [] },
        ctas: { label: "CTAs mais clicados", columns: ["label", "clicks"], rows: d.ctaLabels || [] },
      },
      source: { endpoint: "GET /api/lp/summary" },
    });
  });
}
