// Vocabulário do Suporte no SPA — espelho de tickets-core.js / tickets-sla.js
// da API. Status tem SEMÂNTICA fixa (`kind`): o kanban, os filtros e o SLA leem
// o kind, nunca o rótulo. O estado do SLA sai só do que o servidor gravou no
// ticket (prazos e instantes de aviso em tempo útil), então a fila, o menu e o
// runner concordam sem a tela recalcular expediente.

import { userById, currentUser } from "./users.js";
import { COLUMN_COLORS } from "./tasks.js";

export const TICKET_STATUSES = [
  { key: "new", label: "Novo", kind: "open", tone: "var(--info)" },
  { key: "open", label: "Em atendimento", kind: "open", tone: "var(--accent)" },
  { key: "pending_customer", label: "Aguardando cliente", kind: "waiting", tone: "var(--warn)" },
  { key: "on_hold", label: "Em espera", kind: "waiting", tone: "var(--fg-4)" },
  { key: "resolved", label: "Resolvido", kind: "done", tone: "var(--pos)" },
  { key: "closed", label: "Fechado", kind: "done", tone: "var(--fg-4)" },
];
export const STATUS_BY_KEY = Object.fromEntries(TICKET_STATUSES.map((s) => [s.key, s]));
export const kindOf = (status) => STATUS_BY_KEY[status]?.kind || "open";
export const isDone = (t) => kindOf(t?.status) === "done";

export const TICKET_PRIORITIES = [
  { key: "urgent", label: "Urgente", tone: "var(--neg)" },
  { key: "high", label: "Alta", tone: "var(--warn)" },
  { key: "normal", label: "Normal", tone: "var(--fg-3)" },
  { key: "low", label: "Baixa", tone: "var(--fg-4)" },
];
export const PRIORITY_BY_KEY = Object.fromEntries(TICKET_PRIORITIES.map((p) => [p.key, p]));
export const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

// Categoria não tem cor salva: a cor sai do nome, na paleta das labels das
// Tarefas, então a mesma categoria tem sempre a mesma cor em todo card.
const LABEL_PALETTE = COLUMN_COLORS.filter(Boolean);
export function categoryColor(name) {
  const s = String(name || "");
  if (!s) return "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return LABEL_PALETTE[h % LABEL_PALETTE.length];
}

export const CHANNEL_LABEL = { internal: "aberto pela equipe", portal: "portal do cliente", whatsapp: "WhatsApp", email: "e-mail" };

// ── Escopo de suporte (espelho de support-scope.js) ─────────────────────────
// A API é quem decide; aqui é o menu e a tela não mentirem. Sem sessão de
// usuário (acesso por chave) = sem restrição.
export function supportScope(user = currentUser()) {
  if (!user) return null;
  const fresh = (user.id && userById(user.id)) || user;
  if ((fresh.roles || []).includes("admin")) return null;
  return Array.isArray(fresh.supportSaas) ? fresh.supportSaas : [];
}
// Por que a fila está fechada pra esta sessão, em texto que diz onde destravar.
export function noScopeHint(productName = "este produto", user = currentUser()) {
  const fresh = (user?.id && userById(user.id)) || user;
  const atendente = (fresh?.roles || []).includes("support");
  const lista = Array.isArray(fresh?.supportSaas) ? fresh.supportSaas : [];
  if (atendente && !lista.length) return `Sua etiqueta de Suporte está marcada, mas nenhum produto foi liberado. Quem gerencia a equipe inclui ${productName} em Ajustes → Equipe, na coluna "Atende (suporte)". Admin vê todos os produtos.`;
  return `O acesso à fila é por produto. Peça a quem gerencia a equipe para incluir ${productName} na sua lista em Ajustes → Equipe, coluna "Atende (suporte)".`;
}
export const handlesSaas =(saas, user) => { const s = supportScope(user); return s === null || s.includes(saas); };
// Atendente pode ser responsável por tickets do produto? (registro da API)
export const agentHandles = (agent, saas) => !!agent && (agent.admin || (agent.supportSaas || []).includes(saas));

// ── SLA ─────────────────────────────────────────────────────────────────────
const ms = (v) => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; };

function clockState({ start, due, warnFrom, doneAt, paused, breached, now }) {
  if (!due) return "none";
  const t = ms(now), d = ms(due), s = ms(start);
  if (doneAt) return breached || ms(doneAt) > d ? "breached" : "met";
  if (paused) return breached ? "breached" : "paused";
  if (breached || t > d) return "breached";
  if (warnFrom) return t >= ms(warnFrom) ? "warning" : "ok";
  return d - s > 0 && (t - s) / (d - s) >= 0.8 ? "warning" : "ok";
}
const RANK = { breached: 5, warning: 4, ok: 3, paused: 2, met: 1, none: 0 };

export function slaState(ticket, now = Date.now()) {
  const sla = ticket?.sla || {};
  const start = ticket?.createdAt;
  const firstResponse = sla.resolvedAt && !sla.firstResponseAt
    ? (sla.breached?.firstResponse ? "breached" : "none")
    : clockState({ start, due: sla.firstResponseDue, warnFrom: sla.firstResponseWarnAt, doneAt: sla.firstResponseAt, breached: !!sla.breached?.firstResponse, now });
  const resolution = clockState({ start, due: sla.resolutionDue, warnFrom: sla.resolutionWarnAt, doneAt: sla.resolvedAt, paused: !!sla.pausedAt, breached: !!sla.breached?.resolution, now });
  const overall = RANK[firstResponse] >= RANK[resolution] ? firstResponse : resolution;
  return { firstResponse, resolution, overall };
}

export const SLA_TONE = { breached: "var(--neg)", warning: "var(--warn)", ok: "var(--fg-3)", paused: "var(--fg-4)", met: "var(--pos)", none: "var(--fg-4)" };

// "vence em 2 h", "estourou há 3 d" — distância em palavras, nunca a data crua.
export function distance(msDiff) {
  const abs = Math.abs(msDiff);
  if (abs < 3_600_000) return `${Math.max(1, Math.round(abs / 60_000))} min`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} h`;
  const d = Math.round(abs / 86_400_000);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}

// O relógio que manda agora, em uma linha: é o que a fila e o card mostram.
export function slaLabel(ticket, now = Date.now()) {
  const st = slaState(ticket, now);
  const sla = ticket?.sla || {};
  if (isDone(ticket)) {
    if (st.resolution === "breached" || st.firstResponse === "breached") return { tone: SLA_TONE.breached, text: "resolvido fora do prazo", state: "breached" };
    return { tone: SLA_TONE.met, text: "resolvido no prazo", state: "met" };
  }
  if (sla.pausedAt) return { tone: SLA_TONE.paused, text: "SLA pausado", state: "paused" };
  const waitingFirst = !sla.firstResponseAt;
  const clock = waitingFirst ? "firstResponse" : "resolution";
  const due = waitingFirst ? sla.firstResponseDue : sla.resolutionDue;
  const state = st[clock];
  if (!due) return { tone: SLA_TONE.none, text: "sem SLA", state: "none" };
  const diff = ms(due) - ms(now);
  const what = waitingFirst ? "1ª resposta" : "resolução";
  if (state === "breached") return { tone: SLA_TONE.breached, text: `${what} estourou há ${distance(diff)}`, state };
  return { tone: SLA_TONE[state] || SLA_TONE.ok, text: `${what} em ${distance(diff)}`, state };
}

// Espera em dias ("há 3 dias"), com --warn até 4 e --neg a partir de 5.
export function waitingSince(iso, now = Date.now()) {
  if (!iso) return null;
  const days = Math.floor((ms(now) - ms(iso)) / 86_400_000);
  if (days <= 0) {
    const h = Math.floor((ms(now) - ms(iso)) / 3_600_000);
    return { text: h <= 0 ? "agora" : `há ${h} h`, tone: "var(--fg-3)", days: 0 };
  }
  return { text: `há ${days} ${days === 1 ? "dia" : "dias"}`, tone: days >= 5 ? "var(--neg)" : "var(--warn)", days };
}

// Link público do chamado, montado no NAVEGADOR (mesma régua das propostas):
// em produção o nginx serve /s/ na mesma origem do cockpit e no dev o Vite faz
// proxy. Perguntar a URL pra API devolvia o host interno do proxy.
export const portalUrl = (ticket) => (ticket?.portalToken
  ? `${import.meta.env?.VITE_API_BASE || (typeof location !== "undefined" ? location.origin : "")}/s/${ticket.portalToken}`
  : "");
export const ticketHash =(id) => `#tickets/${encodeURIComponent(id)}`;
export const ticketTitle = (t) => `#${t?.number || "?"} ${t?.subject || "(sem assunto)"}`;
export const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
