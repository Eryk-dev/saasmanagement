import React from "react";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { useData } from "../data.jsx";
import { api } from "../lib/api.js";
// Coluna de proposta do lead (reusada pelo Pipeline e pelo detalhe do lead).
// Para leads do SaaS do Levercopy (CONFIG.levercopy), oferece gerar/re-gerar a
// proposta dinâmica e abre os links (ver + editar). Demais leads mantêm o botão
// "contatar". O servidor decide a elegibilidade de fato.

const { useState } = React;

const accentBtnStyle = { ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" };
const linkBtnStyle = { ...accentBtnStyle, textDecoration: "none" };

function ProposalActions({ l }) {
  const { refresh } = useData();
  const cfg = window.SEED.CONFIG?.levercopy;
  const isLevercopy = !!cfg?.enabled && l.saas === cfg.saas;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

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

export { ProposalActions };
