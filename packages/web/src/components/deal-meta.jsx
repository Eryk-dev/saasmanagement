// Comercial do Lever CRM (Fase 2) no card do Negócio, sem ocupar o corpo do
// card: uma linha no cabeçalho com o tipo de negócio, as tags e o caminho pro
// cliente e pra integração (quando o lead já vendeu), e as versões da proposta
// em uma linha junto dos botões de proposta. `createExtraDeal` abre, a partir
// do card do cliente, um negócio já ligado a ele (upsell, renovação, reativação).

import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { openCustomer, openLeadById, openOnboarding } from "../lib/open-record.js";
import { stageByKind, firstStage } from "../lib/funnel.js";
import { Popover } from "./popover.jsx";

export const DEAL_TYPES = [
  { value: "nova_venda", label: "Nova venda" },
  { value: "upsell", label: "Upsell" },
  { value: "renovacao", label: "Renovação" },
  { value: "reativacao", label: "Reativação" },
];
const dealLabel = (v) => DEAL_TYPES.find((d) => d.value === v)?.label || "Nova venda";
const STATUS_TONE = { aceita: "var(--pos)", expirada: "var(--neg)", aberta: "var(--accent)", enviada: "var(--fg-3)" };

const pill = {
  display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 9px", borderRadius: 999,
  background: "var(--bg-2)", border: 0, fontSize: 11.5, color: "var(--fg-2)", cursor: "pointer", whiteSpace: "nowrap",
};
const link = { ...pill, background: "transparent", padding: "0 2px", color: "var(--accent)", fontWeight: 600 };

// Tipo do negócio: a pílula abre a lista (Popover), sem select de formulário.
function DealTypePill({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return <>
    <button ref={ref} type="button" style={pill} onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} title="Tipo do negócio">
      {dealLabel(value)} <span aria-hidden="true" style={{ color: "var(--fg-4)" }}>▾</span>
    </button>
    {open && <Popover anchor={ref} onClose={() => setOpen(false)} width={180} align="start" label="Tipo do negócio">
      {DEAL_TYPES.map((d) => <button key={d.value} type="button" onClick={() => { setOpen(false); if (d.value !== value) onChange(d.value); }}
        style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, color: "var(--fg-2)", background: d.value === (value || "nova_venda") ? "var(--accent-soft)" : "transparent", border: 0, cursor: "pointer" }}>
        {d.label}
      </button>)}
    </Popover>}
  </>;
}

function TagsEditor({ tags, onChange }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const commit = () => {
    const t = text.trim();
    if (t) onChange([...tags, t]);
    setText("");
    setAdding(false);
  };
  return <>
    {tags.map((t) => <span key={t} style={{ ...pill, cursor: "default" }}>#{t}
      <button type="button" aria-label={`Tirar a tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} style={{ border: 0, background: "transparent", color: "var(--fg-4)", cursor: "pointer", padding: 0 }}>✕</button></span>)}
    {adding
      ? <input autoFocus className="inp" style={{ width: 110, height: 22, fontSize: 11.5, borderRadius: 999 }} placeholder="tag…" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setText(""); setAdding(false); } }} />
      : <button type="button" style={{ ...pill, background: "transparent", border: "1px dashed var(--line-2)", color: "var(--fg-3)" }} onClick={() => setAdding(true)}>+ tag</button>}
  </>;
}

// Cliente e integração do lead que já vendeu (o caminho de volta do card).
function useCustomerLinks(lead) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!lead?.customerId) { setState(null); return undefined; }
    let alive = true;
    Promise.all([api.get("customers", lead.customerId).catch(() => null), api.customerOnboardings(lead.customerId).catch(() => null)])
      .then(([customer, r]) => {
        if (!alive || !customer) return;
        const open = ((r && r.onboardings) || []).filter((o) => !["concluida", "cancelada"].includes(o.stage));
        setState({ customer, onboarding: open.find((o) => o.lead === lead.id) || open[0] || null });
      });
    return () => { alive = false; };
  }, [lead?.customerId, lead?.id]);
  return state;
}

// Quantas calls o lead já teve (registro de calls, crm/meetings.js).
function useCallCount(lead) {
  const [n, setN] = useState(null);
  useEffect(() => {
    let alive = true;
    api.leadMeetings(lead.id).then((r) => {
      if (!alive) return;
      const rows = (r && r.meetings) || [];
      setN({ done: rows.filter((m) => m.status === "realizada").length, noShow: rows.filter((m) => m.status === "no_show").length });
    }).catch(() => {});
    return () => { alive = false; };
  }, [lead.id, lead.callAt, lead.stage]);
  return n;
}

// A linha do cabeçalho do card do Negócio.
export function LeadCrmStrip({ lead, onPatch, onLeave }) {
  const links = useCustomerLinks(lead);
  const calls = useCallCount(lead);
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 }}>
    <DealTypePill value={lead.dealType} onChange={(v) => onPatch({ dealType: v })} />
    <TagsEditor tags={tags} onChange={(next) => onPatch({ tags: next })} />
    {calls && (calls.done + calls.noShow) > 0 && <span style={{ fontSize: 11.5, color: calls.noShow ? "var(--warn)" : "var(--fg-3)", marginLeft: 2 }}
      title="Calls de venda deste lead que já passaram">{calls.done} {calls.done === 1 ? "call feita" : "calls feitas"}{calls.noShow ? ` · ${calls.noShow} no-show` : ""}</span>}
    {links?.customer && <>
      <span aria-hidden="true" style={{ width: 1, height: 14, background: "var(--line-2)", margin: "0 4px" }} />
      <button type="button" style={link} onClick={() => { onLeave?.(); openCustomer(links.customer.id); }} title="Abrir o card do cliente">cliente: {links.customer.name} →</button>
      {links.onboarding && <button type="button" style={link} onClick={() => { onLeave?.(); openOnboarding(links.onboarding.id); }} title="Abrir o card da integração">
        integração {links.onboarding.progress ?? 0}% →</button>}
    </>}
  </div>;
}

// As versões da proposta, em uma linha (v1 expirada · v2 aberta).
export function ProposalVersionsLine({ lead }) {
  const [versions, setVersions] = useState(null);
  useEffect(() => {
    let alive = true;
    api.leadProposalVersions(lead.id).then((r) => alive && setVersions((r && r.proposals) || [])).catch(() => alive && setVersions([]));
    return () => { alive = false; };
  }, [lead.id, lead.proposta_id]);
  if (!versions || !versions.length) return null;
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10, fontSize: 11.5, color: "var(--fg-3)" }}>
    <span>propostas</span>
    {versions.map((v) => <span key={v.id} title={`criada ${new Date(v.createdAt).toLocaleDateString("pt-BR")}${v.validUntil ? ` · válida até ${v.validUntil}` : ""}${v.views ? ` · ${v.views} visualizações` : ""}`}>
      v{v.version} <b style={{ color: STATUS_TONE[v.status], fontWeight: 600 }}>{v.status}</b></span>)}
  </div>;
}

// Negócio novo a partir do cliente: lead ligado a ele, no funil do produto, na
// etapa de proposta (o cliente já é conhecido; não volta pro SDR).
export async function createExtraDeal(customer, type) {
  const product = (window.SEED?.SAAS || []).find((p) => p.id === customer.saas);
  const stage = stageByKind(product, "proposta") || stageByKind(product, "followup") || firstStage(product);
  const lead = await api.create("leads", {
    saas: customer.saas, name: customer.contact || customer.name, company: customer.name,
    email: customer.email || "", phone: customer.phone || "", customerId: customer.id, dealType: type,
    stage, closer: customer.owner || "", source: "Cliente",
  });
  openLeadById(lead.id);
  return lead;
}
