// Timeline única (Lever CRM, Fase 1.2): o MESMO componente no card do Cliente,
// do Negócio e da Integração. Lê GET /api/customers/:id/timeline ou
// /api/leads/:id/timeline, que juntam no servidor os eventos dos produtos, os
// toques do lead, o histórico de plano e a atividade dos tickets.

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { displayName } from "../lib/users.js";

const ORIGIN = { evento: "produto", atividade: "toque", plano: "plano", ticket: "suporte" };
const LIFECYCLE = { integracao: "integração", ativo: "ativo", risco: "em risco", churn: "churn" };
const FINANCIAL = { aguardando_pagamento: "aguardando pagamento", adimplente: "adimplente", inadimplente: "inadimplente" };
const STAGE = { aguardando_kickoff: "aguardando kickoff", kickoff: "kickoff", configuracao: "configuração", treinamento: "treinamento", go_live: "go-live", concluida: "concluída", cancelada: "cancelada" };
const PLAN = { start: "Plano iniciado", upsell: "Upsell", churn: "Churn", reactivation: "Reativação", canceled: "Assinatura cancelada", paused: "Assinatura pausada", scheduled: "Troca de plano agendada" };

const fromTo = (map, d) => `${map[d?.from] || d?.from || "—"} → ${map[d?.to] || d?.to || "—"}`;

export function timelineTitle(item) {
  const d = item.data || {};
  switch (item.kind) {
    case "customer.lifecycle_changed": return `Estágio de vida: ${fromTo(LIFECYCLE, d)}`;
    case "customer.financial_status_changed": return `Financeiro: ${fromTo(FINANCIAL, d)}`;
    case "onboarding.created": return "Integração aberta";
    case "onboarding.stage_changed": return `Integração: ${fromTo(STAGE, d)}`;
    case "workspace.created": return "Conta criada no produto";
    case "user.signed_up": return "Cadastro no LeverId";
    default: break;
  }
  if (item.origin === "plano") return PLAN[item.kind] || `Plano · ${item.kind}`;
  if (item.origin === "ticket") return `Ticket · ${item.kind}`;
  return item.text || item.kind;
}

const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export function RecordTimeline({ customerId = "", leadId = "", limit = 8 }) {
  const [state, setState] = useState({ loading: true, items: [], error: "" });
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    const load = customerId ? api.customerTimeline(customerId) : api.leadTimeline(leadId);
    load.then((r) => alive && setState({ loading: false, items: (r && r.items) || [], error: "" }))
      .catch((e) => alive && setState({ loading: false, items: [], error: e.message || "não foi possível carregar" }));
    return () => { alive = false; };
  }, [customerId, leadId]);
  if (state.loading) return <p className="customer-peek-note mono dim">carregando…</p>;
  if (state.error) return <p className="customer-peek-note" role="alert">{state.error}</p>;
  if (!state.items.length) return <p className="customer-peek-note">Nada na linha do tempo ainda.</p>;
  const shown = all ? state.items : state.items.slice(0, limit);
  return <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
    {shown.map((item) => <div key={item.id} className="customer-peek-fact" style={{ alignItems: "flex-start" }}>
      <span className="tnum">{fmt(item.at)}</span>
      <strong style={{ fontWeight: 500, textAlign: "left" }}>
        {timelineTitle(item)}
        <em style={{ display: "block", fontStyle: "normal", fontSize: 11, color: "var(--fg-4)" }}>
          {[ORIGIN[item.origin] || item.origin, item.author && item.author !== "system" ? displayName(item.author) : ""].filter(Boolean).join(" · ")}
        </em>
      </strong>
    </div>)}
    {state.items.length > limit && <button type="button" className="customer-peek-link" style={{ marginTop: 8, textAlign: "left" }} onClick={() => setAll(!all)}>
      {all ? "mostrar menos" : `+${state.items.length - limit} na linha do tempo`}
    </button>}
  </div>;
}
