import React from "react";
import { Modal } from "../../components/overlay.jsx";
import { CustomerSupportHistory } from "../../components/customer-tickets.jsx";
import { isDone, hermesHolding, fold, waitingSince } from "../../lib/tickets.js";

const { useMemo } = React;

// Aba Clientes da fila (27/10/2026): os clientes do produto que têm ticket,
// com o resumo do suporte de cada um; o clique abre o histórico da EMPRESA
// (CustomerSupportHistory, que junta os produtos da mesma org pela API). Conta
// só ticket VINCULADO ao cliente (customerId), o mesmo que o histórico mostra;
// os sem vínculo aparecem num aviso no fim.
export const CUSTOMERS_GRID = "minmax(220px,2fr) minmax(80px,.6fr) minmax(70px,.5fr) minmax(100px,.7fr) minmax(180px,1.4fr) minmax(130px,1fr)";
export const CUSTOMERS_GRID_GAP = 12;
export const CUSTOMERS_GRID_BUDGET = 900;

const breached = (t) => !!(t.sla?.breached?.resolution || t.sla?.breached?.firstResponse);

export function customerRows(tickets, customers = []) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const rows = new Map();
  let unlinked = 0;
  for (const t of tickets) {
    if (!t.customerId) { unlinked++; continue; }
    const r = rows.get(t.customerId) || { id: t.customerId, customer: byId.get(t.customerId) || null, tickets: [] };
    r.tickets.push(t);
    rows.set(t.customerId, r);
  }
  const list = [...rows.values()].map((r) => {
    const sorted = [...r.tickets].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const cats = {};
    for (const t of r.tickets) if (t.category) cats[t.category] = (cats[t.category] || 0) + 1;
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return {
      ...r,
      name: r.customer?.name || sorted[0]?.requester?.name || "Cliente",
      total: r.tickets.length,
      open: r.tickets.filter((t) => !isDone(t)).length,
      breached: r.tickets.filter(breached).length,
      hermes: r.tickets.filter(hermesHolding).length,
      last: sorted[0] || null,
      topCategory: top ? { name: top[0], count: top[1] } : null,
    };
  });
  list.sort((a, b) => (b.open - a.open) || String(b.last?.createdAt || "").localeCompare(String(a.last?.createdAt || "")));
  return { rows: list, unlinked };
}

export function TicketsCustomers({ tickets, q = "", now, openCustomer, onOpenCustomer, onCloseCustomer, initialHistory }) {
  const customers = window.SEED?.CUSTOMERS || [];
  const { rows, unlinked } = useMemo(() => customerRows(tickets, customers), [tickets, customers]);
  const needle = fold(q).trim();
  const shown = needle ? rows.filter((r) => fold(r.name).includes(needle) || fold(r.customer?.contact).includes(needle)) : rows;
  const selected = openCustomer ? rows.find((r) => r.id === openCustomer) : null;
  const target = selected?.customer || (selected ? { id: selected.id, name: selected.name, saas: selected.last?.saas || "" } : null);

  return (
    <div className="support-list">
      {rows.length === 0 ? (
        <p className="mono dim" style={{ fontSize: 12, padding: "14px var(--pad-x) 0", margin: 0 }}>Nenhum ticket vinculado a cliente ainda.</p>
      ) : shown.length === 0 ? (
        <p className="mono dim" style={{ fontSize: 12, padding: "14px var(--pad-x) 0", margin: 0 }}>{`Nenhum cliente com "${q.trim()}".`}</p>
      ) : (
        <div className="tbl-x" style={{ border: 0, borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)" }}>
          <div style={{ minWidth: CUSTOMERS_GRID_BUDGET }}>
            <div className="kicker" style={{ display: "grid", gridTemplateColumns: CUSTOMERS_GRID, gap: CUSTOMERS_GRID_GAP, padding: "11px 18px", background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }}>
              <span>Cliente</span><span>Em aberto</span><span>Total</span><span>SLA estourado</span><span>Último pedido</span><span>Do que mais pedem</span>
            </div>
            {shown.map((r) => {
              const when = r.last ? waitingSince(r.last.createdAt, now) : null;
              return (
                <div key={r.id} role="button" tabIndex={0} className="support-row" aria-current={openCustomer === r.id ? "true" : undefined}
                  style={{ gridTemplateColumns: CUSTOMERS_GRID, gap: CUSTOMERS_GRID_GAP }} title={`Histórico de suporte de ${r.name}`}
                  onClick={() => onOpenCustomer(r.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpenCustomer(r.id); } }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="support-ellipsis" style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="support-ellipsis" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
                      {[r.customer?.contact, r.hermes ? `${r.hermes} com o Hermes` : ""].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <span className="tnum" style={{ fontSize: 13, fontWeight: r.open ? 700 : 400, color: r.open ? "var(--warn)" : "var(--fg-4)" }}>{r.open}</span>
                  <span className="tnum" style={{ fontSize: 13, color: "var(--fg-2)" }}>{r.total}</span>
                  <span className="tnum" style={{ fontSize: 13, fontWeight: r.breached ? 700 : 400, color: r.breached ? "var(--neg)" : "var(--fg-4)" }}>{r.breached}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="support-ellipsis" style={{ fontSize: 12.5 }}>{r.last?.subject || "—"}</div>
                    <div className="mono support-ellipsis" style={{ fontSize: 11, color: "var(--fg-4)" }}>{when?.text || ""}</div>
                  </div>
                  <span className="support-ellipsis" style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                    {r.topCategory ? `${r.topCategory.name} · ${r.topCategory.count}` : <span style={{ color: "var(--fg-4)" }}>sem categoria</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {unlinked > 0 && (
        <p style={{ fontSize: 12, color: "var(--fg-3)", padding: "10px 4px 0", margin: 0 }}>
          {`${unlinked} ${unlinked === 1 ? "ticket ainda não tem" : "tickets ainda não têm"} cliente vinculado e não ${unlinked === 1 ? "entra" : "entram"} aqui. Vincule pelo nome do cliente no card do ticket.`}
        </p>
      )}
      {target && (
        <Modal onClose={onCloseCustomer} label={`Histórico de suporte · ${target.name}`} largura={1000} padding={20}
          painelStyle={{ maxHeight: "min(92dvh, 100%)", display: "flex", flexDirection: "column" }}>
          <div className="tickets-customer-head">
            <h2>{`Histórico de suporte · ${target.name}`}</h2>
            <button type="button" aria-label="Fechar histórico" onClick={onCloseCustomer}>✕</button>
          </div>
          <div style={{ padding: "16px 24px 24px", overflowY: "auto", minHeight: 0 }}>
            <CustomerSupportHistory customer={target} onLeave={onCloseCustomer} initial={initialHistory} />
          </div>
        </Modal>
      )}
    </div>
  );
}
