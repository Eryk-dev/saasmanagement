import React from "react";
import { userById, displayName } from "../lib/users.js";
import { stageByKind } from "../lib/funnel.js";
import { bookingCandidates, sentAgo } from "../lib/booking-candidates.js";
import { Modal } from "./overlay.jsx";
import { waLink } from "../lib/ui.js";
import { bookingInviteText } from "../lib/wa-copy.js";
import { api } from "../lib/api.js";

export { bookingCandidates, sentAgo };

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

// Janela do aviso do sino: ligar à mão a marcação sem card (regra da lista em
// lib/booking-candidates.js).
export function BookingLinkModal({ eventId, userId, text = "", onClose }) {
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const rows = bookingCandidates(window.SEED?.LEADS, window.SEED?.SAAS, userId, query);
  // Card fora da entrega: liga PRIMEIRO (a ligação já passa o card pra quem
  // recebeu a marcação; se a marcação foi cancelada ou é de outro card, nada se
  // move) e só então move pra Integração pelo PATCH de etapa, o mesmo do funil
  // (histórico, fechamento, cliente e briefing de passagem).
  async function link({ l: lead, move }) {
    if (busy) return;
    setBusy(lead.id); setError("");
    try {
      await api.linkBooking(eventId, { user: userId, leadId: lead.id });
    } catch (err) {
      setError(err.message || "Não foi possível ligar a marcação");
      setBusy("");
      return;
    }
    const cfg = (window.SEED?.SAAS || []).find((s) => s.id === lead.saas);
    const to = move ? stageByKind(cfg, "integracao") : "";
    if (to) {
      try {
        await api.update("leads", lead.id, { stage: to, stageSince: new Date().toISOString() });
      } catch {
        window.toast?.(`Marcação ligada ao card de ${lead.name || "cliente"}, mas o card não foi pra ${to} · mova pelo funil`, "warn");
        onClose();
        return;
      }
    }
    window.toast?.(`Marcação ligada ao card de ${lead.name || "cliente"}${to ? ` e o card foi pra ${to}` : ""}`, "pos");
    onClose();
  }
  // O que acontece com o card ao ligar, na linha de cada um.
  const rowText = ({ l, st, move, otherIntegrator }) => [
    move ? `${l.stage || "sem etapa"} → vai pra Integração` : st.text,
    otherIntegrator ? `integra: ${displayName(otherIntegrator) || otherIntegrator} → passa pra ${displayName(userId) || "quem recebeu"}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <Modal onClose={onClose} fechavel={!busy} label="ligar marcação a um card" largura={480} padding={16} painelStyle={{ padding: 18 }}>
      <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>Ligar a marcação a um card</div>
      {text && <div className="mono" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>{text}</div>}
      <input className="inp" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar por nome, empresa, e-mail ou telefone…"
        aria-label="Buscar card" autoFocus style={{ width: "100%", marginTop: 12, borderRadius: 999, padding: "0 12px" }} />
      <div role="list" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, maxHeight: "min(50dvh, 420px)", overflowY: "auto" }}>
        {rows.length === 0 && <div className="mono dim" style={{ fontSize: 12, padding: "10px 2px" }}>{query ? "nenhum card com essa busca" : `nenhum card em Integração de ${displayName(userId) || "quem integra"} · busque o cliente pelo nome, e-mail ou telefone`}</div>}
        {rows.map((row) => { const { l, st } = row; return (
          <div key={l.id} role="listitem" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--line-1)", borderRadius: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name || "cliente"}{l.company ? <span style={{ fontWeight: 400, color: "var(--fg-3)" }}> · {l.company}</span> : null}</div>
              <div className="mono" style={{ fontSize: 10.5, color: st.rank === 0 && !row.move ? "var(--warn)" : "var(--fg-3)", marginTop: 2 }}>{rowText(row)}</div>
            </div>
            <button type="button" onClick={() => link(row)} disabled={!!busy} aria-label={`Ligar a ${l.name || "cliente"}`}
              style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", border: 0, fontWeight: 600 }}>
              {busy === l.id ? "ligando…" : "ligar"}
            </button>
          </div>
        ); })}
      </div>
      {error && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: "var(--neg)" }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" onClick={onClose} disabled={!!busy} style={btn}>fechar</button>
      </div>
    </Modal>
  );
}
