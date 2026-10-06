import React from "react";
import { Popover } from "./popover.jsx";
// Data e data/hora no desenho do cockpit (06/10/2026). O <input type="date"> e o
// "datetime-local" abriam o calendário do sistema operacional (fonte, cor e
// "dd/mm/yyyy --:--" do navegador) no meio do formulário e da ficha do lead.
// Mesmo molde do SelectPopover: gatilho na medida do .inp, painel no Popover
// com o mês (semana começa na segunda) e, com hora, a coluna de horários de
// meia em meia hora. O valor continua o do input nativo: "YYYY-MM-DD" ou
// "YYYY-MM-DDTHH:MM" no relógio local, então quem já gravava não muda nada.

const { useEffect, useMemo, useRef, useState } = React;
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || "")) ? String(s).slice(0, 10) : "");
const timeOf = (s) => (/T\d{2}:\d{2}/.test(String(s || "")) ? String(s).slice(11, 16) : "");
// Horários de 30 em 30 (o resto do cockpit agenda nessa grade); um horário
// gravado fora dela (14:15) entra na lista pra continuar visível e marcado.
const SLOTS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);

export function formatDateTime(value, withTime = true) {
  const day = dayOf(value);
  if (!day) return "";
  const d = new Date(`${day}T12:00:00`);
  const wd = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const base = `${wd}, ${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  const t = timeOf(value);
  return withTime && t ? `${base} · ${t}` : base;
}

function MonthGrid({ month, value, today, onPick }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12).getDate();
  const cells = [];
  for (let i = 0; i < (first.getDay() + 6) % 7; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d, 12));
  return (
    <div role="grid" aria-label={`${MONTHS[month.getMonth()]} de ${month.getFullYear()}`}
      style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
      {WEEKDAYS.map((w) => <div key={w} className="mono" style={{ textAlign: "center", fontSize: 9.5, color: "var(--fg-4)", paddingBottom: 4 }}>{w}</div>)}
      {cells.map((d, i) => {
        if (!d) return <div key={`e${i}`} />;
        const s = ymdOf(d);
        const on = s === value;
        return (
          <button key={s} type="button" onClick={() => onPick(s)} aria-pressed={on}
            aria-label={d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            style={{
              height: 30, borderRadius: 999, fontSize: 12, fontWeight: on ? 700 : s === today ? 600 : 400,
              background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-fg)" : "var(--fg-1)",
              border: s === today && !on ? "1px solid var(--line-2)" : "1px solid transparent",
            }}>
            {d.getDate()}
          </button>
        );
      })}
    </div>
  );
}

function Panel({ anchor, value, withTime, onPick, onClose, title }) {
  const today = ymdOf(new Date());
  const day = dayOf(value);
  const time = timeOf(value);
  const [month, setMonth] = useState(() => { const d = new Date(`${day || today}T12:00:00`); return new Date(d.getFullYear(), d.getMonth(), 1, 12); });
  const [draftDay, setDraftDay] = useState(day);
  const slots = useMemo(() => (time && !SLOTS.includes(time) ? [...SLOTS, time].sort() : SLOTS), [time]);
  const listRef = useRef(null);
  // Abre a coluna no horário escolhido (ou no comercial, 08:00), não à meia-noite.
  useEffect(() => {
    listRef.current?.querySelector(`[data-t="${time || "08:00"}"]`)?.scrollIntoView({ block: "center" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1, 12));
  const pickDay = (s) => {
    if (!withTime) { onPick(s); return; }
    setDraftDay(s);
    // Dia trocado com hora já escolhida: mantém a hora e confirma direto.
    if (time) onPick(`${s}T${time}`);
  };
  const pickTime = (t) => onPick(`${draftDay || today}T${t}`);
  const navBtn = { width: 28, height: 28, borderRadius: 999, color: "var(--fg-2)", fontSize: 14 };
  return (
    <Popover anchor={anchor} onClose={onClose} width={withTime ? 352 : 260} title={title} maxHeight={420}>
      <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={() => shift(-1)} aria-label="Mês anterior" style={navBtn}>‹</button>
            <span style={{ fontSize: 12.5, fontWeight: 600, textTransform: "capitalize" }}>{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
            <button type="button" onClick={() => shift(1)} aria-label="Próximo mês" style={navBtn}>›</button>
          </div>
          <MonthGrid month={month} value={withTime ? draftDay : day} today={today} onPick={pickDay} />
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button type="button" className="mono" onClick={() => { pickDay(today); setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12)); }}
              style={{ height: 26, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-2)", fontSize: 11, color: "var(--fg-2)" }}>hoje</button>
            {value && <button type="button" className="mono" onClick={() => onPick("")}
              style={{ height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11, color: "var(--fg-3)" }}>limpar</button>}
          </div>
        </div>
        {withTime && (
          <div ref={listRef} role="listbox" aria-label="Horário"
            style={{ flex: "0 0 74px", maxHeight: 268, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, borderLeft: "1px solid var(--line-1)", paddingLeft: 10 }}>
            {!draftDay && <div className="mono dim" style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg-1)", fontSize: 10, padding: "2px 0 6px" }}>escolha o dia</div>}
            {slots.map((t) => {
              const on = t === time && draftDay === day;
              return (
                <button key={t} type="button" role="option" aria-selected={on} data-t={t} disabled={!draftDay}
                  onClick={() => pickTime(t)} className="tnum"
                  style={{ height: 28, borderRadius: 999, fontSize: 12, flexShrink: 0, fontWeight: on ? 700 : 400,
                    background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-fg)" : "var(--fg-1)",
                    opacity: draftDay ? 1 : 0.4, cursor: draftDay ? "pointer" : "default" }}>
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Popover>
  );
}

// value/onChange no formato do input nativo. `withTime` = datetime-local.
export function DateTimeField({ value, onChange, withTime = true, label, placeholder, disabled = false, id, style }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const text = formatDateTime(value, withTime);
  const ph = placeholder || (withTime ? "escolher dia e hora…" : "escolher o dia…");
  return (
    <>
      <button ref={btnRef} id={id} type="button" className="inp" disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-label={label ? `${label}: ${text || "vazio"}` : undefined}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", minWidth: 0, height: 34, textAlign: "left", fontSize: 12.5,
          cursor: disabled ? "default" : "pointer", borderColor: open ? "var(--accent-line)" : undefined, opacity: disabled ? 0.6 : 1, ...style }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: "var(--fg-4)" }}>
          <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
        <span className={text ? "tnum" : undefined} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: text ? "var(--fg-1)" : "var(--fg-4)" }}>
          {text || ph}
        </span>
      </button>
      {open && (
        <Panel anchor={btnRef} value={value} withTime={withTime} title={label}
          onClose={() => { setOpen(false); btnRef.current?.focus(); }}
          onPick={(v) => { setOpen(false); btnRef.current?.focus(); if (v !== value) onChange(v); }} />
      )}
    </>
  );
}
