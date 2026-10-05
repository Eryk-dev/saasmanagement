// Metas — ferramenta única pra editar TODAS as metas de desempenho do produto,
// por VAGA (papel: SDR/closer/integrador) e, opcionalmente, por PESSOA. Escreve
// na collection `goals` (`{saas, scope, key, metric, target, period}`), que é a
// MESMA fonte que o scoreboard e a Visão geral já leem (goalFor: user vence
// role). Setar uma meta aqui passa a valer em todo campo que mostra meta;
// limpar volta pro benchmark padrão.
//
// Além das metas por vaga/pessoa, a tela edita a META DA EMPRESA: a meta de
// venda do mês (caixa), gravada em product.monthlyCashTarget — é ela que a
// faixa "Meta do mês" da Visão geral e a Análise do pipeline perseguem — e a
// meta de CONTRATOS do mês (product.monthlyContractsTarget): vazia, o número
// de contratos segue a venda ÷ ticket; digitada, ela vence essa divisão e a
// cadeia (calls, contatos, leads) desce a partir dela.

import { DEFAULT_CASH_TARGET, computePipelinePace, cashTargetFor } from "./pipeline-pace.js";
import { DEFAULT_COMP_PLAN, compLevelOf, careerRuleOf, promotionEligibility, leveledRoleOf } from "../comp/comp-plan.js";
import { monthKey } from "./metrics-core.js";
import { META_CATALOG, deriveGoalsFromPace } from "./metas.js";

const ALL_METRICS = new Set(META_CATALOG.flatMap((r) => r.metrics.map((m) => m.metric)));
const ROLES = new Set(META_CATALOG.map((r) => r.role));

// Id DETERMINÍSTICO por (produto, escopo, chave, métrica): uma meta = um doc.
// Evita a colisão do id auto-gerado (Date.now()+performance) quando criamos
// várias metas no mesmo tick, e torna o upsert idempotente por construção.
const goalId = (saas, scope, key, metric) => `goal_${saas}_${scope}_${key}_${metric}`;

// Quantos meses a tela enxerga: o corrente + 6 à frente (o botão "definir os
// 6 meses" da Agenda preenche exatamente essa janela).
const MONTHS_AHEAD = 7;

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
    // Derivação da meta do mês (cadeia do pace) — best-effort, ver mais abaixo.
    let derived = null;
    try { derived = deriveGoalsFromPace(await computePipelinePace(repo, product), { contractsTarget: product.monthlyContractsTarget }); }
    catch { derived = null; }
    const derivedByMetric = Object.fromEntries((derived?.goals || []).map((g) => [`${g.role}.${g.metric}`, g.target]));
    const roles = META_CATALOG.map((r) => ({
      role: r.role, label: r.label, hint: r.hint,
      metrics: r.metrics.map((m) => ({
        ...m,
        target: roleTarget(r.role, m.metric),
        // O que a meta do mês EXIGE dessa métrica. Campo vazio na tela passa a
        // valer esse número (o placar usa o mesmo fallback), então nenhuma vaga
        // fica sem régua e nenhuma régua contradiz a meta da empresa.
        derived: derivedByMetric[`${r.role}.${m.metric}`] ?? null,
      })),
    }));
    // Time do produto com papel (pros overrides por pessoa). O `compLevel` (1
    // jr · 2 pl · 3 sn) diz qual linha do plano de remuneração vale pra pessoa.
    const users = (await repo.list("users").catch(() => []))
      .filter((u) => !u.saas || u.saas === product.id)
      .filter((u) => (u.roles || []).some((r) => ROLES.has(r)))
      .map((u) => ({ id: u.id, name: u.name || u.id, roles: (u.roles || []).filter((r) => ROLES.has(r)), compLevel: compLevelOf(u), _raw: u }));
    // ELEGIBILIDADE a subir de nível: 3 meses fechados seguidos com 100% da
    // meta, lidos dos carimbos mensais (comp_months) — nunca recalculados aqui.
    // A tela classifica o nível nesta mesma lista, então o chip fica ao lado do
    // seletor, que é onde a decisão acontece.
    const careerDocs = await repo.list("comp_plans").catch(() => []);
    const careerRule = careerRuleOf(careerDocs);
    const monthStamps = await repo.listWhere("comp_months", { saas: product.id }).catch(() => []);
    const hojeKey = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    for (const u of users) {
      const raw = u._raw;
      delete u._raw;
      if (!leveledRoleOf(raw)) { u.promo = null; continue; }
      const hist = Array.isArray(raw.compLevelHistory) ? raw.compLevelHistory : [];
      u.promo = promotionEligibility({
        stamps: monthStamps.filter((s) => s.kind === "person" && s.uid === u.id),
        level: u.compLevel,
        levelSince: hist.length ? hist[hist.length - 1].at : "",
        rule: careerRule,
        today: hojeKey,
      });
    }
    // Plano de REMUNERAÇÃO vigente (comp_plans por cima do padrão aprovado):
    // contratos/receita de SDR e closer são meta POR PESSOA pelo nível — o
    // placar já aplica (comp vence vaga e derivado), a tela mostra a régua.
    const compDocs = await repo.list("comp_plans").catch(() => []);
    const compLevels = (role) => {
      const doc = compDocs.find((d) => d && d.role === role);
      const levels = doc?.plan?.levels?.length ? doc.plan.levels : DEFAULT_COMP_PLAN[role].levels;
      return levels
        .map((l) => ({ n: Math.floor(Number(l?.n)) || 1, metaContracts: Number(l?.metaContracts) || 0, metaRevenue: Number(l?.metaRevenue) || 0 }))
        .sort((a, b) => a.n - b.n);
    };
    const compPlan = { sdr: compLevels("sdr"), closer: compLevels("closer") };
    // Metas por pessoa já configuradas.
    const userGoals = goals
      .filter((g) => g.scope === "user" && ALL_METRICS.has(g.metric))
      .map((g) => ({ key: g.key, metric: g.metric, target: Number(g.target) }));
    // Meta da empresa: o padrão (vale pra qualquer mês sem valor próprio) e a
    // agenda dos PRÓXIMOS meses. Configurar agosto hoje faz a plataforma inteira
    // virar de meta sozinha no dia 1º, sem ninguém lembrar de mexer.
    const mesAtual = monthKey(new Date());
    const proximosMeses = [];
    for (let i = 0; i < MONTHS_AHEAD; i++) {
      const d = new Date(`${mesAtual}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + i);
      const m = d.toISOString().slice(0, 7);
      const alvo = cashTargetFor(product, m);
      proximosMeses.push({
        month: m,
        target: Number(product.monthlyCashTargets?.[m]) > 0 ? Number(product.monthlyCashTargets[m]) : null,
        effective: alvo.target,     // o que vale hoje pra esse mês (com fallback)
        source: alvo.source,        // month | default | system
        current: m === mesAtual,
      });
    }
    const company = {
      cashTarget: Number(product.monthlyCashTarget) > 0 ? Number(product.monthlyCashTarget) : null,
      cashTargetDefault: DEFAULT_CASH_TARGET,
      contractsTarget: Number(product.monthlyContractsTarget) > 0 ? Number(product.monthlyContractsTarget) : null,
      growthPct: Number(product.monthlyCashGrowthPct) > 0 ? Number(product.monthlyCashGrowthPct) : null,
      months: proximosMeses,
    };
    // Quantas pessoas em cada vaga (o placar reparte a meta de time entre elas).
    const people = Object.fromEntries([...ROLES].map((role) => [role, users.filter((u) => u.roles.includes(role)).length]));
    return { saas: product.id, roles, users, userGoals, company, people, derived, compPlan };
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
    const empresa = req.body?.company;
    if (empresa && typeof empresa === "object") {
      const patch = {};
      if ("cashTarget" in empresa) {
        const num = Number(String(empresa.cashTarget ?? "").trim()); // "" → NaN (não 0)
        const next = Number.isFinite(num) && num > 0 ? num : null;
        if (next !== (Number(product.monthlyCashTarget) > 0 ? Number(product.monthlyCashTarget) : null)) patch.monthlyCashTarget = next;
      }
      // Regra de crescimento (% ao mês sobre o último mês agendado): é ela que
      // dispensa re-agendar a escada todo mês. Vazio/zero limpa (mês sem valor
      // volta a seguir a meta padrão). Teto de sanidade em 1000%.
      if ("growthPct" in empresa) {
        const num = Number(String(empresa.growthPct ?? "").trim());
        const next = Number.isFinite(num) && num > 0 ? Math.min(Math.round(num * 10) / 10, 1000) : null;
        if (next !== (Number(product.monthlyCashGrowthPct) > 0 ? Number(product.monthlyCashGrowthPct) : null)) patch.monthlyCashGrowthPct = next;
      }
      // Meta de contratos do mês (nº inteiro): vazio/zero limpa e o número volta
      // a seguir a venda ÷ ticket na cadeia.
      if ("contractsTarget" in empresa) {
        const num = Number(String(empresa.contractsTarget ?? "").trim());
        const next = Number.isFinite(num) && num > 0 ? Math.round(num) : null;
        if (next !== (Number(product.monthlyContractsTarget) > 0 ? Number(product.monthlyContractsTarget) : null)) patch.monthlyContractsTarget = next;
      }
      // Agenda de metas por mês: "AAAA-MM" → valor. Vazio/zero apaga o mês (ele
      // volta a seguir o padrão), e mês fora do formato é ignorado.
      if (empresa.months && typeof empresa.months === "object") {
        const mapa = { ...(product.monthlyCashTargets || {}) };
        for (const [mes, valor] of Object.entries(empresa.months)) {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) continue; // mês 13 não existe
          const num = Number(String(valor ?? "").trim());
          if (Number.isFinite(num) && num > 0) mapa[mes] = num;
          else delete mapa[mes];
        }
        patch.monthlyCashTargets = mapa;
      }
      if (Object.keys(patch).length) await repo.update("products", product.id, patch);
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
