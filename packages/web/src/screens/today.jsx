import React from "react";
import { createPortal } from "react-dom";
import { LeadGrade, LeadSection } from "../components/lead-card.jsx";
import "./today.css";
import { Modal } from "../components/overlay.jsx";
import { Popover } from "../components/popover.jsx";
import { EmptyState, useEsc, toast, WaButton, Avatar, MoreMenu } from "../atoms.jsx";
import { ErrorBoundary } from "../components/error-boundary.jsx";
import { Pill } from "../components/viz.jsx";
import { ActivityComposer } from "../components/timeline.jsx";
import { waLink, leadTier, cockpitProposalUrl } from "../lib/ui.js";
import { waCallLinkText } from "../lib/wa-copy.js";
import { api } from "../lib/api.js";
import { bizDay } from "../lib/format.js";
import { businessDaysBetween } from "../components/period-picker.jsx";
import { scaledGoal } from "../components/team-cards.jsx";
import { useData } from "../data.jsx";
import { stageKind, phaseOf, workableStages, openStages, cadenceOf, rollToBusinessDay, stageByKind, firstStage, lossReasonsOf, nextKindsFor, nurtureStage, hasDayStages, dayStageNumber } from "../lib/funnel.js";
import { allUsers, currentUser, displayName, userById, usersByRole, isAdminUser } from "../lib/users.js";
import { useActiveSaas } from "../lib/workspace.js";
import { myOpenTasks, taskHash } from "../lib/tasks.js";
import { useAttribution } from "../lib/pains.js";
import { clientSummary, ClientSummaryCard, AttributionCard, LeadChecklist, ScriptBlocks, DealProductField, isOneOffProduct, SelectWithCustom, PaymentMethodSelect, ProductOptions, leadBox } from "../components/lead-blocks.jsx";
import { resolveScript, scriptTokens, scriptChecklist, isNoShowStage, confirmationScript, integrationConfirmationScript, scriptKeyFor } from "../lib/scripts.js";
import { CLOSED_PLANS, CLOSED_PLANS_ACTIVE, withLegacyOption, closedPlanLabel, dealProductLabel, dealProductsOf } from "../lib/payments.js";
import { LeadSendActions, useLeadProposalActions } from "../components/lead-send-actions.jsx";
import { PaymentLinkModal } from "../components/payment-link-modal.jsx";
// Meu dia — a fila de execução de quem opera o funil, agrupada POR DIA:
// "Hoje" (a fila de trabalho, numerada na ordem de prioridade do processo),
// "Amanhã" e "Próximos dias" (o que já está agendado, à vista), e "Sem data".
// Dentro de cada dia vale a mesma prioridade: horário marcado → novos →
// qualificando → follow-ups → nutrição. Formato de tabela (Quando · Etapa ·
// Ação · Lead). "Começar a fila" abre o roteiro do 1º pendente de HOJE e
// "toque e próximo" segue em sequência até zerar o dia.

const { useState: useS, useMemo: useM, useEffect: useE } = React;

const TOUCH_TYPES = new Set(["whatsapp", "call", "email", "meeting"]);
const DAY = 86400000;

// Relógio da tela: um tick a cada 30s mantém o horário do cabeçalho e as
// previsões da fila ("em 25 min") vivos sem depender de recarga de dados.
function useNow(step = 30000) {
  const [now, setNow] = useS(() => Date.now());
  useE(() => {
    const id = setInterval(() => setNow(Date.now()), step);
    return () => clearInterval(id);
  }, [step]);
  return now;
}

// Previsão que fica embaixo da pílula de horário: quanto falta pro compromisso.
function untilNote(t, now) {
  const mins = Math.round((t - now) / 60000);
  if (mins <= 0) return "agora";
  if (mins < 60) return `em ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `em ${h}h${String(m).padStart(2, "0")}` : `em ${h}h`;
}

const hhmmOf = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const ddmmOf = (t) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

// Ponteiros no horário real — o ícone do relógio marca a hora de agora.
function ClockIcon({ now, size = 15 }) {
  const d = new Date(now);
  const mins = d.getMinutes();
  const hand = (deg, len) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(12 + Math.cos(a) * len).toFixed(1)} ${(12 + Math.sin(a) * len).toFixed(1)}`;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d={`M12 12 L ${hand(((d.getHours() % 12) + mins / 60) * 30, 4.2)}`} />
      <path d={`M12 12 L ${hand(mins * 6, 6.4)}`} />
    </svg>
  );
}

// Relógio ao vivo ao lado do título: situa quem está operando a fila (o "agora"
// das pílulas de horário é este).
function NowClock({ now }) {
  const d = new Date(now);
  const day = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
  return (
    <span title={`agora · ${day} ${hhmmOf(now)}`} style={{
      display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: 999,
      border: "1px solid var(--line-1)", background: "var(--bg-2)", flexShrink: 0,
    }}>
      {/* Ordem da prancha: o dia antes da hora, tudo em mono. */}
      <span style={{ color: "var(--fg-4)", display: "inline-flex" }}><ClockIcon now={now} /></span>
      <span className="mono tnum" style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{day}</span>
      <span style={{ fontSize: 11.5, color: "var(--line-2)" }}>·</span>
      <span className="mono tnum" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-1)" }}>{hhmmOf(now)}</span>
    </span>
  );
}

// Coluna "quando" da fila: a HORA em pílula navy (o dado que a pessoa procura
// primeiro) e a previsão logo abaixo ("agora", "em 25 min", "atrasado 2d").
// Item sem hora marcada usa a pílula neutra pra fila não perder o alinhamento.
// A pílula de horário na medida da prancha (14/09): 22px de altura, raio 6,
// 11,5px tabular. O TOM pinta a pílula inteira, e é ele que faz a coluna ser
// lida de longe: cinza = já feito ou sem data, âmbar = perto de vencer, navy =
// hora marcada com o lead, vermelho = passou da hora.
const TIME_TONE = {
  neg:  { bg: "var(--neg)", fg: "oklch(1 0 0)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  appt: { bg: "var(--btn-bg)", fg: "var(--btn-fg)" },
  mut:  { bg: "var(--bg-2)", fg: "var(--fg-4)" },
};
function TimeCell({ pill, note, tone, soft, apagado }) {
  const t = apagado || soft || tone === "mut" ? TIME_TONE.mut : tone === "neg" ? { bg: "var(--neg-soft)", fg: "var(--neg)" } : tone === "warn" ? TIME_TONE.warn : TIME_TONE.appt;
  const noteColor = apagado ? "var(--fg-4)" : tone === "neg" ? "var(--neg)" : tone === "warn" ? "var(--warn)" : tone === "pos" ? "var(--pos)" : "var(--fg-4)";
  return (
    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
      {/* Instrument Sans com números tabulares (`.tnum`, sem `.mono`): a hora
          lê mais fácil que na JetBrains e as colunas continuam alinhadas. */}
      <span className="tnum" style={{
        display: "inline-flex", alignItems: "center", height: 24, padding: "0 11px", borderRadius: 999,
        background: t.bg, color: t.fg, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", maxWidth: "100%",
        overflow: "hidden", textOverflow: "ellipsis",
      }}>{pill}</span>
      {note && <span style={{ fontSize: 10.5, fontWeight: tone === "neg" && !apagado ? 600 : 500, color: noteColor, paddingLeft: 2, whiteSpace: "nowrap" }}>{note}</span>}
    </span>
  );
}

// Rótulo da ação por kind — o "o que fazer" do item, não o nome do estágio.
const ACTION_LABELS = {
  novo: "1º contato",
  contato: "tentativa",
  qualificacao: "retomada",
  call: "call",
  proposta: "cobrar proposta",
  followup: "follow-up",
  integracao: "integração",
  posvenda: "pós-venda",
  outro: "contato",
};

// Etapas em que mandar a proposta faz sentido no roteiro (a call tem bloco
// próprio, com os atalhos da chamada junto).

const TIER_ORDER = { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1, sem: 0 };

// Ordem de atendimento dentro de cada dia (Leo, jul/2026): confirmar call (o
// mais time-sensitive) e horário marcado primeiro; novos e no-show (leads
// quentes) na sequência; depois retomadas, follow-ups, nutrição e sem agenda.
const GROUP_ORDER = ["confirm", "appt", "novo", "noshow", "qual", "closer", "nutri", "loose"];

// Orçamento da fila compacta: horário, identidade/ação e abrir roteiro.
export const QUEUE_GRID = "72px minmax(0,1fr) 121px";
export const QUEUE_GRID_GAP = 10;
export const QUEUE_GRID_BUDGET = 716;

// ── O grupo VIRA CABEÇALHO na fila (12/09/2026) ─────────────────────────────
// A ordem já existia (é o GROUP_ORDER que o buildQueue aplica) e não aparecia:
// a lista renderizava plana, e 14 linhas seguidas não contam que as duas
// primeiras são confirmação de call e as quatro seguintes são leads novos. A
// frase diz POR QUE aquele grupo vem antes — é o que ensina a fila.
const GROUP_META = {
  confirm: ["Confirmar call", "o mais sensível a horário"],
  appt: ["Compromisso marcado", "hora marcada com o lead"],
  novo: ["Leads novos", "quanto mais fresco, mais responde"],
  noshow: ["Furou a call", "retomar no mesmo dia"],
  qual: ["Retomadas", "toque agendado que venceu"],
  closer: ["Follow-up do closer", ""],
  nutri: ["Nutrição", "fora do funil ativo"],
  loose: ["Sem data", "ninguém marcou o próximo toque · não entram na contagem do dia"],
};

// O VERBO da ação (o trabalho), que estava escondido em 12,5px --fg-3 dentro da
// coluna do nome enquanto a ETAPA ocupava uma coluna de 118px em chip. Usado
// pelo bloco "Agora" e pela coluna "o que fazer" da linha — uma régua só.
// O verbo da linha, com as palavras da prancha (14/09) e em minúsculo: é uma
// ORDEM DE TRABALHO ("positivar a confirmação"), não um rótulo de categoria.
// A confirmação de 2h manda e a de 10 min positiva, por isso os dois verbos.
function actionVerb(item) {
  if (item.confirm) {
    if (item.confirmKind === "integracao") return "confirmar a integração";
    if (item.confirmWindow === "ligar") return "ligar pro cliente (sem positiva)";
    return item.confirmWindow === "10min" ? "positivar a confirmação" : "confirmar a call";
  }
  if (item.group === "noshow") return "retomada";
  if (item.group === "nutri") return "reativação";
  if (item.group === "loose") return "marcar o próximo toque";
  return ACTION_LABELS[item.kind] || "contato";
}

// O detalhe embaixo do verbo: a janela da confirmação, a tentativa, a nota do
// toque ou a origem do lead novo — o que dá contexto sem abrir o roteiro.
function actionHint(item) {
  const { l, kind, due } = item;
  const tent = Number(l.stageAttempts) || 0;
  const partes = [];
  if (item.confirm) {
    partes.push(item.confirmWindow === "10min" ? "10 min antes" : item.confirmWindow === "ligar" ? "1h antes · sem resposta na confirmação" : "2h antes");
    const at = item.confirmKind === "integracao" ? l.integrationAt : l.callAt;
    if (at) partes.push(`${item.confirmKind === "integracao" ? "integração" : "call"} ${hhmmOf(at)}`);
  } else if (l.nextActionNote) {
    if (tent > 0) partes.push(`${tent} de 5`);
    partes.push(l.nextActionNote);
  } else if (due?.type === "call") {
    partes.push("call confirmada · Meet da agenda");
  } else if (kind === "novo") {
    partes.push(l.source || "sem origem");
    partes.push(tent > 0 ? `${tent}ª tentativa` : "sem tentativa");
  } else if (tent > 0) {
    partes.push(`${tent} de 5`);
  }
  return partes.filter(Boolean).join(" · ");
}

// Fase do processo → papel que trabalha nela. Card SEM responsável só entra na
// fila de quem tem o papel da fase: SDR não vê follow-up/integração soltos
// (exclusivos de closer/integrador) e closer não herda a fila de novos.
const PHASE_ROLE = { sdr: "sdr", closer: "closer", entrega: "integrator" };

// Passo de confirmação (2h / 10min antes da call, 2h antes da integração) já
// executado? O registro mora em `lead.confirmLog` AMARRADO ao horário vigente
// do compromisso ({ at, "1h": iso, … }): remarcou a call, o log antigo perde a
// validade sozinho e as tarefas de confirmação voltam pra fila.
export function confirmStepDone(lead, window, at) {
  const log = lead?.confirmLog;
  return !!(log && at && log.at === at && log[window]);
}

// Monta a fila: um item por lead trabalhável, no bloco do dia certo e
// classificado no grupo de prioridade (que define a ordem dentro do bloco).
function buildQueue(leads, consultas, saasCfg, person) {
  const workable = new Set(workableStages(saasCfg));
  const open = new Set(openStages(saasCfg));
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const endTomorrow = new Date(endToday); endTomorrow.setDate(endTomorrow.getDate() + 1);
  const todayStr = startToday.toDateString(); // uma vez, não 2 Date + toDateString por lead

  const g = { hoje: [], amanha: [], proximos: [], semdata: [] };
  let doneToday = 0;
  // Papéis de quem é a fila (sdr/closer/integrator) — decide quais cards sem
  // dono aparecem. Fila "time todo" (person vazio) mostra tudo.
  const personRoles = person ? new Set(userById(person)?.roles || []) : null;

  for (const l of leads) {
    if (saasCfg && l.saas !== saasCfg.id) continue;
    const stage = l.stage || saasCfg?.funnel?.[0]?.stage || "";
    if (l.stage && !workable.has(l.stage)) continue;
    const kind = stageKind(saasCfg, stage);
    const phase = phaseOf(kind);
    // Confirmação de call: call marcada pra HOJE conduzida pelo closer (dono !=
    // closer) → vira uma tarefa de CONFIRMAÇÃO na fila do SDR (o closer segue
    // vendo a call na dele). Vai pro DONO quando há dono; SEM dono cai pra quem
    // tiver o papel de SDR (mesmo fallback do resto da fila) — senão uma call de
    // lead antigo/importado sem owner some sem NINGUÉM pra confirmar. Só na fila
    // de um SDR, não no "time todo".
    const callT = l.callAt ? new Date(l.callAt).getTime() : NaN;
    const callToday = Number.isFinite(callT) && callT >= startToday.getTime() && callT <= endToday.getTime();
    const isConfirm = kind === "call" && callToday && l.owner !== l.closer && person &&
      (l.owner ? person === l.owner : personRoles.has(PHASE_ROLE.sdr));
    // Responsável da vez: SDR (dono) na pré-venda; closer na fase de call/
    // follow-up (SÓ o campo closer: dono SDR antigo não puxa o card); e o
    // INTEGRADOR (campo próprio) na entrega — integração/CS são do Eryk.
    const who = isConfirm ? l.owner : phase === "sdr" ? (l.owner || "") : phase === "entrega" ? (l.integrator || "") : (l.closer || "");
    // Filtro de pessoa: card atribuído à pessoa sempre entra; card SEM dono só
    // entra pra quem tem o papel da fase (SDR não vê follow-up/integração). A
    // confirmação já foi filtrada por pessoa acima (isConfirm), então não passa
    // por aqui — senão a call sem dono cairia no papel de closer e sumiria.
    if (person && !isConfirm) {
      if (who) { if (who !== person) continue; }
      else {
        const need = PHASE_ROLE[phase];
        if (!need || !personRoles.has(need)) continue;
      }
    }

    // Progresso do dia: todo lead trabalhável tocado hoje conta, mesmo que o
    // toque já tenha re-agendado o GPS (o item muda de bloco, o feito fica).
    if (TOUCH_TYPES.has(l.lastActivityType) && l.lastActivityAt &&
      new Date(l.lastActivityAt).toDateString() === todayStr) doneToday++;

    // Tarefa de confirmação: NÃO vence no horário da call. Vira DUAS tarefas com
    // o horário já descontado — 2h antes (manda a confirmação; era 1h até 30/08:
    // saindo 2h antes, o silêncio vira ligação AINDA antes da call — quem não
    // responde a confirmação fura 88%) e 10min antes (positiva ou liga). Assim
    // o SDR sabe a hora exata de executar cada uma.
    if (isConfirm) {
      const M = 60 * 1000;
      // FEITO por janela: o SDR marcou "confirmou" ou "sem resposta" naquele
      // passo (confirmStepDone), senão a tarefa continua pendente. Cliente que
      // confirmou já resolve a de 2h; a de 10min segue (positiva ou ligação).
      g.hoje.push({ l, kind, phase, who, due: { t: callT - 120 * M, type: "confirm" }, done: confirmStepDone(l, "2h", l.callAt) || !!l.callConfirmed, stage, group: "confirm", confirm: true, confirmWindow: "2h" });
      // LIGAÇÃO OBRIGATÓRIA (raio-x 17/09): sem positiva até 1h antes, o robô
      // levanta o alerta (sdrLog.ringAlertFor = horário da call) e a metade
      // furava mesmo assim, porque alerta não vira ligação. Aqui o alerta é
      // uma TAREFA da fila, 1h antes, feita quando o SDR registra o resultado
      // (atendeu/confirmou ou não atendeu) ou quando o cliente confirma.
      if (l.sdrLog?.ringAlertFor === l.callAt) {
        g.hoje.push({ l, kind, phase, who, due: { t: callT - 60 * M, type: "confirm" }, done: confirmStepDone(l, "ligar", l.callAt) || !!l.callConfirmed, stage, group: "confirm", confirm: true, confirmWindow: "ligar" });
      }
      g.hoje.push({ l, kind, phase, who, due: { t: callT - 10 * M, type: "confirm" }, done: confirmStepDone(l, "10min", l.callAt), stage, group: "confirm", confirm: true, confirmWindow: "10min" });
      continue;
    }

    // Confirmação da INTEGRAÇÃO: 2h antes da call de vídeo, na fila de quem vai
    // conduzir (o integrador). Diferente da confirmação de call, aqui é a MESMA
    // pessoa que confirma e faz, então o item de confirmação SOMA com o
    // compromisso da integração (não substitui): ele confirma às 8h e conduz às
    // 10h. Marcado como feito quando ele registra que o cliente confirmou. Só na
    // fila de UMA pessoa (igual à confirmação de call): no "time todo" o
    // compromisso da integração já aparece, e a linha extra viraria ruído.
    const integT = l.integrationAt ? new Date(l.integrationAt).getTime() : NaN;
    if (person && kind === "integracao" && Number.isFinite(integT) &&
      integT >= startToday.getTime() && integT <= endToday.getTime()) {
      g.hoje.push({
        l, kind, phase, who, stage, group: "confirm",
        due: { t: integT - 120 * 60 * 1000, type: "confirm" },
        done: !!l.integrationConfirmed || confirmStepDone(l, "2h", l.integrationAt), confirm: true, confirmKind: "integracao", confirmWindow: "2h",
      });
    }

    // "Quando" do card. Duas regras que se combinam:
    //  (1) Compromisso (call/integração) só vale de HOJE em diante e SÓ NA ETAPA
    //      correspondente: uma call marcada num card que já AVANÇOU de etapa
    //      (ex.: foi pra Proposta) é histórico, não compromisso — o servidor
    //      re-agenda o GPS mas nunca limpa o callAt, então sem o filtro por etapa
    //      a call antiga ancorava o card na fila de hoje pra sempre.
    //  (2) Havendo compromisso vivo NA etapa, é ele que conduz o card (mesmo pra
    //      frente). O toque do GPS (nextActionAt) é confirmação/retry e NÃO
    //      compete: senão um card com call daqui a 2 dias aparece "atrasado" hoje
    //      por um toque vencido. O nextActionAt só entra quando não há call/
    //      integração agendada nesta etapa.
    const cands = [];
    const push = (v, type, min = 0) => {
      const t = v ? new Date(v).getTime() : NaN;
      if (Number.isFinite(t) && t >= min) cands.push({ t, type });
    };
    if (kind === "call") push(l.callAt, "call", startToday.getTime());
    else if (kind === "integracao") push(l.integrationAt, "integração", startToday.getTime());
    if (!cands.length) push(l.nextActionAt, "toque");
    cands.sort((a, b) => a.t - b.t);
    const due = cands[0] || null;

    // Toque já registrado hoje = item cumprido (fica na fila, riscado).
    const done = due?.type !== "call" && TOUCH_TYPES.has(l.lastActivityType) &&
      l.lastActivityAt && new Date(l.lastActivityAt).toDateString() === todayStr;

    // Grupo de prioridade (define a ordem e o rótulo da ação).
    const group = !due
      ? (kind === "novo" ? "novo" : "loose")
      : due.type !== "toque" ? "appt"
      : isNoShowStage(stage) ? "noshow"
      : kind === "novo" ? "novo"
      : !open.has(stage) ? "nutri"
      : phase === "sdr" ? "qual"
      : "closer";

    const item = { l, kind, phase, who, due, done, stage, group };

    // Bloco do dia: novo sem agendamento é trabalho de HOJE (SLA corre).
    if (!due) g[kind === "novo" ? "hoje" : "semdata"].push(item);
    else if (due.t <= endToday.getTime()) g.hoje.push(item);
    else if (due.t <= endTomorrow.getTime()) g.amanha.push(item);
    else g.proximos.push(item);
  }

  // Consultas 1:1 (UniqueKids) na fila de quem conduz: entram como compromisso
  // ("appt") no horário marcado, lado a lado com as calls. Só as agendadas e do
  // dono da vez (mesma pessoa da fila); abrir o card leva ao Meet centralizado
  // no lead. Passadas do dia já viram histórico e saem da fila (< início de hoje).
  for (const c of (consultas || [])) {
    if (!c || c.status !== "scheduled" || !c.at) continue;
    if (person && c.owner !== person) continue;
    const t = new Date(String(c.at).length === 16 ? `${c.at}:00` : c.at).getTime();
    if (!Number.isFinite(t) || t < startToday.getTime()) continue;
    const item = { consulta: c, kind: "consulta", who: c.owner || "", due: { t, type: "consulta" }, done: false, stage: `Consulta ${c.n || "?"}/${c.packageTotal || 8}`, group: "appt" };
    if (t <= endToday.getTime()) g.hoje.push(item);
    else if (t <= endTomorrow.getTime()) g.amanha.push(item);
    else g.proximos.push(item);
  }

  // Ordem dentro do bloco: prioridade do processo; no empate, novos por chegada
  // (SLA), agendados pelo horário e os sem data pelo potencial.
  const rank = (i) => GROUP_ORDER.indexOf(i.group);
  const tiebreak = (a, b) => {
    // Novos sempre por ordem de chegada (SLA): quem espera há mais tempo primeiro.
    if (a.group === "novo") return new Date(a.l.createdAt || 0) - new Date(b.l.createdAt || 0);
    if (a.due && b.due) return a.due.t - b.due.t;
    if (a.due || b.due) return a.due ? -1 : 1;
    return (TIER_ORDER[leadTier(b.l).key] - TIER_ORDER[leadTier(a.l).key]) || (Number(b.l.score) || 0) - (Number(a.l.score) || 0);
  };
  for (const k of Object.keys(g)) g[k].sort((a, b) => rank(a) - rank(b) || tiebreak(a, b));
  return { ...g, doneToday };
}

// Registro rápido de social selling (decisão do Leo, 10/09): a SDR aperta +1 a
// cada abordagem feita no Instagram; o número do dia vai pra Análise de
// Desempenho ("social selling executado"). "cadastrar lead" abre o form já com
// a origem "Social selling" (é o que conta como "virou lead") e ela de dona.
function SocialSellingBar({ saasId, person, version, openForm }) {
  const [count, setCount] = useS(null);
  const [busy, setBusy] = useS(false);
  const hoje = bizDay(new Date());
  useE(() => {
    if (!saasId || !person) return;
    let alive = true;
    api.desempenho(saasId, { since: hoje, until: hoje })
      .then((d) => alive && setCount(d?.logs?.[person]?.socialSelling || 0))
      .catch(() => alive && setCount(null));
    return () => { alive = false; };
  }, [saasId, person, version, hoje]);
  const inc = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.desempenhoLog(saasId, { user: person, inc: { socialSelling: 1 } });
      setCount(r?.socialSelling ?? ((count || 0) + 1));
      toast("Social selling registrado", "pos");
    } catch (e) { toast(`Não deu pra registrar · ${e?.message || "tente de novo"}`, "neg"); }
    finally { setBusy(false); }
  };
  const btn = { height: 30, padding: "0 12px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
  // Rodapé do card da fila (prancha, 14/09): kicker + a frase do porquê à
  // esquerda, o número e as duas ações à direita.
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", padding: "12px 16px" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div className="kicker">Social selling</div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>cada abordagem no Instagram conta no seu desempenho do dia</div>
      </div>
      <span className="tnum" style={{ fontSize: 20, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{count == null ? "—" : count}</span>
      <button onClick={inc} disabled={busy} title="registra uma abordagem feita no Instagram"
        style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "var(--btn-bg)", opacity: busy ? 0.6 : 1 }}>+1</button>
      {openForm && (
        <button onClick={() => openForm("leads", { saas: saasId, source: "Social selling", owner: person })}
          title="cadastra o lead já com a origem Social selling · conta na Análise de Desempenho" style={btn}>cadastrar lead</button>
      )}
    </div>
  );
}

// ── Fila limpa: UM bloco (12/09) ───────────────────────────────────────────
// Eram três coisas separadas empilhadas: o EmptyState "Fila limpa", a barra de
// social selling e o aviso do Instagram — três caixas dizendo variações da
// mesma coisa. Agora é um bloco: o que você fez hoje, o que fazer agora (os
// seguidores novos) e as duas ações. O contador +1 continua vivo na barra do
// fluxo normal; aqui o que importa é ir pro Instagram.
function FilaLimpa({ ig, contatos, calls, saasId, person, openForm }) {
  const username = ig?.username || "";
  const count = ig?.count;
  const igUrl = username ? `https://instagram.com/${username}` : "https://instagram.com";
  return (
    <section style={{ border: "1px solid var(--accent-line)", background: "var(--accent-soft)", borderRadius: "var(--r-4)", padding: "20px var(--inset-x)" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <div className="kicker accent">Fila limpa</div>
          <div style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700, marginTop: 5 }}>
            Nada pendente na sua fila de hoje.
          </div>
          <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 5 }}>
            {contatos != null || calls != null
              ? `${contatos ?? 0} ${contatos === 1 ? "contato" : "contatos"}${calls ? ` e ${calls} ${calls === 1 ? "call agendada" : "calls agendadas"}` : ""} hoje.`
              : "Confira o pipeline ou puxe leads novos."}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 10, lineHeight: 1.5 }}>
            {count == null
              ? "Passa no Instagram e chama os novos seguidores no direct."
              : count > 0
                ? <>Você teve <strong style={{ color: "var(--accent)" }}>{count} novo{count === 1 ? "" : "s"} seguidor{count === 1 ? "" : "es"}</strong> nas últimas ~24h. Chama cada um no direct.</>
                : "Sem novos seguidores nas últimas 24h, mas vale reativar quem já te segue."}
            {" "}<span className="dim">O Instagram não lista quem seguiu por aqui (a plataforma não entrega o @ por API): abra o app pra ver e chamar.</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href={igUrl} target="_blank" rel="noopener noreferrer"
            style={{ height: 38, display: "inline-flex", alignItems: "center", padding: "0 16px", borderRadius: 999, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 13.5, fontWeight: 700, textDecoration: "none" }}>
            Abrir o Instagram ↗
          </a>
          {openForm && saasId && (
            <button onClick={() => openForm("leads", { saas: saasId, source: "Social selling", owner: person })}
              title="cadastra o lead já com a origem Social selling e você como dono"
              style={{ height: 38, padding: "0 16px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
              + cadastrar lead
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── 3.1 Seletor de pessoa: UM chip ─────────────────────────────────────────
// Eram N chips com contagem no lugar mais nobre do cabeçalho — num time de 8,
// oito chips, e é recurso de GESTOR. Agora um chip com a fila atual; o clique
// abre a lista com as contagens (o queueCounts já era calculado). Quem não é
// admin vê só o rótulo da própria fila.
function PersonPicker({ users, person, counts, onChange, canPick }) {
  const [open, setOpen] = useS(false);
  const anchor = React.useRef(null);
  const atual = users.find((u) => u.id === person);
  const rotulo = `${atual?.name || atual?.id || "fila"}${counts[person] != null ? ` · ${counts[person]}` : ""}`;
  if (!canPick) {
    return (
      <span style={{ height: 38, display: "inline-flex", alignItems: "center", padding: "0 13px", borderRadius: 999, border: "1px solid var(--line-1)", color: "var(--fg-3)", fontSize: 13 }}>
        {rotulo}
      </span>
    );
  }
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      <button ref={anchor} onClick={() => setOpen((o) => !o)} title="ver a fila de outra pessoa" aria-label="Pessoa da fila" aria-expanded={open}
        style={{ height: 38, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 13px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", boxShadow: "var(--shadow-1)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
        {atual?.name || atual?.id || "fila"} <span className="today-person-count">{counts[person] || 0}</span><span className="mono dim" style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={230} label="Pessoa da fila">
          {users.map((u) => {
            const ativo = u.id === person;
            return (
              <button key={u.id} onClick={() => { setOpen(false); onChange(u.id); }}
                style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 999, border: 0, background: ativo ? "var(--accent-soft)" : "transparent", color: ativo ? "var(--accent)" : "var(--fg-2)", fontSize: 12.5, fontWeight: ativo ? 600 : 400, cursor: "pointer", textAlign: "left" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name || u.id}</span>
                <span className="tnum" style={{ fontSize: 12, color: ativo ? "var(--accent)" : "var(--fg-4)" }}>{counts[u.id] || 0}</span>
              </button>
            );
          })}
        </Popover>
      )}
    </span>
  );
}

function TodayScreen({ onOpenLead, onOpenWhatsapp }) {
  const { version } = useData();
  const [activeProduct] = useActiveSaas();
  const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === activeProduct?.id) || activeProduct;
  const me = currentUser()?.id || "";

  const [leads, setLeads] = useS(() => (window.SEED?.LEADS || []).map((l) => ({ ...l })));
  useE(() => { setLeads((window.SEED?.LEADS || []).map((l) => ({ ...l }))); }, [version]);

  // Consultas 1:1 (UniqueKids) do produto ativo — entram na fila como compromisso
  // no horário marcado (buildQueue). Fora do SEED (coleção própria), refetch no
  // tempo real (version). Sem consultas no produto, a fila fica igual.
  const [consultas, setConsultas] = useS([]);
  // Falha de carga NÃO pode ser silenciosa: consulta/tarefa que some da fila
  // sem aviso é compromisso furado. O banner avisa e oferece recarregar.
  const [consultasErr, setConsultasErr] = useS(false);
  const [reload, setReload] = useS(0);
  useE(() => {
    let alive = true;
    api.list("consultations")
      .then((rows) => { if (!alive) return; setConsultas((rows || []).filter((c) => c.saas === (saasCfg?.id || activeProduct?.id))); setConsultasErr(false); })
      .catch(() => { if (alive) { setConsultas([]); setConsultasErr(true); } });
    return () => { alive = false; };
  }, [version, saasCfg?.id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fila de quem: padrão o usuário logado; admin pode inspecionar a de qualquer um.
  const [person, setPersonState] = useS(() => {
    try { const v = localStorage.getItem("cockpit_today_person"); if (v != null) return v; } catch { /* ignore */ }
    return me;
  });
  const setPerson = (p) => {
    setPersonState(p);
    setScriptItem(null);
    try { localStorage.setItem("cockpit_today_person", p); } catch { /* ignore */ }
  };
  const [scriptItem, setScriptItem] = useS(null); // item com o painel de roteiro aberto
  useE(() => { setScriptItem(null); }, [saasCfg?.id]);

  const q = useM(() => buildQueue(leads, consultas, saasCfg, person), [leads, consultas, saasCfg, person]);
  const total = q.hoje.length;
  // Tick do relógio do cabeçalho — de quebra mantém a previsão de cada linha
  // ("em 25 min", "agora") em dia sem esperar um refresh de dados.
  const now = useNow();

  // Próximo item pendente DEPOIS deste na fila de HOJE — o "toque e próximo".
  // Só entre leads (consultas não entram no fluxo de roteiro/toque).
  function nextAfter(item) {
    const idx = q.hoje.findIndex((i) => i.l?.id === item.l.id);
    return q.hoje.find((i, j) => j > idx && !i.done && i.l && i.l.id !== item.l.id) || null;
  }

  // Toque direto da fila: vira activity, o servidor conta a tentativa, re-agenda
  // o GPS (pulando fim de semana) e, em estágio "novo", move o lead sozinho pra
  // Qualificando. Espelho local pra resposta imediata; o SSE ressincroniza.
  //
  // `when` = data e hora escolhidas no "Retomar" ("YYYY-MM-DDTHH:MM", hora
  // local). Ela MANDA no próximo toque: o servidor re-agenda pela cadência ao
  // receber a activity, então o horário do operador só vale se for gravado
  // DEPOIS que a activity entrou — por isso o update espera o logActivity.
  function logTouch(item, when = "") {
    const l = item.l;
    const cad = cadenceOf(saasCfg, item.stage);
    const now = Date.now();
    const chosen = when ? new Date(when) : null;
    const chosenIso = chosen && Number.isFinite(chosen.getTime()) ? chosen.toISOString() : "";
    setLeads((prev) => prev.map((x) => x.id === l.id ? {
      ...x,
      stageAttempts: (Number(x.stageAttempts) || 0) + 1,
      lastActivityAt: new Date(now).toISOString(),
      lastActivityType: "call",
      ...(chosenIso ? { nextActionAt: chosenIso }
        : cad.retryDays ? { nextActionAt: rollToBusinessDay(new Date(now + cad.retryDays * DAY)).toISOString() } : {}),
    } : x));
    api.logActivity({ saas: l.saas, lead: l.id, type: "call", text: "tentativa de contato (meu dia)", author: me })
      .then(() => (chosenIso ? api.update("leads", l.id, { nextActionAt: chosenIso }) : null))
      .catch((err) => { console.warn("toque não registrado:", err.message); toast("O toque não foi salvo · tente de novo", "neg"); });
  }

  // Card sem responsável: quem clica assume (vira o responsável). Grava no
  // campo da fase — owner na pré-venda, integrator na entrega, closer no meio.
  function claim(item) {
    const whoId = me || person;
    if (!whoId) return;
    const field = item.phase === "sdr" ? "owner" : item.phase === "entrega" ? "integrator" : "closer";
    setLeads((prev) => prev.map((x) => x.id === item.l.id ? { ...x, [field]: whoId } : x));
    api.update("leads", item.l.id, { [field]: whoId }).catch((err) => { console.warn("responsável não salvo:", err.message); toast("Não deu pra assumir o card · tente de novo", "neg"); });
  }

  // Edição inline dos dados do lead (checklist do roteiro). Otimista.
  function patchLead(leadId, patch) {
    setLeads((prev) => prev.map((x) => x.id === leadId ? { ...x, ...patch } : x));
    api.update("leads", leadId, patch).catch((err) => { console.warn("lead não salvo:", err.message); toast("Alteração no lead não foi salva · tente de novo", "neg"); });
  }

  // Mover o card pra próxima coluna a partir do roteiro (com o setup do destino
  // já resolvido: closer+call, integrador, valor, motivo). Otimista igual ao
  // board — o servidor recarimba stageSince, agenda o GPS e faz o resto
  // (applyStageMove). Depois avança pro próximo pendente da fila.
  function moveAndNext(patch) {
    const cur = scriptItem;
    if (!cur) return;
    const nx = nextAfter(cur);
    setLeads((prev) => prev.map((x) => x.id === cur.l.id
      ? { ...x, ...patch, stageSince: new Date().toISOString(), stageAttempts: 0 } : x));
    api.update("leads", cur.l.id, patch).catch((err) => { console.warn("movimento não persistido:", err.message); toast("O movimento do card não foi salvo · tente de novo", "neg"); });
    setScriptItem(nx);
  }

  // Agenda a call E cria o Meet + convite numa tacada só: persiste o movimento
  // (aguardando, pra o callAt/e-mail já estarem salvos), cria o Meet no Google
  // (que manda o convite pro e-mail do lead sozinho) e devolve o resultado. NÃO
  // avança a fila — o painel mostra a confirmação e o link; "próximo" é à parte.
  async function moveAndMeet(patch, email) {
    const cur = scriptItem;
    if (!cur) throw new Error("sem item na fila");
    const full = email ? { ...patch, email } : patch;
    setLeads((prev) => prev.map((x) => x.id === cur.l.id
      ? { ...x, ...full, stageSince: new Date().toISOString(), stageAttempts: 0 } : x));
    await api.update("leads", cur.l.id, full);
    const res = await api.createMeet(cur.l.id, email ? { email } : undefined);
    setLeads((prev) => prev.map((x) => x.id === cur.l.id ? { ...x, callUrl: res.callUrl } : x));
    return res;
  }
  const advanceScript = () => setScriptItem(nextAfter(scriptItem));

  // Abrir o card do lead a partir de uma consulta da fila — é lá que o Meet fica
  // centralizado (entrar/criar/resumir). Casa a consulta com o lead (por leadId
  // ou pelo cliente). `openRow` roteia: consulta abre o card, lead abre o roteiro.
  function openConsulta(item) {
    const c = item.consulta; if (!c) return;
    const lead = leads.find((x) => x.id === c.leadId)
      || (c.customerId ? leads.find((x) => x.customerId === c.customerId) : null);
    if (lead) onOpenLead && onOpenLead(lead);
  }
  const openRow = (item) => (item.consulta ? openConsulta(item) : setScriptItem(item));

  const users = useM(() => allUsers().filter((u) => !u.saas || u.saas === saasCfg?.id), [saasCfg?.id]);
  const firstPending = q.hoje.find((i) => !i.done);
  const pendingToday = q.hoje.filter((i) => !i.done);
  const doneTodayRows = q.hoje.filter((i) => i.done);
  const [busca, setBusca] = useS("");
  // Memo: buildQueue de TODOS os usuários a cada render travava a digitação no painel.
  // Só os leads que a fila pode mostrar (produto ativo + etapa trabalhável),
  // filtrados UMA vez: buildQueue descartaria os mesmos, mas varrendo os ~2 mil
  // leads do seed pra cada pessoa do seletor.
  const queueCounts = useM(() => {
    const workable = new Set(workableStages(saasCfg));
    const pool = leads.filter((l) => (!saasCfg || l.saas === saasCfg.id) && (!l.stage || workable.has(l.stage)));
    return Object.fromEntries(users.map((u) => [u.id, buildQueue(pool, consultas, saasCfg, u.id).hoje.filter((i) => !i.done).length]));
  }, [leads, consultas, saasCfg, users]);
  // O primeiro pendente fica em Agora; os demais e as feitas têm áreas próprias.
  const queueRows = q.hoje.filter(item => !item.done && (item.consulta || item !== firstPending));
  const lateCount = pendingToday.filter((i) => i.due && i.due.t <= Date.now()).length;

  // Busca DENTRO da fila (protótipo, 14/09). Com oito grupos e o dia cheio, a
  // fila passa de vinte linhas e achar "aquele lead" era rolar a tela inteira.
  // Filtra por nome e empresa; a numeração continua a da fila inteira, pra
  // buscar não mentir sobre a posição do item na ordem do dia.
  const filtraFila = (rows) => {
    const t = busca.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((i) => {
      const nome = i.consulta ? (i.consulta.clientName || "") : (i.l?.name || "");
      const empresa = i.consulta ? (i.consulta.childName || "") : (i.l?.company || "");
      return `${nome} ${empresa}`.toLowerCase().includes(t);
    });
  };
  const queueShown = filtraFila(queueRows);
  const [queuePage, setQueuePage] = useS(0);
  useE(() => setQueuePage(0), [busca, person, saasCfg?.id]);
  const lastPage = Math.max(0, Math.ceil(queueShown.length / 10) - 1);
  const page = Math.min(queuePage, lastPage);
  const pageRows = queueShown.slice(page * 10, page * 10 + 10);

  return (
    <div className="today-screen">
      <div className="today-layout">
        <header className="today-page-head">
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 className="page-title">Minhas atividades</h1>
              <NowClock now={now} />
            </div>

          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6, flexWrap: "wrap" }}>
            <PersonPicker users={users} person={person} counts={queueCounts}
              onChange={setPerson} canPick={users.length > 1 && isAdminUser()} />
            {/* "Começar a fila →" (prancha, 14/09): abre o roteiro do primeiro
                pendente. É o mesmo destino do botão do bloco Agora, e existe
                porque quem chega na tela quer começar sem escolher. */}
            <button onClick={() => firstPending && openRow(firstPending)} disabled={!firstPending}
              title={firstPending ? "abre a primeira atividade da fila" : "fila de hoje zerada"}
              style={{ height: 38, padding: "0 16px", borderRadius: 999, border: "1px solid var(--btn-bg)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 13, fontWeight: 650, cursor: firstPending ? "pointer" : "not-allowed", opacity: firstPending ? 1 : 0.45 }}>
              {firstPending ? (doneTodayRows.length ? "Continuar a fila →" : "Começar a fila →") : "Fila limpa ✓"}
            </button>
          </div>
        </header>
      <div className="today-main">
        {consultasErr && (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--warn-line)", background: "var(--warn-soft)", borderRadius: "var(--r-2)", padding: "9px 12px", fontSize: 12.5 }}>
            <span style={{ minWidth: 240, flex: 1 }}>
              <span style={{ display: "block", fontWeight: 600 }}>
                Não deu pra carregar as consultas · a fila pode estar incompleta.
              </span>
              <span className="dim" style={{ display: "block", fontSize: 11.5, marginTop: 2 }}>
                compromisso que não aparece é compromisso furado
              </span>
            </span>
            <button onClick={() => setReload((n) => n + 1)} style={{ marginLeft: "auto", height: 28, padding: "0 12px", borderRadius: 999, border: "1px solid var(--warn-line)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600, flexShrink: 0, cursor: "pointer" }}>recarregar</button>
          </div>
        )}
        {total === 0 ? (
          <section className="today-clean capsule-navy">
            <div className="today-section-label">Fila limpa</div>
            <h2>Nenhuma atividade pendente hoje</h2>
            <p>Os próximos compromissos aparecem abaixo.</p>
          </section>
        ) : (
          <>
              {/* ── AGORA: o comando da tela (12/09) ────────────────────────
                  O primeiro pendente era só fundo --accent-soft numa linha
                  igual às outras: a tela prometia "hoje em ordem de execução"
                  e não dizia qual é o próximo. Ele SAI da lista abaixo (a
                  contagem desconta), pra não existir em dois lugares. */}
              {firstPending && !firstPending.consulta && (
                <AgoraBlock item={firstPending} saasCfg={saasCfg} onScript={() => setScriptItem(firstPending)}
                  onClaim={() => claim(firstPending)} onWhatsapp={onOpenWhatsapp} />
              )}

              <section className="today-queue">
                <div className="today-queue-head">
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div className="today-section-label">Hoje</div>
                    <h3>A ordem é a prioridade do processo</h3>
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    {/* "N de M feitos hoje" + a barra: é a proporção que diz se
                        o dia está ganho ou perdido às 15h. O atraso não vira
                        chip aqui — ele já é lido na pílula vermelha da linha. */}
                    {(doneTodayRows.length > 0 || queueRows.length > 0) && (() => {
                      const feitos = doneTodayRows.length;
                      const totalDia = feitos + pendingToday.length;
                      const pct = totalDia > 0 ? Math.round((feitos / totalDia) * 100) : 0;
                      return (
                        <span className="today-progress"
                          title={`${feitos} de ${totalDia} da fila de hoje já saíram${lateCount ? ` · ${lateCount} ${lateCount === 1 ? "atrasada" : "atrasadas"}` : ""}`}>
                          <span className="tnum" style={{ fontSize: 12, color: "var(--fg-3)" }}>{`${feitos} de ${totalDia} feitos`}</span>
                          <span style={{ width: 80, height: 6, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden", flexShrink: 0 }}>
                            <span style={{ display: "block", height: 6, width: `${pct}%`, background: "var(--pos)" }} />
                          </span>
                        </span>
                      );
                    })()}
                    <label className="today-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20.4 20.4-4.2-4.2"/></svg><input aria-label="Buscar na fila" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar na fila…"
                      className="inp" /></label>
                  </div>
                </div>
                {queueRows.length === 0 && (
                  <div style={{ padding: "16px var(--inset-x)", borderTop: "1px solid var(--line-faint)", fontSize: 13, color: "var(--fg-3)" }}>
                    {firstPending ? "Só a atividade de agora, ali em cima." : "Fila zerada por hoje."}
                  </div>
                )}
                {queueRows.length > 0 && queueShown.length === 0 && (
                  <div style={{ padding: "16px var(--inset-x)", borderTop: "1px solid var(--line-faint)", fontSize: 13, color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span>{`Nenhum item da fila com “${busca.trim()}”.`}</span>
                    <button onClick={() => setBusca("")} className="mono" style={{ background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>limpar busca</button>
                  </div>
                )}
                {pageRows.map((item) => {
                  const key = item.consulta ? `c-${item.consulta.id}` : item.confirmWindow ? `${item.l.id}-${item.confirmWindow}` : item.l.id;
                  return (
                    <React.Fragment key={key}>
                      <QueueRow item={item} block="hoje" featured={false}
                        onScript={() => setScriptItem(item)} onClaim={() => claim(item)} onWhatsapp={onOpenWhatsapp} onOpen={() => item.consulta ? openConsulta(item) : onOpenLead?.(item.l)} />
                    </React.Fragment>
                  );
                })}
                {queueShown.length > 10 && <nav className="today-pagination" aria-label="Páginas da fila">
                  <span>{page * 10 + 1}–{Math.min((page + 1) * 10, queueShown.length)} de {queueShown.length}</span>
                  <button disabled={page === 0} onClick={() => setQueuePage(page - 1)}>‹ Anteriores</button>
                  <button disabled={page === lastPage} onClick={() => setQueuePage(page + 1)}>Próximas ›</button>
                </nav>}

              </section>
                {doneTodayRows.length > 0 && <details className="today-completed"><summary>{doneTodayRows.length} feitas hoje</summary>{doneTodayRows.map(item => <QueueRow key={item.l?.id || item.consulta?.id} item={item} block="hoje" onScript={() => openRow(item)} onOpen={() => openRow(item)} />)}</details>}
          </>
        )}
        <CompactSchedule title="Atividades futuras" rows={q.amanha} laterRows={q.proximos} onOpen={openRow} />
      </div>
      <aside className="today-aside today-workbench">
      {scriptItem && (
        <ErrorBoundary variant="modal" label="atividade" resetKey={scriptItem.l?.id} onReset={() => setScriptItem(null)}>
          <ScriptPanel inline key={`${scriptItem.l?.id}-${scriptItem.confirmWindow || ""}`}
            item={scriptItem}
            saasCfg={saasCfg}
            leads={leads}
            onPatch={patchLead}
            onMove={moveAndNext}
            onMoveMeet={moveAndMeet}
            onAfter={advanceScript}
            onClose={() => setScriptItem(null)}
            onTouch={(when) => { const nx = nextAfter(scriptItem); logTouch(scriptItem, when); setScriptItem(nx); }}
            nextItem={nextAfter(scriptItem)}
            onSkip={() => setScriptItem(nextAfter(scriptItem))}
            onOpenLead={() => { setScriptItem(null); onOpenLead && onOpenLead(scriptItem.l); }}
            onWhatsapp={onOpenWhatsapp ? (l, draft) => { setScriptItem(null); onOpenWhatsapp(l, draft); } : null}
          />
        </ErrorBoundary>
      )}
        {!scriptItem && <div className="today-script-empty"><span aria-hidden="true">◇</span><strong>Escolha uma atividade</strong><p>Os atalhos, os dados do lead e as ações aparecem aqui — sem sair da fila.</p></div>}
      </aside>
      </div>


    </div>
  );
}

// Linha de consulta (UniqueKids) na fila: horário, "Consulta n/8", cliente e as
// ações — entrar no Meet (se já existe) e abrir o card (onde o Meet é criado e
// resumido). Não participa do fluxo de roteiro/toque dos leads.
function ConsultaRow({ item, block, featured, ordem, onOpen }) {
  const c = item.consulta;
  const t = item.due?.t;
  const now = Date.now();
  let when;
  if (t == null) when = { pill: "sem hora", soft: true, tone: "mut" };
  else if (block === "amanha") when = { pill: hhmmOf(t), note: "amanhã", tone: "mut" };
  else if (block === "proximos") when = { pill: ddmmOf(t), note: hhmmOf(t), tone: "mut" };
  else if (t <= now) when = { pill: hhmmOf(t), note: "agora", tone: "neg" };
  else when = { pill: hhmmOf(t), note: untilNote(t, now), tone: "pos" };
  return (
    <div onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      title="Abrir o card da consulta (Meet, resumo)" style={{
      display: "flex", alignItems: "center", gap: 14, padding: featured ? "16px var(--inset-x)" : "14px var(--inset-x)",
      borderTop: "1px solid var(--line-faint)", background: featured ? "var(--accent-soft)" : "transparent", cursor: "pointer", flexWrap: "wrap",
    }}>
      <span className="mono tnum" style={{ width: 24, flexShrink: 0, fontSize: 11.5, color: "var(--fg-4)", textAlign: "right" }}>{ordem ?? "—"}</span>
      <TimeCell pill={when.pill} note={when.note} tone={when.tone} soft={when.soft} />
      <span style={{ width: 118, flexShrink: 0 }}>
        <span style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: "20px", padding: "0 8px", borderRadius: "var(--r-1)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 11.5, fontWeight: 600 }}>Consulta {c.n || "?"}/{c.packageTotal || 8}</span>
      </span>
      <div style={{ flex: 1, minWidth: "min(240px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{c.clientName || "cliente"}</span>
          {c.childName && <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{c.childName}</span>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 3 }}>consulta da mentoria · UniqueKids</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {c.meetUrl && (
          <a href={c.meetUrl} target="_blank" rel="noopener noreferrer" style={{ height: 32, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: 999, border: `1px solid ${featured ? "var(--btn-bg)" : "var(--line-2)"}`, background: featured ? "var(--btn-bg)" : "var(--bg-1)", color: featured ? "var(--btn-fg)" : "var(--fg-2)", fontSize: 12.5, fontWeight: featured ? 600 : 500, textDecoration: "none" }}>entrar no Meet</a>
        )}
        <button onClick={onOpen} style={{ height: 32, padding: "0 14px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5 }}>abrir card</button>
      </div>
    </div>
  );
}

// Uma linha da fila: sequência, quando, etapa (coluna do funil), ação a fazer,
// lead com a qualificação compilada e as ações. Clique no corpo abre o ROTEIRO
// (o painel de execução), não o card de status; o drawer fica no "abrir lead".
function QueueRow({ item, block, featured, ordem, onScript, onClaim, onWhatsapp, onOpen }) {
  const { l, consulta, kind, due, stage, who, group } = item;
  if (consulta) return <ConsultaRow item={item} block={block} featured={featured} ordem={ordem} onOpen={onOpen} />;
  const now = Date.now();

  // Coluna de horário. A HORA marcada vai na pílula navy (destaque) e a
  // previsão fica logo abaixo: hoje = agora / em 25 min / atrasado Nd; amanhã e
  // próximos dias = a data na pílula. Item sem hora (novo, sem data) usa a
  // pílula neutra com a idade embaixo.
  const startToday = new Date().setHours(0, 0, 0, 0);
  let when;
  if (item.confirm && due) {
    // Confirmação: mostra a hora JÁ descontada (1h/10min antes da call). Passou
    // da hora = "agora" em vermelho pra virar prioridade.
    when = due.t <= now
      ? { pill: hhmmOf(due.t), note: "agora", tone: "neg" }
      : { pill: hhmmOf(due.t), note: untilNote(due.t, now), tone: "pos" };
  } else if (due && block === "amanha") {
    when = { pill: hhmmOf(due.t), note: "amanhã", tone: "mut" };
  } else if (due && block === "proximos") {
    when = { pill: ddmmOf(due.t), note: hhmmOf(due.t), tone: "mut" };
  } else if (due && due.t < startToday) {
    const daysLate = Math.max(1, Math.ceil((startToday - due.t) / DAY));
    when = { pill: ddmmOf(due.t), note: `atrasado ${daysLate}d`, tone: "neg" };
  } else if (due && due.t <= now) {
    when = { pill: hhmmOf(due.t), note: due.type === "call" ? "call agora" : "agora", tone: "neg" };
  } else if (due) {
    when = { pill: hhmmOf(due.t), note: untilNote(due.t, now), tone: due.type === "call" ? "pos" : "mut" };
  } else if (kind === "novo") {
    const ageH = l.createdAt ? Math.max(0, Math.floor((now - new Date(l.createdAt).getTime()) / 3600000)) : null;
    when = { pill: "novo", soft: true, note: ageH == null ? null : ageH < 24 ? `há ${ageH}h` : `há ${Math.floor(ageH / 24)}d`, tone: "warn" };
  } else when = { pill: "sem data", soft: true, tone: "mut" };

  const tier = leadTier(l);
  const verbo = actionVerb(item);
  const hint = actionHint(item);

  // Linha apagada = já feita: a prancha mantém a feita NA FILA, riscada e sem
  // número, em vez de escondê-la atrás de um "ver as feitas". É o que faz
  // "1 de 10 feitos hoje" ter onde ser conferido.
  const apagado = !!item.done;
  return (
    <div className={`today-queue-row${apagado ? " is-done" : ""}${due?.t <= now ? " is-late" : ""}`}>
      <TimeCell pill={when.pill} note={apagado ? "feito" : when.note} tone={when.tone} soft={when.soft} apagado={apagado} />
      <button onClick={onScript} className="today-queue-lead">
        <span><LeadGrade tier={tier} muted={apagado} placeholder size={20} /><strong>{l.name}</strong><small>{l.company}</small></span>
        <span className="today-queue-action">{verbo}</span>
      </button>
      <button className="today-open-script" onClick={onScript}>Abrir atividade →</button>
    </div>
  );
}

// ── O bloco "Agora" ────────────────────────────────────────────────────────
// O primeiro pendente é o comando da tela. Na prancha (14/09) ele é o ÚNICO
// card de borda navy: a identidade vem primeiro (nível · nome · empresa ·
// hora), o verbo em negrito embaixo e o detalhe abaixo dele; as duas ações
// ficam empilhadas à direita, a principal escura em cima. Ele sai da lista de
// baixo (a contagem desconta), pra não existir em dois lugares.
function AgoraBlock({ item, saasCfg, onScript }) {
  const { l, due, stage, who } = item;
  const now = Date.now();
  const atrasado = !!due && due.t <= now;
  const tier = leadTier(l);
  const quando = due ? `${hhmmOf(due.t)} · ${atrasado ? "agora" : untilNote(due.t, now)}` : "sem hora marcada";
  return <section className="today-now capsule-navy">
    <div className="today-section-label">Próxima ação</div>
    <div className="today-now-person"><LeadGrade tier={tier} size={22} placeholder /><strong>{l.name}</strong><span>{l.company}</span><small className={atrasado ? "is-late" : ""}>{quando}</small></div>
    <div className="today-now-action">{actionVerb(item)}</div>
    <button onClick={onScript}>Abrir a atividade →</button>
  </section>;
}

// Uma faixa (Amanhã ou Próximos dias) dentro do card "O que vem".
function ScheduleLane({ label, rows, amanha, onOpen }) {
  // A lista corta em 5, mas NUNCA em silêncio: o total fica no cabeçalho e o
  // "+N" expande aqui mesmo (agenda escondida = call que ninguém preparou).
  const [showAll, setShowAll] = useS(false);
  const timeOf = (item) => {
    if (!item.due) return "sem data";
    return amanha
      ? new Date(item.due.t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : new Date(item.due.t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const calls = rows.filter((i) => i.due?.type === "call" || i.kind === "call").length;
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "7px var(--inset-x)", background: "var(--bg-2)", borderTop: "1px solid var(--line-1)" }}>
        <span className="kicker tnum" style={{ fontWeight: 600, color: "var(--fg-2)" }}>{label}</span>
        {calls > 0 && <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{calls} {calls === 1 ? "call" : "calls"}</span>}
      </div>
      <div style={{ padding: "0 var(--inset-x) 4px" }}>
        {rows.length === 0 && <div style={{ padding: "10px 0 12px", fontSize: 12.5, color: "var(--fg-4)" }}>nenhuma atividade</div>}
        {(showAll ? rows : rows.slice(0, 5)).map((item) => (
          <button key={item.consulta ? `c-${item.consulta.id}` : item.confirmWindow ? `${item.l.id}-${item.confirmWindow}` : item.l.id} onClick={() => onOpen(item)} style={{ width: "100%", display: "flex", gap: 10, alignItems: "baseline", padding: "10px 0", borderTop: "1px solid var(--line-faint)", textAlign: "left" }}>
            <span className="tnum" style={{ fontSize: 12.5, color: "var(--fg-4)", flexShrink: 0 }}>{timeOf(item)}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{item.consulta ? (item.consulta.clientName || "cliente") : item.l.name}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--fg-3)" }}>{item.consulta ? `Consulta ${item.consulta.n || "?"}/${item.consulta.packageTotal || 8} · UniqueKids` : `${ACTION_LABELS[item.kind] || "contato"}${item.l.company ? ` · ${item.l.company}` : ""}`}</span>
            </span>
          </button>
        ))}
        {rows.length > 5 && (
          <button onClick={() => setShowAll((v) => !v)} style={{ width: "100%", textAlign: "left", padding: "9px 0", borderTop: "1px solid var(--line-faint)", fontSize: 12.5, color: "var(--accent)", fontWeight: 500 }}>
            {showAll ? "mostrar menos" : `+${rows.length - 5} ${rows.length - 5 === 1 ? "atividade" : "atividades"}`}
          </button>
        )}
      </div>
    </>
  );
}

// "O que vem": Amanhã e Próximos dias no MESMO card, em duas faixas (12/09).
// O trilho tinha quatro cards de peso idêntico; estes dois são consulta, não
// fluxo de trabalho, então dividem um lugar só.
function CompactSchedule({ title = "O que vem", rows = [], laterRows = [], onOpen }) {
  const total = rows.length + laterRows.length;
  return (
    <section className="today-future" aria-label={title} style={{ background: "var(--bg-1)", border: 0, borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
      <div style={{ padding: "18px var(--inset-x) 12px" }}>
        <h3 className="card-title" style={{ margin: 0 }}>{title}</h3>
        <div className="card-sub" style={{ marginTop: 3 }}>
          {total ? `${total} ${total === 1 ? "atividade agendada" : "atividades agendadas"}` : "Nenhuma atividade futura agendada."}
        </div>
      </div>
      <ScheduleLane label={`Amanhã · ${rows.length}`} rows={rows} amanha onOpen={onOpen} />
      {laterRows.length > 0 && <ScheduleLane label={`Próximos dias · ${laterRows.length}`} rows={laterRows} onOpen={onOpen} />}
    </section>
  );
}

// Tarefas do kanban na fila do dia: as abertas da pessoa (ou sem responsável),
// vencidas em vermelho, ✓ conclui direto. O card inteiro leva pro kanban.
function TasksCard({ tasks, onDone, undo, onUndo }) {
  const [busy, setBusy] = useS(null);
  const todayStr = bizDay(new Date());
  const daysUntil = (d) => Math.round((new Date(`${d}T12:00:00`) - new Date(`${todayStr}T12:00:00`)) / DAY);
  const dueLabel = (d) => {
    if (!d) return "sem prazo";
    const n = daysUntil(d);
    return n < 0 ? `venceu há ${Math.abs(n)} d` : n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} d`;
  };
  const late = tasks.filter((t) => t.dueDate && t.dueDate < todayStr).length;
  const shown = tasks.slice(0, 5);
  return (
    <section className="today-tasks">
      <div className="today-tasks-head">
        <div><h3 className="card-title">Tarefas</h3><div className="card-sub">{tasks.length} abertas{late ? ` · ${late} vencidas` : ""}{tasks.length > 5 ? " · mostrando 5" : ""}</div></div>
        <button onClick={() => { location.hash = "#tasks"; }}>kanban →</button>
      </div>
      <div className="today-tasks-list">
        {undo && <div className="today-task-undo"><span>{undo.task.title || "Tarefa"} concluída</span><button onClick={onUndo}>desfazer</button></div>}
        {shown.map((t) => <div className="today-task-row" key={t.id}>
          <button className="today-task-open" onClick={() => { location.hash = taskHash(t.id); }} title="Abrir a tarefa">
            <span className="today-task-title">{t.title || "(sem título)"}</span>
            <span className="today-task-meta">{(t.assignees || []).map(displayName).filter(Boolean).join(", ") || "sem responsável"}{t.priority ? ` · ${t.priority}` : ""}</span>
          </button>
          <span className="today-task-due" style={{ color: !t.dueDate ? "var(--fg-3)" : t.dueDate < todayStr ? "var(--neg)" : t.dueDate === todayStr ? "var(--warn)" : "var(--fg-3)" }} title={t.dueDate || undefined}>{dueLabel(t.dueDate)}</span>
          <button className="today-task-done" title="Concluir tarefa" aria-label={`Concluir tarefa: ${t.title}`} disabled={busy === t.id}
            onClick={async () => { setBusy(t.id); try { await onDone(t); } finally { setBusy(null); } }}>{busy === t.id ? "…" : "✓"}</button>
        </div>)}
        {!tasks.length && <div className="card-sub" style={{ padding: "12px 0" }}>Nenhuma tarefa aberta.</div>}
        {tasks.length > 5 && <button className="today-more-tasks" onClick={() => { location.hash = "#tasks"; }}>+{tasks.length - 5} no kanban →</button>}
      </div>
    </section>
  );
}

// Placar: o que a pessoa fez contra a META DELA (Leo, 25/08). A meta de Metas
// (pessoa > vaga ÷ time > plano de remuneração > derivada do pace, tudo já
// resolvido pelo servidor em `row.goals`) é a MESMA régua da Visão geral, então
// as duas telas nunca divergem.
//
// A JANELA é a do trabalho de cada papel:
//   SDR    → o DIA. Contato e agendamento são volume diário (a meta mensal ÷
//            dias úteis, base 21,75, dá dezenas por dia: número que se persegue
//            hoje).
//   CLOSER → o MÊS. Contrato e receita não cabem num dia: 10 contratos/mês
//            repartidos por 21,75 arredondam pra "1 por dia", o dobro do que a
//            pessoa persegue de verdade. O mês é a unidade em que essa meta
//            existe, então é nela que o placar cobra.
//
// Valor e meta saem SEMPRE do mesmo lugar: com meta, os dois vêm do placar do
// servidor; sem meta (produto sem cadeia derivável, fim de semana, quem não é
// SDR nem closer), os dois seguem locais, como era antes. O que nunca pode
// acontecer é cruzar realizado do servidor com um alvo que é só o tamanho da
// fila — foi assim que "1 / 9" parecia meta sendo, na verdade, carga do dia.
export function dayScoreOf({ role, row, today, local }) {
  const fila = {
    title: "Placar do dia", scope: "fila de hoje",
    lines: [
      { label: "Contatados", value: local.contacted, goal: local.contactedGoal, kind: "int" },
      { label: "Calls de hoje", value: local.calls, goal: local.callsGoal, kind: "int" },
    ],
  };
  if (role === "closer") {
    const won = Number(row?.goals?.won?.target) > 0 ? Math.round(row.goals.won.target) : null;
    const revenue = Number(row?.goals?.revenue?.target) > 0 ? Math.round(row.goals.revenue.target) : null;
    const lines = [
      won && { label: "Contratos", value: row.won || 0, goal: won, kind: "int" },
      revenue && { label: "Receita", value: row.revenue || 0, goal: revenue, kind: "money" },
    ].filter(Boolean);
    return lines.length ? { title: "Placar do mês", scope: "meta do mês", lines } : fila;
  }
  const biz = businessDaysBetween(today, today);
  const goalContacts = scaledGoal(row?.goals?.contacts, biz);
  const goalCalls = scaledGoal(row?.goals?.callsBooked, biz);
  if (!goalContacts && !goalCalls) return fila;
  return {
    title: "Placar do dia", scope: "meta do dia",
    lines: [
      {
        label: "Contatados",
        value: goalContacts ? (row.contacted || 0) : local.contacted,
        goal: goalContacts || local.contactedGoal, kind: "int",
      },
      {
        // A linha muda de sentido junto com a meta: contra a meta de
        // agendamento, o número é quanto a pessoa AGENDOU hoje; sem ela, segue
        // sendo quantas das calls de hoje já aconteceram.
        label: goalCalls ? "Calls agendadas" : "Calls de hoje",
        value: goalCalls ? (row.callsBooked || 0) : local.calls,
        goal: goalCalls || local.callsGoal, kind: "int",
      },
    ],
  };
}

function DayScore({ title = "Placar do dia", scope = "fila de hoje", lines = [] }) {
  const show = (v, kind) => (kind === "money" ? window.fmt.money(Number(v) || 0) : window.fmt.int(Number(v) || 0));
  return (
    <section style={{ background: "var(--bg-1)", border: 0, borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: "20px var(--inset-x)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span className="kicker accent">{title}</span>
        {/* Contra o que o número está sendo cobrado: sem meta configurada, o
            placar mede a fila, e dizer isso evita ler carga do dia como alvo. */}
        <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{scope}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
        {lines.map((l) => (
          <div key={l.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13.5, color: "var(--fg-2)" }}>{l.label}</span>
              <span className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{show(l.value, l.kind)} <span style={{ fontWeight: 400, fontSize: 12, color: "var(--fg-4)" }}>/ {show(l.goal, l.kind)}</span></span>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, Math.round((l.value / Math.max(l.goal, 1)) * 100))}%`, background: "var(--accent)", borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Rótulo curto dos tipos de activity nos "últimos contatos" do resumo.
const ACT_LABELS = { whatsapp: "whatsapp", call: "ligação", email: "e-mail", meeting: "reunião", note: "nota", stage: "mudou de etapa", system: "sistema" };

// O resumo compilado do cliente mora em components/lead-blocks.jsx (é o mesmo
// dos dois painéis de lead). Reexportado aqui porque o inbox do WhatsApp
// importa `clientSummary` desta tela desde antes.
export { clientSummary };

// Resumo da última call por IA (activity call_summary, gerado da transcrição do
// Meet) mostrado no roteiro pra o closer trabalhar o follow-up com contexto: o
// que rolou, objeções (tratadas/em aberto), combinados, próximo passo e a
// mensagem de WhatsApp pronta pra enviar. Some quando não há resumo ainda.
export function CallSummaryCard({ summary, phone, onSend = null }) {
  const [copied, setCopied] = useS(false);
  if (!summary) return null;
  const box = { border: "1px solid var(--accent-line)", borderRadius: "var(--r-2)", padding: "10px 12px", background: "var(--accent-soft)" };
  // Integração (onboarding) tem estrutura própria: sentimento no lugar da
  // temperatura, configurado/pendências/próximos passos no lugar de objeções.
  const integ = summary.kind === "integracao" || !!summary.sentimento;
  const badge = integ ? summary.sentimento : summary.temperatura;
  const tone = integ
    ? (summary.sentimento === "satisfeito" ? "pos" : summary.sentimento === "em risco" ? "neg" : "warn")
    : (summary.temperatura === "quente" ? "neg" : summary.temperatura === "morno" ? "warn" : "mut");
  const wa = phone ? waLink(phone) : null;
  const msg = summary.followup?.whatsapp || "";
  const waHref = wa ? (msg ? `${wa}?text=${encodeURIComponent(msg)}` : wa) : null;
  const copy = async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem clipboard */ } };
  const line = { fontSize: 12, lineHeight: 1.5, color: "var(--fg-1)" };
  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span className="kicker accent">{integ ? "Resumo da integração · IA" : "Resumo da última call · IA"}</span>
        {badge && <Pill tone={tone}>{badge}</Pill>}
        {summary.recordingUrl && <a href={summary.recordingUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>🎥 gravação</a>}
      </div>
      {summary.resumo && <div style={{ ...line, marginBottom: 6 }}>{summary.resumo}</div>}
      {integ ? (
        <>
          {summary.configurado?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="kicker" style={{ marginBottom: 3 }}>Configurado</div>
              {summary.configurado.map((c, i) => <div key={i} style={line}>• {c}</div>)}
            </div>
          )}
          {summary.pendencias?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="kicker" style={{ marginBottom: 3 }}>Pendências</div>
              {summary.pendencias.map((p, i) => (
                <div key={i} style={{ ...line, display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span className="mono" style={{ color: "var(--warn)", flexShrink: 0, fontSize: 10 }}>{p.responsavel || "?"}</span>
                  <span style={{ minWidth: 0 }}>{p.item}</span>
                </div>
              ))}
            </div>
          )}
          {summary.proximosPassos?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="kicker" style={{ marginBottom: 3 }}>Próximos passos</div>
              {summary.proximosPassos.map((p, i) => <div key={i} style={line}>• {p}</div>)}
            </div>
          )}
        </>
      ) : (
        <>
          {summary.objecoes?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="kicker" style={{ marginBottom: 3 }}>Objeções</div>
              {summary.objecoes.map((o, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <div style={{ ...line, display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span className="mono" style={{ color: o.resolvida ? "var(--pos)" : "var(--neg)", flexShrink: 0, fontSize: 10 }}>{o.resolvida ? "tratada" : "em aberto"}</span>
                    <span style={{ fontWeight: 500, minWidth: 0 }}>{o.objecao}</span>
                  </div>
                  {o.comoFoiTratada && <div className="dim" style={{ fontSize: 11, lineHeight: 1.4, paddingLeft: 2 }}>{o.comoFoiTratada}</div>}
                </div>
              ))}
            </div>
          )}
          {summary.compromissos?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="kicker" style={{ marginBottom: 3 }}>Combinados</div>
              {summary.compromissos.map((c, i) => <div key={i} style={line}>• {c}</div>)}
            </div>
          )}
        </>
      )}
      {summary.followup?.nota && (
        <div style={{ ...line, marginBottom: msg ? 6 : 0 }}><span className="kicker">{integ ? "Acompanhamento" : "Próximo passo"}</span> · {summary.followup.nota}</div>
      )}
      {msg && (
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: "7px 9px" }}>
          <div className="kicker" style={{ marginBottom: 3 }}>WhatsApp sugerido</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 6 }}>{msg}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {/* Com o inbox à mão (roteiro), o texto vai pra caixa de mensagem
                DAQUI; fora dele (cliente/negócio), segue pro app. */}
            {onSend ? (
              <button onClick={() => onSend(msg)} title="Abre a conversa no inbox com esta mensagem já escrita"
                style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: 999, border: "none", background: "var(--wa-brand)", color: "var(--wa-brand-fg)", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>enviar no WhatsApp</button>
            ) : waHref && (
              <a href={waHref} target="_blank" rel="noopener noreferrer" style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: 999, background: "var(--wa-brand)", color: "var(--wa-brand-fg)", fontSize: 11.5, fontWeight: 700, textDecoration: "none" }}>enviar no WhatsApp ↗</a>
            )}
            <button onClick={copy} style={{ height: 26, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5 }}>{copied ? "copiado ✓" : "copiar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Briefing de passagem pro INTEGRADOR (activity integration_brief, gerado da
// transcrição da call de VENDA quando o card entra em Integração). O integrador
// não estava na call: aqui ele se localiza (quem é o cliente, o que foi
// prometido) e vê o que fazer (confirmar, checklist, primeira mensagem).
export function IntegrationBriefCard({ brief, phone, deal, onSend = null }) {
  const [copied, setCopied] = useS(false);
  const [open, setOpen] = useS(true);
  if (!brief) return null;
  // O negócio JÁ ESTÁ FECHADO: a linha do que foi contratado abre o card pra
  // ninguém tratar quem já comprou como lead em negociação.
  // O que foi contratado (escopo), NÃO como foi pago: forma de pagamento é
  // assunto do financeiro, o integrador não fala de dinheiro com o cliente.
  const closed = [
    dealProductLabel(deal?.dealProduct), // produto do catálogo (FULL/OEM/Parcial): o integrador entrega o escopo certo
    Number(deal?.amount) > 0 ? window.fmt.money(deal.amount) : "",
    closedPlanLabel(deal?.planClosed),
  ].filter(Boolean).join(" · ");
  const box = { border: "1px solid var(--accent-line)", borderRadius: "var(--r-2)", padding: "10px 12px", background: "var(--accent-soft)" };
  const line = { fontSize: 12, lineHeight: 1.5, color: "var(--fg-1)" };
  const sub = (label) => <div className="kicker" style={{ marginBottom: 3 }}>{label}</div>;
  // O passo a passo da call fica no roteiro da etapa (card Passo a passo, logo
  // abaixo): aqui é só o contexto. `vendido` é o shape antigo do briefing.
  const entregas = brief.entregas || brief.vendido;
  // A integração é feita numa CALL DE VÍDEO: a mensagem que a IA escreve PROPÕE
  // a call (ela não conhece link nem agenda). Quando o horário já está marcado
  // e o Meet criado, a mensagem fecha o combinado com dia e link de verdade —
  // é a diferença entre "vamos marcar" e "está marcado, entra por aqui".
  const meetUrl = deal?.integrationCallUrl || "";
  const when = (() => {
    const d = deal?.integrationAt ? new Date(deal.integrationAt) : null;
    if (!d || !Number.isFinite(d.getTime())) return "";
    return `${d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  })();
  const callLine = meetUrl
    ? (when
      ? `Fica ${when}. É por vídeo, entra por este link no horário: ${meetUrl}`
      : `Nossa call de integração é por vídeo, entra por este link: ${meetUrl}`)
    : when
      ? `Fica ${when}, é uma call de vídeo. Te mando o link antes.`
      : "A integração é numa call de vídeo comigo, qual o melhor dia e horário pra você?";
  const msg = [brief.primeiraMensagem || "", callLine].filter(Boolean).join("\n\n");
  const wa = phone ? waLink(phone) : null;
  const waHref = wa ? (msg ? `${wa}?text=${encodeURIComponent(msg)}` : wa) : null;
  const copy = async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem clipboard */ } };
  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span className="kicker accent">Briefing da integração · IA</span>
        <Pill tone="pos">negócio fechado</Pill>
        {brief.source === "resumo" && <Pill tone="warn">sem transcrição</Pill>}
        {brief.recordingUrl && <a href={brief.recordingUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>🎥 gravação da venda</a>}
        <button onClick={() => setOpen((v) => !v)} className="mono dim" style={{ fontSize: 10.5, marginLeft: "auto" }}>{open ? "recolher" : "abrir"}</button>
      </div>
      <div className="kicker" style={{ marginBottom: 5 }}>
        {closed ? `Já contratou: ${closed} · agora é entrega, não venda` : "O cliente já comprou, agora é entrega, não venda"}
      </div>
      {/* Estado da call de vídeo: é por ela que a integração acontece, então o
          card cobra o que falta (marcar a data, criar o Meet) antes do resto. */}
      <div className="kicker" style={{ marginBottom: 6, color: meetUrl ? "var(--pos)" : "var(--warn)" }}>
        {meetUrl
          ? `Call de vídeo ${when ? `marcada: ${when}` : "com link criado"}`
          : when ? `Call de vídeo ${when}, ainda sem Meet (nasce sozinho pela conta Google do responsável; ou crie logo abaixo, em Integração)` : "Sem call de vídeo marcada: combine o horário em Integração e o Meet nasce sozinho"}
      </div>
      {brief.resumo && <div style={{ ...line, marginBottom: open ? 6 : 0 }}>{brief.resumo}</div>}
      {open && (
        <>
          <div style={{ marginBottom: 6 }}>
            {sub("Objetivos da entrega")}
            {entregas?.length > 0
              ? entregas.map((v, i) => <div key={i} style={line}>• {v}</div>)
              : <div className="mono dim" style={{ fontSize: 11 }}>briefing antigo sem objetivos, use "refazer briefing" no card de Integração</div>}
          </div>
          {brief.atencao?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {sub("Pontos de atenção")}
              {brief.atencao.map((a, i) => (
                <div key={i} style={{ ...line, color: "var(--neg)" }}>• {typeof a === "string" ? a : `${a.ponto}: ${a.porque}`}</div>
              ))}
            </div>
          )}
          {msg && (
            <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: "7px 9px" }}>
              <div className="kicker" style={{ marginBottom: 3 }}>{meetUrl ? "Mensagem com o link da call" : "Mensagem pra marcar a call de vídeo"}</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 6 }}>{msg}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {/* Com o inbox à mão (drawer no pipeline), o texto vai pra caixa
                    de mensagem DAQUI; fora dele, segue pro app. */}
                {onSend && msg ? (
                  <button onClick={() => onSend(msg)} title="Abre a conversa no inbox com esta mensagem já escrita"
                    style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: 999, border: "none", background: "var(--wa-brand)", color: "var(--wa-brand-fg)", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>enviar no WhatsApp</button>
                ) : waHref && (
                  <a href={waHref} target="_blank" rel="noopener noreferrer" style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: 999, background: "var(--wa-brand)", color: "var(--wa-brand-fg)", fontSize: 11.5, fontWeight: 700, textDecoration: "none" }}>enviar no WhatsApp ↗</a>
                )}
                <button onClick={copy} style={{ height: 26, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5 }}>{copied ? "copiado ✓" : "copiar"}</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Atalhos da call — pro operador que abre o roteiro de uma call agendada: reúne
// num lugar só o LINK da chamada (entrar · copiar · mandar pro cliente no
// WhatsApp já com o link no texto) e a PROPOSTA (abrir/editar a existente ou
// gerar na hora). Sem link ainda? cria o Meet (Google) na agenda, na mesma
// regra do drawer. `wa` = base do WhatsApp do lead (waLink(l.phone));
// `onPatch` grava no lead (sincroniza a fila e persiste). Proposta é só do
// closer na call — na tarefa de confirmação do SDR ela some.
// `kind` = "call" (venda) ou "integracao": a integração também roda no Meet com o
// cliente (Leo, 11/09) e tem a PRÓPRIA sala (integrationCallUrl); a proposta
// só faz sentido na call de venda.
function CallShortcuts({ l, wa, onPatch, kind = "call" }) {
  const [busy, setBusy] = useS("");   // "meet" | ""
  const [err, setErr] = useS("");
  const isInteg = kind === "integracao";
  const url = isInteg ? l.integrationCallUrl : l.callUrl;
  const nome = isInteg ? "integração" : "call";
  const waForward = wa && url
    ? `${wa}?text=${encodeURIComponent(waCallLinkText(l, url, isInteg ? "integração" : ""))}`
    : null;
  const googleOn = !!window.SEED?.CONFIG?.google?.connected;

  async function makeLink() {
    if (!googleOn) { setErr(`conecte o Google em Ajustes pra criar o Meet da ${nome}`); return; }
    setBusy("meet"); setErr("");
    try {
      // O servidor já grava o link no lead; o patch só espelha aqui e na fila.
      const r = await api.createMeet(l.id, isInteg ? { kind: "integracao" } : undefined);
      onPatch(isInteg ? { integrationCallUrl: r.callUrl, integrationMeetEventId: r.eventId } : { callUrl: r.callUrl, meetEventId: r.eventId });
    } catch (e) { setErr(e?.message || `falha ao criar o link da ${nome}`); }
    setBusy("");
  }

  if (!url && !googleOn) return null;
  return <div className="today-call-shortcuts">
    {url ? <>
      <a href={url} target="_blank" rel="noopener noreferrer">Entrar na {nome} ↗</a>
      <button onClick={async () => { try { await navigator.clipboard.writeText(url); toast("Link copiado", "pos"); } catch { toast("Não foi possível copiar o link", "neg"); } }}>Copiar link da {nome}</button>
      {waForward && <a href={waForward} target="_blank" rel="noopener noreferrer">Enviar link da {nome} ↗</a>}
    </> : <button onClick={makeLink} disabled={busy === "meet"}>{busy === "meet" ? "Criando Meet…" : "Criar link do Meet"}</button>}
    {err && <span role="alert" className="today-shortcut-error">{err}</span>}
  </div>;
}

function ActivityModal(props) {
  return createPortal(<Modal {...props} />, document.body);
}

function InlineScriptShell({ children, onClose }) {
  useEsc(onClose);
  const ref = React.useRef(null);
  useE(() => {
    const trigger = document.activeElement;
    ref.current?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <section ref={ref} tabIndex={-1} className="today-inline-script" aria-label="Atividade do lead">{children}</section>;
}

function PresentationConfig({ url }) {
  const ref = React.useRef(null);
  const [height, setHeight] = useS(480);
  useE(() => {
    const origin = new URL(url, window.location.href).origin;
    const resize = (event) => {
      if (event.source !== ref.current?.contentWindow || event.origin !== origin || event.data?.type !== "cockpit:proposal-config-height") return;
      const next = Number(event.data.height);
      if (Number.isFinite(next) && next > 0) setHeight(Math.min(2400, Math.ceil(next)));
    };
    window.addEventListener("message", resize);
    return () => window.removeEventListener("message", resize);
  }, [url]);
  return <iframe ref={ref} title="Configurar apresentação" style={{ height }} src={`${url}${url.includes("?") ? "&" : "?"}embed=config&from=cockpit`} />;
}

function ScriptPanel({ inline = false, item, saasCfg, leads, onPatch, onMove, onMoveMeet, onAfter, onClose, onTouch, onOpenLead, onWhatsapp, preview = false, previewScript = null, nextItem = null, onSkip = null }) {
  // On narrow screens keep the accessible modal: the queue can be much taller
  // than the viewport, so an inline editor below it would open out of sight.
  // Choose once per open editor. Changing its wrapper while typing would
  // remount nested forms and discard their unsaved local state on resize.
  const [compact] = useS(() => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1100px)").matches);
  const PanelShell = inline ? (compact ? ActivityModal : InlineScriptShell) : Modal;
  // Cópia local do lead: a edição inline dos campos reflete na hora aqui (fala
  // interpolada + checklist) e persiste via onPatch (fila + API).
  const [l, setL] = useS(item.l);
  useE(() => { setL(item.l); }, [item.l.id]); // eslint-disable-line react-hooks/exhaustive-deps
  function patch(p) {
    setL((prev) => ({ ...prev, ...p }));
    onPatch && onPatch(item.l.id, p);
  }
  // Remarcação na confirmação: o cliente pediu pra mudar de horário. O SDR escolhe
  // um novo slot na agenda do closer; salvamos o novo callAt E registramos um TOQUE
  // (meta.event="reschedule") — assim conta como "contatado" no placar do SDR e
  // entra na timeline. Não é no-show e não muda de etapa: o card segue em Call
  // agendada, só com horário novo (reschedule:false → não bumpa tentativa nem GPS).
  const [resched, setResched] = useS(false);
  const [rDay, setRDay] = useS(() => nextBusinessDays(1)[0]);
  const [rSlot, setRSlot] = useS("");
  // Atalho pro link de pagamento do MP sem sair do roteiro: mesmo modal do
  // card do lead (o checkout nasce amarrado ao id do lead).
  const [payLink, setPayLink] = useS(false);
  const proposalActions = useLeadProposalActions({ lead: l, onOpenWhatsapp: onWhatsapp,
    onSaved: fresh => patch({ proposalUrl: fresh.proposalUrl, proposal_edit_url: fresh.proposal_edit_url, proposta_id: fresh.proposta_id, proposalPinned: fresh.proposalPinned }),
  });
  useE(() => { setResched(false); setRSlot(""); setPayLink(false); }, [item.l.id]);
  function doReschedule() {
    if (!rSlot) return;
    // Na confirmação da INTEGRAÇÃO o horário que muda é o da entrega, não o da
    // call de venda (que já aconteceu e virou histórico do card).
    const isInteg = item.confirmKind === "integracao";
    patch(isInteg ? { integrationAt: rSlot, integrationConfirmed: false } : { callAt: rSlot, callConfirmed: false });
    api.logActivity({
      saas: l.saas, lead: l.id, type: "call",
      text: isInteg ? "remarcou a integração na confirmação" : "remarcou a call na confirmação",
      author: currentUser()?.id || "", meta: { reschedule: false, event: "reschedule" },
    }).catch((err) => { console.warn("remarcação não registrada:", err.message); toast("A remarcação não entrou na timeline", "warn"); });
    setResched(false);
    onClose && onClose();
  }

  // Confirmação executada: "cliente confirmou" ou "sem resposta". Grava o passo
  // no lead (confirmLog, amarrado ao horário vigente → a tarefa sai da fila),
  // registra o TOQUE pro crédito no placar do dia — reschedule:false pra não
  // bumpar tentativa nem re-agendar o GPS (a call já está marcada) — e avança
  // pro próximo item da fila, que é o feedback que faltava.
  function markConfirm(replied) {
    const isInteg = item.confirmKind === "integracao";
    const at = isInteg ? l.integrationAt : l.callAt;
    const win = item.confirmWindow || "2h";
    const prev = l.confirmLog && l.confirmLog.at === at ? l.confirmLog : { at };
    const p = { confirmLog: { ...prev, [win]: new Date().toISOString() } };
    if (replied) p[isInteg ? "integrationConfirmed" : "callConfirmed"] = true;
    patch(p);
    // Janela "ligar": o registro é da LIGAÇÃO (atendeu e confirmou / não
    // atendeu), tipo call, pra ficar na timeline como ligação e não como
    // mensagem (raio-x 17/09: o alerta de ligar não virava ligação).
    const ligar = win === "ligar";
    api.logActivity({
      saas: l.saas, lead: l.id, type: ligar ? "call" : "whatsapp",
      text: replied
        ? (isInteg ? "cliente confirmou a integração" : ligar ? "liguei: atendeu e confirmou a call" : "cliente confirmou a call")
        : ligar ? "liguei 1h antes: não atendeu" : `sem resposta na confirmação de ${win}`,
      author: currentUser()?.id || "",
      meta: { reschedule: false, event: replied ? "confirm" : ligar ? "ring_noanswer" : "confirm_noreply", window: win },
    }).catch((err) => { console.warn("confirmação não registrada:", err.message); toast("A confirmação não entrou na timeline", "warn"); });
    if (onAfter) onAfter(); else onClose && onClose();
  }
  // Item de confirmação de call usa o roteiro de confirmação; o resto, o roteiro
  // do estágio (por tentativa). A confirmação não é movimento de etapa, então o
  // bloco "Depois da ação" (destino) some pra esse item. Em pré-visualização
  // (Ajustes → Scripts) o roteiro já vem pronto (previewScript) — mostra o
  // rascunho que está sendo editado, sem depender de resolver por lead.
  const script = previewScript || (item.confirm
    ? (item.confirmKind === "integracao" ? integrationConfirmationScript(l, saasCfg) : confirmationScript(l, saasCfg, item.confirmWindow))
    : resolveScript(saasCfg, l));
  const wa = waLink(l.phone);
  const tier = leadTier(l);
  // Últimos contatos da timeline + o último resumo de call por IA (activity
  // system call_summary) — contexto de quem já falou com esse lead e o que
  // saiu da última call, pra o closer conduzir o follow-up.
  const [acts, setActs] = useS(null);
  const [actsError, setActsError] = useS(false);
  const [callSummary, setCallSummary] = useS(null);
  const [salesSummary, setSalesSummary] = useS(null); // última call de VENDA resumida (alimenta os tokens do roteiro)
  const [actsReload, setActsReload] = useS(0); // bump refaz o fetch após anotar
  useE(() => {
    // Pré-visualização usa um lead fictício: não busca timeline (nem bate na API).
    if (preview) { setActs([]); return; }
    let alive = true;
    setActs(null); setActsError(false); setCallSummary(null); setSalesSummary(null);
    api.listActivities(l.id)
      .then((a) => {
        if (!alive) return;
        const all = a || [];
        setActs(all.filter((x) => x.type !== "system")
          .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))
          .slice(0, 4));
        const sums = all.filter((x) => x.meta?.event === "call_summary" && x.meta?.summary)
          .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));
        const cs = sums[0];
        setCallSummary(cs ? { ...cs.meta.summary, recordingUrl: cs.meta.recordingUrl || "", kind: cs.meta.kind || "call" } : null);
        // Pros tokens do roteiro só serve a call de VENDA (a de integração tem
        // outra estrutura: sentimento/pendências, nada de objeção/combinado).
        setSalesSummary(sums.find((x) => (x.meta.kind || "call") === "call")?.meta.summary || null);
      })
      .catch(() => { if (alive) { setActs([]); setActsError(true); setCallSummary(null); setSalesSummary(null); } });
    return () => { alive = false; };
  }, [l.id, actsReload]);
  // Tokens depois do fetch: o roteiro do follow-up usa o que saiu da call
  // transcrita (combinado, objeção em aberto, dor, temperatura).
  const tokens = scriptTokens(l, saasCfg, salesSummary);

  return (
    <PanelShell onClose={onClose} label={preview ? "Pré-visualização do roteiro" : "Atividade do lead"} largura={1120} padding={20}
      painelStyle={{ maxHeight: "calc(100dvh - 40px)", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: "var(--r-4)" }}>
      <div className="today-script lead-panel" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="today-script-header">
          <LeadGrade tier={tier} placeholder />
          <div className="today-script-identity">
            <button onClick={preview ? undefined : onOpenLead} disabled={preview}>{l.name}</button>
            <span>{l.company}{l.company ? " · " : ""}{actionVerb(item)}</span>
          </div>
          <button onClick={onClose} aria-label="Fechar atividade" className="lead-panel-close">✕</button>
        </div>

        {/* Atalhos.pdf: faixa de atalhos, apresentação/respostas e histórico. */}
        <div className="today-script-body">
          <LeadSection title="Atalhos" className="today-script-shortcuts">
            {!preview && <LeadSendActions compact showGenerate={false} showMore={false} lead={l} busy={proposalActions.busy} altDecks={proposalActions.altDecks}
              onGenerate={proposalActions.generate} onPayment={() => setPayLink(true)} onShare={proposalActions.share}
              onOpenWhatsapp={onWhatsapp} />}
            {(item.kind === "call" || item.kind === "integracao") && !preview && (!item.confirm || (item.kind === "call" ? l.callUrl : l.integrationCallUrl)) &&
              <CallShortcuts l={l} wa={wa} onPatch={patch} kind={item.kind} />}
          </LeadSection>
          <div className="today-script-columns">
            <LeadSection title="Informações da apresentação" className="today-presentation">
              {l.proposal_edit_url && !preview ? <>
                <PresentationConfig key={l.proposal_edit_url} url={l.proposal_edit_url} />
              </> : <p className="today-script-hint">{preview ? "A configuração da apresentação aparece aqui na atividade do lead." : "Prepare a proposta pelo botão Proposta no WhatsApp para preencher pedidos, ticket médio, produtos e plano aqui. A configuração continua disponível na apresentação."}</p>}
            </LeadSection>
            <LeadSection title="Perguntas e respostas do formulário">
              <LeadChecklist readable key={l.id} checklist={scriptChecklist(saasCfg, l)} onPatch={patch} leadId={l.id} title="Respostas do lead" />
            </LeadSection>
          </div>
          {preview && <LeadSection title="Pré-visualização do roteiro"><ScriptBlocks script={script} tokens={tokens} /></LeadSection>}
          <LeadSection title="Histórico de ações e anotações" className="today-script-history">
            <CallSummaryCard summary={callSummary} phone={l.phone} onSend={onWhatsapp ? (msg) => onWhatsapp(l, msg) : null} />
            {!preview && <ActivityComposer embedded lead={l} onLogged={() => setActsReload((n) => n + 1)} />}
            {acts === null && <p className="today-script-hint" role="status">Carregando histórico…</p>}
            {actsError && <p role="alert" className="today-script-hint">Não foi possível carregar o histórico. <button onClick={() => setActsReload((n) => n + 1)}>Tentar novamente</button></p>}
            {!actsError && acts?.length === 0 && <p className="today-script-hint">Nenhum contato registrado ainda.</p>}
            {(acts || []).map((a) => <div className="today-lead-history-row" key={a.id}>
              <time dateTime={a.at}>{a.at ? new Date(a.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</time>
              <div><strong>{ACT_LABELS[a.type] || a.type}</strong><span>{a.type === "stage" ? `${a.meta?.from || "?"} → ${a.meta?.to || "?"}` : a.text}</span></div>
            </div>)}
          </LeadSection>
        </div>
        {/* ── Rodapé: "Depois da ação" SEMPRE VISÍVEL (12/09) ───────────────
            Continua sem "registrar toque": a atividade só se completa movendo o
            card. O que muda é que o bloco que faz isso era o ÚLTIMO da coluna,
            embaixo do resumo, da atribuição e do checklist — a única coisa que
            fecha o item exigia a maior rolagem. Agora é a barra do rodapé.
            Item de confirmação não move etapa: no lugar dos destinos, ele
            mantém os botões próprios (confirmou / sem resposta / remarcar). */}
        <div className="today-script-footer capsule-navy" style={{ marginTop: "auto", padding: "14px 20px", borderTop: "1px solid var(--line-2)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {!item.confirm && !preview && (
            <div style={{ flexBasis: "100%", minWidth: 0 }}>
              <DestinoSection saasCfg={saasCfg} lead={l} leads={leads} callSummary={callSummary}
                onMove={onMove} onMoveMeet={onMoveMeet} onAfter={onAfter} onTouch={onTouch} />
            </div>
          )}
          {!item.confirm && preview && (
            <div className="mono dim" style={{ flexBasis: "100%", fontSize: 10.5, lineHeight: 1.5, border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", padding: "8px 10px" }}>
              na fila real, aqui aparece o bloco <b>“Próximo passo”</b> (pra onde vai o card)
            </div>
          )}
          {/* WhatsApp em linha própria, esticado (igual ao do drawer/pop de contato). */}
          {wa && (
            // Atende DENTRO do cockpit (inbox); sem o handler (pré-visualização
            // em Ajustes → Scripts), cai no deep-link do app.
            onWhatsapp
              ? <button className="today-script-whatsapp" onClick={() => onWhatsapp(l)} title={`Abrir a conversa no inbox · ${l.phone}`}>WhatsApp</button>
              : <a className="today-script-whatsapp" href={wa} target="_blank" rel="noopener noreferrer" title={`WhatsApp · ${l.phone}`}>WhatsApp ↗</a>
          )}
          {/* Confirmação: o SDR marca quando o cliente responde à mensagem de 1h;
              o roteiro troca o passo de 10 min (positiva) sozinho. */}
          {item.confirm && (() => {
            // Na integração o flag é próprio (integrationConfirmed): confirmar a
            // entrega não pode marcar a call de venda como confirmada.
            const isInteg = item.confirmKind === "integracao";
            const on = isInteg ? !!l.integrationConfirmed : !!l.callConfirmed;
            return (
              // Já confirmado: o clique DESMARCA (fica na tela). Ainda não:
              // marca, credita o toque e vai pro próximo da fila.
              <button onClick={() => (on ? patch(isInteg ? { integrationConfirmed: false } : { callConfirmed: false }) : markConfirm(true))}
                title={on ? "Cliente confirmou presença (clique pra desmarcar)" : "Cliente respondeu confirmando: marca, credita o contato e vai pro próximo da fila"}
                style={{ padding: "8px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                  background: on ? "var(--pos)" : "var(--bg-1)", color: on ? "var(--wa-brand-fg)" : "var(--fg-2)",
                  border: "1px solid " + (on ? "var(--pos)" : "var(--line-2)") }}>
                {on ? "✓ cliente confirmou" : item.confirmWindow === "ligar" ? "atendeu e confirmou" : "cliente confirmou"}
              </button>
            );
          })()}
          {/* Sem resposta: registra a tentativa e tira a tarefa da fila — na
              janela de 2h o próximo passo é a de 10 min; nela, é ligar. */}
          {item.confirm && !preview && (
            <button onClick={() => markConfirm(false)}
              title={item.confirmWindow === "ligar"
                ? "Ligou e não atendeu: registra a ligação na timeline; manda o link no WhatsApp e a call segue reservada"
                : item.confirmWindow === "2h" && item.confirmKind !== "integracao"
                  ? "Não respondeu: registra a tentativa e segue pro passo de 10 min (nele o roteiro manda ligar)"
                  : "Não respondeu: registra a tentativa — ligue no horário, a call segue reservada"}
              style={{ padding: "8px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                background: "var(--bg-1)", color: "var(--fg-2)", border: "1px dashed var(--line-strong)" }}>
              {item.confirmWindow === "ligar" ? "não atendeu" : "sem resposta"}
            </button>
          )}
          {/* Cliente pediu pra remarcar na confirmação: escolhe novo horário na
              agenda do closer. Salva o novo callAt E vira um toque (credita o SDR). */}
          {item.confirm && !preview && (
            <button onClick={() => setResched((v) => !v)}
              title="Cliente pediu pra remarcar: escolher novo horário (conta como contato no seu placar)"
              style={{ padding: "8px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                background: resched ? "var(--accent-soft)" : "var(--bg-1)", color: resched ? "var(--accent)" : "var(--fg-2)",
                border: "1px solid " + (resched ? "var(--accent-line)" : "var(--line-2)") }}>
              ↻ remarcar
            </button>
          )}
          {item.confirm && !preview && resched && (
            <div style={{ flex: "1 1 100%", marginTop: 4, padding: 12, borderRadius: "var(--r-2)", background: "var(--bg-1)", border: "1px solid var(--line-1)" }}>
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 8 }}>
                {item.confirmKind === "integracao"
                  ? "Novo horário da integração · o convite do Meet acompanha o horário novo (o cliente recebe a atualização por e-mail)."
                  : `Novo horário da call${l.closer ? "" : " · defina o closer no card antes"} — vira um toque no lead (conta no placar do SDR).`}
              </div>
              <SlotGrid days={nextBusinessDays(6)} day={rDay} setDay={setRDay} slot={rSlot} setSlot={setRSlot}
                busy={callBusyKeys(leads, item.confirmKind === "integracao" ? l.integrator : l.closer, l.id)} />
              <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setResched(false)}
                  style={{ padding: "8px 12px", borderRadius: 999, fontSize: 12.5, background: "transparent", color: "var(--fg-3)", border: "1px solid var(--line-1)" }}>
                  cancelar
                </button>
                <button onClick={doReschedule} disabled={!rSlot}
                  style={{ padding: "8px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                    background: rSlot ? "var(--btn-bg, var(--accent))" : "var(--bg-2)", color: rSlot ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-4)",
                    border: "1px solid " + (rSlot ? "var(--btn-bg, var(--accent))" : "var(--line-2)"), cursor: rSlot ? "pointer" : "not-allowed" }}>
                  salvar novo horário
                </button>
              </div>
            </div>
          )}
        </div>

        {/* O modal empilha por cima do painel (z-index maior) e o servidor já
            persiste o lead — aqui só refletimos o retorno na cópia local. */}
        {payLink && (
          <PaymentLinkModal
            lead={l}
            onClose={() => setPayLink(false)}
            onSaved={(r) => setL((prev) => ({ ...prev, ...(r.lead || {}) }))}
          />
        )}
      </div>
    </PanelShell>
  );
}

// ─────────────────────────────────────────── Destino do card (o próximo passo)
// Pra onde o card vai DEPOIS da ação, por KIND do estágio atual (resolvido pro
// nome real do funil via stageByKind). Cada destino abre o SETUP do seu tipo:
// call → closer + horário livre na agenda dele; entrega → integrador; ganho →
// valor; perda → motivo. O movimento é otimista e o servidor faz o resto.
// "retry" = não atendeu / não fechou hoje: registra a tentativa e retoma amanhã
// (fica na mesma coluna). Num lead NOVO a tentativa promove pra Qualificando
// sozinha (server) — por isso o chip de retry do novo mostra "Qualificando".
export function destinationsFor(saasCfg, lead) {
  const curStage = lead.stage || firstStage(saasCfg);
  const curKind = stageKind(saasCfg, curStage);
  const out = [];
  const seen = new Set([curStage]);
  // Quais destinos e em que ordem: default do kind (NEXT_KINDS), sobrescrito por
  // produto em Ajustes → Próximos passos PELA CHAVE DE ROTEIRO (scriptKeyFor) —
  // assim 2ª tentativa, 3ª tentativa, 1º/2º/3º contato têm passos independentes.
  for (const k of nextKindsFor(saasCfg, scriptKeyFor(saasCfg, lead), curKind)) {
    if (k === "retry") {
      // Com as colunas de dia, o toque no Novo lead NÃO promove (o relógio leva
      // pro Dia 2 e só a resposta do lead leva pra Qualificando).
      const promote = curKind === "novo" && !hasDayStages(saasCfg);
      const target = promote ? (stageByKind(saasCfg, "qualificacao") || curStage) : curStage;
      out.push({ retry: true, promote, stage: target, kind: promote ? "qualificacao" : curKind });
      continue;
    }
    if (k === "noshow") {
      // No-show é kind contato (colide com Nutrição no stageByKind) → resolve
      // pela etapa nomeada "No show" do funil, se existir.
      const st = (saasCfg?.funnel || []).find((f) => f && isNoShowStage(f.stage));
      if (st && !seen.has(st.stage)) { seen.add(st.stage); out.push({ stage: st.stage, kind: "noshow" }); }
      continue;
    }
    if (k === "nutricao") {
      // Nutrição também é kind contato (e stageByKind cairia em Dia 2, a 1ª
      // etapa de cadência) → resolve pela etapa NOMEADA. Move direto: o
      // servidor aplica a cadência de 7 dias da etapa (GPS em 168h, dia útil).
      const st = nurtureStage(saasCfg);
      if (st && !seen.has(st)) { seen.add(st); out.push({ stage: st, kind: stageKind(saasCfg, st) }); }
      continue;
    }
    const stage = stageByKind(saasCfg, k);
    if (curKind === "followup" && dayStageNumber(stage)) continue;
    if (stage && !seen.has(stage)) { seen.add(stage); out.push({ stage, kind: stageKind(saasCfg, stage) }); }
  }
  // O retorno do follow-up sempre permite escolher uma data, inclusive no
  // último roteiro, cuja configuração antiga omitia o retry.
  if (curKind === "followup" && !out.some((d) => d.retry)) {
    out.unshift({ retry: true, promote: false, stage: curStage, kind: curKind });
  }
  return out;
}

// Setup que cada destino pede antes de mover.
export function setupType(kind) {
  if (kind === "call") return "call";
  if (kind === "followup") return "followup"; // follow-up também escolhe horário na agenda
  if (kind === "integracao" || kind === "posvenda") return "integrator";
  if (kind === "ganho") return "won";
  if (kind === "perdido" || kind === "desqualificado") return "loss";
  return "none";
}

// Agenda da call: das 07h às 20h30 em blocos de MEIA HORA; a call dura 1h, então
// ocupa DOIS slots seguidos do closer. Fim de semana fora (seg a sex).
export const CALL_H0 = 7, CALL_H1 = 21; // slots 07:00…20:30 (bate com a agenda 7h-21h)
export const SLOT_MIN = 30;             // granularidade da grade
const CALL_MIN = 60;                    // duração da call/integração
export function nextBusinessDays(n) {
  const out = []; const d = new Date(); d.setHours(0, 0, 0, 0);
  while (out.length < n) { const w = d.getDay(); if (w !== 0 && w !== 6) out.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return out;
}
// Slots que uma call marcada em "YYYY-MM-DDTHH:MM" (hora local) ocuparia — pra
// quem checa conflito fora da grade (input livre do drawer).
export function callSlotKeys(localValue) {
  const d = new Date(String(localValue || ""));
  return Number.isFinite(d.getTime()) ? occupySlots(d) : [];
}

// Chave do slot: "YYYY-MM-DD-HH-MM" com MM em 00/30. O minuto entra na chave
// porque a grade é de meia em meia hora — sem ele, call das 14h e das 14h30
// cairiam na mesma célula e uma esconderia a outra.
const pad2 = (x) => String(x).padStart(2, "0");
const cellKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}-${d.getMinutes() < 30 ? "00" : "30"}`;
export const slotVal = (day, hour, min = 0) => `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}T${pad2(hour)}:${pad2(min)}`;

// Slots que um compromisso OCUPA: ele dura 1h e a grade é de 30 min, então
// marca todas as meias-horas que a duração encosta. Call às 14h bloqueia 14h e
// 14h30; call às 14h30 bloqueia 14h30 e 15h. Horário quebrado (14h10, vindo do
// Google) é ancorado na meia hora que o contém, e aí pega três.
export function occupySlots(start, minutes = CALL_MIN) {
  const out = [];
  const t0 = new Date(start);
  t0.setMinutes(t0.getMinutes() < 30 ? 0 : 30, 0, 0); // âncora da meia hora
  const end = new Date(start).getTime() + minutes * 60_000;
  for (let c = new Date(t0); c.getTime() < end; c.setMinutes(c.getMinutes() + SLOT_MIN)) out.push(cellKey(c));
  return out;
}
// YYYY-MM-DD local (pro <input type="date"> e comparação de dia); parseYMD volta
// pra Date em hora LOCAL (new Date("YYYY-MM-DD") seria UTC → dia anterior no BRT).
const ymd = (d) => { const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const sameYMD = (a, b) => ymd(a) === ymd(b);
const parseYMD = (s) => { const [y, m, dd] = String(s).split("-").map(Number); const d = new Date(); d.setFullYear(y, (m || 1) - 1, dd || 1); d.setHours(0, 0, 0, 0); return d; };

// Um bloqueio de agenda (agenda_blocks) casa com o slot (cellKey
// "YYYY-MM-DD-HH-MM") do dono? recur "weekly" bate pelo dia da semana; "once"
// pela data. allDay pega o dia todo; senão vale SOBREPOSIÇÃO: o slot de meia
// hora [t, t+30min) fica ocupado se o bloqueio toca qualquer pedaço dele
// (fromHour/toHour aceitam fração, ex. 7.5 = 07:30).
function matchBlock(blocks, key) {
  const dateStr = key.slice(0, 10);         // YYYY-MM-DD
  const hour = Number(key.slice(11, 13));   // HH
  const minute = Number(key.slice(14, 16)); // MM (00|30)
  const from = hour + minute / 60, to = from + SLOT_MIN / 60;
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return blocks.find((b) => {
    const hourHit = b.allDay || (Number(b.fromHour) < to && Number(b.toHour) > from);
    if (!hourHit) return false;
    return b.recur === "weekly" ? Number(b.weekday) === weekday : b.date === dateStr;
  });
}
// "Agenda ocupada" do dono: calls/integrações já marcadas (keys concretas) MAIS os
// bloqueios manuais da tela Agenda. Devolve o mesmo contrato que a SlotGrid usa
// (.has), com .info(key) extra pro tooltip (motivo do bloqueio).
export function busyView(concreteKeys, userId) {
  // Item conta pra pessoa quando ela é a dona (user) OU participante (users[],
  // compromisso com mais de uma pessoa ocupa a agenda de todas).
  const blocks = ((typeof window !== "undefined" && window.SEED?.AGENDA_BLOCKS) || [])
    .filter((b) => b.user === userId || (Array.isArray(b.users) && b.users.includes(userId)));
  // Consulta da mentoria (UniqueKids) ocupa a agenda de quem atende igual a uma
  // call: quem faz o encontro do cliente não pode receber call de venda por
  // cima. Entra AQUI (e não em callBusyKeys) pra valer em toda grade — call,
  // follow-up e integração — sem cada uma ter que lembrar.
  const consultKeys = new Set();
  for (const c of (typeof window !== "undefined" && window.SEED?.CONSULTATION_SLOTS) || []) {
    if (c.user !== userId) continue;
    const d = new Date(c.at);
    if (Number.isFinite(d.getTime())) for (const k of occupySlots(d, c.minutes)) consultKeys.add(k);
  }
  return {
    has: (key) => concreteKeys.has(key) || consultKeys.has(key) || !!matchBlock(blocks, key),
    info: (key) => {
      if (concreteKeys.has(key)) return { kind: "call" };
      if (consultKeys.has(key)) return { kind: "block", reason: "consulta da mentoria" };
      const b = matchBlock(blocks, key);
      // Compromisso (kind "event") ocupa igual; o tooltip mostra o título dele.
      return b ? { kind: "block", reason: b.title || b.reason || "" } : null;
    },
  };
}

// Horas já ocupadas na agenda de um closer: cada lead dele com callAt marca a
// hora daquele slot (a call ocupa 1h). Ignora o próprio lead (reagendamento) e
// os follow-ups — follow-up NÃO bloqueia horário: o SDR pode marcar a call de
// venda por cima. Só call de venda conta como ocupada, pra não dar divergência.
// Soma os bloqueios manuais do closer (busyView).
export function callBusyKeys(leads, closerId, selfId) {
  const busy = new Set();
  const saasList = (typeof window !== "undefined" && window.SEED?.SAAS) || [];
  for (const o of leads || []) {
    if (!closerId || o.id === selfId || o.closer !== closerId || !o.callAt) continue;
    const cfg = saasList.find((s) => s.id === o.saas);
    if (stageKind(cfg, o.stage) === "followup") continue; // follow-up não ocupa a agenda
    const d = new Date(o.callAt);
    if (Number.isFinite(d.getTime())) for (const k of occupySlots(d)) busy.add(k);
  }
  return busyView(busy, closerId);
}

// Horas ocupadas na agenda de um integrador: cada lead dele com integrationAt
// marca a hora (a integração ocupa 1h). Ignora o próprio lead (reagendamento).
// Soma os bloqueios manuais do integrador (busyView).
export function integBusyKeys(leads, integratorId, selfId) {
  const busy = new Set();
  for (const o of leads || []) {
    if (!integratorId || o.id === selfId || o.integrator !== integratorId || !o.integrationAt) continue;
    const d = new Date(o.integrationAt);
    if (Number.isFinite(d.getTime())) for (const k of occupySlots(d)) busy.add(k);
  }
  return busyView(busy, integratorId);
}

// Grade de agenda reutilizável: abas de dia (dias úteis) + slots de MEIA HORA.
// Marca como ocupado (e desabilita) o que já está no `busy` do dono — e como a
// call dura 1h, marcar as 14h derruba também as 14h30. Usada pela call e pelo
// follow-up; o valor escolhido volta em `slotVal` (YYYY-MM-DDTHH:MM).
export function SlotGrid({ days, day, setDay, slot, setSlot, busy }) {
  const custom = !days.some((d) => sameYMD(d, day)); // dia escolhido no calendário (fora dos chips)
  // Trocar de dia limpa o horário se ele era de OUTRO dia (senão o resumo mostraria
  // um slot que não bate com a grade visível).
  const pickDay = (d) => { setDay(d); if (slot && slot.slice(0, 10) !== ymd(d)) setSlot(""); };
  return (
    <>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        {days.map((d, i) => {
          const on = sameYMD(d, day);
          return (
            <button key={i} onClick={() => pickDay(d)} style={{
              height: 30, padding: "0 10px", borderRadius: 999, fontSize: 11, fontFamily: "var(--mono)",
              background: on ? "var(--accent)" : "var(--bg-1)",
              color: on ? "var(--accent-fg)" : "var(--fg-3)",
              border: "1px solid " + (on ? "var(--accent)" : "var(--line-2)"),
            }}>{d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(/\./g, "")}</button>
          );
        })}
        {/* Calendário aberto: escolher qualquer dia/mês (não trava em dia útil). */}
        <label title="escolher qualquer dia no calendário" style={{
          display: "inline-flex", alignItems: "center", height: 30, padding: "0 8px", borderRadius: 999, cursor: "pointer",
          background: custom ? "var(--accent)" : "var(--bg-1)",
          color: custom ? "var(--accent-fg)" : "var(--fg-3)",
          border: "1px " + (custom ? "solid var(--accent)" : "dashed var(--line-2)"),
        }}>
          <input type="date" min={ymd(new Date())} value={ymd(day)} onChange={(e) => { if (e.target.value) pickDay(parseYMD(e.target.value)); }}
            style={{ border: 0, background: "transparent", fontSize: 11, fontFamily: "var(--mono)", color: "inherit", padding: 0, outline: "none", colorScheme: "light dark" }} />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>
        {Array.from({ length: ((CALL_H1 - CALL_H0) * 60) / SLOT_MIN }, (_, i) => {
          const total = CALL_H0 * 60 + i * SLOT_MIN;
          return { h: Math.floor(total / 60), m: total % 60 };
        }).map(({ h, m }) => {
          const cell = new Date(day); cell.setHours(h, m, 0, 0);
          const key = cellKey(cell);
          const occupied = busy.has(key);
          const bInfo = occupied && busy.info ? busy.info(key) : null;
          const blocked = bInfo?.kind === "block"; // bloqueio manual (agenda) ≠ call já marcada
          const past = cell.getTime() < Date.now();
          const val = slotVal(day, h, m);
          const sel = slot === val;
          const disabled = occupied || past;
          const title = blocked ? ("agenda bloqueada" + (bInfo.reason ? `: ${bInfo.reason}` : "")) : occupied ? "closer já tem call nesse horário" : past ? "horário já passou" : "marcar";
          return (
            <button key={`${h}-${m}`} disabled={disabled} onClick={() => setSlot(val)} title={title}
              style={{
                height: 32, borderRadius: 999, fontSize: 11.5, fontFamily: "var(--mono)",
                background: sel ? "var(--accent)" : occupied ? "var(--neg-soft)" : "var(--bg-1)",
                color: sel ? "var(--accent-fg)" : occupied ? "var(--neg)" : past ? "var(--fg-4)" : "var(--fg-2)",
                border: "1px solid " + (sel ? "var(--accent)" : occupied ? "color-mix(in srgb, var(--neg) 30%, var(--line-2))" : "var(--line-2)"),
                opacity: past && !sel ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer",
                textDecoration: occupied && !blocked ? "line-through" : "none",
              }}>{blocked ? "🔒 " : ""}{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}</button>
          );
        })}
      </div>
    </>
  );
}

// "Quando retomar": N dias à frente, 9h, nunca no fim de semana (a mesma régua
// dos atalhos de próximo toque na ficha do lead). Devolve o formato do
// <input type="datetime-local"> — hora local, sem fuso.
const retryPreset = (days, hour = 9) => {
  if (days === 0) { const t = new Date(); t.setHours(t.getHours() + 1, 0, 0, 0); return slotVal(t, t.getHours(), 0); }
  const d = rollToBusinessDay(new Date(Date.now() + days * DAY));
  d.setHours(hour, 0, 0, 0);
  return slotVal(d, hour, 0);
};
const RETRY_PRESETS = [
  ["hoje +1h", () => retryPreset(0)],
  ["amanhã 9h", () => retryPreset(1)],
  ["+2d", () => retryPreset(2)],
  ["+1sem", () => retryPreset(7)],
  ["+15d", () => retryPreset(15)],
  ["+30d", () => retryPreset(30)],
  ["+45d", () => retryPreset(45)],
  ["+60d", () => retryPreset(60)],
];

function DestinoSection({ saasCfg, lead, leads, callSummary, onMove, onMoveMeet, onAfter, onTouch }) {
  const dests = destinationsFor(saasCfg, lead);
  const stageMeta = Object.fromEntries((saasCfg?.funnel || []).map((f) => [f.stage, f]));
  const isFollowup = stageKind(saasCfg, lead.stage || firstStage(saasCfg)) === "followup";
  const closers = usersByRole("closer");
  const integrators = usersByRole("integrator");
  const reasons = lossReasonsOf(saasCfg);

  const [dest, setDest] = useS(null);       // { stage, kind }
  const [closer, setCloser] = useS(lead.closer || "");
  const [integrator, setIntegrator] = useS(lead.integrator || (integrators.length === 1 ? integrators[0].id : ""));
  const [amount, setAmount] = useS(lead.amount || "");
  const [payment, setPayment] = useS(lead.paymentMethod || "");
  // O que foi VENDIDO (produto do catálogo da apresentação + ciclo): o card só
  // vai pra Integração depois de fechar, e a entrega precisa do escopo.
  const [dealProduct, setDealProduct] = useS(lead.dealProduct || "");
  const [planClosed, setPlanClosed] = useS(lead.planClosed || "anual");
  const [reason, setReason] = useS("");
  const [note, setNote] = useS("");
  const [slot, setSlot] = useS(lead.callAt || "");
  const [day, setDay] = useS(() => nextBusinessDays(1)[0]); // dia da grade (qualquer dia via calendário)
  const [retryAt, setRetryAt] = useS(""); // "Retomar": quando voltar nesse lead
  // Call → Follow-up: qual proposta ficou na mesa (obrigatória nesse movimento)
  // — o PRODUTO da apresentação + o ciclo, pro follow-up cobrar a oferta certa.
  const fromCall = stageKind(saasCfg, lead.stage || saasCfg?.funnel?.[0]?.stage) === "call";
  const [offer, setOffer] = useS(lead.proposalOffer || "");
  const [offerProduct, setOfferProduct] = useS(lead.proposalProduct || "");
  const [email, setEmail] = useS(lead.email || "");
  const [emailTouched, setEmailTouched] = useS(false); // SDR digitou um e-mail próprio pro convite
  const [meetBusy, setMeetBusy] = useS(false);   // criando o Meet
  const [meetRes, setMeetRes] = useS(null);      // { callUrl, attendees }
  const [meetErr, setMeetErr] = useS(null);
  useE(() => {
    setDest(null); setCloser(lead.closer || ""); setSlot(lead.callAt || ""); setDay(nextBusinessDays(1)[0]); setRetryAt("");
    setIntegrator(lead.integrator || (integrators.length === 1 ? integrators[0].id : ""));
    setAmount(lead.amount || ""); setPayment(lead.paymentMethod || ""); setReason(""); setNote("");
    setDealProduct(lead.dealProduct || ""); setPlanClosed(lead.planClosed || "anual");
    setOffer(lead.proposalOffer || ""); setOfferProduct(lead.proposalProduct || "");
    setEmail(lead.email || ""); setEmailTouched(false); setMeetBusy(false); setMeetRes(null); setMeetErr(null);
  }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-preenche o e-mail do convite com o do lead SEMPRE que ele estiver
  // preenchido (ex.: o SDR acabou de preencher no checklist), até o SDR digitar
  // um e-mail próprio no campo do convite (aí respeita o que ele escreveu).
  useE(() => {
    if (!emailTouched && lead.email) setEmail(lead.email);
  }, [lead.email, emailTouched]);

  // Follow-up: pré-seleciona o horário que a IA sugeriu na última call
  // (callSummary.followup.quando, hora de Brasília), quando cai num slot válido
  // (dia útil à vista, dentro do expediente, no futuro e livre na agenda).
  useE(() => {
    if (!dest || dest.retry || setupType(dest.kind) !== "followup" || slot) return;
    const m = String(callSummary?.followup?.quando || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (!m) return;
    const hh = Number(m[2]);
    // A sugestão vem em qualquer minuto; ancora na meia hora da grade.
    const mm = Number(m[3]) < 30 ? 0 : 30;
    if (hh < CALL_H0 || hh >= CALL_H1) return;
    const dd = nextBusinessDays(6);
    const idx = dd.findIndex((d) => cellKey(d).slice(0, 10) === m[1]);
    if (idx < 0) return;
    const cell = new Date(dd[idx]); cell.setHours(hh, mm, 0, 0);
    if (cell.getTime() <= Date.now()) return;
    if (closer && callBusyKeys(leads, closer, lead.id).has(cellKey(cell))) return;
    setDay(dd[idx]); setSlot(slotVal(dd[idx], hh, mm));
  }, [dest, callSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dests.length === 0) return null;
  // "Retomar" tem setup próprio (a data de voltar) e NÃO herda o do kind da
  // etapa atual — senão um retry em follow-up abriria a grade de agendamento.
  const setup = !dest ? null : dest.retry ? "retry" : setupType(dest.kind);
  const days = nextBusinessDays(6);

  // Horas ocupadas na agenda do closer (cada call = 1h; ignora o próprio lead).
  // Vale pra call e pro follow-up: ambos marcam horário na agenda do closer.
  const busy = (setup === "call" || setup === "followup") && closer ? callBusyKeys(leads, closer, lead.id)
    : setup === "integrator" && integrator ? integBusyKeys(leads, integrator, lead.id)
    : new Set();

  // Escolher um destino inicializa a agenda com o horário que já existe no lead
  // (call/follow-up = callAt; integração = integrationAt), pra permitir reagendar.
  const chooseDest = (d) => {
    const same = dest && dest.stage === d.stage && !!dest.retry === !!d.retry;
    const next = same ? null : d;
    setDest(next);
    if (!next) return;
    // Retomar: já nasce preenchido com a cadência do estágio (o "amanhã" de
    // antes), então quem só quer registrar a tentativa confirma num clique e
    // quem precisa de outra data muda ali mesmo.
    if (next.retry) { setRetryAt(retryPreset(Number(cadenceOf(saasCfg, lead.stage)?.retryDays) || 1)); return; }
    const st = setupType(next.kind);
    const at = st === "integrator" ? (lead.integrationAt || "")
      : st === "call" ? (lead.callAt || "")
      : st === "followup" ? (lead.followupAt || "") // remarcar o follow-up abre no horário dele
      : "";
    setSlot(at);
    setDay(at ? parseYMD(at.slice(0, 10)) : nextBusinessDays(1)[0]);
  };

  const isRetry = !!dest?.retry;
  // Produto do catálogo é obrigatório pra fechar em quem tem catálogo (o SaaS
  // sem catálogo, como a mentoria do Kids, nem mostra o campo).
  const askProduct = dealProductsOf(lead.saas).length > 0;
  const oneOff = isOneOffProduct(lead.saas, dealProduct);
  const dealReady = Number(amount) > 0 && !!payment && (!askProduct || !!dealProduct);
  // Proposta na mesa completa = ciclo escolhido E, em quem tem catálogo, o
  // produto ofertado ("não chegou na proposta" dispensa o produto).
  const offerDone = !!offer && (offer === "nenhuma" || !askProduct || !!offerProduct);
  const ready = !dest ? false
    : isRetry ? !!retryAt
    : setup === "call" ? !!(closer && slot)
    : setup === "followup" ? !!closer && (!fromCall || offerDone) // horário é opcional; saindo da call, a proposta na mesa é obrigatória
    : setup === "integrator" ? !!(integrator && (dest.kind !== "integracao" || dealReady))
    : setup === "won" ? dealReady
    : setup === "loss" ? !!reason
    : true;

  // O fechamento em si (produto, ciclo, valor, pagamento) — igual no gate do
  // board: quem fecha pelo roteiro registra a mesma coisa.
  const dealPatch = () => ({
    amount: Number(amount),
    paymentMethod: payment,
    ...(askProduct ? { dealProduct, planClosed: oneOff ? "unico" : planClosed } : {}),
  });

  function confirm() {
    if (!ready) return;
    // Retomar não move o card: registra a tentativa e marca quando voltar (num
    // lead novo é o servidor que promove pra Qualificando, no toque).
    if (isRetry) { onTouch && onTouch(retryAt); return; }
    const patch = { stage: dest.stage };
    if (setup === "call") { patch.closer = closer; patch.callAt = slot; if (email.trim()) patch.email = email.trim(); }
    // Follow-up: mantém o closer e, se um horário foi escolhido, agenda nele —
    // followAt PRÓPRIO (aparece na agenda com a cara de follow-up, sem travar
    // slots de venda) + nextActionAt (a fila do "meu dia" vence exatamente nesse
    // horário, não na cadência padrão). Já foi gravado no callAt e dava ruim: a
    // agenda desenhava um "✓ call feita" que nunca aconteceu e ainda arquivava a
    // call de verdade no histórico (Leo, 13/08 — casos Beto e Milaan).
    else if (setup === "followup") { patch.closer = closer; if (fromCall && offer) { patch.proposalOffer = offer; patch.proposalProduct = offer === "nenhuma" ? "" : offerProduct; } if (slot) { patch.followupAt = slot; patch.nextActionAt = slot; } }
    // Integração: define o integrador e, se um horário foi escolhido na agenda,
    // agenda a integração nele (integrationAt aparece na Agenda e replica na
    // agenda pessoal do integrador que conectou o Google).
    else if (setup === "integrator") { patch.integrator = integrator; if (slot) patch.integrationAt = slot; if (dest.kind === "integracao" && Number(amount) > 0) { Object.assign(patch, dealPatch()); } }
    else if (setup === "won") { Object.assign(patch, dealPatch()); }
    else if (setup === "loss") { patch.lostReason = reason; if (note.trim()) patch.lostNote = note.trim(); }
    onMove && onMove(patch);
  }

  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
  const meetReady = setup === "call" && !!closer && !!slot && validEmail(email) && !meetBusy;

  // Botão único: agenda a call (closer + horário), cria o Meet e manda o convite
  // pro e-mail do lead — tudo de uma vez. Fica pausado no sucesso pra mostrar o
  // link; "próximo" avança a fila.
  async function agendarComMeet() {
    if (!meetReady || !onMoveMeet) return;
    setMeetBusy(true); setMeetErr(null); setMeetRes(null);
    try {
      const res = await onMoveMeet({ stage: dest.stage, closer, callAt: slot }, email.trim());
      setMeetRes(res || { ok: true });
    } catch (e) {
      setMeetErr(e?.message || "falha ao criar o Meet");
    }
    setMeetBusy(false);
  }
  const label = { display: "block", marginBottom: 4 };
  const fieldStyle = { width: "100%", height: 30, padding: "0 8px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: 999, color: "var(--fg-1)", fontSize: 12.5 };
  const slotFmt = (v) => { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; };

  // O que foi vendido — os mesmos campos do gate do board (produto do catálogo,
  // ciclo, valor e pagamento), servindo a Integração e o Ganho.
  const dealFields = (hint) => (
    <div style={{ maxWidth: 340 }}>
      <DealProductField saas={lead.saas} value={dealProduct} plan={planClosed} amount={amount}
        fieldStyle={fieldStyle} labelStyle={label}
        onChange={(id, p) => { setDealProduct(id); if (p?.oneOff) setPlanClosed("unico"); }}
        onPick={(r) => { setAmount(String(r.value)); if (r.plan) setPlanClosed(r.plan); }} />
      {askProduct && (
        <div style={{ marginTop: 12 }}>
          <label className="kicker" style={label}>Plano fechado *</label>
          <select value={oneOff ? "unico" : planClosed} disabled={oneOff}
            onChange={(e) => setPlanClosed(e.target.value)} style={{ ...fieldStyle, opacity: oneOff ? 0.7 : 1 }}>
            {/* Só os planos ativos; "Assinatura mensal" (legado) só quando já é o plano do lead. */}
            {withLegacyOption(CLOSED_PLANS_ACTIVE, CLOSED_PLANS, planClosed).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <label className="kicker" style={label}>{askProduct && !oneOff && planClosed === "mensal" ? "Valor mensal (R$) *" : "Valor do negócio (R$) *"}</label>
        <input type="number" min="0" step="0.01" value={amount} placeholder={askProduct && !oneOff && planClosed === "mensal" ? "ex.: 599" : "ex.: 7188"}
          onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} style={fieldStyle} />
        <div className="mono dim" style={{ fontSize: 10, marginTop: 5 }}>
          {askProduct && !oneOff && planClosed === "mensal"
            ? "recorrência: a cada 30 dias do fechamento o acumulado do cliente soma mais uma mensalidade"
            : hint}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="kicker" style={label}>Modo de pagamento *</label>
        <PaymentMethodSelect value={payment} onChange={setPayment} fieldStyle={fieldStyle} placeholder="como o cliente fechou…" />
      </div>
    </div>
  );

  return (
    <div className="today-destinations">
      <div className="kicker" style={{ marginBottom: 10 }}>Próximo passo</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {dests.map((d, i) => {
          // Chip de retry: não atendeu / não fechou hoje → registra a tentativa
          // e abre a escolha de quando voltar (num lead novo, o toque promove
          // pra Qualificando sozinho, no servidor).
          if (d.retry) {
            const color = stageMeta[d.stage]?.color || "var(--fg-3)";
            const on = isRetry;
            return (
              <button key="retry" onClick={() => chooseDest(d)}
                title={isFollowup ? "Escolher a data e a hora de retorno do follow-up" : d.promote
                  ? `Não atendeu ou ainda não fechou · registra a tentativa, vai pra ${d.stage} e você escolhe quando voltar`
                  : "Não atendeu · registra a tentativa e você escolhe o dia e a hora de voltar"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, height: 42, padding: "0 16px", borderRadius: 999,
                  background: on ? "var(--accent-soft)" : "var(--bg-1)",
                  border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-strong)"),
                  color: on ? "var(--accent)" : "var(--fg-2)", fontSize: 13, fontWeight: 600,
                }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                {isFollowup ? "Follow-up" : d.promote ? `${d.stage} · retomar` : "Retomar"}
              </button>
            );
          }
          const on = dest?.stage === d.stage;
          const color = stageMeta[d.stage]?.color || "var(--accent)";
          return (
            <button key={d.stage} onClick={() => chooseDest(d)} style={{
              display: "inline-flex", alignItems: "center", gap: 7, height: 42, padding: "0 16px", borderRadius: 999,
              background: on ? "var(--accent-soft)" : "var(--bg-1)",
              border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"),
              color: on ? "var(--accent)" : "var(--fg-2)", fontSize: 13, fontWeight: 600,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
              {d.stage} {on ? "" : "→"}
            </button>
          );
        })}
      </div>

      {dest && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Retomar: QUANDO voltar nesse lead. Atalhos + data e hora exatas
              (mesmos atalhos do "próximo toque" da ficha do lead) — antes era
              sempre a cadência do estágio, e quem combinou de voltar daqui a
              duas semanas tinha que corrigir no card depois. */}
          {isRetry && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="kicker" htmlFor={`return-at-${lead.id}`}>{isFollowup ? "Data de retorno" : "Quando retomar"}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {RETRY_PRESETS.map(([txt, mk]) => {
                  const v = mk();
                  const on = retryAt === v;
                  return (
                    <button key={txt} onClick={() => setRetryAt(v)} style={{
                      height: 28, padding: "0 10px", borderRadius: 999,
                      border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"),
                      background: on ? "var(--accent-soft)" : "var(--bg-1)",
                      color: on ? "var(--accent)" : "var(--fg-2)", fontSize: 11.5, fontWeight: on ? 600 : 500,
                    }}>{txt}</button>
                  );
                })}
                <input id={`return-at-${lead.id}`} type="datetime-local" value={retryAt} onChange={(e) => setRetryAt(e.target.value)}
                  title="Dia e hora exatos pra voltar nesse lead"
                  style={{ ...fieldStyle, width: "auto", height: 28, fontFamily: "var(--mono)", fontSize: 11.5 }} />
              </div>
              <div className="mono dim" style={{ fontSize: 10.5 }}>
                {isFollowup ? "O cliente continua em follow-up e volta à sua fila na data escolhida." : <>registra a tentativa de contato{dest.promote ? ` e manda o card pra ${dest.stage}` : ""} · o lead volta na sua fila nesse horário</>}
              </div>
            </div>
          )}

          {setup === "call" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <div>
                  <label className="kicker" style={label}>Closer da call *</label>
                  <select value={closer} onChange={(e) => { setCloser(e.target.value); setSlot(""); }} style={fieldStyle}>
                    <option value="">escolher o closer…</option>
                    {closers.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                  </select>
                </div>
              </div>
              {closer ? (
                <div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginBottom: 6 }}>
                    Horários livres na agenda de {displayName(closer)} · a call ocupa 1h
                  </div>
                  <SlotGrid days={days} day={day} setDay={setDay} slot={slot} setSlot={setSlot} busy={busy} />
                  {slot && <div className="mono" style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 8 }}>Call: {slotFmt(slot)} · {displayName(closer)}</div>}
                </div>
              ) : (
                <div className="mono dim" style={{ fontSize: 11 }}>escolha o closer pra ver os horários livres da agenda dele</div>
              )}
              {closer && slot && (
                <div style={{ maxWidth: 340 }}>
                  <label className="kicker" style={label}>E-mail do lead (pro convite da call)</label>
                  <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailTouched(true); }} placeholder="nome@email.com" style={fieldStyle} />
                  {email && !validEmail(email) && <div className="mono" style={{ fontSize: 10, color: "var(--warn)", marginTop: 4 }}>e-mail inválido</div>}
                </div>
              )}
            </>
          )}

          {setup === "followup" && (
            closer ? (
              <div>
                {/* Saindo da CALL: registra qual proposta ficou na mesa — o
                    PRODUTO da apresentação + o ciclo, é ela que o follow-up
                    cobra (aparece no Resumo do cliente). */}
                {fromCall && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                    {askProduct && offer !== "nenhuma" && (
                      <div style={{ width: "min(280px, 100%)" }}>
                        <label className="kicker" style={label}>Qual produto ficou ofertado? *</label>
                        <SelectWithCustom ids={dealProductsOf(lead.saas).map((p) => p.id)} value={offerProduct} onChange={setOfferProduct}
                          fieldStyle={fieldStyle} placeholder="o produto da apresentação…"
                          customLabel="Personalizado… (escrever o produto)" customPlaceholder="escreva o produto ofertado…">
                          <ProductOptions products={dealProductsOf(lead.saas)} />
                        </SelectWithCustom>
                      </div>
                    )}
                    <div style={{ width: "min(280px, 100%)" }}>
                      <label className="kicker" style={label}>Qual proposta ficou na mesa? *</label>
                      <select value={offer} onChange={(e) => setOffer(e.target.value)} style={fieldStyle}>
                        <option value="">a oferta que o cliente levou pra pensar…</option>
                        {CLOSED_PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                        <option value="nenhuma">não chegou na proposta</option>
                      </select>
                    </div>
                  </div>
                )}
                <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginBottom: 6 }}>
                  Quando fazer o follow-up · agenda de {displayName(closer)}
                </div>
                {callSummary?.followup?.nota && <div className="mono" style={{ fontSize: 10.5, color: "var(--accent)", marginBottom: 6 }}>✨ IA (última call): {callSummary.followup.nota}</div>}
                <SlotGrid days={days} day={day} setDay={setDay} slot={slot} setSlot={setSlot} busy={busy} />
                {slot && <div className="mono" style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 8 }}>Follow-up: {slotFmt(slot)} · {displayName(closer)}</div>}
                <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>entra na agenda nesse horário · não trava o slot pra novas calls de venda. Sem horário, retoma pela cadência.</div>
              </div>
            ) : (
              <div style={{ maxWidth: 280 }}>
                <label className="kicker" style={label}>Responsável pelo follow-up *</label>
                <select value={closer} onChange={(e) => { setCloser(e.target.value); setSlot(""); }} style={fieldStyle}>
                  <option value="">escolher…</option>
                  {closers.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                </select>
              </div>
            )
          )}

          {setup === "integrator" && (() => {
            const integLabel = dest.kind === "integracao" ? "integração" : "entrega/CS";
            return (
              <div>
                <div style={{ maxWidth: 280 }}>
                  <label className="kicker" style={label}>Responsável pela {integLabel} *</label>
                  <select value={integrator} onChange={(e) => { setIntegrator(e.target.value); setSlot(""); }} style={fieldStyle}>
                    <option value="">escolher o integrador…</option>
                    {integrators.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                  </select>
                  {lead.closer && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 5 }}>closer da venda: {displayName(lead.closer)} (fica registrado)</div>}
                </div>
                {dest.kind === "integracao" && <div style={{ marginTop: 12 }}>{dealFields("fechou! esse é o valor do negócio (vira a receita do closer)")}</div>}
                {integrator && (
                  <div style={{ marginTop: 14 }}>
                    <div className="kicker" style={{ marginBottom: 8 }}>
                      Quando fazer a {integLabel} · agenda de {displayName(integrator)}
                    </div>
                    <SlotGrid days={days} day={day} setDay={setDay} slot={slot} setSlot={setSlot} busy={busy} />
                    {slot && <div className="mono" style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 8 }}>{integLabel[0].toUpperCase() + integLabel.slice(1)}: {slotFmt(slot)} · {displayName(integrator)}</div>}
                    <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>entra na agenda nesse horário e replica na agenda pessoal do integrador (se ele conectou o Google). Sem horário, só move pra {integLabel}.</div>
                  </div>
                )}
              </div>
            );
          })()}

          {setup === "won" && dealFields("vira a receita no marketing e a conversão enviada pra Meta")}

          {setup === "loss" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <div>
                <label className="kicker" style={label}>Motivo *</label>
                <select value={reason} onChange={(e) => setReason(e.target.value)} style={fieldStyle}>
                  <option value="">escolha o motivo…</option>
                  {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="kicker" style={label}>Detalhe (opcional)</label>
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: fechou com concorrente" style={fieldStyle} />
              </div>
            </div>
          )}

          {setup === "call" ? (
            meetRes ? (
              <div style={{ border: "1px solid var(--pos)", background: "var(--pos-soft)", borderRadius: "var(--r-2)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="mono" style={{ fontSize: 12, color: "var(--pos)", fontWeight: 600 }}>✓ call agendada · Meet criado · convite enviado{validEmail(email) ? ` pra ${email.trim()}` : ""}</div>
                {meetRes.callUrl && <a href={meetRes.callUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11.5, color: "var(--accent)", wordBreak: "break-all" }}>{meetRes.callUrl}</a>}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                  <button onClick={() => onAfter && onAfter()} style={{ height: 30, padding: "0 14px", borderRadius: 999, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12.5, fontWeight: 600 }}>próximo →</button>
                  <button onClick={() => setDest(null)} className="mono dim" style={{ fontSize: 11.5 }}>fechar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={agendarComMeet} disabled={!meetReady} style={{
                    height: 32, padding: "0 16px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                    background: meetReady ? "var(--btn-bg, var(--accent))" : "var(--bg-2)", color: meetReady ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-4)",
                    border: "1px solid " + (meetReady ? "var(--btn-bg, var(--accent))" : "var(--line-2)"), cursor: meetReady ? "pointer" : "not-allowed",
                  }}>{meetBusy ? "criando Meet e enviando convite…" : "🎥 agendar + criar Meet + convite"}</button>
                  <button onClick={confirm} disabled={!ready || meetBusy} className="mono"
                    style={{ height: 32, padding: "0 12px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, opacity: ready && !meetBusy ? 1 : 0.5 }}>só agendar (sem convite)</button>
                  <button onClick={() => setDest(null)} className="mono dim" style={{ fontSize: 11.5 }}>cancelar</button>
                </div>
                {meetErr && <div className="mono" style={{ fontSize: 11, color: "var(--neg)" }}>{meetErr} · a call já foi agendada; crie o Meet pela ficha do lead se precisar.</div>}
                {closer && slot && !validEmail(email) && <div className="mono dim" style={{ fontSize: 10.5 }}>preencha o e-mail do lead pra mandar o convite (ou use "só agendar")</div>}
              </div>
            )
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={confirm} disabled={!ready} style={{
                height: 32, padding: "0 16px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                background: ready ? "var(--btn-bg, var(--accent))" : "var(--bg-2)", color: ready ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-4)",
                border: "1px solid " + (ready ? "var(--btn-bg, var(--accent))" : "var(--line-2)"), cursor: ready ? "pointer" : "not-allowed",
              }}>{isRetry ? (isFollowup ? "agendar retorno →" : "registrar tentativa e retomar →") : setup === "followup" && slot ? "agendar follow-up →" : `mover pra ${dest.stage} →`}</button>
              <button onClick={() => setDest(null)} className="mono dim" style={{ fontSize: 11.5 }}>cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { TodayScreen, ScriptPanel, buildQueue, ACTION_LABELS, GROUP_META, GROUP_ORDER };
