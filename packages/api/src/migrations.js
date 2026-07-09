// Migrações idempotentes de boot — rodam uma vez por inicialização, depois de
// initDb()/ensureDefaultAdmins(). Cada uma DEVE ser segura pra rodar repetidas
// vezes (todo deploy reinicia o container) e nunca deve corromper dados que já
// existem: na dúvida sobre o estado, não mexe.

import { normalizeFunnel } from "./stages.js";

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
    const n = await ensureUserRoles(repo);
    if (n) console.log(`[migration] roles garantidas em ${n} usuário(s)`);
  } catch (err) {
    console.error("[migration] ensureUserRoles falhou:", err?.message || err);
  }
}
