// Comercial do Lever CRM (Fase 2) no card do Negócio: tipo de negócio (nova
// venda, upsell, renovação, reativação), tags do time e as versões da proposta
// com o estado de cada uma. E o "Novo negócio" do card do cliente, que abre um
// lead já ligado a ele (upsell, renovação, reativação) no funil do produto.

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { openLeadById } from "../lib/open-record.js";
import { stageByKind, firstStage } from "../lib/funnel.js";
import { SelectPopover } from "./select-popover.jsx";
import { toast } from "../atoms.jsx";

export const DEAL_TYPES = [
  { value: "nova_venda", label: "Nova venda" },
  { value: "upsell", label: "Upsell" },
  { value: "renovacao", label: "Renovação" },
  { value: "reativacao", label: "Reativação" },
];
const STATUS_TONE = { aceita: "var(--pos)", expirada: "var(--neg)", aberta: "var(--accent)", enviada: "var(--fg-3)" };
const chip = { display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 9px", borderRadius: 999, background: "var(--bg-2)", fontSize: 11.5, color: "var(--fg-2)" };

export function LeadDealMeta({ lead, onPatch }) {
  const [tag, setTag] = useState("");
  const [versions, setVersions] = useState(null);
  useEffect(() => {
    let alive = true;
    api.leadProposalVersions(lead.id).then((r) => alive && setVersions(r.proposals || [])).catch(() => alive && setVersions([]));
    return () => { alive = false; };
  }, [lead.id, lead.proposta_id]);
  const tags = Array.isArray(lead.tags) ? lead.tags : [];
  const addTag = () => {
    const t = tag.trim();
    if (!t) return;
    onPatch({ tags: [...tags, t] });
    setTag("");
  };
  return <section className="lead-section">
    <div className="lead-section-heading"><h3>Negócio</h3></div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="mono dim" style={{ fontSize: 11, width: 104, flexShrink: 0 }}>Tipo</span>
      <div style={{ flex: 1, minWidth: 0 }}><SelectPopover size="sm" value={lead.dealType || "nova_venda"} options={DEAL_TYPES} onChange={(v) => onPatch({ dealType: v })} label="Tipo de negócio" /></div>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      <span className="mono dim" style={{ fontSize: 11, width: 104, flexShrink: 0 }}>Tags</span>
      {tags.map((t) => <span key={t} style={chip}>#{t}
        <button type="button" aria-label={`Tirar a tag ${t}`} onClick={() => onPatch({ tags: tags.filter((x) => x !== t) })} style={{ color: "var(--fg-4)" }}>✕</button></span>)}
      <input className="inp" style={{ width: 120, height: 24 }} placeholder="nova tag…" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTag(); }} onBlur={addTag} />
    </div>
    {versions && versions.length > 0 && <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8 }}>
      <span className="mono dim" style={{ fontSize: 11, width: 104, flexShrink: 0 }}>Propostas</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[...versions].reverse().map((v) => <span key={v.id} style={chip} title={`criada ${new Date(v.createdAt).toLocaleDateString("pt-BR")}${v.validUntil ? ` · válida até ${v.validUntil}` : ""}${v.views ? ` · ${v.views} visualizações` : ""}`}>
          v{v.version} <b style={{ color: STATUS_TONE[v.status], fontWeight: 600 }}>{v.status}</b></span>)}
      </div>
    </div>}
  </section>;
}

// "Novo negócio" no card do cliente: lead ligado ao cliente, no funil do
// produto, na etapa de proposta (cliente já é conhecido; não volta pro SDR).
export function NewDealButton({ customer, onLeave }) {
  const [type, setType] = useState("upsell");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const product = (window.SEED?.SAAS || []).find((p) => p.id === customer.saas);
      const stage = stageByKind(product, "proposta") || stageByKind(product, "followup") || firstStage(product);
      const lead = await api.create("leads", {
        saas: customer.saas, name: customer.contact || customer.name, company: customer.name,
        email: customer.email || "", phone: customer.phone || "", customerId: customer.id, dealType: type,
        stage, closer: customer.owner || "", source: "Cliente",
      });
      onLeave?.();
      openLeadById(lead.id);
    } catch (e) {
      toast(`${e.message || "Não foi possível abrir o negócio"} · tente de novo`, "neg");
    } finally {
      setBusy(false);
    }
  }
  return <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
    <div style={{ flex: 1, minWidth: 0 }}><SelectPopover size="sm" value={type} options={DEAL_TYPES.filter((d) => d.value !== "nova_venda")} onChange={setType} label="Tipo do novo negócio" /></div>
    <button type="button" className="customer-peek-link" onClick={create} disabled={busy}>{busy ? "abrindo…" : "novo negócio"}</button>
  </div>;
}
