// Migrações idempotentes de boot — rodam uma vez por inicialização, depois de
// initDb()/ensureDefaultAdmins(). Cada uma DEVE ser segura pra rodar repetidas
// vezes (todo deploy reinicia o container) e nunca deve corromper dados que já
// existem: na dúvida sobre o estado, não mexe.

import { normalizeFunnel, kindOf } from "./stages.js";

// Garante o estágio "Integração" no funil do produto `leverads`, posicionado
// entre "Negociação" e "Ganho". Integração é pós-venda: negócio já fechado,
// agenda-se a call de setup (campo `integrationAt` no card) antes de marcar Ganho.
//
// Idempotente: se "Integração" já está no funil, não faz nada. Defensiva: se o
// produto/funil não existir ou não tiver as âncoras esperadas, sai sem alterar.
export async function ensureIntegrationStage(repo) {
  const product = await repo.get("products", "leverads");
  if (!product || !Array.isArray(product.funnel) || product.funnel.length === 0) return false;

  const funnel = product.funnel;
  const existing = funnel.find((f) => f && f.stage === "Integração");
  if (existing) {
    // Reparo idempotente: a 1ª versão inseriu staleDays=0, que marca TODO card como
    // parado (dias na coluna ≥ 0). Normaliza pra "" (sem limiar). Só age se precisar.
    if (existing.staleDays === 0) {
      const next = funnel.map((f) => (f === existing ? { ...f, staleDays: "" } : f));
      await repo.update("products", "leverads", { funnel: next });
      return true;
    }
    return false; // já existe e está ok
  }

  // Âncora: imediatamente ANTES de "Ganho"; fallback logo APÓS "Negociação".
  let idx = funnel.findIndex((f) => f && f.stage === "Ganho");
  if (idx === -1) {
    const neg = funnel.findIndex((f) => f && f.stage === "Negociação");
    if (neg === -1) return false; // funil inesperado — não mexe
    idx = neg + 1;
  }

  // Mesmo shape que a tela Settings persiste. conv=1 porque é etapa administrativa
  // pós-ganho (não é gargalo de conversão); staleDays "" = sem marcação de parado.
  const stage = { stage: "Integração", conv: 1, color: "", staleDays: "" };
  const next = [...funnel.slice(0, idx), stage, ...funnel.slice(idx)];
  await repo.update("products", "leverads", { funnel: next });
  return true;
}

// ── Funil CRM SDR+Closer (rework 2026-07) ───────────────────────────────────
// Troca o funil implícito do leverads (Qualificação → Call closer → Negociação
// → Integração → Ganho + colunas soltas) pelo processo explícito SDR → Closer.
// Guarda ESTRITA: só age se o funil atual ainda tem os 4 nomes antigos na ordem
// relativa e nenhum nome novo — funil editado pelo dono nunca é sobrescrito
// (nesse caso só o `kind` entra, via ensureFunnelKinds). Cards são migrados por
// rename (repo.update direto: NÃO recarimba stageSince, NÃO loga activity —
// rename em massa não é movimento real de funil).

const CRM_OLD_ORDER = ["Qualificação", "Call closer", "Negociação", "Ganho"];
const CRM_NEW_NAMES = ["Novo lead", "Em contato", "Qualificando", "Call agendada", "Proposta enviada", "Follow-up"];
// Estágios antigos consumidos pelo funil novo (qualquer outro é preservado no fim,
// ex.: "Mentoria"). "Sem resposta" morre como coluna: vira Perdido + lostReason.
const CRM_CONSUMED = new Set([...CRM_OLD_ORDER, "Integração", "Perdido", "Desqualificado", "Sem resposta"]);
const CRM_CARD_MAP = {
  "Qualificação": "Qualificando",
  "Call closer": "Call agendada",
  "Negociação": "Follow-up",
  "Sem resposta": "Perdido",
  "disqualified": "Desqualificado",
};

export async function migrateLeverAdsCrmFunnel(repo) {
  const product = await repo.get("products", "leverads");
  if (!product || !Array.isArray(product.funnel) || product.funnel.length === 0) return false;
  const funnel = product.funnel;
  const names = funnel.map((f) => f && f.stage);

  // Guarda: nomes antigos presentes na ordem relativa, nenhum nome novo.
  const idxs = CRM_OLD_ORDER.map((n) => names.indexOf(n));
  if (idxs.some((i) => i === -1)) return false;
  if (idxs.some((i, k) => k > 0 && i < idxs[k - 1])) return false;
  if (names.some((n) => CRM_NEW_NAMES.includes(n))) return false;

  const old = (name) => funnel.find((f) => f && f.stage === name) || {};
  // Herda ajustes visuais/de conversão do estágio antigo equivalente.
  const inherit = (name) => {
    const o = old(name);
    return { color: o.color || "", staleDays: o.staleDays ?? "" };
  };
  const NEW_FUNNEL = [
    { stage: "Novo lead", kind: "novo", conv: 1, ...inherit(""), cadence: { firstTouchHours: 2 } },
    { stage: "Em contato", kind: "contato", conv: 1, ...inherit(""), cadence: { maxAttempts: 5, retryDays: 1 } },
    { stage: "Qualificando", kind: "qualificacao", conv: old("Qualificação").conv ?? 1, ...inherit("Qualificação"), cadence: { maxAttempts: 5, retryDays: 1 } },
    { stage: "Call agendada", kind: "call", conv: old("Call closer").conv ?? 1, ...inherit("Call closer"), cadence: { maxAttempts: 3, retryDays: 1 } },
    { stage: "Proposta enviada", kind: "proposta", conv: 1, ...inherit(""), cadence: { maxAttempts: 5, retryDays: 2 } },
    { stage: "Follow-up", kind: "followup", conv: old("Negociação").conv ?? 1, ...inherit("Negociação"), cadence: { maxAttempts: 8, retryDays: 3 } },
    { stage: "Integração", kind: "integracao", conv: old("Integração").conv ?? 1, ...inherit("Integração") },
    { stage: "Ganho", kind: "ganho", conv: old("Ganho").conv ?? 1, ...inherit("Ganho") },
    { stage: "Perdido", kind: "perdido", conv: old("Perdido").conv ?? 0, ...inherit("Perdido") },
    { stage: "Desqualificado", kind: "desqualificado", conv: old("Desqualificado").conv ?? 0, ...inherit("Desqualificado") },
  ];
  // Estágios custom do dono (ex.: "Mentoria") sobrevivem no fim, com kind.
  const preserved = funnel.filter((f) => f && f.stage && !CRM_CONSUMED.has(f.stage));
  const next = normalizeFunnel([...NEW_FUNNEL, ...preserved]);

  // Cards primeiro (se o processo morrer no meio, o funil antigo ainda existe e
  // a próxima rodada refaz os renames restantes sem efeito colateral).
  let migrated = 0;
  for (const collection of ["leads", "deals"]) {
    for (const item of await repo.list(collection)) {
      if (item.saas !== "leverads") continue;
      const to = CRM_CARD_MAP[item.stage];
      if (!to || to === item.stage) continue;
      const patch = { stage: to };
      if (item.stage === "Sem resposta" && !item.lostReason) patch.lostReason = "sem_resposta";
      await repo.update(collection, item.id, patch);
      migrated++;
    }
  }
  await repo.update("products", "leverads", { funnel: next });
  return { migrated };
}

// ── Cadência SDR (jul/2026) ─────────────────────────────────────────────────
// O processo desenhado pelo Leo: 1º ato no Novo lead (2 ligações + WhatsApp de
// apresentação, SLA 2h, fim de semana vira segunda cedo) → o toque move sozinho
// pra Qualificando (retomadas diárias, 3 sessões no total) → sem retorno vai pra
// Nutrição, que devolve o card à fila 20 dias depois (sempre em dia útil).
//
// One-shot de verdade: marca product.sdrCadenceV1 ao aplicar — edição posterior
// do Leo (cadência, pergunta removida, estágio recriado) NUNCA é sobrescrita.
// Sub-guardas por operação protegem estados inesperados na primeira rodada.
export async function migrateLeverAdsSdrCadence(repo) {
  const product = await repo.get("products", "leverads");
  if (!product || product.sdrCadenceV1) return false;
  if (!Array.isArray(product.funnel) || product.funnel.length === 0) return false;
  let funnel = product.funnel.map((f) => ({ ...(f || {}) }));
  // Comparação por chave, não por JSON: o jsonb do Postgres reordena as chaves
  // do objeto salvo (foi o que fez a 1ª rodada pular a cadência do Qualificando
  // em produção — corrigido lá via PUT /funnel em 2026-07-12).
  const canon = (o) => JSON.stringify(Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b))));
  const cadEq = (f, cad) => canon(f.cadence) === canon(cad);
  let movedCards = 0;

  // 1. "Em contato" sai (Qualificando cobre a fase); os cards migram por rename
  // direto (sem recarimbar stageSince — não é movimento real de funil).
  const emContato = funnel.find((f) => f.stage === "Em contato" && f.kind === "contato");
  const qualificando = funnel.find((f) => f.kind === "qualificacao");
  if (emContato && qualificando) {
    for (const l of await repo.list("leads")) {
      if (l.saas === "leverads" && l.stage === "Em contato") {
        await repo.update("leads", l.id, { stage: qualificando.stage });
        movedCards++;
      }
    }
    funnel = funnel.filter((f) => f !== emContato);
  }

  // 2. Nutrição: fila de reativação fora da régua (depois do Ganho). Entrada
  // re-agenda o GPS pra +20 dias (480h, rola pra dia útil); dentro do ciclo,
  // retomada diária, 3 sessões. kind explícito: a heurística por nome mandaria
  // "nutri" pra perdido.
  if (!funnel.some((f) => f.stage === "Nutrição")) {
    const ganhoIdx = funnel.findIndex((f) => f.kind === "ganho");
    if (ganhoIdx !== -1) {
      funnel.splice(ganhoIdx + 1, 0, {
        stage: "Nutrição", kind: "contato", conv: 1, color: "", staleDays: "",
        cadence: { maxAttempts: 3, retryDays: 1, firstTouchHours: 480 },
      });
    }
  }

  // 3. Cadências do processo: só se ainda estiverem nos valores antigos do seed
  // CRM (funil mexido pelo dono fica como está).
  const novo = funnel.find((f) => f.kind === "novo");
  if (novo && cadEq(novo, { firstTouchHours: 2 })) {
    novo.cadence = { maxAttempts: 1, retryDays: 1, firstTouchHours: 2 };
  }
  if (qualificando && cadEq(qualificando, { maxAttempts: 5, retryDays: 1 })) {
    qualificando.cadence = { maxAttempts: 3, retryDays: 1 };
  }

  // 4. Pergunta de qualificação que o SDR coleta na conversa: tamanho do time de
  // marketing. key/values casam com o DiagnosticoIn do copylever (staff: 0|1|2-3|4+).
  let leadQuestions = Array.isArray(product.leadQuestions) ? product.leadQuestions.map((q) => ({ ...q })) : null;
  if (leadQuestions && !leadQuestions.some((q) => q && q.key === "staff")) {
    leadQuestions.push({
      key: "staff", label: "Quantas pessoas no time de marketing?", type: "select", required: false,
      options: [
        { value: "0", label: "Só eu" },
        { value: "1", label: "1 pessoa" },
        { value: "2-3", label: "2 a 3 pessoas" },
        { value: "4+", label: "4 ou mais" },
      ],
    });
  }

  await repo.update("products", "leverads", {
    funnel: normalizeFunnel(funnel),
    ...(leadQuestions ? { leadQuestions } : {}),
    sdrCadenceV1: true,
  });
  return { movedCards };
}

// Todo funil de todo produto ganha `kind` (heurística por nome quando ausente).
// Cobre multi-SaaS e o caso do dono ter editado o funil (guarda acima falhou).
export async function ensureFunnelKinds(repo) {
  let changed = 0;
  for (const product of await repo.list("products")) {
    if (!Array.isArray(product.funnel) || product.funnel.length === 0) continue;
    const next = normalizeFunnel(product.funnel);
    if (JSON.stringify(next) !== JSON.stringify(product.funnel)) {
      await repo.update("products", product.id, { funnel: next });
      changed++;
    }
  }
  return changed;
}

// Motivos de perda padrão por produto (ids estáveis; label é só exibição —
// `lead.lostReason` guarda o id). "nao_informado" é fallback do server, fora da lista.
export const DEFAULT_LOSS_REASONS = [
  { id: "preco", label: "Preço" },
  { id: "sem_resposta", label: "Sem resposta" },
  { id: "sem_fit", label: "Sem fit" },
  { id: "timing", label: "Timing" },
  { id: "concorrente", label: "Concorrente" },
  { id: "nao_compareceu", label: "Não compareceu na call" },
  { id: "outro", label: "Outro" },
];

export async function ensureLossReasons(repo) {
  let changed = 0;
  for (const product of await repo.list("products")) {
    if (Array.isArray(product.lossReasons)) continue;
    await repo.update("products", product.id, { lossReasons: DEFAULT_LOSS_REASONS });
    changed++;
  }
  return changed;
}

// "Não compareceu na call" é o sinal que alimenta o show-rate do SDR (o closer
// marca ao mover pra Perdido). Produto que já tinha lossReasons (leverads) não
// entra no ensureLossReasons acima, então este anexa o motivo aos funis COM
// estágio de call, uma vez (marcador noShowReasonV1 respeita remoção manual).
export async function ensureNoShowReason(repo) {
  let changed = 0;
  for (const product of await repo.list("products")) {
    if (product.noShowReasonV1) continue;
    const patch = { noShowReasonV1: true };
    const reasons = Array.isArray(product.lossReasons) ? product.lossReasons : [];
    const hasCall = (product.funnel || []).some((f) => kindOf(product, f.stage) === "call");
    if (hasCall && !reasons.some((r) => r.id === "nao_compareceu")) {
      patch.lossReasons = [...reasons, { id: "nao_compareceu", label: "Não compareceu na call" }];
    }
    await repo.update("products", product.id, patch);
    changed++;
  }
  return changed;
}

// Metas de SDR por TAXA (benchmark de SaaS inbound morno) — o alvo é a taxa,
// que já se normaliza pelo volume de leads (o alvo absoluto de calls sai de
// leads × taxa na UI). Semeadas como role-scope na coleção goals, uma vez por
// produto com estágio de call (marcador sdrGoalsV1 respeita edição manual).
const SDR_BENCHMARK_GOALS = [
  { metric: "contactRate", target: 80 }, // reach: % dos leads novos contatados
  { metric: "bookingRate", target: 30 }, // % dos leads que viram call agendada
  { metric: "showRate", target: 75 },    // % das calls em que a pessoa compareceu
  { metric: "callWinRate", target: 25 }, // % das calls que fecharam
];

export async function ensureSdrGoals(repo) {
  let created = 0;
  const goals = await repo.list("goals");
  for (const product of await repo.list("products")) {
    if (product.sdrGoalsV1) continue;
    const hasCall = (product.funnel || []).some((f) => kindOf(product, f.stage) === "call");
    if (hasCall) {
      for (const g of SDR_BENCHMARK_GOALS) {
        const exists = goals.some((x) => x.saas === product.id && x.scope === "role" && x.key === "sdr" && x.metric === g.metric);
        if (!exists) {
          // Id explícito: o gerador do repo é por timestamp e várias metas nascem
          // no mesmo tick — colidiriam na PK (mesmo motivo de routes.forms.js).
          await repo.create("goals", { id: `goal_${product.id}_sdr_${g.metric}`, saas: product.id, scope: "role", key: "sdr", metric: g.metric, target: g.target, period: "month" });
          created++;
        }
      }
    }
    await repo.update("products", product.id, { sdrGoalsV1: true });
  }
  return created;
}

// Metas de QUALIDADE do closer por benchmark (fechamento de proposta, win rate
// geral). Receita/Ganhos são QUOTA absoluta e o Leo define na mão, então não
// semeamos. Marcador closerGoalsV1 respeita edição manual.
const CLOSER_BENCHMARK_GOALS = [
  { metric: "proposalWinRate", target: 30 }, // proposta → ganho
  { metric: "winRateCall", target: 25 },     // call → ganho
];

export async function ensureCloserGoals(repo) {
  let created = 0;
  const goals = await repo.list("goals");
  for (const product of await repo.list("products")) {
    if (product.closerGoalsV1) continue;
    const hasCall = (product.funnel || []).some((f) => kindOf(product, f.stage) === "call");
    if (hasCall) {
      for (const g of CLOSER_BENCHMARK_GOALS) {
        const exists = goals.some((x) => x.saas === product.id && x.scope === "role" && x.key === "closer" && x.metric === g.metric);
        if (!exists) {
          await repo.create("goals", { id: `goal_${product.id}_closer_${g.metric}`, saas: product.id, scope: "role", key: "closer", metric: g.metric, target: g.target, period: "month" });
          created++;
        }
      }
    }
    await repo.update("products", product.id, { closerGoalsV1: true });
  }
  return created;
}

// Etiquetas de capacidade do time (quem aparece nos pickers de SDR/closer/
// integrador). Espelha o hardcode antigo do pipeline.jsx; não cria usuário novo.
const ROLE_SEED = {
  eryk: ["integrator"],
  leonardo: ["closer", "sdr"],
  jonathan: ["closer"],
};

export async function ensureUserRoles(repo) {
  let changed = 0;
  for (const user of await repo.list("users")) {
    if (Array.isArray(user.roles)) continue;
    await repo.update("users", user.id, { roles: ROLE_SEED[user.id] || [] });
    changed++;
  }
  return changed;
}

// Escopo de produto do time (user.saas): quem atende UM produto só não aparece
// nos pickers dos outros workspaces. Mesmo padrão do ROLE_SEED: aplica uma vez
// (só quando o campo ainda não existe no registro) e não cria usuário novo.
// A Ana foi criada antes do campo existir na API — o PATCH em produção era
// no-op até o deploy do código novo; este seed fecha a lacuna no 1º boot.
const SAAS_SEED = {
  ana: "uniquekids",
};

export async function ensureUserSaasScope(repo) {
  let changed = 0;
  for (const [id, saas] of Object.entries(SAAS_SEED)) {
    const user = await repo.get("users", id);
    if (!user || user.saas !== undefined) continue;
    await repo.update("users", id, { saas });
    changed++;
  }
  return changed;
}

// Telas permitidas por usuário (user.screens, ver screens.js): SDR e Ana só
// operam o funil — Pipeline + Tarefas. Mesmo padrão one-shot dos seeds acima:
// aplica só quando o campo ainda não existe (ajuste manual em Ajustes → Equipe
// nunca é sobrescrito) e não cria usuário.
const SCREENS_SEED = {
  sdr: ["today", "pipeline", "tasks"],
  ana: ["today", "pipeline", "tasks"],
};

export async function ensureUserScreens(repo) {
  let changed = 0;
  for (const [id, screens] of Object.entries(SCREENS_SEED)) {
    const user = await repo.get("users", id);
    if (!user || user.screens !== undefined) continue;
    await repo.update("users", id, { screens });
    changed++;
  }
  return changed;
}

// Orquestrador chamado no boot. Cada migração é isolada num try/catch pra que
// uma falha não derrube o start da API.
export async function runStartupMigrations(repo) {
  try {
    const changed = await ensureIntegrationStage(repo);
    if (changed) console.log('[migration] estágio "Integração" garantido no funil do leverads');
  } catch (err) {
    console.error("[migration] ensureIntegrationStage falhou:", err?.message || err);
  }
  try {
    const r = await migrateLeverAdsCrmFunnel(repo);
    if (r) console.log(`[migration] funil CRM SDR+Closer aplicado no leverads (${r.migrated} cards migrados)`);
  } catch (err) {
    console.error("[migration] migrateLeverAdsCrmFunnel falhou:", err?.message || err);
  }
  try {
    const r = await migrateLeverAdsSdrCadence(repo);
    if (r) console.log(`[migration] cadência SDR aplicada no leverads (Em contato → Qualificando: ${r.movedCards} cards; Nutrição criada)`);
  } catch (err) {
    console.error("[migration] migrateLeverAdsSdrCadence falhou:", err?.message || err);
  }
  try {
    const n = await ensureFunnelKinds(repo);
    if (n) console.log(`[migration] kind garantido no funil de ${n} produto(s)`);
  } catch (err) {
    console.error("[migration] ensureFunnelKinds falhou:", err?.message || err);
  }
  try {
    const n = await ensureLossReasons(repo);
    if (n) console.log(`[migration] lossReasons padrão em ${n} produto(s)`);
  } catch (err) {
    console.error("[migration] ensureLossReasons falhou:", err?.message || err);
  }
  try {
    const n = await ensureNoShowReason(repo);
    if (n) console.log(`[migration] motivo "não compareceu" verificado em ${n} produto(s)`);
  } catch (err) {
    console.error("[migration] ensureNoShowReason falhou:", err?.message || err);
  }
  try {
    const n = await ensureSdrGoals(repo);
    if (n) console.log(`[migration] ${n} meta(s) de SDR (taxa) semeada(s)`);
  } catch (err) {
    console.error("[migration] ensureSdrGoals falhou:", err?.message || err);
  }
  try {
    const n = await ensureCloserGoals(repo);
    if (n) console.log(`[migration] ${n} meta(s) de closer (qualidade) semeada(s)`);
  } catch (err) {
    console.error("[migration] ensureCloserGoals falhou:", err?.message || err);
  }
  try {
    const n = await ensureUserRoles(repo);
    if (n) console.log(`[migration] roles garantidas em ${n} usuário(s)`);
  } catch (err) {
    console.error("[migration] ensureUserRoles falhou:", err?.message || err);
  }
  try {
    const n = await ensureUserSaasScope(repo);
    if (n) console.log(`[migration] escopo de produto aplicado em ${n} usuário(s)`);
  } catch (err) {
    console.error("[migration] ensureUserSaasScope falhou:", err?.message || err);
  }
  try {
    const n = await ensureUserScreens(repo);
    if (n) console.log(`[migration] telas restritas aplicadas em ${n} usuário(s)`);
  } catch (err) {
    console.error("[migration] ensureUserScreens falhou:", err?.message || err);
  }
}
