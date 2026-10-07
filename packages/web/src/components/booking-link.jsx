import React from "react";
import { userById, displayName } from "../lib/users.js";
import { waLink } from "../lib/ui.js";
import { bookingInviteText } from "../lib/wa-copy.js";

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
export function bookingShareUrl(userId, saas, what = "integracao") {
  const base = import.meta.env?.VITE_API_BASE || (typeof window !== "undefined" && window.location?.origin) || "";
  const q = new URLSearchParams({ ...(saas ? { s: saas } : {}), t: what });
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
  const text = bookingInviteText(lead, name, bookingShareUrl(userId, lead?.saas));
  const wa = waLink(lead?.phone);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { window.prompt("Mensagem:", text); }
  }
  return (
    <div role="group" aria-label={`Link de convite de ${name}`}
      style={{ padding: "10px 12px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-2)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, color: "var(--fg-2)" }}>
        Link de convite de <strong>{name}</strong>: o cliente vê os horários livres e marca sozinho
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={copy} style={btn}>{copied ? "copiado ✓" : "copiar mensagem"}</button>
        {wa && <a href={`${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" style={btn}>enviar no WhatsApp</a>}
        <a href={url} target="_blank" rel="noopener noreferrer" style={btn}>abrir agenda ↗</a>
      </div>
    </div>
  );
}
