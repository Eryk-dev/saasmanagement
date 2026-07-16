import React from "react";
import { api } from "../lib/api.js";

// UniqueKids · bloco de "Sugestão de solução" no roteiro da call. A Ana gera por
// IA (método R.O.T.I.N.A, a partir do desafio + exemplo do lead) e edita à
// vontade. Persiste em lead.sugestaoSolucao pelo patch do drawer.
export function RoutineSuggestion({ lead, patch }) {
  const [text, setText] = React.useState(lead.sugestaoSolucao || "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const aiOn = !!window.SEED?.CONFIG?.ai?.configured;

  // troca de lead → recarrega o texto salvo daquele lead
  React.useEffect(() => { setText(lead.sugestaoSolucao || ""); }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api.routineSuggestion(lead.id);
      const s = r.sugestao || "";
      setText(s);
      patch({ sugestaoSolucao: s });
    } catch (e) {
      setErr(e?.message || "não deu pra gerar a sugestão");
    } finally { setBusy(false); }
  }
  function save() {
    if (text !== (lead.sugestaoSolucao || "")) patch({ sugestaoSolucao: text });
  }

  return (
    <div style={box}>
      <div className="mono" style={{ ...kicker, display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ flex: 1 }}>Sugestão de solução · método R.O.T.I.N.A</span>
        <button onClick={generate} disabled={busy || !aiOn}
          title={aiOn ? "Gera a partir do desafio e do exemplo preenchidos no lead" : "IA não configurada no servidor"}
          style={{ height: 24, padding: "0 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            border: "1px solid var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)", opacity: busy || !aiOn ? 0.55 : 1 }}>
          {busy ? "gerando…" : (text ? "↻ Regenerar" : "✦ Gerar sugestão")}
        </button>
      </div>
      {err && <div style={{ fontSize: 11, color: "#e5484d", marginBottom: 6 }}>{err}</div>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        rows={5}
        placeholder={aiOn ? "clique em Gerar pra criar a sugestão a partir do desafio, ou escreva a sua" : "escreva a sugestão de solução (IA indisponível)"}
        style={{ width: "100%", padding: "9px 11px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5, lineHeight: 1.5, resize: "vertical", minHeight: 90 }}
      />
      <div className="mono dim" style={{ fontSize: 10, marginTop: 5 }}>editável, ajuste como precisar antes da call</div>
    </div>
  );
}

const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px", background: "var(--bg-inset)" };
const kicker = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
