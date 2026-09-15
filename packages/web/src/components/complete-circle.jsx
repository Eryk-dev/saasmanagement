import React from "react";

const { useState } = React;

// Círculo de concluir dos cards (Tarefas, Tickets): 22px com área de toque
// 44px e o "pop" ao marcar. Não abre o card nem começa arrasto.
export function CompleteCircle({ done, onToggle, size = 22, title, doneTitle = "Reabrir", undoneTitle = "Marcar como concluída" }) {
  const [pop, setPop] = useState(false);
  const label = title || (done ? doneTitle : undoneTitle);
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={done}
      onClick={(e) => { e.stopPropagation(); setPop(true); setTimeout(() => setPop(false), 260); onToggle(!done); }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
      style={{ width: size + 12, height: size + 12, margin: -6, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "transparent" }}>
      <span className={pop ? "tk-pop" : ""} style={{
        width: size, height: size, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: `1.5px solid ${done ? "var(--pos)" : "var(--line-strong)"}`, background: done ? "var(--pos)" : "transparent", color: done ? "#fff" : "var(--fg-4)",
        transition: "background .15s, border-color .15s",
      }}>
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: done ? 1 : 0.55 }}>
          <path d="M5 12.5l4.2 4.2L19 7.5" />
        </svg>
      </span>
    </button>
  );
}
