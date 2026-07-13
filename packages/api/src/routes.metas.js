// Metas — ferramenta única pra editar TODAS as metas de desempenho do produto,
// por VAGA (papel: SDR/closer/integrador) e, opcionalmente, por PESSOA. Escreve
// na collection `goals` (`{saas, scope, key, metric, target, period}`), que é a
// MESMA fonte que o scoreboard e a Visão geral já leem (goalFor: user vence
// role). Setar uma meta aqui passa a valer em todo campo que mostra meta;
// limpar volta pro benchmark padrão.

// Catálogo das métricas por vaga: rótulo, unidade e o benchmark padrão (o valor
// que a Visão geral usa quando não há meta configurada). `default: null` = sem
// padrão (o Leo define, ex.: ganhos/receita/ticket).
export const META_CATALOG = [
  {
    role: "sdr", label: "SDR", hint: "prospecção e agendamento",
    metrics: [
      { metric: "contactRate", label: "Taxa de contato", unit: "%", default: 80 },
      { metric: "bookingRate", label: "Taxa de agendamento", unit: "%", default: 30 },
      { metric: "showRate", label: "Comparecimento na call", unit: "%", default: 75 },
      { metric: "callWinRate", label: "Conversão pós-call", unit: "%", default: 25 },
      { metric: "callsBooked", label: "Calls agendadas (alvo fixo)", unit: "n", default: null },
    ],
  },
  {
    role: "closer", label: "Closer", hint: "call, proposta e fechamento",
    metrics: [
      { metric: "winRateCall", label: "Call → ganho", unit: "%", default: 25 },
      { metric: "proposalWinRate", label: "Proposta → ganho", unit: "%", default: 30 },
      { metric: "won", label: "Ganhos no mês", unit: "n", default: null },
      { metric: "revenue", label: "Receita no mês", unit: "R$", default: null },
      { metric: "ticket", label: "Ticket médio", unit: "R$", default: null },
    ],
  },
  {
    role: "integrator", label: "Integrador · CS", hint: "integração e pós-venda",
    metrics: [
      { metric: "newAccounts", label: "Contas novas no mês", unit: "n", default: null },
      { metric: "activeAccounts", label: "Contas ativas", unit: "n", default: null },
    ],
  },
  {
    role: "social", label: "Mídia social", hint: "redes sociais e conteúdo",
    metrics: [
      { metric: "postsPerMonth", label: "Posts no mês", unit: "n", default: null },
      { metric: "followerGrowth", label: "Novos seguidores no mês", unit: "n", default: null },
      { metric: "engagementRate", label: "Taxa de engajamento", unit: "%", default: null },
      { metric: "reachMonth", label: "Alcance no mês", unit: "n", default: null },
    ],
  },
];

const ALL_METRICS = new Set(META_CATALOG.flatMap((r) => r.metrics.map((m) => m.metric)));
const ROLES = new Set(META_CATALOG.map((r) => r.role));

// Id DETERMINÍSTICO por (produto, escopo, chave, métrica): uma meta = um doc.
// Evita a colisão do id auto-gerado (Date.now()+performance) quando criamos
// várias metas no mesmo tick, e torna o upsert idempotente por construção.
const goalId = (saas, scope, key, metric) => `goal_${saas}_${scope}_${key}_${metric}`;

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
    return { saas: product.id, roles, users, userGoals };
  });

  // Salva as metas (upsert/delete na collection goals). Cada item:
  // { scope:"role"|"user", key, metric, target }. target vazio/<=0 = remove
  // (volta pro benchmark). period sempre "month" (o front escala pro período).
  app.put("/api/metas/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const incoming = Array.isArray(req.body?.goals) ? req.body.goals : null;
    if (!incoming) return reply.code(400).send({ error: "goals deve ser uma lista" });

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
    return { ok: true, created, updated, removed };
  });
}
