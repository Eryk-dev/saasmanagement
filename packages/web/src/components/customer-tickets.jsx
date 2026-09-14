import React from "react";
import { api } from "../lib/api.js";
import { SecondaryButton } from "../atoms.jsx";
import { canSeeScreen } from "../lib/users.js";
import { STATUS_BY_KEY, handlesSaas, isDone, slaLabel, ticketHash } from "../lib/tickets.js";
import { NewTicketModal } from "../screens/tickets/new-ticket.jsx";

const { useState, useEffect } = React;

// Tickets do cliente na ficha (aba Histórico): o que ele pediu ao suporte, com
// status e SLA, e o atalho pra abrir um ticket já vinculado. Só aparece pra
// quem tem a tela Tickets E atende o produto do cliente — a API recusaria.
export function CustomerTickets({ customer }) {
  const visible = !!customer?.id && canSeeScreen("tickets") && handlesSaas(customer.saas);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    let vivo = true;
    setItems(null);
    api.tickets({ saas: customer.saas, customerId: customer.id })
      .then((r) => { if (vivo) { setItems(r || []); setError(""); } })
      .catch((err) => { if (vivo) { setItems([]); setError(err.message || "erro"); } });
    return () => { vivo = false; };
  }, [visible, customer?.id, customer?.saas]);

  if (!visible) return null;
  const open = (items || []).filter((t) => !isDone(t));
  const go = (id) => { location.hash = ticketHash(id).slice(1); };

  return (
    <section style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px 8px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Tickets de suporte</h3>
          <div className="card-sub" style={{ marginTop: 3 }}>
            {items === null ? "carregando…" : items.length ? `${open.length} ${open.length === 1 ? "aberto" : "abertos"} · ${items.length} no total` : "nenhum pedido de suporte"}
          </div>
        </div>
        <SecondaryButton size="sm" onClick={() => setCreating(true)}>+ Abrir ticket</SecondaryButton>
      </div>
      {error && <div style={{ padding: "0 16px 12px", fontSize: 12.5, color: "var(--warn)" }}>Não deu pra carregar os tickets ({error}).</div>}
      {(items || []).slice(0, 8).map((t) => {
        const st = STATUS_BY_KEY[t.status] || STATUS_BY_KEY.new;
        const sla = slaLabel(t);
        return (
          <button key={t.id} type="button" onClick={() => go(t.id)} className="tk-row"
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 16px", borderTop: "1px solid var(--line-1)", textAlign: "left", fontSize: 13 }}>
            <span className="mono tnum" style={{ color: "var(--fg-4)", fontSize: 12 }}>#{t.number}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{t.subject}</span>
            <span className="hide-mobile" style={{ fontSize: 12, color: sla.tone, whiteSpace: "nowrap" }}>{sla.text}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-2)", whiteSpace: "nowrap" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: st.tone }} />{st.label}
            </span>
          </button>
        );
      })}
      {(items || []).length > 8 && (
        <button type="button" onClick={() => { location.hash = "tickets"; }} style={{ padding: "8px 16px 12px", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>+{items.length - 8} na fila de tickets</button>
      )}
      {creating && (
        <NewTicketModal saasId={customer.saas} initial={{ customerId: customer.id }} onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); go(t.id); }} />
      )}
    </section>
  );
}
