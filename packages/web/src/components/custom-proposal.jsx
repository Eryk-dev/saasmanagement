import React from "react";
import { api } from "../lib/api.js";
import { cockpitProposalUrl } from "../lib/ui.js";

// Proposta PERSONALIZADA (objetiva) — pra cliente que fechou solução sob medida
// numa conversa. O closer não monta o deck inteiro: escreve o COMBINADO
// (entregáveis) e o VALOR, e sai capa + "o combinado" no MESMO layout da
// apresentação (o tema vem do template publicado). Duas telas, nada de escada
// de ofertas nem reveal — é objetiva, já está fechado.

const { useState, useEffect } = React;

const CYCLES = [
  ["avista", "à vista"],
  ["mensal", "por mês"],
  ["parcelado", "parcelado"],
];

const field = { height: 34, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, width: "100%", minWidth: 0 };
const label = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 5 };
const ghost = { height: 32, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const primary = { ...ghost, border: "1px solid var(--accent)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))" };

export function CustomProposalModal({ lead, onClose, onSaved }) {
  const [spec, setSpec] = useState({ title: "Proposta personalizada", subtitle: "", deliverables: [""], price: "", cycle: "avista", priceCaption: "" });
  const [url, setUrl] = useState(lead.customProposalUrl || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  // Reabrir carrega a spec já gravada (a proposta guarda os campos do form).
  useEffect(() => {
    if (!lead.customProposalId) return;
    let alive = true;
    api.get("proposals", lead.customProposalId).then((p) => {
      if (alive && p?.spec) setSpec((s) => ({ ...s, ...p.spec, deliverables: p.spec.deliverables?.length ? p.spec.deliverables : [""] }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [lead.customProposalId]);

  const set = (k, v) => setSpec((s) => ({ ...s, [k]: v }));
  const setDeliv = (i, v) => setSpec((s) => ({ ...s, deliverables: s.deliverables.map((d, j) => (j === i ? v : d)) }));
  const addDeliv = () => setSpec((s) => ({ ...s, deliverables: [...s.deliverables, ""] }));
  const rmDeliv = (i) => setSpec((s) => ({ ...s, deliverables: s.deliverables.filter((_, j) => j !== i).length ? s.deliverables.filter((_, j) => j !== i) : [""] }));

  const clean = () => ({ ...spec, deliverables: spec.deliverables.map((d) => d.trim()).filter(Boolean) });

  async function preview() {
    setBusy(true); setMsg(null);
    try {
      const { html } = await api.customProposal(lead.id, { ...clean(), preview: true });
      const w = window.open("", "_blank");
      if (w) { w.document.open(); w.document.write(html); w.document.close(); }
      else setMsg({ ok: false, text: "o navegador bloqueou a aba de preview — libere o pop-up" });
    } catch (e) { setMsg({ ok: false, text: e.message || "não deu pra pré-visualizar" }); }
    setBusy(false);
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.customProposal(lead.id, clean());
      setUrl(r.url);
      setMsg({ ok: true, text: "proposta salva · link pronto pra mandar" });
      onSaved && onSaved(r);
    } catch (e) { setMsg({ ok: false, text: e.message || "não deu pra salvar" }); }
    setBusy(false);
  }

  const canSave = spec.title.trim() && spec.deliverables.some((d) => d.trim());

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 95, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", maxHeight: "calc(100vh - 40px)", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600 }}>Proposta personalizada</div>
          <span className="dim" style={{ fontSize: 12 }}>· {lead.name || "cliente"}</span>
          <button onClick={onClose} className="mono dim" style={{ marginLeft: "auto", fontSize: 15 }}>✕</button>
        </div>
        <div className="dim" style={{ fontSize: 12, marginTop: -6 }}>capa + o combinado (entregáveis e valor), no layout da sua apresentação.</div>

        {/* Capa */}
        <div>
          <span style={label}>Título da capa</span>
          <input value={spec.title} onChange={(e) => set("title", e.target.value)} style={field} placeholder="Proposta personalizada" />
        </div>
        <div>
          <span style={label}>Subtítulo <span style={{ textTransform: "none", letterSpacing: 0 }}>(opcional)</span></span>
          <input value={spec.subtitle} onChange={(e) => set("subtitle", e.target.value)} style={field} placeholder="Solução sob medida pra sua operação" />
        </div>

        {/* O combinado */}
        <div>
          <span style={label}>O que foi combinado</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {spec.deliverables.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="mono dim" style={{ fontSize: 12, flexShrink: 0 }}>•</span>
                <input value={d} onChange={(e) => setDeliv(i, e.target.value)} style={field}
                  placeholder="ex.: setup + acompanhamento dos 3 primeiros meses"
                  onKeyDown={(e) => { if (e.key === "Enter" && d.trim() && i === spec.deliverables.length - 1) addDeliv(); }} />
                <button onClick={() => rmDeliv(i)} title="remover" className="mono dim" style={{ fontSize: 13, flexShrink: 0, width: 24 }}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={addDeliv} style={{ ...ghost, height: 28, marginTop: 6, fontSize: 12 }}>+ entregável</button>
        </div>

        {/* Valor */}
        <div>
          <span style={label}>Valor</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
              <input value={spec.price} onChange={(e) => set("price", e.target.value.replace(/[^\d.]/g, ""))} inputMode="numeric"
                style={{ ...field, width: 130, textAlign: "right", fontFamily: "var(--mono)" }} placeholder="6.000" />
            </div>
            <select value={spec.cycle} onChange={(e) => set("cycle", e.target.value)} style={{ ...field, width: "auto" }}>
              {CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="dim" style={{ fontSize: 11.5, flex: 1, minWidth: 120 }}>deixe em branco pra proposta só de escopo</span>
          </div>
        </div>

        {msg && <div className="mono" style={{ fontSize: 11.5, color: msg.ok ? "var(--pos)" : "var(--neg)" }}>{msg.text}</div>}

        {url && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", borderRadius: "var(--r-2)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
            <a href={cockpitProposalUrl(url)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12.5, textDecoration: "none" }}>ver como cliente ↗</a>
            <button onClick={() => { navigator.clipboard?.writeText(url); setMsg({ ok: true, text: "link copiado" }); }} style={{ ...ghost, height: 28, fontSize: 12 }}>copiar link</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          <button onClick={preview} disabled={busy || !canSave} style={{ ...ghost, opacity: busy || !canSave ? 0.55 : 1 }}>pré-visualizar</button>
          <button onClick={save} disabled={busy || !canSave} style={{ ...primary, flex: 1, opacity: busy || !canSave ? 0.55 : 1 }}>
            {busy ? "salvando…" : url ? "salvar alterações" : "gerar proposta"}
          </button>
        </div>
      </div>
    </div>
  );
}
