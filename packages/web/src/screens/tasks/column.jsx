import React from "react";
import { Menu } from "../../components/menu.jsx";
import { COLUMN_COLORS } from "../../lib/tasks.js";
import { Icon } from "./icons.jsx";
import { TaskCard, NewTaskCard } from "./card.jsx";
import { rulesSummary } from "./rules.jsx";

const { useState, useRef, useEffect } = React;
const CUT = 60;

function ColumnName({ name, editing, onStart, onSave }) {
  const ref = useRef(null);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);
  if (editing) {
    return (
      <input ref={ref} defaultValue={name} className="inp" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onSave(e.target.value); if (e.key === "Escape") onSave(null); }}
        onBlur={(e) => onSave(e.target.value)} style={{ height: 26, fontSize: 13, fontWeight: 600, width: "100%", minWidth: 0 }} />
    );
  }
  return <button type="button" onDoubleClick={onStart} title="Duplo clique renomeia" style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, textAlign: "left", color: "var(--fg-1)" }}>{name}</button>;
}

export function TaskColumn({ col, idx, count, cards, hiddenCount, usersById, labelColors, isDoneCol, collapsed, hideEmpty, fields, compact, sortManual, dnd, placeholder, dragging, composer, focusId, selection, renamingId, subCounts, blockedIds, actions, colActions }) {
  const listRef = useRef(null);
  const rulesTitle = "Regras: " + rulesSummary(col.column?.rules, usersById, isDoneCol);
  const [menu, setMenu] = useState(null);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const over = placeholder && placeholder.colKey === col.key;
  const shown = expanded ? cards : cards.slice(0, CUT);
  const cut = cards.length - shown.length;

  if (collapsed) {
    return (
      <div onClick={() => colActions.collapse(col.key, false)} title={`${col.name} · ${cards.length}. Clique para expandir`}
        {...dnd.listDropProps(col.key, listRef, { canReorder: false })}
        style={{ width: 44, flexShrink: 0, background: over ? "var(--accent-soft)" : "var(--bg-2)", borderRadius: "var(--r-4)", border: "1px solid " + (over ? "var(--accent-line)" : "transparent"), display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "12px 0", cursor: "pointer", minHeight: 160 }}>
        <span className="mono tnum" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)" }}>{cards.length}</span>
        <span className="tk-strip" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)", maxHeight: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{col.name}</span>
        {col.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: col.color }} />}
        <span ref={listRef} data-col-list="1" style={{ display: "none" }} />
      </div>
    );
  }

  const menuItems = [
    { label: "Renomear", onClick: () => setEditing(true) },
    { label: "Adicionar tarefa no topo", onClick: () => colActions.composer(col.key, "top") },
    { sep: true },
    { label: "Adicionar coluna à esquerda", onClick: () => colActions.add(idx) },
    { label: "Adicionar coluna à direita", onClick: () => colActions.add(idx + 1) },
    { label: "Mover coluna para a esquerda", disabled: idx === 0, onClick: () => colActions.shift(col.key, -1) },
    { label: "Mover coluna para a direita", disabled: idx === count - 1, onClick: () => colActions.shift(col.key, 1) },
    { sep: true },
    { label: "Recolher coluna", onClick: () => colActions.collapse(col.key, true) },
    { label: "Ocultar colunas vazias", checked: hideEmpty, onClick: () => colActions.toggleHideEmpty() },
    { label: "Cor", children: COLUMN_COLORS.map((c) => ({ label: c ? "" : "Sem cor", checked: (col.color || "") === c, icon: c ? <span style={{ width: 12, height: 12, borderRadius: 3, background: c, display: "inline-block" }} /> : "", onClick: () => colActions.color(col.key, c) })).map((it, i) => ({ ...it, label: it.label || ["", "Azul", "Índigo", "Verde", "Âmbar", "Vermelho", "Rosa"][i] || "Cor" })) },
    { label: "Definir como Concluído", checked: isDoneCol, onClick: () => colActions.setDone(isDoneCol ? "" : col.key) },
    { label: "Regras da coluna…", icon: col.column?.rules ? "⚡" : "", onClick: () => colActions.rules(col.key) },
    { sep: true },
    { label: "Excluir coluna", danger: true, disabled: count <= 1, onClick: () => colActions.remove(col.key, col.name, cards.length) },
  ];

  const virtualItems = [
    { label: "Recolher coluna", onClick: () => colActions.collapse(col.key, true) },
    { label: "Ocultar colunas vazias", checked: hideEmpty, onClick: () => colActions.toggleHideEmpty() },
    { sep: true },
    { label: "Voltar a agrupar por coluna", onClick: () => colActions.ungroup() },
  ];
  const ph = over && placeholder.index >= 0 && dragging ? <div key="ph" style={{ height: dragging.height || 56, border: "1px dashed var(--accent-line)", borderRadius: "var(--r-3)", background: "var(--accent-soft)", flexShrink: 0 }} /> : null;
  const items = [];
  shown.forEach((t, i) => {
    if (ph && placeholder.index === i) items.push(ph);
    items.push(
      <TaskCard key={t.id} t={t} colKey={col.key} usersById={usersById} labelColors={labelColors}
        done={!!t.completed} focused={focusId === t.id} selected={!!selection && selection.has(t.id)} renaming={renamingId === t.id}
        blocked={blockedIds.has(t.id)} subDone={subCounts.get(t.id)?.done || 0} subTotal={subCounts.get(t.id)?.total || 0}
        fields={fields} compact={compact} dragProps={dnd.cardDragProps} actions={actions} />,
    );
  });
  if (ph && placeholder.index >= shown.length) items.push(ph);

  return (
    <div style={{ width: "min(272px, 82vw)", flexShrink: 0, maxHeight: "100%", display: "flex", flexDirection: "column", background: "var(--bg-2)", borderRadius: "var(--r-4)", border: "1px solid " + (over ? "var(--accent-line)" : "transparent"), scrollSnapAlign: "start", transition: "border-color .12s" }}>
      <div className="tk-col-head" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 6px 12px", flexShrink: 0 }}>
        {col.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: col.color, flexShrink: 0 }} />}
        {(col.column?.rules || isDoneCol) && <span title={rulesTitle} style={{ color: "var(--accent)", display: "inline-flex", flexShrink: 0 }}><Icon name="play" size={12} /></span>}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <ColumnName name={col.name} editing={editing && !col.virtual} onStart={() => { if (!col.virtual) setEditing(true); }} onSave={(v) => { setEditing(false); if (v != null && v.trim() && v.trim() !== col.name) colActions.rename(col.key, v.trim()); }} />
          <span className="mono tnum dim" style={{ fontSize: 11.5, flexShrink: 0 }} title={hiddenCount ? `${hiddenCount} escondida(s) pelo filtro ou pela busca` : undefined}>{cards.length}{hiddenCount ? <span style={{ opacity: 0.7 }}> +{hiddenCount}</span> : null}</span>
        </div>
        <span className="tk-hover" style={{ display: "inline-flex", gap: 2, flexShrink: 0 }}>
          {(!col.virtual || col.dropPatch) && <button type="button" title="Adicionar tarefa no topo" aria-label="Adicionar tarefa no topo" onClick={() => colActions.composer(col.key, "top")} style={{ width: 26, height: 26, borderRadius: 6, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="plus" size={14} /></button>}
          <button type="button" title={col.virtual ? "Opções do grupo" : "Mais ações da coluna"} aria-label={col.virtual ? "Opções do grupo" : "Mais ações da coluna"} onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())} style={{ width: 26, height: 26, borderRadius: 6, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="more" size={14} /></button>
        </span>
        {menu && <Menu anchor={menu} items={col.virtual ? virtualItems : menuItems} onClose={() => setMenu(null)} title={col.name} />}
      </div>
      <div ref={listRef} data-col-list="1" {...dnd.listDropProps(col.key, listRef, { canReorder: sortManual })}
        style={{ flex: 1, minHeight: 60, overflowY: "auto", padding: "2px 10px 6px", display: "flex", flexDirection: "column", gap: 8 }}>
        {composer && composer.position === "top" && <NewTaskCard onSave={(title) => actions.create(col.key, title, "top")} onCancel={() => colActions.composer(null)} />}
        {items}
        {cut > 0 && <button type="button" onClick={() => setExpanded(true)} style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, padding: "6px 0", textAlign: "left" }}>+{cut} tarefas</button>}
        {expanded && cards.length > CUT && <button type="button" onClick={() => setExpanded(false)} style={{ fontSize: 12, color: "var(--fg-4)", padding: "4px 0", textAlign: "left" }}>mostrar menos</button>}
        {cards.length === 0 && !composer && !ph && <div className="mono dim" style={{ fontSize: 11, textAlign: "center", padding: "22px 0" }}>{dragging ? "Solte aqui" : "vazio"}</div>}
        {composer && composer.position === "bottom" && <NewTaskCard onSave={(title) => actions.create(col.key, title, "bottom")} onCancel={() => colActions.composer(null)} />}
      </div>
      {(!col.virtual || col.dropPatch) && <button type="button" onClick={() => colActions.composer(col.key, "bottom")} style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 6px 6px", padding: "8px 8px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 500, color: "var(--fg-3)", textAlign: "left", flexShrink: 0 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; e.currentTarget.style.color = "var(--fg-1)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--fg-3)"; }}>
        <Icon name="plus" size={14} /> Adicionar tarefa
      </button>}
    </div>
  );
}
