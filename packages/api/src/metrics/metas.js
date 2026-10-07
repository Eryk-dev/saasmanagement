// Catálogo das metas de desempenho (por vaga e da equipe) e as metas padrão
// derivadas do pace do pipeline. A edição mora em routes.metas.js; o placar
// (scoreboard.js) lê o mesmo catálogo.

import { RATE_BENCHMARKS } from "./pipeline-pace.js";

// Benchmark do pace (0..1) vira o "padrão" em % que a tela mostra: um número só
// pros dois lados.
const pct = (r) => Math.round(r * 100);

// Catálogo das métricas por vaga: rótulo, unidade e o benchmark padrão (o valor
// que a Visão geral usa quando não há meta configurada). `default: null` = sem
// padrão (o Leo define, ex.: ganhos/receita/ticket).
//
// `kind` = como a métrica se comporta no TEMPO, e é o que decide se a meta do
// mês pode ser reescalada pra uma janela menor:
//   flow  acumula (contatos, ganhos, receita, posts) → meta de 7 dias = fatia
//   rate  proporção (taxas) → 30% é 30% em qualquer janela
//   avg   média (ticket) e stock = saldo (contas ativas) → nunca se reparte no
//         tempo: metade do mês não tem "metade do ticket".
//
// `team: true` = a meta é o alvo do TIME INTEIRO, e o placar divide pelas
// pessoas da vaga (2 closers e "24 ganhos" = 12 pra cada, somando os 24 que a
// empresa precisa). Sem a flag, a meta é de CADA pessoa — é o certo pra taxa
// (30% de agendamento é 30% pra todo mundo) e pra média/índice (ticket, NPS),
// que não se reparte.
export const META_CATALOG = [
  {
    role: "sdr", label: "SDR", hint: "prospecção e agendamento",
    metrics: [
      { metric: "contactRate", kind: "rate", label: "Taxa de contato", unit: "%", hint: "dos leads novos, quantos você alcança", default: pct(RATE_BENCHMARKS.contactRate) },
      { metric: "bookingRate", kind: "rate", label: "Taxa de agendamento", unit: "%", hint: "dos contatados, quantos marcam call", default: pct(RATE_BENCHMARKS.bookingRate) },
      { metric: "showRate", kind: "rate", label: "Comparecimento na call", unit: "%", hint: "das agendadas, quantas acontecem", default: pct(RATE_BENCHMARKS.showRate) },
      { metric: "contacts", kind: "flow", label: "Contatos no mês", unit: "n", default: null, team: true },
      { metric: "callsBooked", kind: "flow", label: "Calls agendadas", unit: "n", default: null, team: true },
      // As duas pernas do SDR: contratos e receita. Desde 06/10/2026 (Leo) a
      // meta do SDR É A META DO MÊS DA EQUIPE: a meta de receita do mês da
      // empresa e a meta de contratos que sai dela (receita ÷ ticket médio do
      // mês anterior). `teamGoal: true` = não é campo de vaga nem régua do
      // plano de remuneração por nível: o goalFor do placar lê a meta do mês
      // (inteira, sem repartir por headcount); só o ajuste por PESSOA vence.
      { metric: "won", kind: "flow", label: "Contratos no mês", unit: "n", hint: "a meta de contratos do mês da equipe", default: null, teamGoal: true },
      { metric: "revenue", kind: "flow", label: "Receita fechada", unit: "R$", hint: "a meta de receita do mês da equipe — faturado e recorrente contam só o recebido", default: null, teamGoal: true },
      // Mentoria: a segunda fila do SDR (Leo, 16/08). Metas SEPARADAS das duas
      // pernas acima de propósito — o funil é outro (não tem call agendada nem
      // fechamento por call) e o plano de remuneração ainda não cobre a
      // mentoria, então somar aqui mudaria comissão sem ninguém decidir.
      { metric: "mentoriaWon", kind: "flow", label: "Mentorias vendidas", unit: "n", hint: "vendas da fila de quem ainda não vende", default: null, team: true },
      { metric: "mentoriaRevenue", kind: "flow", label: "Receita de mentoria", unit: "R$", hint: "R$ fechado na fila da mentoria", default: null, team: true },
    ],
  },
  {
    role: "closer", label: "Closer", hint: "call, proposta e fechamento",
    metrics: [
      // UMA taxa de fechamento, sobre as calls que ACONTECERAM. É a mesma que o
      // placar mede, que o pace usa na cadeia e que a régua da Visão geral
      // colore. A conversão sobre as AGENDADAS não é campo: é conta
      // (comparecimento × esta), senão dá pra configurar duas que se contradizem.
      { metric: "conversaoCall", kind: "rate", label: "Call → ganho", unit: "%", hint: "das calls que aconteceram", default: pct(RATE_BENCHMARKS.closeRate) },
      // Resgate de follow-up: dos leads que caíram em follow-up na janela,
      // quantos o closer trouxe de volta pra ganho. É a métrica que separa o
      // closer que só colhe call quente do que trabalha a fila (Visão geral).
      { metric: "followupWinRate", kind: "rate", label: "Resgate de follow-up", unit: "%", hint: "dos que caíram em follow-up, quantos fecham", default: 15 },
      // Volume de call do closer: as que ACONTECERAM (o no-show é cobrado no
      // comparecimento do SDR). Fica logo abaixo da taxa porque é o denominador
      // dela — as duas juntas explicam os ganhos.
      { metric: "callsShown", kind: "flow", label: "Calls realizadas no mês", unit: "n", hint: "sem contar os no-show", default: null, team: true },
      // Upsell registrado na ficha do cliente conta como ganho de quem vendeu (09/09).
      { metric: "won", kind: "flow", label: "Ganhos no mês", unit: "n", hint: "fechamentos + upsells que você vendeu", default: null, team: true, compPlan: true },
      { metric: "revenue", kind: "flow", label: "Receita no mês", unit: "R$", hint: "à vista conta cheio; faturado, recorrente e upsell contam só o recebido", default: null, team: true, compPlan: true },
      { metric: "ticket", kind: "avg", label: "Ticket médio", unit: "R$", default: null },
    ],
  },
  {
    role: "integrator", label: "Integrador · CS", hint: "integração e pós-venda",
    metrics: [
      { metric: "retentionRate", kind: "rate", label: "Retenção", unit: "%", default: 95 },
      // NPS é ÍNDICE (promotores − detratores, de -100 a 100), não média das
      // notas: é a régua do npsIndex no metrics-core e a que o bônus do plano
      // de remuneração (NPS >= 80) cobra.
      { metric: "nps", kind: "avg", label: "NPS alvo (índice)", unit: "n", default: null },
      { metric: "newAccounts", kind: "flow", label: "Contas novas no mês", unit: "n", default: null, team: true },
      { metric: "activeAccounts", kind: "stock", label: "Contas ativas", unit: "n", default: null, team: true },
      // Trabalho de CS (retenção): upsell e indicação. SEM `team` de propósito — o
      // papel `integrator` junta o CS e o integrador técnico (Eryk), e só o CS faz
      // upsell/indicação; repartir o alvo pelos dois subestimaria a fatia do CS.
      // Upsell = fatura kind:"upsell" registrada na ficha do cliente, atribuída a
      // quem vendeu (soldBy; fatura antiga cai no dono do cliente). O nº conta o
      // registro; o R$ só o que caiu. Indicação = leads com origem "Indicação"
      // na janela (nº do time).
      { metric: "upsells", kind: "flow", label: "Upsells no mês", unit: "n", default: null },
      { metric: "upsellRevenue", kind: "flow", label: "Receita de upsell no mês", unit: "R$", hint: "só o que caiu (fatura de upsell paga)", default: null },
      // Indicação COLHIDA pela pessoa (desde 12/09/2026 tem dono: o prêmio da
      // coleta é do colaborador, então o número por pessoa é o que se persegue).
      { metric: "referrals", kind: "flow", label: "Indicações no mês", unit: "n", hint: "as que VOCÊ colheu (cliente indicador + seu nome no registro)", default: null },
    ],
  },
  {
    role: "social", label: "Mídia social", hint: "redes sociais, conteúdo e criativos",
    metrics: [
      // Fase de aprendizado: cobra VOLUME e consistência (o hábito de produzir)
      // antes de perseguir resultado — o Leo lapida engajamento/alcance depois.
      { metric: "postsPerMonth", kind: "flow", label: "Posts no mês", unit: "n", default: 30, team: true },        // 1/dia
      { metric: "storiesPerMonth", kind: "flow", label: "Stories no mês", unit: "n", default: 120, team: true },   // 4/dia
      { metric: "adsPerMonth", kind: "flow", label: "Ads no mês", unit: "n", default: 48, team: true },            // 12/semana
      // Resultado (secundárias por ora, sem alvo — pra ajustar no futuro).
      { metric: "followerGrowth", kind: "flow", label: "Novos seguidores no mês", unit: "n", default: null, team: true },
      { metric: "engagementRate", kind: "rate", label: "Taxa de engajamento", unit: "%", default: null },
      { metric: "reachMonth", kind: "flow", label: "Alcance no mês", unit: "n", default: null, team: true },
    ],
  },
];

// Métricas cuja meta de vaga é do TIME (o placar reparte entre as pessoas).
export const TEAM_METRICS = new Set(META_CATALOG.flatMap((r) => r.metrics.filter((m) => m.team).map((m) => m.metric)));

// Desdobramento da meta do MÊS CHEIO pela cadeia do pace. O `plan` do pace
// persegue o que FALTA (gap ÷ dias restantes) porque serve pra tocar o dia; a
// meta é do mês inteiro, então aqui a conta parte do alvo cheio — mas pelas
// MESMAS taxas e pelo MESMO ticket, senão as duas telas brigam.
//
// Só desdobra VOLUME. As taxas continuam digitadas: o pace usa a meta de taxa
// como fallback quando falta histórico (goalRate em routes.pipeline-pace.js),
// então derivar taxa do pace criaria referência circular — e taxa é ambição,
// não retrato do que já acontece.
export function deriveGoalsFromPace(pace, opts = {}) {
  const through = (n, rate) => (n != null && rate > 0 ? Math.ceil(n / rate) : null);
  // Persegue a META ATUAL: batida a base, o pace re-ancora na próxima super meta
  // (sale.chaseTarget), e o card Pace da tela Metas mostra o que ESSE teto exige.
  // Abaixo de 100% o chaseTarget é a própria base, então nada muda. Passado de
  // 200% (chaseTarget null) cai na base — não há teto acima pra desdobrar.
  const base = pace.sale.target;
  const target = pace.sale.chaseTarget != null ? pace.sale.chaseTarget : base;
  const superMode = target > base;
  const chasePct = pace.sale.chasePct || null;
  const ticket = Number(pace.context.averageEntry) > 0 ? Number(pace.context.averageEntry) : null;
  // Ticket médio do MÊS ANTERIOR (Leo, 06/10/2026): a meta de contratos do mês
  // = receita do mês ÷ esse ticket. `ticketMonth` diz qual mês serviu de base
  // (vazio = mês anterior sem venda, caiu no fallback do pace).
  const ticketMonth = pace.context.averageEntrySource === "prev_month" ? (pace.context.previousMonth?.month || "") : "";
  const c = pace.conversions;
  // Nº de contratos do mês: a meta digitada da EMPRESA (monthlyContractsTarget)
  // vence a divisão receita do mês ÷ ticket médio do mês anterior — e, como todo digitado, NÃO escala em super
  // meta. wonFromTicket fica exposto pra tela comparar as duas verdades.
  const contractsTarget = Number(opts.contractsTarget) > 0 ? Math.round(Number(opts.contractsTarget)) : null;
  const wonFromTicket = ticket ? Math.ceil(target / ticket) : null;
  const won = contractsTarget ?? wonFromTicket;
  const callsShown = through(won, c.closeRateEffective.value);
  const callsBooked = through(callsShown, c.showRate.value);
  const contacts = through(callsBooked, c.bookingRate.value);
  const leads = through(contacts, c.contactRate.value);
  // O que trava é sempre a primeira divisão que falha. Sem ticket, a meta de
  // contratos digitada ainda sustenta a cadeia (ela É o nº de ganhos).
  const blockedBy = won == null ? "ticket"
    : !(c.closeRateEffective.value > 0) ? "closeRate"
    : !(c.showRate.value > 0) ? "showRate"
    : !(c.bookingRate.value > 0) ? "bookingRate"
    : !(c.contactRate.value > 0) ? "contactRate"
    : null;
  return {
    target, base, superMode, chasePct,
    ticket, ticketSource: pace.context.averageEntrySource || "", ticketMonth,
    previousMonth: pace.context.previousMonth || null,
    contractsTarget, wonFromTicket, wonSource: contractsTarget != null ? "company" : "ticket",
    won, callsShown, callsBooked, contacts,
    leads, // entrada do funil: é o marketing que entrega, então não vira meta de vaga
    rates: {
      closeRate: c.closeRateEffective.value, closeRateSource: c.closeRateEffective.source,
      showRate: c.showRate.value, showRateSource: c.showRate.source,
      bookingRate: c.bookingRate.value, bookingRateSource: c.bookingRate.source,
      contactRate: c.contactRate.value, contactRateSource: c.contactRate.source,
    },
    // Janela e amostra de cada taxa, pro tooltip da cadeia responder "de onde
    // veio e de qual período" na própria tela (pergunta real do Leo): mês
    // fechado anterior (coorte madura) ou 30d móveis no fallback. n/d zerados =
    // taxa sem medição (veio de meta configurada ou benchmark).
    rateWindow: pace.rateWindow || null,
    rateCounts: {
      contactRate: { n: c.contactRate?.numerator || 0, d: c.contactRate?.denominator || 0 },
      bookingRate: { n: c.bookingRate?.numerator || 0, d: c.bookingRate?.denominator || 0 },
      showRate: { n: c.showRate?.numerator || 0, d: c.showRate?.denominator || 0 },
      closeRate: { n: c.closeRate?.numerator || 0, d: c.closeRate?.denominator || 0 },
      leadToWin: { n: c.leadToWin?.numerator || 0, d: c.leadToWin?.denominator || 0 },
    },
    blockedBy,
    // O que o botão "derivar do pace" grava (alvos do TIME — o placar reparte).
    // Cadeia travada não entrega meia derivação: preencher só a receita deixaria
    // o resto das vagas incoerente, que é justamente o que essa tela conserta.
    goals: blockedBy ? [] : [
      { role: "closer", metric: "callsShown", target: callsShown },
      { role: "closer", metric: "won", target: won },
      { role: "closer", metric: "revenue", target: target },
      { role: "closer", metric: "ticket", target: ticket },
      { role: "sdr", metric: "callsBooked", target: callsBooked },
      { role: "sdr", metric: "contacts", target: contacts },
      { role: "integrator", metric: "newAccounts", target: won },
    ].filter((g) => Number(g.target) > 0),
  };
}

// ── Horizonte da agenda de metas ─────────────────────────────────────────────
// A tela Metas planeja por TRIMESTRE (Q1..Q4), semestre e ano: o GET devolve
// de janeiro do ano corrente a dezembro do ano seguinte, com os meses passados
// (pra fechar os trimestres do ano e casar com o histórico). Ano fiscal =
// calendário. Era "corrente + 6" (botão "definir os 6 meses"); 7 meses não
// fecham quatro trimestres.
export function metasHorizon(currentMonth) {
  const year = Number(String(currentMonth).slice(0, 4));
  return { from: `${year}-01`, to: `${year + 1}-12`, current: currentMonth };
}
