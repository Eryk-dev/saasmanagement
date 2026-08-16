// Migrações idempotentes de boot — rodam uma vez por inicialização, depois de
// initDb()/ensureDefaultAdmins(). Cada uma DEVE ser segura pra rodar repetidas
// vezes (todo deploy reinicia o container) e nunca deve corromper dados que já
// existem: na dúvida sobre o estado, não mexe.

import { normalizeFunnel, kindOf, isPostSaleStage, TERMINAL_KINDS } from "./stages.js";
import { catalogAmount } from "./proposal-catalog.js";
import { createClosedSubscription } from "./billing.js";
import { FLASHCARD_DEFAULTS } from "./routes.flashcards.js";
import { LEVERADS_EXPANSION } from "./flashcard-decks.leverads.js";
import { mergeLeadQuestions } from "./forms.js";
import { waMatchKey } from "./wa-store.js";
import { backfillPaymentLinks } from "./payment-links.js";
import { slideVisible } from "./proposal.js";

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

// ── Flashcards: expansão pra 150 por baralho + Estratégia de vendas (ago/2026) ──
// Mesmo desenho do generalDecksV1, mas anexando SÓ os cards da EXPANSÃO (nunca a
// base de jul/2026): se o dono apagou um card antigo pela tela, ele fica apagado.
// Sem doc salvo em produção os DEFAULTS servem sozinhos e isto é no-op.
export async function migrateFlashcardsDeckExpansion(repo) {
  const doc = await repo.get("flashcards", "leverads");
  if (!doc || doc.deckExpansionV1) return 0;
  const have = new Set((doc.cards || []).map((c) => c && c.id));
  const missing = LEVERADS_EXPANSION.filter((c) => !have.has(c.id));
  await repo.update("flashcards", "leverads", {
    ...(missing.length ? { cards: [...(doc.cards || []), ...missing] } : {}),
    deckExpansionV1: true,
  });
  return missing.length;
}

// ── Custos %: base por lançamento (ago/2026) ────────────────────────────────
// Todo custo percentual incidia sobre os GANHOS do mês inteiro. O Leo separou:
// o checkout de 12% só existe quando a venda fecha no cartão de crédito em 12x
// (taxa da adquirente pra antecipar) e o imposto incide sobre o que foi
// RECEBIDO no mês (regime de caixa), não sobre o contratado. O lançamento
// ganha `base` ("won" | "cartao12x" | "received"; sem base = "won") e os dois
// já cadastrados em produção são carimbados pelo nome. Idempotente: só toca
// linha de pct sem base; lançamento novo já nasce com a base escolhida na tela.
export async function migrateExpensePctBases(repo) {
  let n = 0;
  for (const e of await repo.list("expenses")) {
    if (!(Number(e.pct) > 0) || e.base) continue;
    const name = String(e.name || "").toLowerCase();
    const base = name.includes("checkout") ? "cartao12x" : name.includes("imposto") ? "received" : "";
    if (!base) continue;
    await repo.update("expenses", e.id, { base });
    n++;
  }
  return n;
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
  // callWinRate (ganhos ÷ agendadas) saiu: é CONTA de showRate × conversaoCall,
  // não meta digitada (ver ensureCloseRateUnica).
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
  // Uma taxa de fechamento só, sobre as calls que ACONTECERAM. `proposalWinRate`
  // saiu (não alimentava nada) e `winRateCall` virou conta (ensureCloseRateUnica).
  { metric: "conversaoCall", target: 33 },
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

// UMA taxa de fechamento (22/07). O card do closer tinha "Call → ganho" e
// "Proposta → ganho" que não conversavam: a segunda não alimentava NADA, e a
// primeira era lida com dois denominadores (o placar sobre as AGENDADAS, o pace
// sobre as que COMPARECERAM). Agora existe só `conversaoCall` = ganhos ÷ calls
// que aconteceram; a conversão sobre as agendadas virou conta.
//
// A conversão de valor é o pulo do gato: 25% das agendadas com 75% de
// comparecimento são 33% das que aconteceram. Divide pela meta de showRate do
// produto (ou pelo benchmark) pra a régua do time não mudar de altura sozinha.
export async function ensureCloseRateUnica(repo) {
  let changed = 0;
  const goals = await repo.list("goals");
  for (const product of await repo.list("products")) {
    if (product.closeRateUnicaV1) continue;
    const mine = goals.filter((g) => !g.saas || g.saas === product.id);
    const showGoal = Number(mine.find((g) => g.scope === "role" && g.key === "sdr" && g.metric === "showRate")?.target);
    const show = showGoal > 0 ? showGoal / 100 : 0.75;
    for (const old of mine.filter((g) => g.metric === "winRateCall")) {
      const booked = Number(old.target);
      const already = mine.find((g) => g.scope === old.scope && g.key === old.key && g.metric === "conversaoCall");
      if (booked > 0 && !already) {
        const target = Math.min(100, Math.round(booked / show));
        await repo.create("goals", {
          id: `goal_${product.id}_${old.scope}_${old.key}_conversaoCall`,
          saas: product.id, scope: old.scope, key: old.key,
          metric: "conversaoCall", target, period: old.period || "month",
        });
        changed++;
      }
      await repo.remove("goals", old.id); changed++;
    }
    // Métricas que deixaram de existir: a de proposta não alimentava nada e a
    // callWinRate agora é derivada — deixá-las no banco só faria a tela de Metas
    // ressuscitar campo removido.
    for (const dead of mine.filter((g) => g.metric === "proposalWinRate" || g.metric === "callWinRate")) {
      await repo.remove("goals", dead.id); changed++;
    }
    await repo.update("products", product.id, { closeRateUnicaV1: true });
  }
  return changed;
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

// ── Faixa de faturamento no checklist do SDR (jul/2026) ─────────────────────
// O form público não pergunta mais faturamento, mas o SDR precisa capturar a
// faixa NA CONVERSA (qualifica o valor do lead, e o briefing de integração já
// lê lead.revenue). Insere a pergunta no leadQuestions do leverads logo depois
// de "listings" (ordem da conversa: anúncios → faturamento; o CHECKLIST_ORDER
// do painel acompanha). Tokens no formato legado do form ("50k-150k", "1m+"),
// que o range() do integration-brief já formata. One-shot por
// revenueQuestionV1: se o dono apagar a pergunta no editor, ela não volta.
export async function ensureRevenueLeadQuestion(repo) {
  const product = await repo.get("products", "leverads");
  if (!product || product.revenueQuestionV1) return false;
  const qs = Array.isArray(product.leadQuestions) ? product.leadQuestions.map((q) => ({ ...q })) : null;
  let inserted = false;
  if (qs && !qs.some((q) => q && q.key === "revenue")) {
    const revenue = {
      key: "revenue", label: "Qual a faixa de faturamento mensal?", type: "select", required: false,
      options: [
        { value: "0-50k", label: "Até R$ 50 mil/mês" },
        { value: "50k-150k", label: "R$ 50 a 150 mil/mês" },
        { value: "150k-500k", label: "R$ 150 a 500 mil/mês" },
        { value: "500k-1m", label: "R$ 500 mil a 1 mi/mês" },
        { value: "1m+", label: "Mais de R$ 1 mi/mês" },
        { value: "nao-informou", label: "Não quis informar" },
      ],
    };
    const i = qs.findIndex((q) => q && q.key === "listings");
    qs.splice(i === -1 ? qs.length : i + 1, 0, revenue);
    inserted = true;
  }
  await repo.update("products", "leverads", {
    ...(inserted ? { leadQuestions: qs } : {}),
    revenueQuestionV1: true,
  });
  return inserted;
}

// ── Funde conversas duplicadas do inbox (jul/2026) ──────────────────────────
// O mesmo contato aparecia como DUAS conversas quando o número entrava em duas
// grafias (com/sem o nono dígito, ver waMatchKey) — visto em prod com o Hilton.
// O `recordMessage` já foi corrigido pra casar pela chave normalizada e não
// abrir uma segunda thread, mas as duplicatas que JÁ existiam continuam na
// lista; esta migração as consolida.
//
// Agrupa por waMatchKey; em cada grupo com mais de uma thread, elege a mais
// recentemente atualizada como canônica, reaponta as mensagens das outras pra
// ela, soma o não-lido, preenche os campos que faltarem (leadId/name/saas/
// waPhoneId) e apaga as duplicatas. Idempotente e auto-curável: sem duplicatas
// (o caso normal depois do primeiro merge) só faz um list de wa_threads e sai.
export async function ensureWaThreadDedup(repo) {
  const threads = await repo.list("wa_threads");
  const byKey = new Map();
  for (const t of threads) {
    const k = waMatchKey(t?.id || t?.phone || "");
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const dupGroups = [...byKey.values()].filter((g) => g.length > 1);
  if (!dupGroups.length) return 0;

  const allMsgs = await repo.list("wa_messages");
  let merged = 0;
  for (const group of dupGroups) {
    // Canônica = a conversa VIVA (última atualização). Empate no updatedAt cai
    // no id, só pra ser determinístico entre boots.
    group.sort((a, b) =>
      String(b?.updatedAt || "").localeCompare(String(a?.updatedAt || "")) ||
      String(a?.id || "").localeCompare(String(b?.id || "")));
    const canon = group[0];
    let unread = Number(canon.unread) || 0;
    let leadId = canon.leadId ?? null;
    let name = canon.name || "";
    let saas = canon.saas || "";
    let waPhoneId = canon.waPhoneId || "";
    for (const dup of group.slice(1)) {
      for (const m of allMsgs) {
        if (m.thread === dup.id) await repo.update("wa_messages", m.id, { thread: canon.id });
      }
      unread += Number(dup.unread) || 0;
      leadId = leadId ?? dup.leadId ?? null;
      name = name || dup.name || "";
      saas = saas || dup.saas || "";
      waPhoneId = waPhoneId || dup.waPhoneId || "";
      await repo.remove("wa_threads", dup.id);
      merged++;
    }
    await repo.update("wa_threads", canon.id, { unread, leadId, name, saas, waPhoneId });
  }
  return merged;
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
// ── Form: pergunta de corte "já vende em marketplace?" (jul/2026) ───────────
// Estava chegando gente que nem vende em marketplace. Duas coisas resolvem isso
// ao mesmo tempo: perguntar logo de cara (quem não vende sai do fluxo de venda)
// e NÃO contar essa saída como conversão — contar ensinaria a Meta a caçar mais
// gente fora do perfil, que é a raiz do problema.
//
// Quem não vende vai pra uma conversa própria (interesse em aprender + verba) e
// nasce na coluna Mentoria, sem dono: o produto pra essa fila ainda vai existir.
// Migração porque o dado (perguntas) só faz sentido com o código que entende
// `exit` — deploy atômico, igual à troca de tema do form.
export async function migrateFormVendeMarketplace(repo) {
  const form = await repo.get("forms", "fo_diagnostico_leverads");
  if (!form) return false;
  const qs = [...(form.questions || [])];
  // A sincronização do painel do lead roda SEMPRE (é idempotente e só grava
  // quando muda). Prendê-la ao marcador da migração foi o erro que deixou a
  // produção com o formulário novo e o card velho: o marcador já estava posto
  // do deploy anterior, então a sincronização nunca chegava a acontecer e quem
  // caía na Mentoria abria o card sem nenhuma das respostas que deu.
  if (form.vendeMarketplaceV1 || qs.some((q) => q.key === "vende_marketplace")) {
    const ajustadas = semRespostaEvasiva(qs);
    if (JSON.stringify(ajustadas) !== JSON.stringify(qs)) await repo.update("forms", form.id, { questions: ajustadas });
    await sincronizaPainelDoLead(repo, { ...form, questions: ajustadas });
    if (!form.vendeMarketplaceV1) await repo.update("forms", form.id, { vendeMarketplaceV1: true });
    return false;
  }

  const vende = {
    key: "vende_marketplace",
    label: "Antes de tudo: você *já vende* em marketplace?",
    type: "select",
    required: true,
    options: [
      { value: "sim", label: "Sim, já vendo" },
      // Sai do fluxo de venda e carrega a saída "mentoria" até o fim (as
      // perguntas de contato são as MESMAS, então o mapping continua valendo).
      { value: "nao", label: "Ainda não vendo", to: "aprender_interesse", exit: "mentoria" },
    ],
  };
  const aprender = {
    key: "aprender_interesse",
    label: "Você tem interesse em *aprender e começar a vender*?",
    type: "select",
    required: true,
    options: [
      { value: "sim", label: "Sim, quero começar", to: "aprender_verba" },
      // Disse não duas vezes: acaba aqui, sem pedir contato de quem não quer.
      { value: "nao", label: "Não, só estava olhando", to: "_end", exit: "sem_interesse" },
    ],
  };
  const verba = {
    key: "aprender_verba",
    label: "Qual sua *verba pra começar*?",
    type: "select",
    required: true,
    to: "nome", // volta pras perguntas de contato do fluxo normal
    options: [
      { value: "ate-1k", label: "Até R$ 1 mil" },
      { value: "1k-5k", label: "R$ 1 mil a R$ 5 mil" },
      { value: "5k-20k", label: "R$ 5 mil a R$ 20 mil" },
      { value: "20k+", label: "Mais de R$ 20 mil" },
      // Sem "ainda não sei" de propósito: a verba é o que qualifica essa fila,
      // e a saída fácil esvaziava a pergunta (decisão do Leo em 22/07).
    ],
  };

  // A pergunta nova abre o form; as do ramo novo ficam DEPOIS do contato, então
  // o fluxo de quem já vende não muda em nada.
  const contato = new Set([form.mapping?.name, form.mapping?.phone].filter(Boolean));
  const novas = [vende, ...qs, aprender, verba];
  // O último passo do fluxo principal precisa terminar explicitamente, senão
  // cairia nas perguntas do ramo novo que ficam logo abaixo dele.
  const idxUltimoContato = novas.map((q, i) => (contato.has(q.key) ? i : -1)).filter((i) => i >= 0).pop();
  if (idxUltimoContato != null) novas[idxUltimoContato] = { ...novas[idxUltimoContato], to: "_end" };

  await repo.update("forms", form.id, {
    questions: novas,
    exits: {
      ...(form.exits || {}),
      mentoria: {
        label: "Ainda não vende em marketplace",
        stage: "Mentoria",
        title: "Anotado! Você está *no começo da jornada*.",
        subtitle: "A LeverAds é pra quem já vende e quer escalar, então hoje ela não te serve. Estamos montando algo pra quem está começando: guardamos seu contato e te chamamos quando abrir.",
      },
      sem_interesse: {
        label: "Não quer começar a vender",
        title: "Tudo certo, obrigado por responder.",
        subtitle: "Se um dia quiser vender em marketplace, a gente está por aqui.",
      },
    },
    vendeMarketplaceV1: true,
  });
  // O card do lead monta o painel de respostas a partir de product.leadQuestions
  // (não do form). Sem isto, quem cai na Mentoria abre o card e não vê NADA do
  // que respondeu: as perguntas existiriam só dentro do formulário.
  await sincronizaPainelDoLead(repo, { ...form, questions: novas });
  return true;
}

// Tira a saída fácil da pergunta de verba. Idempotente: roda em todo boot, então
// vale também pra quem já tinha o formulário com a opção antiga.
function semRespostaEvasiva(questions) {
  return questions.map((q) => (q.key === "aprender_verba" && (q.options || []).some((o) => o.value === "nao-sei")
    ? { ...q, options: q.options.filter((o) => o.value !== "nao-sei") }
    : q));
}

async function sincronizaPainelDoLead(repo, form) {
  const product = await repo.get("products", form.saas || "leverads");
  if (!product) return;
  const next = mergeLeadQuestions(product.leadQuestions, form);
  if (JSON.stringify(next) !== JSON.stringify(product.leadQuestions || [])) {
    await repo.update("products", product.id, { leadQuestions: next });
  }
}

// ── Form: e-mail na tela de contato (ago/2026) ──────────────────────────────
// A régua de nutrição por e-mail (drip-runner/disparos) só alcança lead com
// `lead.email`, e o form do diagnóstico pedia apenas nome + WhatsApp. A pergunta
// entra EMPILHADA na mesma tela do contato, logo depois do telefone, e vai pro
// `mapping.email` — é o mapping que faz a resposta cair em `lead.email`
// (leadFromSubmission), valer no dedup por e-mail e ficar FORA do painel de
// qualificação do card (mergeLeadQuestions ignora chaves do mapping).
export async function migrateFormEmailContato(repo) {
  const form = await repo.get("forms", "fo_diagnostico_leverads");
  if (!form) return false;
  const qs = [...(form.questions || [])];
  if (form.emailContatoV1 || qs.some((q) => q.key === "email")) return false;
  const idx = qs.findIndex((q) => q.key === form.mapping?.phone);
  if (idx < 0) return false;

  const email = {
    key: "email",
    label: "E-mail",
    type: "email",
    required: true,
    stack: true,
    placeholder: "voce@suaempresa.com.br",
  };
  // O fim explícito do fluxo principal (to:"_end") morava na pergunta do
  // WhatsApp; muda pra nova última pergunta da tela, senão um desempilhamento
  // futuro do e-mail o deixaria depois do fim.
  if (qs[idx].to === "_end") {
    const { to, ...semTo } = qs[idx];
    qs[idx] = semTo;
    email.to = "_end";
  }
  qs.splice(idx + 1, 0, email);

  await repo.update("forms", form.id, {
    questions: qs,
    mapping: { ...(form.mapping || {}), email: "email" },
    emailContatoV1: true,
  });
  return true;
}

// ── Contratos: campos de preenchimento (ago/2026) ───────────────────────────
// Os 4 modelos de contrato nasceram com espaços em branco desenhados no HTML
// (______). A tela Contratos ganhou formulário de preenchimento que interpola
// tokens {{chave}}; esta migração troca os brancos dos modelos SEED pelos
// tokens e grava a lista `fields` (rótulo/placeholder) que o formulário lê.
// Idempotente: pula contrato que já tem token ou `fields`. Se o time editou o
// corpo na tela e o texto não casa mais, os replaces são no-op e nada quebra —
// `fields` só entra se o corpo final tiver pelo menos um token.

const CONTRACT_COMMON_REPLACES = [
  ["Razão social / Nome: ______________________________________________", "Razão social / Nome: {{razao_social}}"],
  ["CNPJ / CPF: ______________________________________________", "CNPJ / CPF: {{cnpj_cpf}}"],
  ["Endereço: ______________________________________________", "Endereço: {{endereco}}"],
  ["Endereço da operação (local das visitas): ______________________________________________", "Endereço da operação (local das visitas): {{endereco}}"],
  ["Representante legal: ______________________________________________", "Representante legal: {{representante}}"],
  ["E-mail: ______________________________ &nbsp; WhatsApp: ______________________________", "E-mail: {{email}} &nbsp; WhatsApp: {{whatsapp}}"],
  ["Forma de pagamento: &nbsp; ☐ PIX à vista &nbsp;&nbsp; ☐ Cartão de crédito em ____x de R$ ______________ &nbsp;&nbsp; ☐ Boleto faturado em ____x de R$ ______________", "Forma de pagamento: {{forma_pagamento}}"],
  ["Vencimento(s): ______________________________________________", "Vencimento(s): {{vencimentos}}"],
  ["Valor total: R$ ______________ ( ______________________________________________ )", "Valor total: R$ {{valor_total}} ({{valor_extenso}})"],
  ["Valor total do período: R$ ______________ ( ______________________________________________ )", "Valor total do período: R$ {{valor_total}} ({{valor_extenso}})"],
  ["Desenvolvimento + implantação: R$ ______________ ( ______________________________________________ )", "Desenvolvimento + implantação: R$ {{valor_total}} ({{valor_extenso}})"],
  ["Condições específicas (se houver): ______________________________________________", "Condições específicas (se houver): {{condicoes}}"],
  ["Personalizações adicionais (se houver): ______________________________________________", "Personalizações adicionais (se houver): {{condicoes}}"],
  ["____________________________, ______ de ______________________ de 20______.", "{{local_data}}."],
];

// Campos comuns do Quadro Resumo (a ordem é a do formulário da tela).
const CONTRACT_COMMON_FIELDS = [
  { key: "razao_social", label: "Razão social / Nome" },
  { key: "cnpj_cpf", label: "CNPJ / CPF" },
  { key: "endereco", label: "Endereço" },
  { key: "representante", label: "Representante legal" },
  { key: "email", label: "E-mail" },
  { key: "whatsapp", label: "WhatsApp", placeholder: "(11) 98765-4321" },
  { key: "valor_total", label: "Valor total (R$)", placeholder: "40.000,00" },
  { key: "valor_extenso", label: "Valor por extenso", placeholder: "quarenta mil reais" },
  { key: "forma_pagamento", label: "Forma de pagamento", placeholder: "Cartão de crédito em 12x de R$ 3.333,33" },
  { key: "vencimentos", label: "Vencimento(s)", placeholder: "primeira em 10/09/2026, demais todo dia 10" },
  { key: "condicoes", label: "Condições específicas", multiline: true, placeholder: "se houver" },
  { key: "local_data", label: "Local e data da assinatura", placeholder: "Curitiba, 10 de agosto de 2026" },
];

const CONTRACT_FILL_SEED = {
  co_assinatura_leverads: {
    replaces: [
      ["☐ Plano Anual (12 meses) &nbsp;&nbsp; ☐ Plano Semestral (6 meses) &nbsp;&nbsp; ☐ Outro: __________________", "Plano: {{plano}}"],
      ["Contas de marketplace incluídas: Mercado Livre ( ____ ) &nbsp; Shopee ( ____ )", "Contas de marketplace incluídas: Mercado Livre ( {{contas_ml}} ) &nbsp; Shopee ( {{contas_shopee}} )"],
      ["____ meses contados da assinatura deste contrato, renovando-se conforme a Cláusula 8ª.", "{{vigencia_meses}} meses contados da assinatura deste contrato, renovando-se conforme a Cláusula 8ª."],
      // A linha extra de continuação do "Condições específicas" fica órfã depois
      // do replace comum — remove junto com o <br> que a precede.
      ["{{condicoes}}<br>\n      ______________________________________________", "{{condicoes}}"],
    ],
    fields: [
      { key: "plano", label: "Plano contratado", placeholder: "Plano Anual (12 meses)" },
      { key: "contas_ml", label: "Contas Mercado Livre", placeholder: "3" },
      { key: "contas_shopee", label: "Contas Shopee", placeholder: "2" },
      { key: "vigencia_meses", label: "Vigência (meses)", placeholder: "12" },
    ],
  },
  co_consultoria_logistica: {
    replaces: [
      ["☐ Incluídas no valor total &nbsp;&nbsp; ☐ Por conta do CONTRATANTE, mediante reembolso comprovado (deslocamento, hospedagem e alimentação da equipe da LEVER)", "{{despesas}}"],
      ["Conclusão do escopo em ______ dias corridos", "Conclusão do escopo em {{prazo_dias}} dias corridos"],
    ],
    fields: [
      { key: "despesas", label: "Despesas de deslocamento", placeholder: "Incluídas no valor total" },
      { key: "prazo_dias", label: "Prazo (dias corridos)", placeholder: "90" },
    ],
  },
  co_erp_tiny_olist: {
    replaces: [
      ["Tiny ERP (Olist) · plano: ______________________ ·", "Tiny ERP (Olist) · plano: {{plano_erp}} ·"],
      ["Go-live em ______ dias corridos", "Go-live em {{prazo_dias}} dias corridos"],
    ],
    fields: [
      { key: "plano_erp", label: "Plano do ERP", placeholder: "Grande" },
      { key: "prazo_dias", label: "Prazo até o go-live (dias)", placeholder: "45" },
    ],
  },
  co_leverwms: {
    replaces: [
      ["✓ Integração direta com o ERP: ______________________<br>", "✓ Integração direta com o ERP: {{erp_integrado}}<br>"],
      ["Hospedagem, manutenção e suporte: &nbsp; ☐ incluídos durante a vigência da licença &nbsp;&nbsp; ☐ R$ ______________ / ano a partir do 2º ano", "Hospedagem, manutenção e suporte: {{manutencao}}"],
      ["______ dias corridos (estimativa de referência: 45 a 90 dias)", "{{prazo_dias}} dias corridos (estimativa de referência: 45 a 90 dias)"],
      ["______ meses contados do aceite, renovando-se conforme a Cláusula 10ª.", "{{vigencia_meses}} meses contados do aceite, renovando-se conforme a Cláusula 10ª."],
    ],
    fields: [
      { key: "erp_integrado", label: "ERP integrado", placeholder: "Tiny ERP (Olist)" },
      { key: "manutencao", label: "Hospedagem / manutenção", placeholder: "incluídas durante a vigência da licença" },
      { key: "prazo_dias", label: "Prazo de implementação (dias)", placeholder: "90" },
      { key: "vigencia_meses", label: "Vigência da licença (meses)", placeholder: "12" },
    ],
  },
};

// Replace tolerante: no padrão, runs de "_" casam com qualquer tamanho de linha
// em branco e whitespace casa com whitespace — contar underscore exato seria
// frágil. O replacement entra via função pra "$" não ser tratado como especial.
function contractRep(body, from, to) {
  const pattern = from
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/_{2,}/g, "_+")
    .replace(/\s+/g, "\\s+");
  return body.replace(new RegExp(pattern, "g"), () => to);
}

export async function migrateContractFillTokens(repo) {
  let n = 0;
  for (const [id, seed] of Object.entries(CONTRACT_FILL_SEED)) {
    const c = await repo.get("contracts", id).catch(() => null);
    if (!c || !c.body) continue;
    if (c.body.includes("{{") || (Array.isArray(c.fields) && c.fields.length)) continue; // já migrado
    let body = c.body;
    for (const [from, to] of [...CONTRACT_COMMON_REPLACES, ...seed.replaces]) body = contractRep(body, from, to);
    if (!body.includes("{{")) continue; // corpo editado à mão, nada casou: não mexe
    // Só entra em `fields` o campo cujo token existe no corpo final (o modelo 2
    // não tem "Vencimento(s)" no 4, por exemplo — cada corpo dita seus campos).
    const fields = [...CONTRACT_COMMON_FIELDS, ...seed.fields]
      .map((f) => (c.saas === "leverads" && id === "co_consultoria_logistica" && f.key === "endereco" ? { ...f, label: "Endereço da operação (local das visitas)" } : f))
      .filter((f) => body.includes(`{{${f.key}}}`));
    await repo.update("contracts", id, { body, fields });
    n++;
  }
  return n;
}

// ── Catálogo de produto/oferta da proposta (aprovado pelo Leo, 04-06/08/2026) ──
// Liga a tela zero com régua + produto no deck do leverads: alinha as faixas de
// anúncios do template às COLUNAS da régua de qualidade (o form já pergunta
// `listings` exatamente nessas faixas) e grava o catálogo em calc.catalog
// (preços aprovados, dores do painMap e perguntas SPIN por dor). One-shot: se o
// template já tem calc.catalog, não mexe — edição do dono é soberana.
const LEVERADS_VOLUME_MID = { "0-100": 50, "100-500": 300, "500-2000": 1200, "2000-10000": 5000, "10000+": 20000 };
const LEVERADS_CATALOG = {
  accounts: ["1", "2", "3-5", "6-10", "10+"],
  volLabels: ["≤100", "100-500", "500-2k", "2-10k", "10k+"],
  // Espelho do GRADE_GRID de packages/web/src/lib/ui.js (calibração 24/07).
  grid: [
    ["E", "D", "C", "C", "C"],
    ["D", "C", "C", "B", "B"],
    ["C", "B", "B", "A", "A"],
    ["B", "B", "A", "S", "S"],
    ["A", "A", "A", "S", "S"],
  ],
  // Semestral abre; anual é o degrau do Shift+1. Parcial de preço fechado (o
  // teste A/B morreu 04/08: a oferta por SKU não existe mais).
  products: {
    full: { name: "LeverAds FULL", sem: { total: 7188, per: 599 }, anu: { total: 11988, per: 999 } },
    fulloem: { name: "LeverAds + OEM FULL", cota: 200, sem: { total: 11988, per: 999 }, anu: { total: 16068, per: 1339 } },
    oem: {
      name: "OEM avulso",
      // Leque de cota do Leo (14/08/2026, preços corrigidos no mesmo dia):
      // 50/100/200 anúncios/mês. A régua abre no menor nível pro porte D/E e
      // no maior pros demais; o closer troca na tela zero (select "Cota OEM"
      // → state.oemCota).
      small: { cota: 50, sem: { total: 1788, per: 149 }, anu: { total: 3288, per: 274 } },
      mid: { cota: 100, sem: { total: 2988, per: 249 }, anu: { total: 5388, per: 449 } },
      big: { cota: 200, sem: { total: 4788, per: 399 }, anu: { total: 8388, per: 699 } },
    },
    parcialA: { name: "Parcial", sem: { total: 2100, per: 175 }, anu: { total: 3588, per: 299 } },
    parcialoem: { name: "Parcial + OEM 50", cota: 50, sem: { total: 3288, per: 274 }, anu: { total: 5376, per: 448 } },
  },
  // Dores do painMap do produto + perguntas SPIN (definidas com o Leo 06/08).
  pains: {
    A: {
      label: "Subir os mesmos anúncios nas outras contas",
      spin: {
        S: "Hoje, quando você publica um produto novo, como funciona? Sobe na conta principal e depois replica nas outras? Quem faz isso?",
        P: "Quanto tempo por semana vai embora só copiando anúncio de conta pra conta? Qual parte é a pior: ficha técnica, variações, fotos?",
        I: "Enquanto o produto não está nas outras contas, quantas vendas elas deixam de fazer? Já desistiu de subir em alguma conta por pura falta de braço?",
        N: "Se o que você sobe na conta principal aparecesse nas outras em minutos, o que você faria com essas horas? Subiria mais produto?",
      },
    },
    B: {
      label: "Conta banida, precisa anunciar em conta nova",
      spin: {
        S: "Você já passou por suspensão ou queda de conta? Hoje, quanto do seu faturamento depende de uma conta só?",
        P: "Na época, quanto tempo levou pra reerguer a operação? O que foi mais difícil: refazer os anúncios, a reputação, o catálogo?",
        I: "Se a sua conta principal caísse amanhã, quanto você perde por dia até reconstruir? Esse risco já te fez segurar investimento?",
        N: "Faria diferença ter as outras contas já espelhadas, prontas, pra uma queda virar solavanco em vez de parar a empresa?",
      },
    },
    C: {
      label: "Gerenciar SKUs com múltiplos anúncios em múltiplas contas",
      spin: {
        S: "Somando todas as contas, quantos anúncios você administra? Quando muda preço ou ficha de um produto, como isso chega nas outras contas?",
        P: "Com que frequência aparece anúncio desatualizado em alguma conta (preço antigo, atributo errado)? E você descobre como, por acaso?",
        I: "Um preço errado numa conta que você olha pouco, quanto custa até alguém perceber? Já tomou prejuízo ou punição do marketplace por isso?",
        N: "E se uma alteração feita uma vez se propagasse pra todos os anúncios daquele SKU, em todas as contas? O que isso mudaria na sua segurança pra crescer?",
      },
    },
    D: {
      label: "Economizar folha salarial e reduzir riscos",
      spin: {
        S: "Quantas pessoas cuidam dos seus anúncios hoje? O que elas fazem no dia a dia, na prática?",
        P: "Quanto dessa rotina é repetição (copiar, conferir, ajustar) em vez de coisa que gera venda? E quando alguém sai de férias ou pede as contas?",
        I: "Pra dobrar de contas no seu modelo atual, quantas contratações seriam? E um erro manual grave, tipo atributo errado em escala, o que já te custou?",
        N: "Se a replicação rodasse sozinha, você enxugaria a folha ou realocaria o time pra venda? Quanto isso vale por mês?",
      },
    },
    E: {
      label: "Mais exposição no marketplace pra vender mais",
      spin: {
        S: "Seu catálogo completo está ativo em quantas contas hoje? Na busca do ML, o comprador te encontra uma vez ou várias?",
        P: "O que te impede de ter tudo ativo em mais contas: trabalho, tempo, medo de bagunçar a operação?",
        I: "Cada conta a mais é uma posição a mais na página de busca. Quanto você estima que fica na mesa com o catálogo cheio numa conta só, enquanto o concorrente aparece três vezes?",
        N: "Se ativar o catálogo em mais duas ou três contas custasse horas em vez de meses, o que acontece com seu faturamento? Quer simular com seus números?",
      },
    },
    // Dor de anúncio OEM (agosto/2026): o lead clicou num anúncio de part
    // number, não de clonagem. Como as A-E, só troca a trilha SPIN — o
    // produto/preço sai da régua (pedido do Leo, 15/08/2026: quem veio pelo
    // OEM também serve pro LeverAds); OEM avulso é escolha manual do closer.
    OEM: {
      label: "Anunciar pelo código OEM sem montar ficha nem compatibilidade",
      spin: {
        S: "Como nasce um anúncio de peça na sua operação hoje? Alguém monta a ficha técnica e as aplicações, ou você só sobe o que já vem pronto do fornecedor?",
        P: "Quanto tempo leva pra publicar UMA peça com ficha completa e todas as compatibilidades? Quantos códigos do seu catálogo seguem sem anúncio porque dá esse trabalho?",
        I: "Cada código que você não anuncia é uma busca em que o comprador acha o concorrente. E anúncio com aplicação errada já te custou devolução ou reclamação?",
        N: "Se você mandasse só a lista de códigos e os anúncios voltassem prontos (foto, descrição, compatibilidade) publicados na sua conta, quantas peças você subiria por mês?",
      },
    },
    none: {
      label: "Sem código (não veio de anúncio)",
      tip: "Abre com a Situação genérica (me conta como está a operação hoje, quantas contas, quem cuida) e escolhe a trilha A-E conforme a primeira dor que ele verbalizar.",
    },
  },
};

export async function ensureProposalCatalog(repo) {
  const t = await repo.get("proposal_templates", "pt_leverads");
  if (!t || (t.calc && t.calc.catalog)) return false;
  const calc = { ...(t.calc || {}) };
  calc.volumeKey = "listings";
  calc.volumeMid = { ...LEVERADS_VOLUME_MID };
  // CÓPIA: sem isso o template (e todo snapshot que sair dele em memória)
  // aponta pro mesmo objeto do módulo, e uma edição de catálogo vaza pros
  // outros — o teste do serviço único pegou isso.
  calc.catalog = JSON.parse(JSON.stringify(LEVERADS_CATALOG));
  await repo.update("proposal_templates", "pt_leverads", { calc });
  return true;
}

// Retroativo (pedido do Leo, 06/08): as propostas JÁ GERADAS do pt_leverads
// entram no fluxo novo — re-snapshot do template atual (catálogo, faixas da
// régua, as duas bases de pricing) preservando id/link/editKey/views e os
// dados do lead, então o link que o closer já tem passa a abrir a tela zero
// com régua. Ficam FORA por segurança: propostas ACEITAS (história fechada) e
// snapshots de cliente já compartilhados (sharedFrom) — mudar o preço que está
// na mão do cliente é decisão humana; re-compartilhar já re-snapshota.
// Idempotente: proposta com calc.catalog não é tocada de novo.
export async function backfillProposalCatalog(repo) {
  const t = await repo.get("proposal_templates", "pt_leverads");
  if (!t || !t.calc?.catalog) return 0; // depende do ensureProposalCatalog
  const proposals = await repo.list("proposals");
  let n = 0;
  for (const p of proposals) {
    if (p.template !== "pt_leverads") continue;
    if (p.sharedFrom || p.accepted) continue;
    if (p.calc && p.calc.catalog) continue;
    const answers = p.data?.answers || {};
    const state = { ...(p.state || {}) };
    // Faixa de anúncios: a resposta atual do form (listings) quando existe;
    // senão a faixa antiga vira a coluna equivalente da régua pelo ponto médio.
    const vm = t.calc.volumeMid || {};
    const bands = Object.keys(vm);
    const fromAnswers = answers[t.calc.volumeKey || "listings"];
    if (fromAnswers != null && vm[String(fromAnswers)] != null) {
      state.volume = String(fromAnswers);
    } else {
      const oldMid = Number((p.calc?.volumeMid || {})[state.volume]) || 0;
      const col = oldMid <= 100 ? 0 : oldMid <= 500 ? 1 : oldMid <= 2000 ? 2 : oldMid <= 10000 ? 3 : 4;
      state.volume = bands[Math.min(col, bands.length - 1)] || state.volume || "";
    }
    const seats = Number((t.calc.seatsMap || {})[state.accounts]);
    if (seats) state.seats = seats;
    // Mesma régua de snapshot do runNativeProposal com catálogo: pricing é
    // matéria-prima do produto e entra sempre; o resto respeita o showIf.
    await repo.update("proposals", p.id, {
      theme: t.theme || {},
      calc: t.calc,
      slides: (t.slides || []).filter((s) => s?.type === "pricing" || slideVisible(s, answers)),
      state,
    });
    n++;
  }
  return n;
}

// ── Leque do OEM avulso nas propostas ABERTAS (pedido do Leo, 14/08/2026) ───
// A tabela nova do OEM avulso (cotas 50/100/200) entrou no template, mas cada
// proposta congela calc.catalog no snapshot — as abertas seguiam mostrando o
// leque antigo (2 cotas, preços velhos) na tela zero. Mesmo recorte do
// retroativo de 06/08: proposta viva do pt_leverads ganha o catálogo ATUAL do
// template (só o catálogo — deck, estado e escolhas do closer ficam); ACEITAS
// e snapshots de cliente (sharedFrom) ficam de fora. Idempotente: proposta
// cujo OEM já tem o nível `mid` (100) não é tocada — edição posterior do dono
// no snapshot é soberana.
export async function backfillOemLeque(repo) {
  const t = await repo.get("proposal_templates", "pt_leverads");
  const catalog = t?.calc?.catalog;
  if (!catalog?.products?.oem?.mid) return 0; // template ainda sem o leque
  const proposals = await repo.list("proposals");
  let n = 0;
  for (const p of proposals) {
    if (p.template !== "pt_leverads") continue;
    if (p.sharedFrom || p.accepted) continue;
    const oem = p.calc?.catalog?.products?.oem;
    if (!oem) continue;
    // "Leque antigo" = sem o nível mid (pré-leque) OU a tabela v1 de 14/08,
    // que saiu com os preços errados e o Leo corrigiu no mesmo dia (v1 só
    // existiu por automação, nunca por edição do dono). Qualquer outra tabela
    // com mid é edição soberana do snapshot: não mexe.
    const v1 = Number(oem.small?.sem?.total) === 2976 && Number(oem.mid?.sem?.total) === 4776;
    if (oem.mid && !v1) continue;
    // CÓPIA do catálogo (mesma lição do ensureProposalCatalog): sem ela todos
    // os snapshots apontariam pro mesmo objeto e uma edição vazaria pros outros.
    await repo.update("proposals", p.id, { calc: { ...p.calc, catalog: JSON.parse(JSON.stringify(catalog)) } });
    n++;
  }
  return n;
}

// ── Card do pipeline = preço da apresentação (pedido do Leo, 15/08/2026) ────
// O amount do lead nascia da fórmula por assentos (contractValue) e ignorava o
// PRODUTO que a régua sugere: o card mostrava R$ 8,4k enquanto o closer
// abria um FULL de R$ 7.188. A geração e a tela zero agora gravam o preço do
// produto ativo (catalogAmount); esta rotina alinha os leads ABERTOS já
// gerados e re-aplica a regra a cada boot — até o fechamento, o valor do card
// É o da apresentação, então drift (edição manual no drawer, dado antigo) não
// sobrevive ao deploy. Ficam fora: lead em estágio terminal (ganho/perdido/
// desqualificado), fechado (planClosed/wonAt), proposta aceita (preço na mão
// do cliente) e proposta sem catálogo. Idempotente: valor já alinhado não mexe.
export async function syncOpenLeadAmounts(repo) {
  const products = new Map((await repo.list("products")).map((p) => [p.id, p]));
  const proposals = new Map((await repo.list("proposals")).map((p) => [p.id, p]));
  const leads = await repo.list("leads");
  let n = 0;
  for (const lead of leads) {
    if (!lead.proposta_id || lead.planClosed || lead.wonAt) continue;
    if (TERMINAL_KINDS.has(kindOf(products.get(lead.saas), lead.stage))) continue;
    const p = proposals.get(lead.proposta_id);
    if (!p || p.accepted) continue;
    const amount = catalogAmount(p);
    if (!(amount > 0) || Number(lead.amount) === amount) continue;
    await repo.update("leads", lead.id, { amount });
    n++;
  }
  return n;
}

// ── Conta grande (keyAccount) ───────────────────────────────────────────────
// Cliente fora da régua (ex.: Galante, pacote bespoke de R$ 120 mil no meio de
// vendas de R$ 3-7 mil): o flag `keyAccount` tira ele do ticket médio e das
// metas derivadas por contrato (pace/Metas/Visão geral) sem tirar o dinheiro
// do caixa/vendido. Carimba o Galante uma vez; clientes futuros são marcados
// na edição do cliente (campo "Conta grande"). Idempotente: já marcado (ou
// desmarcado DE PROPÓSITO — campo presente com valor falso) não mexe.
export async function ensureKeyAccountGalante(repo) {
  const customers = await repo.list("customers");
  const galante = customers.find((c) => c.saas === "leverads" && /galante/i.test(String(c.name || "")));
  if (!galante || galante.keyAccount !== undefined) return false;
  await repo.update("customers", galante.id, { keyAccount: true });
  return true;
}

// ── Papéis do time (Leo, 08/08) ─────────────────────────────────────────────
// O Vitor é CS (integrator) e a Manuela é SDR — a etiqueta extra de closer que
// os dois carregavam pintava bloco de closer nos cards da Visão geral e diluía
// a meta de time dos closers de verdade. ONE-SHOT (flag no produto): rodou uma
// vez, o Leo pode re-etiquetar em Ajustes → Equipe sem a migração desfazer.
export async function migrateRolesCsSdr(repo) {
  const product = await repo.get("products", "leverads");
  if (!product || product.rolesCsSdrV1) return false;
  const users = await repo.list("users").catch(() => []);
  let changed = 0;
  for (const u of users) {
    const roles = Array.isArray(u.roles) ? u.roles : [];
    const name = String(u.name || "");
    if (/manuela/i.test(name) && roles.includes("closer")) {
      await repo.update("users", u.id, { roles: roles.filter((r) => r !== "closer") });
      changed++;
    }
    if (/^vitor/i.test(name.trim()) && roles.some((r) => r === "closer" || r === "sdr")) {
      await repo.update("users", u.id, { roles: roles.filter((r) => r !== "closer" && r !== "sdr") });
      changed++;
    }
  }
  await repo.update("products", "leverads", { rolesCsSdrV1: true });
  return changed;
}

export async function runStartupMigrations(repo) {
  try {
    const changed = await ensureKeyAccountGalante(repo);
    if (changed) console.log("[migration] Galante marcado como conta grande (keyAccount) — fora das médias");
  } catch (err) {
    console.error("[migration] ensureKeyAccountGalante falhou:", err?.message || err);
  }
  try {
    const n = await migrateRolesCsSdr(repo);
    if (n) console.log(`[migration] papéis ajustados (Vitor = CS, Manuela = SDR): ${n} usuário(s)`);
  } catch (err) {
    console.error("[migration] migrateRolesCsSdr falhou:", err?.message || err);
  }
  try {
    const n = await migrateContractFillTokens(repo);
    if (n) console.log(`[migration] modelos de contrato tokenizados pro preenchimento na tela (${n} modelos)`);
  } catch (err) {
    console.error("[migration] migrateContractFillTokens falhou:", err?.message || err);
  }
  try {
    const changed = await migrateFormVendeMarketplace(repo);
    if (changed) console.log('[migration] form do diagnóstico ganhou a pergunta "já vende em marketplace?" + saídas laterais');
  } catch (err) {
    console.error("[migration] migrateFormVendeMarketplace falhou:", err?.message || err);
  }
  try {
    const changed = await migrateFormEmailContato(repo);
    if (changed) console.log("[migration] form do diagnóstico ganhou o e-mail na tela de contato (mapping.email → lead.email)");
  } catch (err) {
    console.error("[migration] migrateFormEmailContato falhou:", err?.message || err);
  }
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
    const n = await migrateFlashcardsDeckExpansion(repo);
    if (n) console.log(`[migration] flashcards: expansão ago/2026 anexada à base do leverads (${n} cards)`);
  } catch (err) {
    console.error("[migration] migrateFlashcardsDeckExpansion falhou:", err?.message || err);
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
    const n = await ensureCloseRateUnica(repo);
    if (n) console.log(`[migration] ${n} meta(s) de fechamento unificadas em conversaoCall`);
  } catch (err) {
    console.error("[migration] ensureCloseRateUnica falhou:", err?.message || err);
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
  try {
    const n = await ensureWaThreadDedup(repo);
    if (n) console.log(`[migration] WhatsApp: ${n} conversa(s) duplicada(s) fundida(s) no inbox`);
  } catch (err) {
    console.error("[migration] ensureWaThreadDedup falhou:", err?.message || err);
  }
  try {
    const changed = await ensureRevenueLeadQuestion(repo);
    if (changed) console.log("[migration] pergunta de faixa de faturamento adicionada ao checklist do leverads");
  } catch (err) {
    console.error("[migration] ensureRevenueLeadQuestion falhou:", err?.message || err);
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
  try {
    const changed = await ensureProposalCatalog(repo);
    if (changed) console.log("[migration] catálogo de produto/oferta gravado no template pt_leverads (tela zero com régua)");
  } catch (err) {
    console.error("[migration] ensureProposalCatalog falhou:", err?.message || err);
  }
  // Depois do catálogo no template: propostas antigas entram no fluxo novo.
  try {
    const n = await backfillProposalCatalog(repo);
    if (n) console.log(`[migration] ${n} proposta(s) existente(s) re-snapshotada(s) no fluxo do catálogo`);
  } catch (err) {
    console.error("[migration] backfillProposalCatalog falhou:", err?.message || err);
  }
  // Depois do backfill: proposta aberta com o leque antigo do OEM avulso (2
  // cotas, preços velhos) recebe a tabela atual do template.
  try {
    const n = await backfillOemLeque(repo);
    if (n) console.log(`[migration] leque do OEM avulso (50/100/200) aplicado em ${n} proposta(s) aberta(s)`);
  } catch (err) {
    console.error("[migration] backfillOemLeque falhou:", err?.message || err);
  }
  // Depois do catálogo/leque nas propostas: o valor do card dos leads abertos
  // passa a ser o preço do produto que a apresentação sugere.
  try {
    const n = await syncOpenLeadAmounts(repo);
    if (n) console.log(`[migration] valor do card alinhado ao produto da apresentação em ${n} lead(s) aberto(s)`);
  } catch (err) {
    console.error("[migration] syncOpenLeadAmounts falhou:", err?.message || err);
  }
  try {
    const n = await migrateExpensePctBases(repo);
    if (n) console.log(`[migration] custos %: base carimbada em ${n} lançamento(s) (checkout → cartão 12x, imposto → recebidos)`);
  } catch (err) {
    console.error("[migration] migrateExpensePctBases falhou:", err?.message || err);
  }
  // Histórico de links de pagamento: o que já foi gerado antes da tela existir
  // (carimbo no lead / na fatura) vira recibo, senão o histórico nasce vazio.
  try {
    const n = await backfillPaymentLinks(repo);
    if (n) console.log(`[migration] ${n} link(s) de pagamento já gerados entraram no histórico`);
  } catch (err) {
    console.error("[migration] backfillPaymentLinks falhou:", err?.message || err);
  }
}
