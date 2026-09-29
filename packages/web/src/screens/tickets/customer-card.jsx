import React from "react";
import { Popover } from "../../components/popover.jsx";
import { SecondaryButton } from "../../atoms.jsx";
import { displayName, canSeeScreen } from "../../lib/users.js";
import { isChurned } from "../../lib/churn.js";
import { isDone, fold } from "../../lib/tickets.js";

// Cartão do cliente vinculado ao ticket: abre no nome do card do Kanban, com o
// essencial do cadastro sem sair da fila. A ficha completa (cobranças,
// marcos, histórico) continua em Clientes — "Abrir ficha" leva até ela.

export const OPEN_CUSTOMER_KEY = "cockpit_customers_open";
// Cliente do ticket: o vínculo gravado (customerId) ou, sem ele, o cadastro do
// mesmo produto que bate com o solicitante — e-mail, telefone (últimos 10
// dígitos, a régua do portal) ou nome igual ao da empresa/contato. Ticket da
// equipe e do WhatsApp costuma nascer sem vínculo. Nome só vale se for único.
// `via` diz como foi achado ("" = vinculado).
const digits = (v) => String(v || "").replace(/\D/g, "");
export function customerOf(t) {
  const all = window.SEED?.CUSTOMERS || [];
  if (t?.customerId) {
    const c = all.find((x) => x.id === t.customerId);
    return c ? { customer: c, via: "" } : null;
  }
  const same = all.filter((c) => c.saas === t?.saas);
  if (!same.length) return null;
  const email = fold(t.requester?.email).trim();
  if (email) { const c = same.find((x) => fold(x.email).trim() === email); if (c) return { customer: c, via: "e-mail" }; }
  const phone = digits(t.requester?.phone);
  if (phone.length >= 10) { const c = same.find((x) => digits(x.phone).slice(-10) === phone.slice(-10)); if (c) return { customer: c, via: "telefone" }; }
  const name = fold(t.requester?.name || t.customerName).trim();
  if (name) {
    const hits = same.filter((x) => fold(x.name).trim() === name || fold(x.contact).trim() === name);
    if (hits.length === 1) return { customer: hits[0], via: "nome" };
  }
  return null;
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

export function CustomerCard({ customer, via, ticket, anchor, tickets, onLink, onClose }) {
  const mine = (tickets || []).filter((t) => t.customerId === customer.id);
  const open = mine.filter((t) => !isDone(t)).length;
  const churned = isChurned(customer);
  const facts = [
    ["Contato", customer.contact],
    ["E-mail", customer.email],
    ["Telefone", customer.phone],
    ["Plano", customer.plan],
    ["MRR", customer.arr ? `${window.fmt?.moneyFull(customer.arr / 12) ?? customer.arr / 12} /mês` : ""],
    ["Cliente desde", fmtDate(customer.startedAt)],
    ["Dono da conta", customer.owner ? displayName(customer.owner) : "sem dono"],
    ["Tickets", mine.length ? `${open} ${open === 1 ? "aberto" : "abertos"} · ${mine.length} no total` : ""],
  ].filter(([, v]) => v);
  const openFile = () => {
    try { sessionStorage.setItem(OPEN_CUSTOMER_KEY, customer.id); } catch { /* ignore */ }
    onClose();
    location.hash = "customers";
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={300} label={`Cliente · ${customer.name}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="support-ellipsis" style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>{customer.name}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{via ? `reconhecido pelo ${via} · ticket sem vínculo` : "cliente vinculado ao ticket"}</div>
          </div>
          {churned && <span className="chip neg" style={{ fontSize: 11, minHeight: 0 }}>encerrado</span>}
        </div>
        <dl style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: "7px 14px", margin: 0, fontSize: 12.5 }}>
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt style={{ color: "var(--fg-3)" }}>{k}</dt>
              <dd className="support-ellipsis" style={{ margin: 0, color: "var(--fg-1)", textAlign: "right" }} title={v}>{v}</dd>
            </React.Fragment>
          ))}
        </dl>
        {via && onLink && <SecondaryButton onClick={() => { onLink(ticket.id, customer); onClose(); }} style={{ width: "100%", justifyContent: "center" }}>Vincular ao ticket #{ticket.number}</SecondaryButton>}
        {canSeeScreen("customers") && <SecondaryButton onClick={openFile} style={{ width: "100%", justifyContent: "center" }}>Abrir ficha em Clientes</SecondaryButton>}
      </div>
    </Popover>
  );
}
