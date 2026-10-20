// Blocos do Lever CRM no card do Cliente (Fases 1.3 a 1B): estágio de vida e
// status financeiro, os negócios (leads) do cliente com o caminho de volta pro
// card do Negócio, e os contatos com papel. Mesmo desenho do customer-peek.

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { openCustomer, openLeadById, openOnboarding } from "../lib/open-record.js";
import { displayName } from "../lib/users.js";
import { NewDealButton } from "./deal-meta.jsx";
// O desenho de gaveta do card do cliente: estes blocos também abrem fora da
// tela de Clientes (card do Negócio, card da Integração).
import "../screens/customers.css";

export const LIFECYCLE = {
  integracao: { label: "em integração", tone: "mut" },
  ativo: { label: "ativo", tone: "pos" },
  risco: { label: "em risco", tone: "neg" },
  churn: { label: "churn", tone: "neg" },
};
export const FINANCIAL = {
  aguardando_pagamento: { label: "aguardando 1º pagamento", tone: "mut" },
  adimplente: { label: "adimplente", tone: "pos" },
  inadimplente: { label: "inadimplente", tone: "neg" },
};
const ROLE = { decisor: "decisor", financeiro: "financeiro", usuario: "usuário", ponto_focal: "ponto focal" };

// Os dois estados na mesma linha, no desenho de estado do customer-peek.
export function CustomerStateChips({ customer }) {
  const life = LIFECYCLE[customer?.lifecycle];
  const fin = FINANCIAL[customer?.financialStatus];
  if (!life && !fin) return null;
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
    {life && <span className="customer-peek-state" style={{ marginLeft: 0 }} data-tone={life.tone} title="Estágio de vida do cliente">{life.label}</span>}
    {fin && <span className="customer-peek-state" style={{ marginLeft: 0 }} data-tone={fin.tone} title="Status financeiro (não corta acesso)">{fin.label}</span>}
  </div>;
}

// Negócios do cliente: o que gerou a venda e os que vieram depois (upsell,
// renovação). Cada um abre o card do Negócio.
export function CustomerDeals({ customer, onLeave }) {
  const leads = (window.SEED?.LEADS || []).filter((l) => l.id === customer.leadId || l.customerId === customer.id);
  return <section>
    <div className="customer-peek-kicker"><span>negócios</span><b>{leads.length}</b></div>
    {leads.map((l) => <div key={l.id} className="customer-peek-fact">
      <span>{l.id === customer.leadId ? "venda de origem" : ({ upsell: "upsell", renovacao: "renovação", reativacao: "reativação" })[l.dealType] || "negócio"}</span>
      <strong><button type="button" className="customer-peek-link" onClick={() => { onLeave?.(); openLeadById(l.id); }}>{l.stage || "—"}{l.closer ? ` · ${displayName(l.closer)}` : ""} →</button></strong>
    </div>)}
    {!leads.length && <p className="customer-peek-note">Nenhum negócio ligado a este cliente.</p>}
    <NewDealButton customer={customer} onLeave={onLeave} />
  </section>;
}

// Contatos com papel (perfil do cliente). Só leitura aqui; a edição é pela
// rota de contatos.
export function CustomerContacts({ customer }) {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    let alive = true;
    api.customerProfile(customer.id).then((p) => alive && setProfile(p)).catch(() => alive && setProfile({ contacts: [], company: {} }));
    return () => { alive = false; };
  }, [customer.id, customer.lifecycle, customer.financialStatus]);
  if (!profile) return null;
  const { company = {}, contacts = [] } = profile;
  if (!contacts.length && !company.cnpj) return null;
  return <section>
    <div className="customer-peek-kicker"><span>empresa e contatos</span></div>
    {company.cnpj && <div className="customer-peek-fact"><span>{company.legalName || "Razão social"}</span><strong className="tnum">{company.cnpj}</strong></div>}
    {company.domain && <div className="customer-peek-fact"><span>Domínio</span><strong>{company.domain}</strong></div>}
    {contacts.map((c) => <div key={c.email || c.phone || c.name} className="customer-peek-fact">
      <span>{[ROLE[c.role] || (c.primary ? "principal" : "contato"), c.leverId ? "LeverId" : ""].filter(Boolean).join(" · ")}</span>
      <strong>{c.name || c.email}{c.email && c.name ? <em style={{ display: "block", fontStyle: "normal", fontSize: 11, fontWeight: 400, color: "var(--fg-4)" }}>{c.email}</em> : null}</strong>
    </div>)}
  </section>;
}

// No card do Negócio (lead que já vendeu): o cliente que nasceu dele, com o
// estado, e a integração em andamento — cada um abre o próprio card. É o
// caminho de volta que faltava (Fase 1B): antes o lead não levava ao cliente.
export function LeadCustomerBar({ lead, onLeave }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!lead?.customerId) return undefined;
    let alive = true;
    Promise.all([api.get("customers", lead.customerId).catch(() => null), api.customerOnboardings(lead.customerId).catch(() => ({ onboardings: [] }))])
      .then(([customer, r]) => alive && setState({ customer, onboardings: r.onboardings || [] }));
    return () => { alive = false; };
  }, [lead?.customerId]);
  if (!lead?.customerId || !state?.customer) return null;
  const { customer, onboardings } = state;
  const current = onboardings.find((o) => o.lead === lead.id && !["concluida", "cancelada"].includes(o.stage))
    || onboardings.find((o) => !["concluida", "cancelada"].includes(o.stage));
  return <section className="lead-section">
    <div className="lead-section-heading"><h3>Cliente</h3>
      <button type="button" className="customer-peek-link" onClick={() => { onLeave?.(); openCustomer(customer.id); }}>abrir cliente →</button></div>
    <div style={{ fontSize: 13, fontWeight: 600 }}>{customer.name}</div>
    <CustomerStateChips customer={customer} />
    {current && <div className="customer-peek-fact" style={{ marginTop: 8 }}>
      <span>Integração · {current.progress ?? 0}%</span>
      <strong><button type="button" className="customer-peek-link" onClick={() => { onLeave?.(); openOnboarding(current.id); }}>abrir integração →</button></strong>
    </div>}
  </section>;
}
