import React from "react";
import { userById, displayName } from "../lib/users.js";
import { stageKind } from "../lib/funnel.js";
import { Modal } from "./overlay.jsx";
import { waLink } from "../lib/ui.js";
import { bookingInviteText } from "../lib/wa-copy.js";
import { api } from "../lib/api.js";

// Link de convite da agenda de quem vai atender (07/10/2026): cada pessoa
// cadastra o seu em Configurações → Integrações (users.bookingUrl), e aqui ele
// vira os botões de mandar ao lead — o cliente abre, vê os horários livres e
// marca sozinho. Aparece ao escolher o integrador no gate de mover pra
// Integração e no próximo passo "Integração" de Minhas atividades. Copiar e
// mandar no Whats levam a mesma mensagem formatada (bookingInviteText).

// Na mensagem vai o link curto do cockpit (/a/:id, auth/booking-page.js): o
// do Google abre no WhatsApp com o preview fixo em inglês; o nosso mostra
// "Agende sua integração com Eryk · LeverAds" e redireciona pra mesma agenda.
// O "abrir agenda" (conferência de quem opera) segue indo direto ao Google.
// ?l= card do lead: quando o cliente clica e marca, a marcação cai no card certo
// sozinha (google/booking-sync.js no servidor).
export function bookingShareUrl(userId, saas, what = "integracao", leadId = "") {
  const base = import.meta.env?.VITE_API_BASE || (typeof window !== "undefined" && window.location?.origin) || "";
  const q = new URLSearchParams({ ...(saas ? { s: saas } : {}), t: what, ...(leadId ? { l: leadId } : {}) });
  return `${base}/a/${encodeURIComponent(userId)}?${q}`;
}

// "há 5 min" / "há 2h" / "há 3 dias" desde o envio do link.
export function sentAgo(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60000));
  return min < 60 ? `há ${min} min` : min < 48 * 60 ? `há ${Math.round(min / 60)}h` : `há ${Math.round(min / 1440)} dias`;
}

const btn = {
  height: 28, padding: "0 12px", borderRadius: 999, border: "1px solid var(--line-1)",
  background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12, display: "inline-flex",
  alignItems: "center", textDecoration: "none", cursor: "pointer",
};

export function BookingLinkActions({ lead, userId }) {
  const [copied, setCopied] = React.useState(false);
  const url = userById(userId)?.bookingUrl || "";
  const name = displayName(userId) || "quem vai atender";
  if (!userId) return null;
  if (!url) {
    return (
      <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
        {name} ainda não cadastrou o link de convite da agenda (Configurações → Integrações → Minha conta Google)
      </div>
    );
  }
  const text = bookingInviteText(lead, name, bookingShareUrl(userId, lead?.saas, "integracao", lead?.id));
  const wa = waLink(lead?.phone);
  // Link enviado (copiado ou aberto no WhatsApp): o card fica "aguardando o
  // cliente marcar" e a grade avisa antes de alguém marcar outro horário por
  // cima. A rotina do servidor limpa quando a marcação chega.
  const markSent = () => {
    if (!lead?.id) return;
    api.update("leads", lead.id, { integrationLinkSentAt: new Date().toISOString(), integrationLinkUser: userId }).catch(() => { /* só o aviso */ });
  };
  async function copy() {
    markSent();
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("Mensagem:", text); }
  }
  return (
    <div role="group" aria-label={`Link de convite de ${name}`}
      style={{ padding: "10px 12px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-2)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, color: "var(--fg-2)" }}>
        Link de convite de <strong>{name}</strong>: o cliente vê os horários livres e marca sozinho
      </div>
      {lead?.integrationLinkSentAt && lead.integrationLinkUser === userId && (
        <div className="mono" style={{ fontSize: 10.5, color: "var(--warn)" }}>
          link enviado {sentAgo(lead.integrationLinkSentAt)} · aguardando o cliente marcar (a marcação cai no card sozinha)
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={copy} style={btn}>{copied ? "copiado ✓" : "copiar mensagem"}</button>
        {wa && <a href={`${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" style={btn} onClick={markSent}>enviar no WhatsApp</a>}
        <a href={url} target="_blank" rel="noopener noreferrer" style={btn}>abrir agenda ↗</a>
      </div>
    </div>
  );
}

// ── Ligar à mão a marcação sem card (07/10/2026) ────────────────────────────
// O cliente marcou pelo link de convite e a rotina não achou o card (link do
// Google mandado direto, e-mail/telefone diferentes). O aviso do sino abre esta
// janela: os cards em Integração/Pós-venda de quem recebeu a marcação (os que
// estão "aguardando o cliente marcar" primeiro) e um clique liga, com a sala da
// marcação, sem esbarrar na trava de horário da grade.
const deliveryKinds = new Set(["integracao", "posvenda"]);
function statusOf(l, now = Date.now()) {
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
  return (leads || [])
    .filter((l) => deliveryKinds.has(stageKind(cfg(l.saas), l.stage)) && (!l.integrator || l.integrator === userId))
    .filter((l) => !q || [l.name, l.company, l.email, l.phone].some((v) => String(v || "").toLowerCase().includes(q)))
    .map((l) => ({ l, st: statusOf(l, now) }))
    .sort((a, b) => a.st.rank - b.st.rank || String(a.l.name || "").localeCompare(String(b.l.name || "")));
}

export function BookingLinkModal({ eventId, userId, text = "", onClose }) {
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const rows = bookingCandidates(window.SEED?.LEADS, window.SEED?.SAAS, userId, query);
  async function link(lead) {
    if (busy) return;
    setBusy(lead.id); setError("");
    try {
      await api.linkBooking(eventId, { user: userId, leadId: lead.id });
      window.toast?.(`Marcação ligada ao card de ${lead.name || "cliente"}`, "pos");
      onClose();
    } catch (err) {
      setError(err.message || "Não foi possível ligar a marcação");
      setBusy("");
    }
  }
  return (
    <Modal onClose={onClose} fechavel={!busy} label="ligar marcação a um card" largura={480} padding={16} painelStyle={{ padding: 18 }}>
      <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>Ligar a marcação a um card</div>
      {text && <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>{text}</div>}
      <input className="inp" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar por nome, empresa, e-mail ou telefone…"
        aria-label="Buscar card" autoFocus style={{ width: "100%", marginTop: 12, borderRadius: 999, padding: "0 12px" }} />
      <div role="list" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, maxHeight: "min(50dvh, 420px)", overflowY: "auto" }}>
        {rows.length === 0 && <div className="mono dim" style={{ fontSize: 12, padding: "10px 2px" }}>nenhum card em Integração de {displayName(userId) || "quem integra"}{query ? " com essa busca" : ""}</div>}
        {rows.map(({ l, st }) => (
          <div key={l.id} role="listitem" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--line-1)", borderRadius: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name || "cliente"}{l.company ? <span style={{ fontWeight: 400, color: "var(--fg-3)" }}> · {l.company}</span> : null}</div>
              <div className="mono" style={{ fontSize: 10.5, color: st.rank === 0 ? "var(--warn)" : "var(--fg-3)", marginTop: 2 }}>{st.text}</div>
            </div>
            <button type="button" onClick={() => link(l)} disabled={!!busy} aria-label={`Ligar a ${l.name || "cliente"}`}
              style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", border: 0, fontWeight: 600 }}>
              {busy === l.id ? "ligando…" : "ligar"}
            </button>
          </div>
        ))}
      </div>
      {error && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: "var(--neg)" }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" onClick={onClose} disabled={!!busy} style={btn}>fechar</button>
      </div>
    </Modal>
  );
}
