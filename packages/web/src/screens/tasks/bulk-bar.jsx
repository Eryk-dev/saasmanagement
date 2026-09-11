import React from "react";
import { UserPicker } from "../../components/user-picker.jsx";
import { DateQuick } from "../../components/date-quick.jsx";
import { Menu } from "../../components/menu.jsx";
import { PRIORITIES } from "../../lib/tasks.js";
import { Icon } from "./icons.jsx";

const { useRef, useState } = React;

// Barra flutuante da seleção: N selecionadas · Responsável · Prazo · Prioridade
// · Mover para · Concluir · Excluir · ✕. Cada ação chama a rota /bulk.
export function BulkBar({ count, users, columns, onAssign, onDue, onPriority, onMove, onComplete, onDelete, onClear, mobile }) {
  const [open, setOpen] = useState(null);
  const refs = { assign: useRef(null), due: useRef(null), priority: useRef(null), move: useRef(null) };
  if (!count) return null;
  const btn = (key, icon, label, onClick) => (
    <button key={key} ref={refs[key]} type="button" title={label} onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: mobile ? "0 8px" : "0 10px", borderRadius: "var(--r-2)", color: "var(--bg-1)", fontSize: 12.5, fontWeight: 600, background: "transparent" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--bg-1) 14%, transparent)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      <Icon name={icon} size={14} />{!mobile && label}
    </button>
  );
  return (
    <div role="toolbar" aria-label="Ações da seleção" data-tk-layer="1" style={{ position: "fixed", left: "50%", bottom: mobile ? 22 : 72, transform: "translateX(-50%)", zIndex: 62, maxWidth: "min(94vw, 820px)", display: "flex", alignItems: "center", gap: 2, padding: "6px 8px 6px 14px", borderRadius: "var(--r-3)", background: "var(--fg-1)", color: "var(--bg-1)", boxShadow: "var(--shadow-pop)" }}>
      <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, marginRight: 8, whiteSpace: "nowrap" }}>{count} {count === 1 ? "selecionada" : "selecionadas"}</span>
      {btn("assign", "user", "Responsável", () => setOpen("assign"))}
      {btn("due", "calendar", "Prazo", () => setOpen("due"))}
      {btn("priority", "flag", "Prioridade", () => setOpen("priority"))}
      {btn("move", "board", "Mover para", () => setOpen("move"))}
      {btn("complete", "check", "Concluir", onComplete)}
      {btn("delete", "trash", "Excluir", onDelete)}
      <button type="button" onClick={onClear} title="Limpar seleção (Esc)" aria-label="Limpar seleção" style={{ width: 30, height: 30, borderRadius: "var(--r-2)", color: "var(--bg-1)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: 4 }}><Icon name="x" size={14} /></button>
      {open === "assign" && <UserPicker anchor={refs.assign} users={users} value={[]} multi={false} allowNone noneLabel="Tirar responsáveis" title="Atribuir a" onChange={(id) => onAssign(id)} onClose={() => setOpen(null)} />}
      {open === "due" && <DateQuick anchor={refs.due} value="" title="Prazo" onChange={(v) => onDue(v)} onClose={() => setOpen(null)} />}
      {open === "priority" && <Menu anchor={refs.priority} onClose={() => setOpen(null)} title="Prioridade" items={PRIORITIES.map(([v, l]) => ({ label: v || l, onClick: () => onPriority(v) }))} />}
      {open === "move" && <Menu anchor={refs.move} onClose={() => setOpen(null)} title="Mover para" items={columns.map((c) => ({ label: c.name, onClick: () => onMove(c.key) }))} />}
    </div>
  );
}
