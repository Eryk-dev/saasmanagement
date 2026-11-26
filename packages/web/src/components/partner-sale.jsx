import React from "react";
import { SwitchRow } from "./form-controls.jsx";
import { SelectPopover } from "./select-popover.jsx";
import { isPartnerSaleLead, partnersOf, partnerLabel } from "../lib/funnel.js";

// Venda de parceiro (26/11/2026): a Segunda Venda também vende o LeverPrice, e
// o negócio pode ter um VENDEDOR EXTERNO no lugar do closer. Ligado, pede o
// parceiro (lista de Ajustes do produto → Parceiros de venda) e o nome do
// vendedor, e o fechamento deixa de exigir closer. A venda entra no caixa e
// vira cliente e integração normais, mas fica fora da meta, do placar e da
// remuneração (isPartnerSaleLead na API). Usado no gate de fechamento
// (stage-move.jsx) e em "A venda" do Próximo passo (today.jsx).

// Estado inicial a partir do lead (o que já está gravado volta ligado).
export function partnerStateOf(lead, saasCfg) {
  const on = isPartnerSaleLead(lead);
  const opts = partnersOf(saasCfg);
  return {
    on,
    partner: on ? String(lead.partner) : (opts.length === 1 ? opts[0].id : ""),
    seller: on ? String(lead.partnerSeller || "") : "",
  };
}

// O controle aparece quando o produto tem parceiro cadastrado ou o lead já é
// venda de parceiro (opção que saiu da lista continua visível pra desligar).
export const partnerFieldVisible = (saasCfg, lead) => partnersOf(saasCfg).length > 0 || isPartnerSaleLead(lead);

// Pronto pra gravar: desligado sempre; ligado, com parceiro e vendedor.
export const partnerReady = (st) => !st?.on || (!!st.partner && !!String(st.seller || "").trim());

// O que vai no PATCH do lead (desligado limpa os dois campos).
export const partnerPatchOf = (st) => (st?.on
  ? { partner: st.partner, partnerSeller: String(st.seller || "").trim() }
  : { partner: "", partnerSeller: "" });

const LABEL = { display: "block", marginBottom: 4 };

export function PartnerSaleField({ saasCfg, lead, value, onChange, labelStyle = LABEL, fieldStyle, idPrefix = "partner" }) {
  if (!partnerFieldVisible(saasCfg, lead)) return null;
  const st = value || partnerStateOf(lead, saasCfg);
  const set = (patch) => onChange({ ...st, ...patch });
  const opts = partnersOf(saasCfg).map((p) => ({ value: p.id, label: p.label }));
  // Parceiro gravado que saiu da lista ainda aparece como opção (não some do lead).
  if (st.partner && !opts.some((o) => o.value === st.partner)) opts.push({ value: st.partner, label: partnerLabel(saasCfg, st.partner) });
  const sellerId = `${idPrefix}-seller-${lead?.id || "novo"}`;
  return (
    <div className="partner-sale" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SwitchRow checked={st.on} onChange={(on) => set({ on })} title="Venda de parceiro"
        hint={st.on
          ? "vendedor externo no lugar do closer · entra no caixa e vira cliente normal, mas fica fora da meta, do placar e da remuneração"
          : "ligue quando quem vendeu foi um parceiro (ex.: Segunda Venda), não o time"} />
      {st.on && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <div role="group" aria-label="Parceiro">
            <div className="kicker" style={labelStyle}>Parceiro *</div>
            <SelectPopover label="Parceiro" placeholder="escolher o parceiro…" value={st.partner} options={opts}
              onChange={(v) => set({ partner: v })} />
          </div>
          <div>
            <label className="kicker" style={labelStyle} htmlFor={sellerId}>Nome do vendedor *</label>
            <input id={sellerId} type="text" autoComplete="off" maxLength={120} value={st.seller}
              placeholder="quem vendeu pelo parceiro" onChange={(e) => set({ seller: e.target.value })} style={fieldStyle} />
          </div>
        </div>
      )}
    </div>
  );
}
