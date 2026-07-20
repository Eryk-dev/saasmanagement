// Régua ÚNICA das métricas do cockpit. Antes deste módulo cada endpoint
// reimplementava as próprias contas e elas divergiam em 4 eixos:
//
//   1. O DIA: UTC-3 fixo (marketing/scoreboard), America/Sao_Paulo (pace),
//      UTC puro (funil da Análise) e corte por instante (/api/metrics). Aqui:
//      `dayKey` — dia do negócio em America/Sao_Paulo, pra todo mundo (o front
//      espelha em bizDay, lib/format.js).
//   2. O GANHO: a régua oficial é a venda como FATO do lead — `isWonLead`
//      (customerId carimbado pelo convertWonLead, ou etapa de kind ganho) e
//      `wonAtOf` (quando vendeu), definidos em stages.js e re-exportados aqui.
//      `winsIn` recorta os fechamentos numa janela, com fallback pro lead
//      legado sem carimbo (startedAt do cliente vinculado).
//   3. O LEAD: contagens oficiais EXCLUEM leads internos (`isRealLead`) — o
//      CPL já excluía e o resto não, então tile e custo divergiam.
//   4. A JANELA: `rangeFromQuery` — since/until por dia do negócio, default
//      30 dias, em todo endpoint que aceita período.
//
// Todo endpoint de métrica importa DAQUI. Regra nova de funil/venda entra
// aqui (ou em stages.js) primeiro; o metrics-consistency.test.js roda as
// telas sobre o mesmo dataset e quebra se alguém divergir.

import { kindOf, isLoss, isNoShowStage, isWonLead, wonAtOf } from "./stages.js";

export { isWonLead, wonAtOf }; // a régua oficial de ganho, num import só

export const DAY_MS = 86_400_000;
export const round2 = (n) => Math.round(n * 100) / 100;

// ── O dia do negócio ─────────────────────────────────────────────────────────
const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dayKey(value) {
  if (!value) return "";
  // Data PURA ("2026-07-03", sem hora — ex.: ad_insights.date) já É o dia do
  // negócio: passar pelo fuso deslocaria um dia (meia-noite UTC = 21h da
  // véspera em São Paulo).
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = Object.fromEntries(
    DATE_FMT.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const monthKey = (value) => dayKey(value).slice(0, 7);

// Janela padrão dos endpoints com ?since=&until= (default: últimos 30 dias).
export function rangeFromQuery(q = {}, now = new Date()) {
  const until = q.until || dayKey(now);
  const since = q.since || dayKey(new Date(now.getTime() - 29 * DAY_MS));
  return { since, until };
}

// ── O que é lead ─────────────────────────────────────────────────────────────
// Lead interno (teste/seed) fica fora de TODA contagem oficial.
export const isRealLead = (l) => !l?.internal;

// ── Fechamentos numa janela ──────────────────────────────────────────────────
// Vendas da janela pela régua oficial: isWonLead + data do wonAtOf. Fallback
// pro lead legado sem carimbo nenhum: startedAt do cliente vinculado (leadId).
// Retorna Map lead.id → momento da venda (só os que caem na janela).
export function winsIn(product, leads, inWin, customerStartByLead) {
  const winAt = new Map();
  for (const l of leads) {
    if (!isWonLead(product, l)) continue;
    const at = wonAtOf(l) || customerStartByLead?.get(l.id) || "";
    if (at && inWin(at)) winAt.set(l.id, at);
  }
  return winAt;
}

// Vínculo lead → início do cliente (fallback do winsIn pra dado legado).
export const customerStartMap = (customers) =>
  new Map(customers.filter((c) => c.leadId && c.startedAt).map((c) => [c.leadId, c.startedAt]));

// TCV de um conjunto de leads (valor lançado no fechamento).
export const tcvOf = (leads) => round2(leads.reduce((a, l) => a + (Number(l.amount) || 0), 0));

// ── A safra de calls ─────────────────────────────────────────────────────────
// Avançou pra frente da call (a call ACONTECEU): proposta/negociação/fechou.
export const FORWARD_KINDS = new Set(["proposta", "followup", "integracao", "ganho"]);

// Leads DISTINTOS da lista que atingiram estágio de kind `call` na janela.
//   actsOf: (leadId) => activities ORDENADAS por data.
export function bookedLeadsIn(product, leads, actsOf, inWin) {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const ids = new Set();
  for (const l of leads) {
    for (const a of actsOf(l.id) || []) {
      if (a.type === "stage" && inWin(a.at) && kindOf(product, a.meta?.to) === "call") ids.add(l.id);
    }
  }
  return [...ids].map((id) => byId.get(id)).filter(Boolean);
}

// Resolução da safra de calls: compareceu = avançou pra frente OU perdeu por
// OUTRO motivo (a call aconteceu); furo = perda "nao_compareceu" OU parado na
// ETAPA de No show (o fluxo manda o furão pra lá, não pra Perdido); ainda em
// Call agendada = não resolvido. won = vendeu (isWonLead, a régua oficial).
export function callOutcome(product, list, actsOf) {
  let shown = 0, noShow = 0, won = 0;
  for (const l of list) {
    const isW = isWonLead(product, l);
    const lost = isLoss(product, l.stage);
    if (isW) won++;
    const advanced = isW || FORWARD_KINDS.has(kindOf(product, l.stage))
      || (actsOf(l.id) || []).some((a) => a.type === "stage" && FORWARD_KINDS.has(kindOf(product, a.meta?.to)));
    if ((lost && l.lostReason === "nao_compareceu") || (!isW && isNoShowStage(l.stage))) noShow++;
    else if (advanced || lost) shown++;
  }
  return { shown, noShow, won };
}

// ── Dinheiro ─────────────────────────────────────────────────────────────────
// MRR da base: soma do arr/12 dos clientes (a régua do bootstrap e do pace).
export const mrrOf = (customers) =>
  round2(customers.reduce((a, c) => a + (Number(c.arr) || 0), 0) / 12);

// Caixa do mês: faturas PAGAS com paidAt dentro do mês (chave "YYYY-MM").
export const cashCollectedIn = (invoices, month) =>
  round2(invoices
    .filter((i) => i.status === "paid" && i.paidAt && monthKey(i.paidAt) === month)
    .reduce((a, i) => a + (Number(i.amount) || 0), 0));

// A receber até uma data (faturas abertas/vencidas com dueDate ≤ limite).
export const receivablesUntil = (invoices, untilDay) =>
  invoices.filter((i) => {
    if (i.status !== "open" && i.status !== "overdue") return false;
    const due = dayKey(i.dueDate);
    return due && due <= untilDay;
  });
