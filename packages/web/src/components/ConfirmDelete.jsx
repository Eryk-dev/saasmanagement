import React from "react";
import { ENTITIES } from "../lib/entities.js";
import { api } from "../lib/api.js";
// Small centered confirm overlay for destructive deletes.

const { useState } = React;

function ConfirmDelete({ entityKey, record, onClose, onDeleted }) {
  const cfg = ENTITIES[entityKey];
  const name = (record && record[cfg.titleField]) || record?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setBusy(true); setError(null);
    try {
      await api.remove(cfg.collection, record.id);
      await onDeleted(); // App closes + refreshes (this component unmounts)
    } catch (err) {
      setBusy(false);
      setError(err.message || String(err));
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(380px, calc(100vw - 32px))", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: "20px 22px" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Excluir {cfg.singular.toLowerCase()}?</div>
        <div className="mono dim" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          <span style={{ color: "var(--fg-1)" }}>{name}</span> será removido. Esta ação não pode ser desfeita.
        </div>
        {error && <div className="mono" style={{ fontSize: 11, color: "var(--neg)", marginTop: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
          <button onClick={confirm} disabled={busy} style={{ padding: "8px 14px", background: "var(--neg)", color: "white", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>{busy ? "Excluindo…" : "Excluir"}</button>
        </div>
      </div>
    </div>
  );
}

export { ConfirmDelete };
