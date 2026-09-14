import React from "react";
import { Modal } from "../../components/overlay.jsx";
import { SHORTCUTS } from "./shortcuts.js";
import { Icon } from "./icons.jsx";

// Modal "?" com os atalhos, agrupados.
export function ShortcutsHelp({ onClose }) {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <Modal onClose={onClose} label="Atalhos de teclado" largura={720} padding={12}
      painelStyle={{ padding: "18px 22px 22px" }}>
      <div data-tk-layer="1">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span className="card-title">Atalhos de teclado</span>
          <span className="dim" style={{ fontSize: 12 }}>funcionam com o quadro em foco, fora de campos de texto</span>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ marginLeft: "auto", width: 32, height: 32, borderRadius: "var(--r-2)", color: "var(--fg-3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={16} /></button>
        </div>
        <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: "6px 28px" }}>
          {groups.map((g) => (
            <div key={g} style={{ marginBottom: 10 }}>
              <div className="kicker accent" style={{ marginBottom: 6 }}>{g}</div>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5 }}>
                  <span style={{ flex: 1, color: "var(--fg-2)" }}>{s.label}</span>
                  <span style={{ display: "inline-flex", gap: 4 }}>{s.keys.map((k, i) => <span key={i} className="kbd">{k}</span>)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
