import React from "react";
import { api } from "../lib/api.js";

// Setup da chamada de voz (M1): mostra se a chamada está habilitada no número e
// um botão pra habilitar sem terminal. NÃO é o botão de ligar (a voz vem no M2/M3);
// é só o interruptor da capacidade no número, direto pela API da Meta.
export function WaCallingSetup() {
  const configured = !!window.SEED?.CONFIG?.whatsapp?.configured;
  const [status, setStatus] = React.useState(null); // ENABLED | OFF | UNKNOWN | ...
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    if (!configured) return;
    let alive = true;
    api.waCallingStatus().then((r) => alive && setStatus(r.status)).catch(() => alive && setStatus("UNKNOWN"));
    return () => { alive = false; };
  }, [configured]);

  if (!configured || status === null) return null;
  const on = status === "ENABLED";

  async function enable() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api.waCallingEnable();
      setStatus(r.status || "ENABLED");
    } catch (e) {
      setErr(e?.message || "não foi possível habilitar");
    } finally { setBusy(false); }
  }

  if (on) {
    return (
      <span className="mono" title="A chamada está habilitada no número (o botão de ligar vem no próximo passo)."
        style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "var(--pos-soft, #e6f7ec)", color: "#127a3a", border: "1px solid #bfe6cc" }}>
        ✆ chamadas habilitadas
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {err && <span className="mono" title={err} style={{ fontSize: 10.5, color: "#e5484d", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{err}</span>}
      <button onClick={enable} disabled={busy} title="Liga a capacidade de chamada de voz no número (pré-requisito pra ligar pelo cockpit). Não é o botão de ligar ainda."
        style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 12px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", opacity: busy ? 0.6 : 1 }}>
        ✆ {busy ? "habilitando…" : "Habilitar chamadas"}
      </button>
    </span>
  );
}
