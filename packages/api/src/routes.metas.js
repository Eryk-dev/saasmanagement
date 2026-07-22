// Metas — ferramenta única pra editar TODAS as metas de desempenho do produto,
// por VAGA (papel: SDR/closer/integrador) e, opcionalmente, por PESSOA. Escreve
// na collection `goals` (`{saas, scope, key, metric, target, period}`), que é a
// MESMA fonte que o scoreboard e a Visão geral já leem (goalFor: user vence
// role). Setar uma meta aqui passa a valer em todo campo que mostra meta;
// limpar volta pro benchmark padrão.
//
// Além das metas por vaga/pessoa, a tela edita a META DA EMPRESA: a meta de
// venda do mês (caixa), gravada em product.monthlyCashTarget — é ela que a
// faixa "Meta do mês" da Visão geral e a Análise do pipeline perseguem.

import { DEFAULT_CASH_TARGET, computePipelinePace } from "./routes.pipeline-pace.js";

// Catálogo das métricas por vaga: rótulo, unidade e o benchmark padrão (o valor
// que a Visão geral usa quando não há meta configurada). `default: null` = sem
// padrão (o Leo define, ex.: ganhos/receita/ticket).
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
      { metric: "contactRate", label: "Taxa de contato", unit: "%", default: 80 },
      { metric: "bookingRate", label: "Taxa de agendamento", unit: "%", default: 30 },
      { metric: "showRate", label: "Comparecimento na call", unit: "%", default: 75 },
      { metric: "callWinRate", label: "Conversão pós-call", unit: "%", default: 25 },
      { metric: "contacts", label: "Contatos no mês", unit: "n", default: null, team: true },
      { metric: "callsBooked", label: "Calls agendadas", unit: "n", default: null, team: true },
    ],
  },
  {
    role: "closer", label: "Closer", hint: "call, proposta e fechamento",
    metrics: [
      { metric: "winRateCall", label: "Call → ganho", unit: "%", default: 25 },
      { metric: "proposalWinRate", label: "Proposta → ganho", unit: "%", default: 30 },
      { metric: "won", label: "Ganhos no mês", unit: "n", default: null, team: true },
      { metric: "revenue", label: "Receita no mês", unit: "R$", default: null, team: true },
      { metric: "ticket", label: "Ticket médio", unit: "R$", default: null },
    ],
  },
  {
    role: "integrator", label: "Integrador · CS", hint: "integração e pós-venda",
    metrics: [
      { metric: "retentionRate", label: "Retenção", unit: "%", default: 95 },
      { metric: "nps", label: "NPS alvo", unit: "n", default: null },
      { metric: "newAccounts", label: "Contas novas no mês", unit: "n", default: null, team: true },
      { metric: "activeAccounts", label: "Contas ativas", unit: "n", default: null, team: true },
    ],
  },
  {
    role: "social", label: "Mídia social", hint: "redes sociais, conteúdo e criativos",
    metrics: [
      // Fase de aprendizado: cobra VOLUME e consistência (o hábito de produzir)
      // antes de perseguir resultado — o Leo lapida engajamento/alcance depois.
      { metric: "postsPerMonth", label: "Posts no mês", unit: "n", default: 30, team: true },        // 1/dia
      { metric: "storiesPerMonth", label: "Stories no mês", unit: "n", default: 120, team: true },   // 4/dia
      { metric: "adsPerMonth", label: "Ads no mês", unit: "n", default: 48, team: true },            // 12/semana
      // Resultado (secundárias por ora, sem alvo — pra ajustar no futuro).
      { metric: "followerGrowth", label: "Novos seguidores no mês", unit: "n", default: null, team: true },
      { metric: "engagementRate", label: "Taxa de engajamento", unit: "%", default: null },
      { metric: "reachMonth", label: "Alcance no mês", unit: "n", default: null, team: true },
    ],
  },
];

// Métricas cuja meta de vaga é do TIME (o placar reparte entre as pessoas).
export const TEAM_METRICS = new Set(META_CATALOG.flatMap((r) => r.metrics.filter((m) => m.team).map((m) => m.metric)));

const ALL_METRICS = new Set(META_CATALOG.flatMap((r) => r.metrics.map((m) => m.metric)));
const ROLES = new Set(META_CATALOG.map((r) => r.role));

// Id DETERMINÍSTICO por (produto, escopo, chave, métrica): uma meta = um doc.
// Evita a colisão do id auto-gerado (Date.now()+performance) quando criamos
// várias metas no mesmo tick, e torna o upsert idempotente por construção.
const goalId = (saas, scope, key, metric) => `goal_${saas}_${scope}_${key}_${metric}`;

// Desdobramento da meta do MÊS CHEIO pela cadeia do pace. O `plan` do pace
// persegue o que FALTA (gap ÷ dias restantes) porque serve pra tocar o dia; a
// meta é do mês inteiro, então aqui a conta parte do alvo cheio — mas pelas
// MESMAS taxas e pelo MESMO ticket, senão as duas telas brigam.
//
// Só desdobra VOLUME. As taxas continuam digitadas: o pace usa a meta de taxa
// como fallback quando falta histórico (goalRate em routes.pipeline-pace.js),
// então derivar taxa do pace criaria referência circular — e taxa é ambição,
// não retrato do que já acontece.
export function deriveGoalsFromPace(pace) {
  const through = (n, rate) => (n != null && rate > 0 ? Math.ceil(n / rate) : null);
  const target = pace.sale.target;
  const ticket = Number(pace.context.averageEntry) > 0 ? Number(pace.context.averageEntry) : null;
  const c = pace.conversions;
  const won = ticket ? Math.ceil(target / ticket) : null;
  const callsShown = through(won, c.closeRateEffective.value);
  const callsBooked = through(callsShown, c.showRate.value);
  const contacts = through(callsBooked, c.bookingRate.value);
  const leads = through(contacts, c.contactRate.value);
  // Sem ticket não há cadeia: o que trava é sempre a primeira divisão que falha.
  const blockedBy = !ticket ? "ticket"
    : !(c.closeRateEffective.value > 0) ? "closeRate"
    : !(c.showRate.value > 0) ? "showRate"
    : !(c.bookingRate.value > 0) ? "bookingRate"
    : !(c.contactRate.value > 0) ? "contactRate"
    : null;
  return {
    target, ticket, ticketSource: pace.context.averageEntrySource || "",
    won, callsShown, callsBooked, contacts,
    leads, // entrada do funil: é o marketing que entrega, então não vira meta de vaga
    rates: {
      closeRate: c.closeRateEffective.value, closeRateSource: c.closeRateEffective.source,
      showRate: c.showRate.value, showRateSource: c.showRate.source,
      bookingRate: c.bookingRate.value, bookingRateSource: c.bookingRate.source,
      contactRate: c.contactRate.value, contactRateSource: c.contactRate.source,
    },
    blockedBy,
    // O que o botão "derivar do pace" grava (alvos do TIME — o placar reparte).
    // Cadeia travada não entrega meia derivação: preencher só a receita deixaria
    // o resto das vagas incoerente, que é justamente o que essa tela conserta.
    goals: blockedBy ? [] : [
      { role: "closer", metric: "won", target: won },
      { role: "closer", metric: "revenue", target: target },
      { role: "closer", metric: "ticket", target: ticket },
      { role: "sdr", metric: "callsBooked", target: callsBooked },
      { role: "sdr", metric: "contacts", target: contacts },
      { role: "integrator", metric: "newAccounts", target: won },
    ].filter((g) => Number(g.target) > 0),
  };
}

export function registerMetasRoutes(app, repo) {
  // Metas atuais do produto + catálogo + time (pros ajustes por pessoa).
  app.get("/api/metas/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const goals = (await repo.list("goals")).filter((g) => (!g.saas || g.saas === product.id));
    const roleTarget = (role, metric) => {
      const g = goals.find((x) => x.scope === "role" && x.key === role && x.metric === metric);
      return g ? Number(g.target) : null;
    };
    const roles = META_CATALOG.map((r) => ({
      role: r.role, label: r.label, hint: r.hint,
      metrics: r.metrics.map((m) => ({ ...m, target: roleTarget(r.role, m.metric) })),
    }));
    // Time do produto com papel (pros overrides por pessoa).
    const users = (await repo.list("users").catch(() => []))
      .filter((u) => !u.saas || u.saas === product.id)
      .filter((u) => (u.roles || []).some((r) => ROLES.has(r)))
      .map((u) => ({ id: u.id, name: u.name || u.id, roles: (u.roles || []).filter((r) => ROLES.has(r)) }));
    // Metas por pessoa já configuradas.
    const userGoals = goals
      .filter((g) => g.scope === "user" && ALL_METRICS.has(g.metric))
      .map((g) => ({ key: g.key, metric: g.metric, target: Number(g.target) }));
    // Meta da empresa: venda do mês em caixa (null = rodando no padrão).
    const company = {
      cashTarget: Number(product.monthlyCashTarget) > 0 ? Number(product.monthlyCashTarget) : null,
      cashTargetDefault: DEFAULT_CASH_TARGET,
    };
    // Quantas pessoas em cada vaga (o placar reparte a meta de time entre elas).
    const people = Object.fromEntries([...ROLES].map((role) => [role, users.filter((u) => u.roles.includes(role)).length]));
    // O que a meta do mês exige, desdobrado pela cadeia do pace. Best-effort: se
    // o pace falhar, a tela continua editável (só sem o botão de derivar).
    let derived = null;
    try { derived = deriveGoalsFromPace(await computePipelinePace(repo, product)); }
    catch { derived = null; }
    return { saas: product.id, roles, users, userGoals, company, people, derived };
  });

  // Salva as metas (upsert/delete na collection goals). Cada item:
  // { scope:"role"|"user", key, metric, target }. target vazio/<=0 = remove
  // (volta pro benchmark). period sempre "month" (o front escala pro período).
  // `company.cashTarget` (opcional) grava a meta de venda do mês no produto:
  // positivo salva, vazio/zero limpa (a faixa volta pro padrão).
  app.put("/api/metas/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const incoming = Array.isArray(req.body?.goals) ? req.body.goals : null;
    if (!incoming) return reply.code(400).send({ error: "goals deve ser uma lista" });

    let companySaved = false;
    if (req.body?.company && typeof req.body.company === "object" && "cashTarget" in req.body.company) {
      const num = Number(String(req.body.company.cashTarget ?? "").trim()); // "" → NaN (não 0)
      const next = Number.isFinite(num) && num > 0 ? num : null;
      if (next !== (Number(product.monthlyCashTarget) > 0 ? Number(product.monthlyCashTarget) : null)) {
        await repo.update("products", product.id, { monthlyCashTarget: next });
      }
      companySaved = true;
    }

    const goals = (await repo.list("goals")).filter((g) => (!g.saas || g.saas === product.id));
    // Acha a meta existente pelo CONTEÚDO (pega também as criadas pela tela
    // Ajustes, que têm id aleatório) — só há uma por (scope,key,metric).
    const findGoal = (scope, key, metric) => goals.find((g) => g.scope === scope && g.key === key && g.metric === metric);

    let created = 0, updated = 0, removed = 0;
    for (const it of incoming) {
      const scope = it?.scope === "user" ? "user" : "role";
      const key = String(it?.key || "").trim();
      const metric = String(it?.metric || "").trim();
      if (!key || !ALL_METRICS.has(metric)) continue;               // ignora lixo
      if (scope === "role" && !ROLES.has(key)) continue;             // role inválida
      const num = Number(String(it?.target ?? "").trim());          // "" → NaN (não 0)
      const existing = findGoal(scope, key, metric);
      if (Number.isFinite(num) && num > 0) {
        if (existing) { await repo.update("goals", existing.id, { target: num, period: "month" }); updated++; }
        else { await repo.create("goals", { id: goalId(product.id, scope, key, metric), saas: product.id, scope, key, metric, target: num, period: "month" }); created++; }
      } else if (existing) {
        await repo.remove("goals", existing.id); removed++;          // limpar = voltar pro padrão
      }
    }
    return { ok: true, created, updated, removed, companySaved };
  });
}
