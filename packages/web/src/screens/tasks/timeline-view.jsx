import React from "react";
import { addDays, diffDays, todayYmd, priTone, assigneesOf, fmtDue } from "../../lib/tasks.js";
import { UserAvatarRing } from "../../components/user-picker.jsx";
import { Icon } from "./icons.jsx";

const { useState, useMemo, useRef, useEffect } = React;
const ZOOM = { day: 36, week: 14, month: 5 };
const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monday = (d) => { const dow = new Date(d + "T12:00:00Z").getUTCDay(); return addDays(d, dow === 0 ? -6 : 1 - dow); };

// Cronograma (Gantt): linhas por tarefa dentro dos grupos, barra do início ao
// prazo (só prazo = 1 dia), arrastar move as duas datas, bordas redimensionam,
// linha de hoje, fim de semana sombreado, setas de bloqueio.
export function TimelineView({ groups, usersById, actions, mobile, today = todayYmd() }) {
  const [zoom, setZoom] = useState("week");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // { id, mode, x0, start, due, dStart, dDue }
  const scroller = useRef(null);
  const px = ZOOM[zoom];
  const all = groups.flatMap((g) => g.tasks);
  const dated = all.filter((t) => t.dueDate);
  const undated = all.filter((t) => !t.dueDate && !t.completed);
  const range = useMemo(() => {
    const ds = dated.flatMap((t) => [t.startDate || t.dueDate, t.dueDate]).filter(Boolean);
    const min = [addDays(today, -14), ...ds].sort()[0];
    const max = [addDays(today, 30), ...ds].sort().pop();
    const start = monday(addDays(min, -7));
    const end = addDays(max, 21);
    return { start, end, days: diffDays(start, end) + 1 };
  }, [dated, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const xOf = (d) => diffDays(range.start, d) * px;
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = Math.max(0, xOf(today) - el.clientWidth / 3); }, [zoom, range.start]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k) => setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Cabeçalho do eixo: meses em cima, dias/semanas embaixo.
  const axis = useMemo(() => {
    const months = []; const ticks = [];
    for (let i = 0; i < range.days; i++) {
      const d = addDays(range.start, i);
      const m = d.slice(0, 7);
      if (!months.length || months[months.length - 1].m !== m) months.push({ m, x: i * px, w: 0 });
      months[months.length - 1].w += px;
      const dow = new Date(d + "T12:00:00Z").getUTCDay();
      if (zoom === "day" || (zoom === "week" && dow === 1) || (zoom === "month" && d.slice(8, 10) === "01")) ticks.push({ d, x: i * px, label: zoom === "day" ? Number(d.slice(8, 10)) : zoom === "week" ? `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}` : MON[Number(d.slice(5, 7)) - 1] });
    }
    return { months, ticks };
  }, [range, px, zoom]);
  const weekends = useMemo(() => { const out = []; for (let i = 0; i < range.days; i++) { const d = addDays(range.start, i); const dow = new Date(d + "T12:00:00Z").getUTCDay(); if (dow === 0 || dow === 6) out.push(i * px); } return out; }, [range, px]);

  // Linhas (grupo + tarefas) e posição vertical de cada tarefa pras setas.
  const rows = [];
  for (const g of groups) { rows.push({ kind: "group", g }); if (!collapsed.has(g.key)) for (const t of g.tasks) rows.push({ kind: "task", t, g }); }
  const ROW = 34, HEAD = 46;
  const yOf = new Map(); rows.forEach((r, i) => { if (r.kind === "task") yOf.set(r.t.id, HEAD + i * ROW); });

  const barOf = (t) => {
    let start = t.startDate && t.startDate <= t.dueDate ? t.startDate : t.dueDate;
    let due = t.dueDate;
    if (drag && drag.id === t.id) { start = drag.start; due = drag.due; }
    return { start, due, x: xOf(start), w: Math.max(px, (diffDays(start, due) + 1) * px) };
  };
  const onPointerDown = (e, t, mode) => {
    if (!t.dueDate) return;
    e.preventDefault(); e.stopPropagation();
    const b = barOf(t);
    setDrag({ id: t.id, mode, x0: e.clientX, start0: b.start, due0: b.due, start: b.start, due: b.due, hasStart: !!t.startDate });
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ponteiro sintético ou já solto */ }
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x0) / px);
    let start = drag.start0, due = drag.due0;
    if (drag.mode === "move") { start = addDays(drag.start0, delta); due = addDays(drag.due0, delta); }
    else if (drag.mode === "left") { start = addDays(drag.start0, delta); if (start > due) start = due; }
    else if (drag.mode === "right") { due = addDays(drag.due0, delta); if (due < start) due = start; }
    if (start !== drag.start || due !== drag.due) setDrag({ ...drag, start, due });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const d = drag; setDrag(null);
    if (d.start === d.start0 && d.due === d.due0) return;
    const patch = { dueDate: d.due };
    if (d.hasStart || d.mode === "left" || d.start !== d.due) patch.startDate = d.start === d.due && !d.hasStart && d.mode !== "left" ? "" : d.start;
    actions.patch(d.id, patch, { label: `${fmtDue(patch.startDate || d.due)} → ${fmtDue(d.due)}`, undo: true, silent: false });
  };

  if (mobile) {
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px var(--pad-x) 24px" }}>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>No celular o cronograma vira lista por data. Abra no computador pra arrastar as barras.</div>
        {[...dated].sort((a, b) => (a.startDate || a.dueDate).localeCompare(b.startDate || b.dueDate)).map((t) => (
          <button key={t.id} type="button" onClick={() => actions.open(t.id)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--line-1)", textAlign: "left" }}>
            <span style={{ width: 4, height: 24, borderRadius: 2, background: t.priority ? priTone(t.priority) : "var(--line-2)" }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: t.completed ? "var(--fg-4)" : "var(--fg-1)" }}>{t.title}</span>
            <span className="tnum dim" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{t.startDate ? `${fmtDue(t.startDate)} → ` : ""}{fmtDue(t.dueDate)}</span>
          </button>
        ))}
      </div>
    );
  }
  const totalH = HEAD + rows.length * ROW + 20;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px var(--pad-x) 6px", flexShrink: 0 }}>
        <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, background: "var(--bg-2)" }}>
          {[["day", "Dia"], ["week", "Semana"], ["month", "Mês"]].map(([k, l]) => <button key={k} type="button" onClick={() => setZoom(k)} style={{ padding: "5px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: zoom === k ? 600 : 500, background: zoom === k ? "var(--bg-1)" : "transparent", boxShadow: zoom === k ? "var(--shadow-segment)" : "none", color: zoom === k ? "var(--fg-1)" : "var(--fg-3)" }}>{l}</button>)}
        </div>
        <button type="button" onClick={() => { const el = scroller.current; if (el) el.scrollTo({ left: Math.max(0, xOf(today) - el.clientWidth / 3), behavior: "smooth" }); }} style={{ height: 30, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 12.5, fontWeight: 500 }}>Hoje</button>
        <span className="dim" style={{ fontSize: 12 }}>arraste a barra pra mudar as datas · as bordas mudam início e prazo</span>
        {undated.length > 0 && <span className="dim" style={{ fontSize: 12, marginLeft: "auto" }}>{undated.length} sem prazo (não aparecem)</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", margin: "0 var(--pad-x) 16px", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", overflow: "hidden", background: "var(--bg-1)" }}>
        {/* coluna fixa: nomes */}
        <div style={{ width: 250, flexShrink: 0, borderRight: "1px solid var(--line-1)", overflow: "hidden", position: "relative" }}>
          <div style={{ height: HEAD, borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", alignItems: "flex-end", padding: "0 10px 6px" }}><span className="kicker">Tarefa</span></div>
          <div id="tk-gantt-names" style={{ overflow: "hidden" }}>
            {rows.map((r, i) => r.kind === "group" ? (
              <button key={"g" + r.g.key} type="button" onClick={() => toggle(r.g.key)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", height: ROW, padding: "0 10px", fontSize: 12.5, fontWeight: 700, background: "var(--bg-0)", borderBottom: "1px solid var(--line-1)", textAlign: "left" }}>
                <Icon name={collapsed.has(r.g.key) ? "chevronRight" : "chevronDown"} size={13} />{r.g.name}<span className="mono tnum dim" style={{ fontWeight: 400, fontSize: 11 }}>{r.g.tasks.length}</span>
              </button>
            ) : (
              <button key={r.t.id} type="button" onClick={() => actions.open(r.t.id)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", height: ROW, padding: "0 10px", fontSize: 12.5, borderBottom: "1px solid var(--line-1)", textAlign: "left", color: r.t.completed ? "var(--fg-4)" : "var(--fg-1)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{r.t.title || "(sem título)"}</span>
                {assigneesOf(r.t)[0] && <UserAvatarRing id={assigneesOf(r.t)[0]} name={usersById.get(assigneesOf(r.t)[0])?.name || ""} size={16} />}
                {!r.t.dueDate && <span className="dim" style={{ fontSize: 10.5 }}>sem prazo</span>}
              </button>
            ))}
          </div>
        </div>
        {/* área rolável: eixo + barras */}
        <div ref={scroller} onScroll={(e) => { const n = document.getElementById("tk-gantt-names"); if (n) n.scrollTop = e.currentTarget.scrollTop; }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          style={{ flex: 1, minWidth: 0, overflow: "auto", position: "relative", cursor: drag ? (drag.mode === "move" ? "grabbing" : "col-resize") : "default", userSelect: drag ? "none" : "auto" }}>
          <div style={{ position: "relative", width: range.days * px, height: totalH }}>
            {/* fundo: fins de semana + linhas dos ticks */}
            {zoom !== "month" && weekends.map((x) => <div key={x} style={{ position: "absolute", left: x, top: HEAD, width: px, height: totalH - HEAD, background: "var(--bg-0)" }} />)}
            {axis.ticks.map((t) => <div key={t.d} style={{ position: "absolute", left: t.x, top: HEAD, width: 1, height: totalH - HEAD, background: "var(--line-1)" }} />)}
            {/* linhas horizontais */}
            {rows.map((r, i) => <div key={i} style={{ position: "absolute", left: 0, right: 0, top: HEAD + i * ROW, height: ROW, borderBottom: "1px solid var(--line-1)", background: r.kind === "group" ? "var(--bg-0)" : "transparent" }} />)}
            {/* eixo */}
            <div style={{ position: "sticky", top: 0, zIndex: 3, height: HEAD, background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }}>
              {axis.months.map((m) => <div key={m.m} className="kicker" style={{ position: "absolute", left: m.x + 6, top: 6, textTransform: "capitalize" }}>{MON[Number(m.m.slice(5, 7)) - 1]} {m.m.slice(0, 4)}</div>)}
              {axis.ticks.map((t) => <div key={t.d} className="tnum" style={{ position: "absolute", left: t.x + 3, top: 26, fontSize: 10.5, color: t.d === today ? "var(--accent)" : "var(--fg-4)", fontWeight: t.d === today ? 700 : 500 }}>{t.label}</div>)}
            </div>
            {/* hoje */}
            <div style={{ position: "absolute", left: xOf(today) + px / 2, top: HEAD, width: 2, height: totalH - HEAD, background: "var(--accent)", zIndex: 2, pointerEvents: "none" }} />
            {/* setas de bloqueio */}
            <svg style={{ position: "absolute", left: 0, top: 0, width: range.days * px, height: totalH, pointerEvents: "none", zIndex: 2 }}>
              {rows.filter((r) => r.kind === "task" && r.t.dueDate).flatMap((r) => (r.t.blockedBy || []).map((bid) => {
                const b = all.find((x) => x.id === bid); if (!b || !b.dueDate || !yOf.has(b.id)) return null;
                const bb = barOf(b), tb = barOf(r.t);
                const x1 = bb.x + bb.w, y1 = yOf.get(b.id) + ROW / 2, x2 = tb.x, y2 = yOf.get(r.t.id) + ROW / 2;
                const mx = x1 + Math.max(10, (x2 - x1) / 2);
                return <path key={r.t.id + bid} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={b.completed ? "var(--pos)" : "var(--neg)"} strokeWidth="1.5" strokeDasharray={b.completed ? "" : "4 3"} />;
              }))}
            </svg>
            {/* barras */}
            {rows.map((r) => {
              if (r.kind !== "task" || !r.t.dueDate) return null;
              const t = r.t; const b = barOf(t); const y = yOf.get(t.id);
              const tone = t.completed ? "var(--pos)" : t.priority ? priTone(t.priority) : "var(--accent)";
              return (
                <div key={t.id} title={`${t.title}: ${fmtDue(b.start)} → ${fmtDue(b.due)}`} onPointerDown={(e) => onPointerDown(e, t, "move")} onDoubleClick={() => actions.open(t.id)}
                  style={{ position: "absolute", left: b.x, top: y + 7, width: b.w, height: ROW - 14, borderRadius: 6, background: `color-mix(in srgb, ${tone} 22%, var(--bg-1))`, border: `1px solid ${tone}`, cursor: "grab", zIndex: 1, display: "flex", alignItems: "center", overflow: "hidden" }}>
                  <div onPointerDown={(e) => onPointerDown(e, t, "left")} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, cursor: "col-resize" }} />
                  <span style={{ padding: "0 8px", fontSize: 11.5, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{b.w > 60 ? t.title : ""}</span>
                  <div onPointerDown={(e) => onPointerDown(e, t, "right")} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 8, cursor: "col-resize" }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
