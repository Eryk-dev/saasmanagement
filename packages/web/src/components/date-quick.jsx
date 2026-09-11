import React from "react";
import { Popover } from "./popover.jsx";
import { todayYmd, addDays } from "../lib/tasks.js";
// Data rápida (popover): atalhos Hoje / Amanhã / Próxima semana + o campo de
// data nativo. Devolve "YYYY-MM-DD" ("" = sem data) e fecha.

const { useEffect, useRef } = React;

const nextMonday = (t) => { const dow = new Date(t + "T12:00:00Z").getUTCDay(); return addDays(t, dow === 0 ? 1 : 8 - dow); };
const nextFriday = (t) => { const dow = new Date(t + "T12:00:00Z").getUTCDay(); return addDays(t, dow < 5 ? 5 - dow : 12 - dow); };

export function quickDates(today = todayYmd()) {
  return [
    { label: "Hoje", value: today },
    { label: "Amanhã", value: addDays(today, 1) },
    { label: "Sexta", value: nextFriday(today) },
    { label: "Próxima semana", value: nextMonday(today) },
  ];
}

export function DateQuick({ anchor, value, onChange, onClose, title = "Prazo", allowClear = true, min }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const pick = (v) => { onChange(v); onClose && onClose(); };
  const chip = (on) => ({ height: 28, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"), background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)" });
  return (
    <Popover anchor={anchor} onClose={onClose} width={280} title={title}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {quickDates().map((q) => <button key={q.label} onClick={() => pick(q.value)} style={chip(value === q.value)}>{q.label}</button>)}
        {allowClear && value && <button onClick={() => pick("")} style={{ ...chip(false), color: "var(--fg-3)" }}>Limpar</button>}
      </div>
      <input ref={ref} type="date" className="inp" value={value || ""} min={min || undefined}
        onChange={(e) => { const v = e.target.value; if (v) pick(v); }}
        style={{ width: "100%", boxSizing: "border-box" }} />
    </Popover>
  );
}
