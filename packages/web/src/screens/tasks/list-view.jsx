import React from "react";
import { Avatar } from "../../atoms.jsx";
import { UserPicker, UserAvatarRing } from "../../components/user-picker.jsx";
import { DateQuick } from "../../components/date-quick.jsx";
import { Menu } from "../../components/menu.jsx";
import { assigneesOf, PRIORITIES, dueState } from "../../lib/tasks.js";
import { CompleteCircle, PriorityChip, LabelChip } from "./card.jsx";
import { Icon } from "./icons.jsx";

const { useState, useRef } = React;

// Lista: tabela agrupada (mesmos grupos do quadro), cabeçalhos ordenáveis e
// edição inline de responsável, prazo, prioridade e coluna em popover.
const SORTABLE = { title: "alpha", assignees: "assignee", due: "due", priority: "priority" };

export function ListView({ groups, usersById, users, labelColors, columns, prefs, setPrefs, actions, focusId, doneKey }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [pick, setPick] = useState(null); // { kind, id, anchor }
  const [adding, setAdding] = useState(null); // groupKey
  const inputRef = useRef(null);
  const sortKey = prefs.sort?.key || "manual";
  const toggle = (k) => setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const setSort = (key) => setPrefs((p) => ({ ...p, sort: p.sort?.key === key ? { key, dir: p.sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" } }));
  const th = (label, key, style) => (
    <th key={label} className="kicker" style={{ padding: "8px 10px", textAlign: "left", cursor: key ? "pointer" : "default", whiteSpace: "nowrap", ...style }} onClick={key ? () => setSort(SORTABLE[key]) : undefined}>
      {label}{key && sortKey === SORTABLE[key] ? (prefs.sort.dir === "desc" ? " ▼" : " ▲") : ""}
    </th>
  );
  const cell = { padding: "6px 10px", fontSize: 12.5, borderTop: "1px solid var(--line-1)", verticalAlign: "middle" };
  const ghost = { display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 6px", borderRadius: "var(--r-2)", fontSize: 12.5, color: "var(--fg-3)", background: "transparent", maxWidth: "100%" };
  const submitNew = async (again) => {
    const v = (inputRef.current?.value || "").trim();
    if (!v) { if (!again) setAdding(null); return; }
    const ok = await actions.create(adding, v, "bottom");
    if (ok && inputRef.current) { inputRef.current.value = ""; if (!again) setAdding(null); else inputRef.current.focus(); }
  };
  const picked = pick ? groups.flatMap((g) => g.tasks).find((t) => t.id === pick.id) : null;
  return (
    <div className="tbl-x" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px var(--pad-x) 24px" }}>
      <table className="tbl" style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
        <thead>
          <tr>
            <th style={{ width: 34 }} />
            {th("Título", "title", { minWidth: 260 })}
            {th("Responsáveis", "assignees", { width: 170 })}
            {th("Prazo", "due", { width: 110 })}
            {th("Prioridade", "priority", { width: 96 })}
            {th("Labels", null, { width: 180 })}
            {th("Coluna", null, { width: 130 })}
            {th("", null, { width: 70 })}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.key}>
              <tr>
                <td colSpan={8} style={{ padding: "10px 10px 4px", borderTop: "1px solid var(--line-1)", background: "var(--bg-0)" }}>
                  <button type="button" onClick={() => toggle(g.key)} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--fg-1)" }}>
                    <Icon name={collapsed.has(g.key) ? "chevronRight" : "chevronDown"} size={14} />
                    {g.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} />}
                    {g.name}<span className="mono tnum dim" style={{ fontSize: 11.5, fontWeight: 400 }}>{g.tasks.length}</span>
                  </button>
                </td>
              </tr>
              {!collapsed.has(g.key) && g.tasks.map((t) => {
                const done = !!t.completed;
                const ds = dueState(t.dueDate, { completed: done });
                return (
                  <tr key={t.id} data-task={t.id} className={"tk-row" + (focusId === t.id ? " is-focused" : "")} onContextMenu={(e) => { e.preventDefault(); actions.menu(t.id, { x: e.clientX, y: e.clientY }); }} style={{ opacity: done ? 0.7 : 1 }}>
                    <td style={{ ...cell, paddingRight: 0 }}><CompleteCircle done={done} size={18} onToggle={(v) => actions.complete(t.id, v)} /></td>
                    <td style={cell}>
                      <button type="button" onClick={() => actions.open(t.id)} style={{ textAlign: "left", fontSize: 13, fontWeight: 600, color: done ? "var(--fg-3)" : "var(--fg-1)", maxWidth: "100%" }}>{t.title || "(sem título)"}</button>
                      {t.parentId && <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>subtarefa</span>}
                    </td>
                    <td style={cell}>
                      <button type="button" onClick={(e) => setPick({ kind: "assignees", id: t.id, anchor: e.currentTarget.getBoundingClientRect() })} style={ghost}>
                        {assigneesOf(t).length ? assigneesOf(t).slice(0, 3).map((id) => <UserAvatarRing key={id} id={id} name={usersById.get(id)?.name || id} size={20} />) : <><Icon name="user" size={13} /> Atribuir</>}
                        {assigneesOf(t).length === 1 && <span style={{ color: "var(--fg-2)" }}>{usersById.get(assigneesOf(t)[0])?.name || assigneesOf(t)[0]}</span>}
                      </button>
                    </td>
                    <td style={cell}>
                      <button type="button" onClick={(e) => setPick({ kind: "due", id: t.id, anchor: e.currentTarget.getBoundingClientRect() })} style={{ ...ghost, color: ds ? ds.tone : "var(--fg-3)", fontWeight: ds && (ds.overdue || ds.today) ? 600 : 500 }}>
                        <Icon name="calendar" size={13} />{ds ? ds.label : "Prazo"}
                      </button>
                    </td>
                    <td style={cell}>
                      <button type="button" onClick={(e) => setPick({ kind: "priority", id: t.id, anchor: e.currentTarget.getBoundingClientRect() })} style={ghost}>
                        {t.priority ? <PriorityChip p={t.priority} /> : <span className="dim">Sem</span>}
                      </button>
                    </td>
                    <td style={cell}><span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{(t.labels || []).slice(0, 3).map((l) => <LabelChip key={l} label={l} color={labelColors.get(l) || ""} small />)}{(t.labels || []).length > 3 && <span className="mono dim" style={{ fontSize: 11 }}>+{t.labels.length - 3}</span>}</span></td>
                    <td style={cell}>
                      <button type="button" onClick={(e) => setPick({ kind: "column", id: t.id, anchor: e.currentTarget.getBoundingClientRect() })} style={ghost}>
                        {columns.find((c) => c.key === t.column)?.name || columns[0]?.name}
                      </button>
                    </td>
                    <td style={{ ...cell, color: "var(--fg-4)", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        {(t.comments || []).length > 0 && <span className="tnum" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5 }}><Icon name="comment" size={12} />{t.comments.length}</span>}
                        {(t.attachments || []).length > 0 && <span className="tnum" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5 }}><Icon name="paperclip" size={12} />{t.attachments.length}</span>}
                        <button type="button" className="tk-hover" title="Mais ações" onClick={(e) => actions.menu(t.id, e.currentTarget.getBoundingClientRect())} style={{ width: 24, height: 24, borderRadius: 6, color: "var(--fg-4)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="more" size={14} /></button>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!collapsed.has(g.key) && (!g.virtual || g.dropPatch) && (
                <tr>
                  <td colSpan={8} style={{ padding: "4px 10px 8px", borderTop: "1px solid var(--line-1)" }}>
                    {adding === g.key ? (
                      <input ref={inputRef} autoFocus className="inp" placeholder="Nome da tarefa (Enter salva, Esc cancela)" style={{ width: "min(100%, 480px)" }}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); submitNew(true); } if (e.key === "Escape") setAdding(null); }} onBlur={() => submitNew(false)} />
                    ) : (
                      <button type="button" onClick={() => setAdding(g.key)} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--fg-3)", padding: "4px 0" }}><Icon name="plus" size={13} /> Adicionar tarefa</button>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {pick?.kind === "assignees" && picked && <UserPicker anchor={pick.anchor} users={users} value={assigneesOf(picked)} multi title="Responsáveis" onChange={(ids) => actions.patch(picked.id, { assignees: ids })} onClose={() => setPick(null)} />}
      {pick?.kind === "due" && picked && <DateQuick anchor={pick.anchor} value={picked.dueDate} title="Prazo" onChange={(v) => actions.setDue(picked.id, v)} onClose={() => setPick(null)} />}
      {pick?.kind === "priority" && picked && <Menu anchor={pick.anchor} onClose={() => setPick(null)} title="Prioridade" items={PRIORITIES.map(([v, l]) => ({ label: v || l, checked: (picked.priority || "") === v, onClick: () => actions.patch(picked.id, { priority: v }) }))} />}
      {pick?.kind === "column" && picked && <Menu anchor={pick.anchor} onClose={() => setPick(null)} title="Mover para" items={columns.map((c) => ({ label: c.name, checked: c.key === picked.column, onClick: () => actions.move(picked.id, c.key) }))} />}
    </div>
  );
}
