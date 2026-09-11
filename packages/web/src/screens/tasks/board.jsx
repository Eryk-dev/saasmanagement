import React from "react";
import { Icon } from "./icons.jsx";
import { TaskColumn } from "./column.jsx";

// O quadro: colunas lado a lado com rolagem horizontal (snap no celular), cada
// coluna rola sozinha. Coluna vazia some quando "Ocultar colunas vazias" está
// ligado (menos durante um arrasto, pra dar onde soltar).
// `groups` = colunas do quadro (group = column) ou grupos virtuais por campo
// (responsável, prazo, prioridade, label) vindos de groupTasks().
export function Board({ boardRef, groups, hiddenByColumn, prefs, dnd, composer, focusId, selection, renamingId, subCounts, blockedIds, usersById, labelColors, doneKey, actions, colActions, sortManual }) {
  const dragging = dnd.drag;
  const virtual = groups.some((g) => g.virtual);
  return (
    <div ref={boardRef} data-board="1" style={{ flex: 1, minHeight: 0, display: "flex", gap: 12, alignItems: "stretch", padding: "12px var(--pad-x) 20px", overflowX: "auto", overflowY: "hidden", scrollSnapType: "x proximity" }}>
      {groups.map((col, i) => {
        const cards = col.tasks || [];
        if (prefs.hideEmpty && !cards.length && !dragging && !(composer && composer.colKey === col.key)) return null;
        if (col.virtual && !cards.length && !dragging && !(composer && composer.colKey === col.key) && col.key === "__none") return null;
        return (
          <TaskColumn key={col.key} col={col} idx={i} count={groups.length} cards={cards} hiddenCount={hiddenByColumn[col.key] || 0}
            usersById={usersById} labelColors={labelColors} isDoneCol={!col.virtual && doneKey === col.key}
            collapsed={!!prefs.collapsed[col.key]} hideEmpty={prefs.hideEmpty} fields={prefs.fields} compact={prefs.compact} sortManual={sortManual && !col.virtual}
            dnd={dnd} placeholder={dnd.placeholder} dragging={dragging} composer={composer && composer.colKey === col.key ? composer : null}
            focusId={focusId} selection={selection} renamingId={renamingId} subCounts={subCounts} blockedIds={blockedIds}
            actions={actions} colActions={colActions} />
        );
      })}
      {!virtual && <button type="button" onClick={() => colActions.add(groups.length)} title="Adicionar coluna"
        style={{ width: "min(272px, 82vw)", flexShrink: 0, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderRadius: "var(--r-4)", border: "1px dashed var(--line-2)", color: "var(--fg-3)", fontSize: 13, fontWeight: 500, background: "transparent" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; e.currentTarget.style.color = "var(--fg-1)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--fg-3)"; }}>
        <Icon name="plus" size={15} /> Adicionar coluna
      </button>}
    </div>
  );
}
