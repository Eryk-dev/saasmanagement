import React from "react";
import { Popover } from "./popover.jsx";

// Calendário de UM dia pra pular a navegação de uma tela (Agenda, 29/10): clicar
// na data abre o mês, um clique no dia leva direto pra ele, sem passar dia a dia
// pelas setas. Mesmo desenho do calendário do filtro de período (semana começa
// na segunda), mas sem intervalo e sem bloquear datas futuras.
//
// `value` e `today` são Date (meia-noite do dia do negócio). `range` (opcional)
// = [início, fim] pintado de leve, pra a visão Semana mostrar a semana inteira.

const { useState, useEffect } = React;
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthOf = (d) => new Date(d.getFullYear(), d.getMonth(), 1, 12);

export function DayJumpCalendar({ anchor, value, today, range, onPick, onClose, label = "Ir para a data" }) {
  const [view, setView] = useState(() => monthOf(value));
  useEffect(() => { setView(monthOf(value)); }, [value.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const lead = (view.getDay() + 6) % 7; // segunda = 0
  const nDias = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: nDias }, (_, i) => new Date(view.getFullYear(), view.getMonth(), i + 1, 12)),
  ];
  const sel = key(value), hoje = key(today);
  const lo = range ? key(range[0]) : null, hi = range ? key(range[1]) : null;
  const mover = (n) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1, 12));
  const nav = { width: 28, height: 28, borderRadius: 999, color: "var(--fg-3)", cursor: "pointer", fontSize: 14 };

  return (
    <Popover anchor={anchor} onClose={onClose} width={268} label={label} style={{ padding: 12 }}>
      <div className="day-jump">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <button type="button" style={nav} title="mês anterior" aria-label="mês anterior" onClick={() => mover(-1)}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 650, textTransform: "capitalize" }}>{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
          <button type="button" style={nav} title="próximo mês" aria-label="próximo mês" onClick={() => mover(1)}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {WEEKDAYS.map((w) => (
            <div key={w} className="mono" style={{ textAlign: "center", fontSize: 9.5, color: "var(--fg-4)", paddingBottom: 4 }}>{w}</div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} />;
            const k = key(d);
            const on = k === sel;
            const inRange = lo && hi && k >= lo && k <= hi;
            const fds = d.getDay() === 0 || d.getDay() === 6;
            return (
              <button key={k} type="button" className="day-jump-day" data-on={on ? "true" : undefined}
                aria-current={k === hoje ? "date" : undefined} aria-pressed={on}
                aria-label={d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                onClick={() => onPick(d)}
                style={{
                  height: 30, borderRadius: "var(--r-2)", fontSize: 12, cursor: "pointer",
                  fontWeight: on ? 700 : k === hoje ? 650 : 400,
                  background: on ? "var(--accent)" : inRange ? "var(--accent-soft)" : "transparent",
                  color: on ? "var(--accent-fg)" : inRange ? "var(--accent)" : fds ? "var(--fg-3)" : "var(--fg-1)",
                  border: k === hoje && !on ? "1px solid var(--line-2)" : "1px solid transparent",
                }}>
                {d.getDate()}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button type="button" onClick={() => onPick(today)}
            style={{ height: 28, padding: "0 13px", borderRadius: 999, fontSize: 12, background: "var(--bg-2)", color: "var(--fg-2)", cursor: "pointer" }}>
            Hoje
          </button>
        </div>
      </div>
    </Popover>
  );
}
