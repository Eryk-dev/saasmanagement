import React, { useEffect, useState } from "react";
import { activeProducts } from "../../../api/src/shared/contract-terms.js";
import { PLAN_PRODUCTS } from "../../../api/src/shared/plan-resources.js";
import { CYCLE_LABEL } from "../lib/payments.js";
import { api } from "../lib/api.js";
import "./customer-active-products.css";

// Produtos ativos do cliente com a vigência de cada um. Aparece no card do
// cliente (Clientes) e no card do lead em Integração/Pós-venda. A vigência é
// derivada, não gravada: ver shared/contract-terms.js.
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

function leftLabel(d) {
  if (d == null) return "";
  if (d < 0) return `venceu há ${-d} d`;
  if (d === 0) return "vence hoje";
  return d === 1 ? "falta 1 dia" : `faltam ${d} dias`;
}

export function CustomerActiveProducts({ customer, subs = [], invoices = [], plans = [], boxed = true }) {
  const rows = activeProducts({ customer, subs, invoices, plans });
  if (!rows.length) return null;
  const productLabel = (id) => PLAN_PRODUCTS.find((x) => x.id === id)?.label || "";
  return (
    <section className="active-products" data-boxed={boxed ? "1" : undefined} aria-label="Produtos ativos">
      <div className="active-products-kicker"><span>produtos ativos</span><b>{rows.length}</b></div>
      {rows.map((r) => (
        <div className="active-product" key={r.id}>
          <div>
            <strong>{r.name}</strong>
            <small>{[productLabel(r.product), CYCLE_LABEL[r.cycle]].filter(Boolean).join(" · ")}</small>
          </div>
          <div>
            <span data-tone={r.paid ? "pos" : "neg"}>{r.paid ? "em dia" : r.overdue ? `${r.overdue} em atraso` : "em atraso"}</span>
            <small>{r.end ? `${r.start ? `${day(r.start)} → ` : "até "}${day(r.end)}` : "vigência não informada"}</small>
            {r.end && <small data-warn={r.daysLeft != null && r.daysLeft <= 30 ? "1" : undefined}>{leftLabel(r.daysLeft)}</small>}
          </div>
        </div>
      ))}
    </section>
  );
}

// No card do LEAD: acha o cliente que nasceu desse lead (se já fechou) e mostra
// os produtos ativos dele. Sem cliente, não renderiza nada.
export function LeadActiveProducts({ lead }) {
  const [data, setData] = useState(null);
  const leadId = lead?.id;
  useEffect(() => {
    if (!leadId) return undefined;
    let alive = true;
    (async () => {
      const [customer] = (await api.list("customers", { lead: leadId })) || [];
      if (!customer || customer.leadId !== leadId) { if (alive) setData(null); return; }
      const [subs, invoices, plans] = await Promise.all([
        api.list("subscriptions", { customer: customer.id }),
        api.list("invoices", { customer: customer.id }),
        api.list("plans", { saas: customer.saas }),
      ]);
      if (alive) setData({ customer, subs: subs || [], invoices: invoices || [], plans: plans || [] });
    })().catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [leadId]);
  return data ? <CustomerActiveProducts {...data} /> : null;
}
