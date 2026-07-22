// Migrações idempotentes de boot — rodam uma vez por inicialização, depois de
// initDb()/ensureDefaultAdmins(). Cada uma DEVE ser segura pra rodar repetidas
// vezes (todo deploy reinicia o container) e nunca deve corromper dados que já
// existem: na dúvida sobre o estado, não mexe.

import { normalizeFunnel, kindOf, isPostSaleStage } from "./stages.js";
import { createClosedSubscription } from "./billing.js";
import { FLASHCARD_DEFAULTS } from "./routes.flashcards.js";

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
  // re-agenda o GPS pra +7 dias (168h, rola pra dia útil); dentro do ciclo,
  // retomada a cada 7 dias, 3 sessões — mesmo ritmo na entrada e entre toques.
  // kind explícito: a heurística por nome mandaria "nutri" pra perdido.
  if (!funnel.some((f) => f.stage === "Nutrição")) {
    const ganhoIdx = funnel.findIndex((f) => f.kind === "ganho");
    if (ganhoIdx !== -1) {
      funnel.splice(ganhoIdx + 1, 0, {
        stage: "Nutrição", kind: "contato", conv: 1, color: "", staleDays: "",
        cadence: { maxAttempts: 3, retryDays: 7, firstTouchHours: 168 },
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
    qualificando.cadence = { maxAttempts: 2, retryDays: 1 };
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

// ── Nutrição: entrada em 7 dias (jul/2026) ──────────────────────────────────
// A Nutrição nascia devolvendo o card em +20 dias (firstTouchHours: 480). O Leo
// encurtou pra 7 dias (168h) pra bater com o ritmo da fila (retryDays: 7 entre
// cada toque) — 1º contato e retomadas no mesmo intervalo. Como a criação da
// Nutrição (migrateLeverAdsSdrCadence) é one-shot e já rodou em produção, editar
// só o seed não alcança os dados vivos; esta migração faz a correção no lugar.
// One-shot com marcador nutricao7dV1; só reescreve a linha ainda no valor antigo
// do seed (480), então cadência ajustada na mão pelo dono nunca é sobrescrita.
export async function migrateNutricaoSevenDays(repo) {
  const product = await repo.get("products", "leverads");
  if (!product || product.nutricao7dV1) return false;
  if (!Array.isArray(product.funnel) || product.funnel.length === 0) return false;
  let changed = false;
  const funnel = product.funnel.map((f) => {
    if (f && f.stage === "Nutrição" && f.cadence && Number(f.cadence.firstTouchHours) === 480) {
      changed = true;
      return { ...f, cadence: { ...f.cadence, firstTouchHours: 168 } };
    }
    return f;
  });
  await repo.update("products", "leverads", {
    ...(changed ? { funnel: normalizeFunnel(funnel) } : {}),
    nutricao7dV1: true,
  });
  return changed;
}

// ── Flashcards: conhecimentos gerais + baralhos de 30 (jul/2026) ────────────
// A base editada na tela (doc `flashcards`) congela os DEFAULTS do código, então
// os baralhos novos (Geral · Negócio/Marketplaces) e os cards extras por vaga
// não chegariam em produção. One-shot com marcador generalDecksV1 no doc:
// APPENDA os cards de DEFAULTS cujo id ainda não existe; card existente (mesmo
// editado pelo dono) nunca é tocado. Sem doc salvo, os DEFAULTS servem sozinhos.
export async function migrateFlashcardsGeneralDecks(repo) {
  const doc = await repo.get("flashcards", "leverads");
  if (!doc || doc.generalDecksV1) return 0;
  const have = new Set((doc.cards || []).map((c) => c && c.id));
  const missing = (FLASHCARD_DEFAULTS.leverads || []).filter((c) => !have.has(c.id));
  await repo.update("flashcards", "leverads", {
    ...(missing.length ? { cards: [...(doc.cards || []), ...missing] } : {}),
    generalDecksV1: true,
  });
  return missing.length;
}

// Permissão de ligação perdida (jul/2026): quando a saudação "posso te ligar?"
// era digitada na mão (sem passar pelo startCallFlow que cria callFlow=pending),
// o aceite do lead era só exibido ("topou receber a ligação") mas a thread ficava
// com callFlow=null — e o botão "Ligar" nunca virava discagem. O código já grava
// o aceite mesmo sem fluxo prévio; esta migração conserta as conversas que
// aceitaram/recusaram ANTES do fix (a última resposta de permissão vale). Idempotente.
export async function backfillCallPermission(repo) {
  const [threads, messages] = await Promise.all([repo.list("wa_threads"), repo.list("wa_messages")]);
  // texto RENDERIZADO com que a resposta de permissão é gravada (bodyOf)
  const REPLY = { "✅ topou receber a ligação": "accepted", "🚫 prefere não receber ligação": "declined" };
  const latest = new Map(); // thread → { perm, at } da resposta de permissão mais recente
  for (const m of messages) {
    if (m.direction !== "in") continue;
    const perm = REPLY[String(m.text || "")];
    if (!perm) continue;
    const at = new Date(m.at || 0).getTime();
    const cur = latest.get(m.thread);
    if (!cur || at > cur.at) latest.set(m.thread, { perm, at, iso: m.at });
  }
  let fixed = 0;
  for (const t of threads) {
    const r = latest.get(t.id);
    if (!r) continue;
    if (t.callFlow?.permission === r.perm) continue; // já está certo
    await repo.update("wa_threads", t.id, {
      callFlow: {
        ...(t.callFlow || { startedAt: r.iso, auto: false }),
        permission: r.perm, permissionAt: r.iso, backfill: true,
      },
    });
    fixed++;
  }
  return fixed;
}

// Tema do form de diagnóstico LeverAds → design system Lever Premium (claro).
// Roda JUNTO do deploy do CSS novo do form-page.js: assim o tema (dado) e o
// visual (código) trocam no MESMO boot, sem janela com logo branco invisível
// no fundo claro. One-shot pelo marcador `dsThemeV1` no doc (guarda o tema
// antigo em `themeBackup`). O form da UniqueKids NÃO é tocado.
const LEVERADS_DS_THEME = {
  bg: "#f7f8fa", surface: "#ffffff", fg: "#0c1d2b",
  accent: "#0F766E", accentFg: "#ffffff",
  font: "'Instrument Sans', system-ui, sans-serif",
  radius: 12, logoUrl: "", logoHeight: 24,
};
export async function migrateFormLeverAdsDsTheme(repo) {
  const form = await repo.get("forms", "fo_diagnostico_leverads");
  if (!form || form.dsThemeV1) return false;
  await repo.update("forms", "fo_diagnostico_leverads", {
    themeBackup: form.theme || null,
    theme: { ...LEVERADS_DS_THEME },
    dsThemeV1: true,
  });
  return true;
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

// Demanda de CONTEÚDO do Mídia social (fase de aprendizado: volume/consistência
// antes de resultado): 30 posts (1/dia), 120 stories (4/dia), 48 ads (12/sem).
// Semeadas como alvos definidos pra já aparecerem na tela de Metas; marcador
// socialGoalsV1 respeita edição manual (o Leo lapida no futuro).
const SOCIAL_CONTENT_GOALS = [
  { metric: "postsPerMonth", target: 30 },
  { metric: "storiesPerMonth", target: 120 },
  { metric: "adsPerMonth", target: 48 },
];

export async function ensureSocialGoals(repo) {
  let created = 0;
  const goals = await repo.list("goals");
  for (const product of await repo.list("products")) {
    if (product.socialGoalsV1) continue;
    for (const g of SOCIAL_CONTENT_GOALS) {
      const exists = goals.some((x) => x.saas === product.id && x.scope === "role" && x.key === "social" && x.metric === g.metric);
      if (!exists) {
        await repo.create("goals", { id: `goal_${product.id}_social_${g.metric}`, saas: product.id, scope: "role", key: "social", metric: g.metric, target: g.target, period: "month" });
        created++;
      }
    }
    await repo.update("products", product.id, { socialGoalsV1: true });
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

// Clientes nascidos da conversão automática ficavam com arr 0 — o valor
// informado no gate de fechamento (lead.amount) não era carregado (corrigido em
// convertWonLead). Backfill self-idempotente: só cliente com leadId, arr zerado
// e SEM assinatura (assinatura é a fonte do arr via syncCustomerArr); o valor do
// lead entra como contrato anual (padrão das ofertas). Plano não é inventado —
// passa a ser capturado no fechamento daqui pra frente.
export async function backfillCustomerArrFromLead(repo) {
  const withSub = new Set((await repo.list("subscriptions")).map((s) => s.customer));
  let changed = 0;
  for (const c of await repo.list("customers")) {
    if (!c.leadId || Number(c.arr) > 0 || withSub.has(c.id)) continue;
    const lead = await repo.get("leads", c.leadId);
    const amount = Number(lead?.amount) || 0;
    if (amount <= 0) continue;
    await repo.update("customers", c.id, { arr: Math.round(amount) });
    changed++;
  }
  return changed;
}

// "Assinatura ativa pra todos os clientes": cliente sem assinatura ganha uma a
// partir do próprio cadastro (plan/arr/paymentMethod), com a mesma regra do
// fechamento (createClosedSubscription): faturado/parcelado = ciclo mensal com
// a parcela; à vista = ciclo do plano com o contrato cheio. Self-idempotente
// (só quem NÃO tem assinatura); pula churnado (endedAt no passado), Serviço
// único (não é recorrência) e arr zerado. Sem plano assume anual (padrão da
// casa) sem inventar o campo plan do cliente. arr não muda: annualized == arr.
export async function backfillSubscriptionsFromCustomers(repo) {
  const withSub = new Set((await repo.list("subscriptions")).map((s) => s.customer));
  const now = new Date();
  let changed = 0;
  for (const c of await repo.list("customers")) {
    if (withSub.has(c.id) || Number(c.arr) <= 0) continue;
    if (c.endedAt && new Date(c.endedAt) <= now) continue;
    const t = String(c.plan || "").toLowerCase();
    if (t.includes("único") || t.includes("unico")) continue;
    const planClosed = t.includes("semestral") ? "semestral" : t.includes("mensal") ? "mensal" : "anual";
    const factor = { anual: 1, semestral: 2, mensal: 12 }[planClosed];
    const sub = await createClosedSubscription(repo, {
      customerId: c.id, saas: c.saas,
      planClosed, amount: Number(c.arr) / factor,
      paymentMethod: c.paymentMethod, startAt: c.startedAt,
    }, now);
    if (sub) changed++;
  }
  return changed;
}

// WhatsApp multi-número: o número do env (single-tenant legado) pertence à
// LEVERADS — carimba em product.waPhoneId uma vez (marcador waPhoneSeedV1) pra
// regra nova valer: produto sem waPhoneId NÃO fala pelo número de outro (a
// UniqueKids bloqueia com aviso até o Leo configurar o número próprio dela em
// Ajustes → Integrações). Apagar o campo depois nunca é sobrescrito.
export async function ensureWaPhoneId(repo) {
  const envId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  if (!envId) return false;
  const product = await repo.get("products", "leverads");
  if (!product || product.waPhoneSeedV1) return false;
  await repo.update("products", "leverads", {
    ...(product.waPhoneId ? {} : { waPhoneId: envId }),
    waPhoneSeedV1: true,
  });
  return !product.waPhoneId;
}

// ── Ganho ANTES da Integração (jul/2026) ────────────────────────────────────
// O funil colocava a entrega antes do fechamento (… Follow-up → Integração →
// Acompanhamento → Ganho), então a venda só era reconhecida no fim da entrega e
// os cards em Integração não contavam como receita. A ordem certa é fechar e
// depois entregar: … Follow-up → Ganho → Integração → Acompanhamento.
//
// Só a ordem do array muda; NENHUM lead é movido (quem está em Integração
// continua em Integração, agora depois do ganho na régua). O que sustenta a
// receita nessa nova ordem é `lead.customerId`/`wonAt` (ver isWonLead em
// stages.js): a venda vira fato do lead e para de depender da posição do card.
//
// One-shot por `ganhoAntesIntegracaoV1`. Guarda estrita: só reordena se o funil
// estiver EXATAMENTE no formato antigo (ganho depois de integracao), então
// rodar de novo, ou num produto que já foi ajustado à mão, não faz nada.
export async function migrateGanhoAntesIntegracao(repo) {
  const product = await repo.get("products", "leverads");
  if (!product || product.ganhoAntesIntegracaoV1) return false;
  const funnel = Array.isArray(product.funnel) ? product.funnel : [];
  const idx = (kind) => funnel.findIndex((f) => kindOf(product, f?.stage) === kind);
  const iGanho = idx("ganho"), iInteg = idx("integracao");
  // Nada a fazer se falta alguma das duas ou se o ganho JÁ está antes.
  if (iGanho === -1 || iInteg === -1 || iGanho < iInteg) {
    await repo.update("products", "leverads", { ganhoAntesIntegracaoV1: true });
    return false;
  }
  const ganhoRow = funnel[iGanho];
  const reordered = funnel.filter((_, i) => i !== iGanho);
  // Reinsere o ganho na posição da integração (que andou uma casa se o ganho
  // estava antes dela no array original — não é o caso aqui, mas fica correto).
  const at = reordered.findIndex((f) => kindOf(product, f?.stage) === "integracao");
  reordered.splice(at, 0, ganhoRow);

  // Os próximos passos salvos vencem os defaults do código, então precisam vir
  // junto: fechar deixa de ser destino da entrega e a entrega passa a ser
  // destino do ganho. Chaveado por ROTEIRO (followup1/2/3, integracao, …).
  const nextSteps = { ...(product.nextSteps || {}) };
  for (const [key, list] of Object.entries(nextSteps)) {
    if (!Array.isArray(list)) continue;
    if (/^followup/.test(key)) nextSteps[key] = list.filter((k) => k !== "integracao");
    if (/^(integracao|posvenda)/.test(key)) nextSteps[key] = list.filter((k) => k !== "ganho");
  }
  if (!Array.isArray(nextSteps.ganho) || !nextSteps.ganho.length) nextSteps.ganho = ["integracao", "posvenda"];
  if (Array.isArray(nextSteps.integracao) && !nextSteps.integracao.length) nextSteps.integracao = ["posvenda"];

  await repo.update("products", "leverads", { funnel: reordered, nextSteps, ganhoAntesIntegracaoV1: true });
  return { order: reordered.map((f) => f.stage) };
}

// Carimba `wonAt` nos leads que já venceram antes do campo existir. A data sai
// do `startedAt` do cliente (gravado por convertWonLead no mesmo instante);
// sem cliente vinculado, cai no stageSince, que ainda é o do ganho porque
// esses cards nunca saíram do Ganho. Sem isso, o primeiro card a andar pra
// Integração perderia a data e cairia no mês errado.
export async function backfillWonAt(repo) {
  const leads = await repo.list("leads");
  const pending = leads.filter((l) => l.customerId && !l.wonAt);
  if (!pending.length) return 0;
  const byId = new Map((await repo.list("customers")).map((c) => [c.id, c]));
  let n = 0;
  for (const lead of pending) {
    const at = byId.get(lead.customerId)?.startedAt || lead.stageSince || "";
    if (!at) continue;
    await repo.update("leads", lead.id, { wonAt: at });
    n++;
  }
  return n;
}

// Card que já está numa etapa PÓS-VENDA sem ter passado pelo Ganho nunca virou
// cliente: o convertWonLead dispara no PATCH do lead, e esses cards foram
// arrastados direto pra entrega antes da regra existir. Depois da reordenação
// eles CONTAM como venda (isPostSaleStage), então precisam do cliente e da
// assinatura junto — senão a receita sobe e os Clientes ativos ficam pra trás.
//
// Idempotente por natureza: o convertWonLead já sai fora se o lead tem
// customerId ou se existe cliente com aquele leadId. Roda DEPOIS da
// reordenação, senão isPostSaleStage ainda é falso.
export async function backfillPostSaleCustomers(repo) {
  // Import dinâmico: migrations.js é carregado pelo index.js antes das rotas, e
  // um import estático de routes.js aqui acoplaria a ordem de carga à toa.
  const { convertWonLead } = await import("./routes.js");
  const products = new Map((await repo.list("products")).map((p) => [p.id, p]));
  const leads = await repo.list("leads");
  let n = 0;
  for (const lead of leads) {
    if (lead.customerId) continue;
    const product = products.get(lead.saas);
    if (!product || !isPostSaleStage(product, lead.stage)) continue;
    try { if (await convertWonLead(repo, lead)) n++; } catch { /* best-effort, igual ao fluxo normal */ }
  }
  return n;
}

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
    const changed = await migrateNutricaoSevenDays(repo);
    if (changed) console.log("[migration] Nutrição: entrada ajustada pra 7 dias (168h) no leverads");
  } catch (err) {
    console.error("[migration] migrateNutricaoSevenDays falhou:", err?.message || err);
  }
  try {
    const n = await migrateFlashcardsGeneralDecks(repo);
    if (n) console.log(`[migration] flashcards: ${n} cards novos (gerais + vagas) anexados à base do leverads`);
  } catch (err) {
    console.error("[migration] migrateFlashcardsGeneralDecks falhou:", err?.message || err);
  }
  try {
    const n = await ensureFunnelKinds(repo);
    if (n) console.log(`[migration] kind garantido no funil de ${n} produto(s)`);
  } catch (err) {
    console.error("[migration] ensureFunnelKinds falhou:", err?.message || err);
  }
  try {
    const n = await backfillCallPermission(repo);
    if (n) console.log(`[migration] permissão de ligação reconstruída em ${n} conversa(s)`);
  } catch (err) {
    console.error("[migration] backfillCallPermission falhou:", err?.message || err);
  }
  try {
    const done = await migrateFormLeverAdsDsTheme(repo);
    if (done) console.log("[migration] form LeverAds: tema trocado pro design system Lever Premium (claro)");
  } catch (err) {
    console.error("[migration] migrateFormLeverAdsDsTheme falhou:", err?.message || err);
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
    const n = await ensureSocialGoals(repo);
    if (n) console.log(`[migration] ${n} meta(s) de conteúdo do Mídia social semeada(s)`);
  } catch (err) {
    console.error("[migration] ensureSocialGoals falhou:", err?.message || err);
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
  try {
    const n = await backfillCustomerArrFromLead(repo);
    if (n) console.log(`[migration] arr puxado do fechamento em ${n} cliente(s)`);
  } catch (err) {
    console.error("[migration] backfillCustomerArrFromLead falhou:", err?.message || err);
  }
  try {
    const n = await backfillSubscriptionsFromCustomers(repo);
    if (n) console.log(`[migration] assinatura ativa criada pra ${n} cliente(s)`);
  } catch (err) {
    console.error("[migration] backfillSubscriptionsFromCustomers falhou:", err?.message || err);
  }
  try {
    const changed = await ensureWaPhoneId(repo);
    if (changed) console.log("[migration] WhatsApp: número do env carimbado como waPhoneId do leverads");
  } catch (err) {
    console.error("[migration] ensureWaPhoneId falhou:", err?.message || err);
  }
  // wonAt ANTES da reordenação: o carimbo precisa existir antes que qualquer
  // card possa sair do Ganho, senão a venda perde a data.
  try {
    const n = await backfillWonAt(repo);
    if (n) console.log(`[migration] data do ganho (wonAt) carimbada em ${n} lead(s)`);
  } catch (err) {
    console.error("[migration] backfillWonAt falhou:", err?.message || err);
  }
  try {
    const r = await migrateGanhoAntesIntegracao(repo);
    if (r) console.log(`[migration] funil do leverads reordenado (ganho antes da integração): ${r.order.join(" → ")}`);
  } catch (err) {
    console.error("[migration] migrateGanhoAntesIntegracao falhou:", err?.message || err);
  }
  // Depois da reordenação: quem está na entrega passa a ser venda, então ganha
  // cliente e assinatura como se tivesse passado pelo Ganho.
  try {
    const n = await backfillPostSaleCustomers(repo);
    if (n) console.log(`[migration] cliente + assinatura criados pra ${n} lead(s) já na entrega`);
  } catch (err) {
    console.error("[migration] backfillPostSaleCustomers falhou:", err?.message || err);
  }
}
