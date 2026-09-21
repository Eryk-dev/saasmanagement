import React from "react";
import { Menu } from "../../components/menu.jsx";
import { KanbanColumn } from "../../components/kanban/board.jsx";
import { COLUMN_COLORS } from "../../lib/tasks.js";
import { Icon } from "./icons.jsx";
import { TaskCard, NewTaskCard } from "./card.jsx";
import { rulesSummary } from "./rules.jsx";

const { useState, useRef, useEffect } = React;

function ColumnName({ name, editing, onStart, onSave }) {
  const ref = useRef(null);
  const finished = useRef(false);
  const finish = value => { if (!finished.current) { finished.current = true; onSave(value); } };
  useEffect(() => { if (editing) { finished.current = false; ref.current?.focus(); ref.current?.select(); } }, [editing]);
  if (editing) {
    return (
      <input ref={ref} defaultValue={name} aria-label="Nome da coluna" className="inp" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") finish(e.target.value); if (e.key === "Escape") finish(null); }}
        onBlur={(e) => finish(e.target.value)} style={{ height: 26, fontSize: 13, fontWeight: 600, width: "100%", minWidth: 0 }} />
    );
  }
  return <button type="button" onDoubleClick={onStart} title="Duplo clique renomeia" className="kb-col-name" style={{ textAlign: "left" }}>{name}</button>;
}

// Coluna do quadro de tarefas sobre a casca do Kanban: aqui fica só o que é
// de tarefa (renomear, menu da coluna, regras, composer, ordem manual).
export function TaskColumn({ col, idx, count, cards, hiddenCount, usersById, labelColors, isDoneCol, collapsed, hideEmpty, fields, compact, sortManual, dnd, composer, focusId, selection, renamingId, subCounts, blockedIds, actions, colActions }) {
  const rulesTitle = "Regras: " + rulesSummary(col.column?.rules, usersById, isDoneCol);
  const [menu, setMenu] = useState(null);
  const [editing, setEditing] = useState(false);
  const canAdd = !col.virtual || !!col.dropPatch;

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

  const before = (col.color || col.column?.rules || isDoneCol) ? (
    <>
      {col.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: col.color, flexShrink: 0 }} />}
      {!collapsed && (col.column?.rules || isDoneCol) && <span title={rulesTitle} style={{ color: "var(--accent)", display: "inline-flex", flexShrink: 0 }}><Icon name="play" size={12} /></span>}
    </>
  ) : null;

  return (
    <>
      <KanbanColumn colKey={col.key} dnd={dnd} label={col.name} items={cards} canReorder={sortManual}
        collapsed={collapsed} onCollapse={() => colActions.collapse(col.key, true)} onExpand={() => colActions.collapse(col.key, false)}
        before={before}
        title={<ColumnName name={col.name} editing={editing && !col.virtual} onStart={() => { if (!col.virtual) setEditing(true); }} onSave={(v) => { setEditing(false); if (v != null && v.trim() && v.trim() !== col.name) colActions.rename(col.key, v.trim()); }} />}
        count={<span title={hiddenCount ? `${hiddenCount} escondida(s) pelo filtro ou pela busca` : undefined}>{cards.length}{hiddenCount ? <span style={{ opacity: 0.7 }}> +{hiddenCount}</span> : null}</span>}
        actions={<>
          {canAdd && <button type="button" className="kb-col-btn" title="Adicionar tarefa no topo" aria-label="Adicionar tarefa no topo" onClick={() => colActions.composer(col.key, "top")}><Icon name="plus" size={14} /></button>}
          <button type="button" className="kb-col-btn" title={col.virtual ? "Opções do grupo" : "Mais ações da coluna"} aria-label={col.virtual ? "Opções do grupo" : "Mais ações da coluna"} onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}><Icon name="more" size={14} /></button>
        </>}
        renderItem={(t) => (
          <TaskCard key={t.id} t={t} colKey={col.key} usersById={usersById} labelColors={labelColors}
            done={!!t.completed} focused={focusId === t.id} selected={!!selection && selection.has(t.id)} renaming={renamingId === t.id}
            blocked={blockedIds.has(t.id)} subDone={subCounts.get(t.id)?.done || 0} subTotal={subCounts.get(t.id)?.total || 0}
            fields={fields} compact={compact} dragProps={dnd.cardDragProps} actions={actions} />
        )}
        moreLabel={(n) => `+${n} tarefas`}
        emptyText="arraste uma tarefa para cá"
        top={composer && composer.position === "top" ? <NewTaskCard onSave={(title) => actions.create(col.key, title, "top")} onCancel={() => colActions.composer(null)} /> : null}
        bottom={composer && composer.position === "bottom" ? <NewTaskCard onSave={(title) => actions.create(col.key, title, "bottom")} onCancel={() => colActions.composer(null)} /> : null}
        footer={canAdd ? (
          <button type="button" onClick={() => colActions.composer(col.key, "bottom")} style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 6px 6px", padding: "8px 8px", borderRadius: 999, fontSize: 12.5, fontWeight: 500, color: "var(--fg-3)", textAlign: "left", flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; e.currentTarget.style.color = "var(--fg-1)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--fg-3)"; }}>
            <Icon name="plus" size={14} /> Adicionar tarefa
          </button>
        ) : null} />
      {menu && <Menu anchor={menu} items={col.virtual ? virtualItems : menuItems} onClose={() => setMenu(null)} title={col.name} />}
    </>
  );
}
