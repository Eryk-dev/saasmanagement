import React from "react";
import { Popover } from "../../components/popover.jsx";
import { addDays, todayYmd, priTone, assigneesOf } from "../../lib/tasks.js";
import { CompleteCircle } from "./card.jsx";
import { Icon } from "./icons.jsx";
import { UserAvatarRing } from "../../components/user-picker.jsx";

const { useState, useMemo, useRef } = React;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DOW = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const ym = (d) => d.slice(0, 7);
const monthStart = (m) => `${m}-01`;
const shiftMonth = (m, n) => { const [y, mo] = m.split("-").map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };

// Calendário: mês (semana começa na segunda), chips por prazo, arrastar muda o
// prazo, "+" no dia cria com prazo, bandeja "Sem prazo" à direita.
export function CalendarView({ tasks, usersById, actions, mobile, today = todayYmd() }) {
  const [month, setMonth] = useState(ym(today));
  const [more, setMore] = useState(null); // { day, anchor }
  const [adding, setAdding] = useState(null); // day
  const [over, setOver] = useState(null);
  const inputRef = useRef(null);
  const first = monthStart(month);
  const dow0 = new Date(first + "T12:00:00Z").getUTCDay(); // 0 = domingo
  const gridStart = addDays(first, dow0 === 0 ? -6 : 1 - dow0);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const byDay = useMemo(() => { const m = new Map(); for (const t of tasks) if (t.dueDate) { if (!m.has(t.dueDate)) m.set(t.dueDate, []); m.get(t.dueDate).push(t); } return m; }, [tasks]);
  const noDue = useMemo(() => tasks.filter((t) => !t.dueDate && !t.completed), [tasks]);
  const submitNew = async () => {
    const v = (inputRef.current?.value || "").trim();
    if (!v) { setAdding(null); return; }
    const ok = await actions.create(null, v, "bottom", { dueDate: adding });
    if (ok) setAdding(null);
  };
  const dropProps = (day) => ({
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== day) setOver(day); },
    onDragLeave: () => setOver((o) => (o === day ? null : o)),
    onDrop: (e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) actions.setDue(id, day || ""); },
  });
  const Chip = ({ t }) => {
    const done = !!t.completed;
    return (
      <div draggable data-task={t.id} onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; }}
        onClick={() => actions.open(t.id)} onContextMenu={(e) => { e.preventDefault(); actions.menu(t.id, { x: e.clientX, y: e.clientY }); }}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 6px", borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderLeft: `3px solid ${t.priority ? priTone(t.priority) : "var(--line-2)"}`, fontSize: 11.5, fontWeight: 600, color: done ? "var(--fg-4)" : "var(--fg-1)", cursor: "grab", opacity: done ? 0.7 : 1 }}>
        <CompleteCircle done={done} size={12} onToggle={(v) => actions.complete(t.id, v)} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || "(sem título)"}</span>
        {assigneesOf(t)[0] && <UserAvatarRing id={assigneesOf(t)[0]} name={usersById.get(assigneesOf(t)[0])?.name || ""} size={14} />}
      </div>
    );
  };
  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px var(--pad-x) 6px", flexShrink: 0 }}>
      <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mês anterior" style={{ width: 30, height: 30, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="chevronLeft" size={14} /></button>
      <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Próximo mês" style={{ width: 30, height: 30, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="chevronRight" size={14} /></button>
      <button type="button" onClick={() => setMonth(ym(today))} style={{ height: 30, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12.5, fontWeight: 500 }}>Hoje</button>
      <span className="sec-title" style={{ textTransform: "capitalize", marginLeft: 6 }}>{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</span>
      <span className="dim" style={{ fontSize: 12, marginLeft: "auto" }}>{noDue.length ? `${noDue.length} sem prazo` : ""}</span>
    </div>
  );
  if (mobile) {
    const listed = days.filter((d) => ym(d) === month && byDay.has(d));
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {head}
        <div style={{ padding: "0 var(--pad-x) 24px", display: "flex", flexDirection: "column", gap: 10 }}>
          {listed.map((d) => (
            <div key={d}>
              <div className="kicker" style={{ marginBottom: 4, color: d === today ? "var(--accent)" : undefined }}>{DOW[(new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7]} {Number(d.slice(8, 10))}{d === today ? " · hoje" : ""}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{byDay.get(d).map((t) => <Chip key={t.id} t={t} />)}</div>
            </div>
          ))}
          {listed.length === 0 && <div className="mono dim" style={{ fontSize: 12 }}>nenhuma tarefa com prazo neste mês</div>}
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {head}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12, padding: "0 var(--pad-x) 16px" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", overflow: "hidden", background: "var(--bg-1)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
            {DOW.map((d) => <div key={d} className="kicker" style={{ padding: "6px 8px", textAlign: "center" }}>{d}</div>)}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "minmax(96px, 1fr)" }}>
            {days.map((d, i) => {
              const inMonth = ym(d) === month;
              const list = byDay.get(d) || [];
              const isToday = d === today;
              return (
                <div key={d} className="tk-row" {...dropProps(d)} style={{ borderRight: (i % 7) < 6 ? "1px solid var(--line-1)" : "none", borderBottom: "1px solid var(--line-1)", padding: 4, background: over === d ? "var(--accent-soft)" : inMonth ? "var(--bg-1)" : "var(--bg-0)", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span className="tnum" style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--bg-1)" : inMonth ? "var(--fg-2)" : "var(--fg-4)", background: isToday ? "var(--accent)" : "transparent", borderRadius: 999, minWidth: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{Number(d.slice(8, 10))}</span>
                    <button type="button" className="tk-hover" title="Adicionar tarefa neste dia" onClick={() => setAdding(d)} style={{ marginLeft: "auto", width: 20, height: 20, borderRadius: 5, color: "var(--fg-4)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="plus" size={12} /></button>
                  </div>
                  {list.slice(0, 3).map((t) => <Chip key={t.id} t={t} />)}
                  {list.length > 3 && <button type="button" onClick={(e) => setMore({ day: d, anchor: e.currentTarget.getBoundingClientRect() })} style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, textAlign: "left", padding: "0 4px" }}>+{list.length - 3}</button>}
                  {adding === d && (
                    <input ref={inputRef} autoFocus className="inp" placeholder="Nova tarefa" style={{ height: 26, fontSize: 12, width: "100%", boxSizing: "border-box" }}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); submitNew(); } if (e.key === "Escape") setAdding(null); }} onBlur={submitNew} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div {...dropProps("")} style={{ width: 230, flexShrink: 0, display: "flex", flexDirection: "column", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: over === "" ? "var(--accent-soft)" : "var(--bg-2)", padding: 10, minHeight: 0 }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Sem prazo · {noDue.length}</div>
          <div style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {noDue.map((t) => <Chip key={t.id} t={t} />)}
            {noDue.length === 0 && <div className="mono dim" style={{ fontSize: 11 }}>tudo com prazo</div>}
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>arraste pra um dia pra dar prazo, ou solte aqui pra tirar</div>
        </div>
      </div>
      {more && (
        <Popover anchor={more.anchor} onClose={() => setMore(null)} width={280} title={`${Number(more.day.slice(8, 10))} de ${MONTHS[Number(more.day.slice(5, 7)) - 1]}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{(byDay.get(more.day) || []).map((t) => <Chip key={t.id} t={t} />)}</div>
        </Popover>
      )}
    </div>
  );
}
