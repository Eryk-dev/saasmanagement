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

import { kindOf, isLoss, isNoShowStage, isWonLead, wonAtOf, TOUCH_TYPES } from "./stages.js";

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
// Lead que conta nas métricas do produto: fora os testes internos do time e
// fora quem saiu por uma SAÍDA LATERAL do form (ex.: "ainda não vende em
// marketplace", que vai pra fila da Mentoria). Esses últimos são contato, mas
// não são lead DESTE produto — contá-los faz o CPL parecer barato justamente
// porque encheu de gente que não compra.
export const isRealLead = (l) => !l?.internal && !l?.formExit;

// ── Indicação (referral) ─────────────────────────────────────────────────────
// Lead que veio por INDICAÇÃO (de um cliente): a origem (`source`) ou o
// `utm.source` contém "indica" — pega "Indicação", "indicacao", "Indicação de
// cliente". É a régua do placar do CS (meta de indicação): conta TODA indicação
// recebida na janela, sem atribuição fina por pessoa (decisão do Leo).
const stripAccents = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const isReferralLead = (l) =>
  stripAccents(l?.source).includes("indica") || stripAccents(l?.utm?.source).includes("indica");

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

// ── Funil de conversão do produto (base ÚNICA das telas) ─────────────────────
// Contagens do funil COORTE na janela (leads criados nela): contatados →
// agendaram call → compareceram → fecharam, + ganhos e receita. É a MESMA base
// da Visão geral (Conversões do funil) e da Análise de Pace, pra as duas telas
// nunca divergirem. O funil ENCADEIA — cada denominador é o passo anterior.
//   actsOf: (leadId) => activities ordenadas;  winLeadsIn(inWin) => leads ganhos
// `adjust` (product.paceAdjust) soma HISTÓRICO PRÉ-COCKPIT (dados reais de antes
// do registro no sistema): { leads, contacted, booked, shown, won } — só somas
// positivas; noShow e ganhos totais (revenue) não entram no ajuste.
// ── Contato com ATRIBUIÇÃO (a régua ÚNICA de "contatados") ───────────────────
// Decisões do Leo (24/07): contato = ação HUMANA — toque de cadência
// (whatsapp/call/email/meeting) ou mensagem ENVIADA no inbox por gente do time
// (`humanIds` = ids da collection users). Automação (fluxo de ligação, drip,
// envio por chave "cockpit") NÃO conta no total: sai em `automationReached`
// (leads distintos que ela alcançou, informativo). Cada lead vai pro autor do
// PRIMEIRO contato humano da janela, então a soma dos autores fecha EXATA com
// o total — é o que deixa o funil da Visão geral ser a soma dos cards.
// O inbox segue separado das activities DE PROPÓSITO (chat ≠ toque de cadência,
// não re-agenda o GPS), mas a mensagem enviada conta como contato aqui.
// Devolve { leadIds, byAuthor (Map autor → leads distintos), automationReached }.
export function contactAttribution({ leads, actsOf, waMessages, saas, inWin, humanIds } = {}) {
  const first = new Map();       // leadId → { at, author } do 1º contato humano
  const autoReached = new Set(); // leads que a automação tocou (mesmo que gente também)
  const record = (id, at, author) => {
    if (!humanIds?.has(author || "")) { autoReached.add(id); return; }
    const cur = first.get(id);
    if (!cur || String(at || "") < String(cur.at || "")) first.set(id, { at: at || "", author });
  };
  const knownIds = new Set((leads || []).map((l) => l.id));
  for (const m of waMessages || []) {
    if (m.direction !== "out" || !m.leadId || !m.author) continue;
    if (saas && m.saas && m.saas !== saas) continue;
    if (!knownIds.has(m.leadId) || !inWin(m.at)) continue;
    record(m.leadId, m.at, m.author);
  }
  for (const l of leads || []) {
    for (const a of actsOf(l.id) || []) {
      if (inWin(a.at) && TOUCH_TYPES.has(a.type)) record(l.id, a.at, a.author);
    }
  }
  const byAuthor = new Map();
  for (const { author } of first.values()) byAuthor.set(author, (byAuthor.get(author) || 0) + 1);
  return { leadIds: new Set(first.keys()), byAuthor, automationReached: autoReached.size };
}

export function funnelCounts(product, { leads, actsOf, inWin, winLeadsIn, adjust, waContactedIds } = {}) {
  const recentLeads = leads.filter((l) => inWin(l.createdAt));
  const recentIds = new Set(recentLeads.map((l) => l.id));
  const contacted = recentLeads.filter((l) => (actsOf(l.id) || []).some((a) => TOUCH_TYPES.has(a.type)) || waContactedIds?.has(l.id));
  const booked = bookedLeadsIn(product, leads, actsOf, inWin).filter((l) => recentIds.has(l.id));
  const outcome = callOutcome(product, booked, actsOf);
  const wonLeads = winLeadsIn ? winLeadsIn(inWin) : [];
  const a = adjust && typeof adjust === "object" ? adjust : {};
  const adjN = (k) => { const n = Math.floor(Number(a[k])); return Number.isFinite(n) && n > 0 ? n : 0; };
  const adjApplied = ["leads", "contacted", "booked", "shown", "won"].reduce((o, k) => (adjN(k) ? { ...o, [k]: adjN(k) } : o), null);
  return {
    leads: recentLeads.length + adjN("leads"),
    contacted: contacted.length + adjN("contacted"),
    booked: booked.length + adjN("booked"),
    shown: outcome.shown + adjN("shown"),
    noShow: outcome.noShow,
    won: outcome.won + adjN("won"),   // ganhos DA SAFRA de calls (+ pré-cockpit) — o que encadeia
    wonTotal: wonLeads.length,         // ganhos totais no período (todos, por transição)
    revenue: tcvOf(wonLeads),
    adjust: adjApplied,
  };
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
