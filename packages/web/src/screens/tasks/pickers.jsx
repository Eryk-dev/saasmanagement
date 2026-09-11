import React from "react";
import { Popover } from "../../components/popover.jsx";
import { COLUMN_COLORS, fmtDue } from "../../lib/tasks.js";

// Repetir: nunca / diariamente / semanalmente (com dias) / mensalmente, a cada
// N, até uma data. O servidor cria a próxima ocorrência ao concluir.
const WD = ["D", "S", "T", "Q", "Q", "S", "S"];
export function RecurrencePicker({ value, onChange, dueDate }) {
  const r = value || null;
  const every = r?.every || "";
  const set = (patch) => onChange(every || patch.every ? { every, interval: 1, weekdays: [], until: "", ...(r || {}), ...patch } : null);
  const sel = { height: 28, fontSize: 12.5 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <select className="inp" style={sel} value={every} onChange={(e) => (e.target.value ? set({ every: e.target.value }) : onChange(null))}>
          <option value="">Nunca</option><option value="day">Diariamente</option><option value="week">Semanalmente</option><option value="month">Mensalmente</option>
        </select>
        {every && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--fg-3)" }}>
            a cada <input type="number" min={1} max={52} className="inp" value={r.interval || 1} onChange={(e) => set({ interval: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} style={{ width: 54, height: 28, fontSize: 12.5 }} />
            {every === "day" ? "dia(s)" : every === "week" ? "semana(s)" : "mês(es)"}
          </span>
        )}
      </div>
      {every === "week" && (
        <div style={{ display: "flex", gap: 4 }}>
          {WD.map((l, i) => {
            const on = (r.weekdays || []).includes(i);
            return <button key={i} type="button" onClick={() => set({ weekdays: on ? r.weekdays.filter((d) => d !== i) : [...(r.weekdays || []), i].sort() })} title={["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][i]}
              style={{ width: 26, height: 26, borderRadius: 999, fontSize: 11.5, fontWeight: 700, border: `1px solid ${on ? "var(--accent-line)" : "var(--line-2)"}`, background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-3)" }}>{l}</button>;
          })}
          <span className="dim" style={{ fontSize: 11, alignSelf: "center", marginLeft: 4 }}>{(r.weekdays || []).length ? "" : "sem dia marcado = a partir do prazo"}</span>
        </div>
      )}
      {every && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--fg-3)" }}>
          até <input type="date" className="inp" value={r.until || ""} min={dueDate || undefined} onChange={(e) => set({ until: e.target.value })} style={{ height: 28, fontSize: 12.5 }} />
          {r.until && <button type="button" onClick={() => set({ until: "" })} style={{ fontSize: 11.5, color: "var(--fg-4)" }}>sem fim</button>}
          {dueDate && <span className="dim" style={{ fontSize: 11 }}>· a próxima nasce ao concluir, a partir de {fmtDue(dueDate)}</span>}
        </div>
      )}
    </div>
  );
}

// Cor de uma label (vale pra todo o quadro): amostras no popover.
export function LabelColorPopover({ anchor, label, color, onChange, onClose }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={220} title={`Cor de "${label}"`}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: 2 }}>
        {COLUMN_COLORS.map((c) => (
          <button key={c || "none"} type="button" title={c ? "" : "sem cor"} onClick={() => { onChange(c); onClose(); }}
            style={{ width: 24, height: 24, borderRadius: 6, background: c || "var(--bg-2)", border: `2px solid ${(color || "") === c ? "var(--fg-1)" : "transparent"}`, boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--fg-4)" }}>{c ? "" : "×"}</button>
        ))}
      </div>
    </Popover>
  );
}
