import React from "react";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { RowActions } from "../atoms.jsx";
import { useData } from "../data.jsx";
import { api } from "../lib/api.js";
// SDR worklist — prioritized leads queue. Persona home for the SDR.

const { useState: useStL } = React;

const accentBtnStyle = { ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" };
const linkBtnStyle = { ...accentBtnStyle, textDecoration: "none" };

function LeadsScreen({ persona }) {
  const { LEADS } = window.SEED;
  const { openForm, openDelete } = useData();
  const [pri, setPri] = useStL("all");
  const filtered = LEADS.filter(l => pri === "all" || l.priority === pri).sort((a,b) => b.score - a.score);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[["all","Todos"],["P0","P0 · hoje"],["P1","P1 · esta semana"],["P2","P2 · backlog"]].map(([k,l]) => (
            <button key={k} onClick={() => setPri(k)} style={{
              height: 26, padding: "0 10px", borderRadius: "var(--r-2)",
              border: "1px solid " + (pri === k ? "var(--line-strong)" : "var(--line-1)"),
              background: pri === k ? "var(--bg-3)" : "var(--bg-2)",
              color: pri === k ? "var(--fg-1)" : "var(--fg-3)",
              fontSize: 12, fontFamily: "var(--mono)",
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="mono dim" style={{ fontSize: 11 }}>fila round-robin · {filtered.length} leads</span>
          <button onClick={() => openForm("leads")} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}><span style={{ fontSize: 11 }}>+ novo lead</span></button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {filtered.map((l, i) => <LeadCard key={l.id} l={l} idx={i} top={i === 0} onEdit={() => openForm("leads", l)} onDelete={() => openDelete("leads", l)} />)}
      </div>
    </div>
  );
}

function LeadCard({ l, idx, top, onEdit, onDelete }) {
  const { SAAS } = window.SEED;
  const saas = SAAS.find(s => s.id === l.saas);
  const saasTone = saas ? window.productTone(saas) : "var(--fg-4)";
  const priTone = l.priority === "P0" ? "var(--neg)" : l.priority === "P1" ? "var(--warn)" : "var(--fg-3)";
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "32px 200px 1.4fr 80px 100px 100px 180px",
      padding: "14px 24px",
      borderBottom: "1px solid var(--line-1)",
      background: top ? "linear-gradient(90deg, oklch(0.72 0.18 33 / 0.04), transparent)" : "transparent",
      alignItems: "center",
      gap: 12,
    }}>
      <span className="mono tnum dim" style={{ fontSize: 11 }}>{String(idx+1).padStart(2,"0")}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{l.name}</div>
        <div className="mono dim" style={{ fontSize: 10 }}>{l.company} · {l.value}</div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: "var(--fg-2)" }}>{l.reason}</div>
        <div className="mono dim" style={{ fontSize: 10, marginTop: 3 }}>{l.source}</div>
      </div>
      <span className="mono" style={{ fontSize: 11, color: priTone, fontWeight: 500 }}>{l.priority}</span>
      <div>
        <div className="mono tnum" style={{ fontSize: 14 }}>{l.score}</div>
        <div className="mono dim" style={{ fontSize: 9 }}>ICP {(l.icp*100).toFixed(0)}%</div>
      </div>
      <div className="mono dim tnum" style={{ fontSize: 11 }}>há {l.age}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <ProposalActions l={l} />
        <RowActions onEdit={onEdit} onDelete={onDelete} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: 1, background: saasTone }} />
          <span className="mono dim" style={{ fontSize: 10 }}>{saas?.name || l.saas}</span>
        </span>
      </div>
    </div>
  );
}

// Coluna de proposta do lead. Para leads do SaaS do Levercopy (CONFIG.levercopy),
// oferece gerar/re-gerar a proposta dinâmica e abre os links (ver + editar). Demais
// leads mantêm o botão "contatar". O servidor decide a elegibilidade de fato.
function ProposalActions({ l }) {
  const { refresh } = useData();
  const cfg = window.SEED.CONFIG?.levercopy;
  const isLevercopy = !!cfg?.enabled && l.saas === cfg.saas;
  const [busy, setBusy] = useStL(false);
  const [err, setErr] = useStL(false);

  async function gen(force) {
    setBusy(true); setErr(false);
    try {
      const r = await api.generateProposal(l.id, force ? { force: true } : {});
      // Falha (fail-open: 200 com ok:false). Nada mudou no servidor, então NÃO
      // damos refresh — o refresh remonta a tela (key=dataVersion) e apagaria o
      // estado de erro. Mantemos err/busy locais pra mostrar "não gerada" + retry.
      if (!r || r.ok === false) { setErr(true); setBusy(false); return; }
      await refresh(); // sucesso: recarrega o SEED; o card remonta já com as URLs
    } catch { setErr(true); setBusy(false); }
  }

  if (l.proposalUrl) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <a href={l.proposalUrl} target="_blank" rel="noreferrer" style={linkBtnStyle}><span style={{ fontSize: 11 }}>proposta ↗</span></a>
        {l.proposal_edit_url && <a href={l.proposal_edit_url} target="_blank" rel="noreferrer" style={{ ...chromeBtnStyleSmall, textDecoration: "none" }}><span style={{ fontSize: 11 }}>editar ↗</span></a>}
        {isLevercopy && <button onClick={() => gen(true)} disabled={busy} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>{busy ? "…" : "re-gerar"}</span></button>}
        {isLevercopy && err && <span className="mono" style={{ fontSize: 9, color: "var(--neg)" }}>re-geração falhou</span>}
      </span>
    );
  }
  if (isLevercopy) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button onClick={() => gen(false)} disabled={busy} style={accentBtnStyle}><span style={{ fontSize: 11 }}>{busy ? "gerando…" : err ? "tentar de novo" : "gerar proposta"}</span></button>
        {err && <span className="mono" style={{ fontSize: 9, color: "var(--neg)" }}>proposta não gerada</span>}
      </span>
    );
  }
  return <button style={accentBtnStyle}><span style={{ fontSize: 11 }}>contatar</span></button>;
}

export { LeadsScreen };
