import { stageKind } from "./funnel.js";

// "há 5 min" / "há 2h" / "há 3 dias" desde o envio do link.
export function sentAgo(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60000));
  return min < 60 ? `há ${min} min` : min < 48 * 60 ? `há ${Math.round(min / 60)}h` : `há ${Math.round(min / 1440)} dias`;
}

// ── Ligar à mão a marcação sem card (07/10/2026) ────────────────────────────
// O cliente marcou pelo link de convite e a rotina não achou o card (link do
// Google mandado direto, e-mail/telefone diferentes). O aviso do sino abre a
// janela de escolha: sem busca, os cards em Integração/Pós-venda de quem
// recebeu a marcação (os que estão "aguardando o cliente marcar" primeiro).
// Com busca (15/10/2026), qualquer card do cockpit: o cliente que marcou nem
// sempre já está na entrega (card ainda em Ganho, na venda, ou com outro
// integrador). Ligar um desses passa o card pra quem recebeu a marcação e o
// move pra Integração (`move`), pelo mesmo PATCH de etapa da tela.
const deliveryKinds = new Set(["integracao", "posvenda"]);
const MAX_SEARCH = 30;

function statusOf(l, now) {
  const at = l.integrationAt ? new Date(l.integrationAt) : null;
  if (at && Number.isFinite(at.getTime()) && at.getTime() > now) {
    return { rank: 2, text: `integração ${at.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` };
  }
  if (l.integrationLinkSentAt) return { rank: 0, text: `link enviado ${sentAgo(l.integrationLinkSentAt, now)} · aguardando marcar` };
  return { rank: 1, text: "sem horário marcado" };
}

export function bookingCandidates(leads, saasList, userId, query = "", now = Date.now()) {
  const q = String(query || "").trim().toLowerCase();
  const cfg = (id) => (saasList || []).find((s) => s.id === id);
  const inDelivery = (l) => deliveryKinds.has(stageKind(cfg(l.saas), l.stage));
  const mine = (l) => inDelivery(l) && (!l.integrator || l.integrator === userId);
  const hits = (l) => [l.name, l.company, l.email, l.phone].some((v) => String(v || "").toLowerCase().includes(q));
  const rows = (leads || [])
    .filter((l) => (q ? hits(l) : mine(l)))
    .map((l) => ({
      l,
      st: statusOf(l, now),
      move: !inDelivery(l),
      otherIntegrator: l.integrator && l.integrator !== userId ? l.integrator : "",
    }))
    // Os da entrega de quem recebeu a marcação vêm antes dos de fora.
    .sort((a, b) => Number(!mine(a.l)) - Number(!mine(b.l)) || a.st.rank - b.st.rank || String(a.l.name || "").localeCompare(String(b.l.name || "")));
  return q ? rows.slice(0, MAX_SEARCH) : rows;
}
