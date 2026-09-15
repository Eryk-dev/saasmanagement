import React from "react";
import "./kanban.css";

const { useState, useRef } = React;

// Casca dos Kanbans do cockpit (Tarefas, Tickets, Pipeline): o quadro e a
// coluna (cabeçalho, área que recebe o soltar, placeholder, vazio, corte "+N"
// e coluna recolhida). Nada de domínio mora aqui: o card, o menu da coluna, o
// composer e a ordem dos cards são de cada tela. O arrasto vem do useBoardDnd
// (./dnd.js), passado como `dnd`.
//   layout "scroll": colunas de largura fixa lado a lado e cada uma rola
//     sozinha (Tarefas, Tickets).
//   layout "fill": grid de colunas iguais que enche a largura e rola de lado
//     quando não cabe; quem rola na vertical é a página (Pipeline, prancha 14/09).
export function KanbanBoard({ boardRef, layout = "scroll", children }) {
  return <div ref={boardRef} data-board="1" data-layout={layout} className="kb-board">{children}</div>;
}

// A coluna inteira recebe o soltar (cabeçalho incluso); a posição é medida
// pelos cards da lista. `renderItem` devolve o card já com `key`.
export function KanbanColumn({
  colKey, dnd, label, title, count, before, meta, actions, subtitle,
  items, renderItem, canReorder = false, cut = 60, moreLabel = (n) => `+${n}`,
  top = null, bottom = null, footer = null, emptyText = "", highlight = false,
  collapsed = false, onExpand, onCollapse,
}) {
  const listRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const dragging = dnd.drag;
  const placeholder = dnd.placeholder;
  const over = placeholder?.colKey === colKey;
  const drop = dnd.listDropProps(colKey, listRef, { canReorder });

  if (collapsed) {
    return (
      <div role="button" tabIndex={0} className="kb-col-collapsed" data-over={over ? "1" : undefined}
        title={`${label} · ${items.length}. Clique para expandir`} aria-label={`Expandir ${label}`}
        onClick={onExpand} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onExpand?.(); } }} {...drop}>
        <span className="mono tnum kb-collapsed-count">{items.length}</span>
        <span className="tk-strip kb-collapsed-name">{label}</span>
        {before}
        <span ref={listRef} data-col-list="1" hidden />
      </div>
    );
  }

  const shown = expanded ? items : items.slice(0, cut);
  const hidden = items.length - shown.length;
  const ph = over && placeholder.index >= 0 && dragging
    ? <div key="__kb-placeholder" className="kb-placeholder" style={{ height: dragging.height || 56 }} />
    : null;
  const nodes = [];
  shown.forEach((item, i) => {
    if (ph && placeholder.index === i) nodes.push(ph);
    nodes.push(renderItem(item, i));
  });
  if (ph && placeholder.index >= shown.length) nodes.push(ph);

  return (
    <section className="kb-col" data-over={over ? "1" : undefined} data-highlight={highlight ? "1" : undefined} aria-label={label} {...drop}>
      <div className="kb-col-head">
        <div className="kb-col-row">
          {before}
          <div className="kb-col-title">
            {title ?? <span className="kb-col-name">{label}</span>}
            <span className="mono tnum dim kb-col-count">{count ?? items.length}</span>
            {meta}
          </div>
          {(actions || onCollapse) && (
            <span className="tk-hover kb-col-actions">
              {actions}
              {onCollapse && (
                <button type="button" className="kb-col-btn" title="Recolher coluna" aria-label={`Recolher ${label}`} onClick={onCollapse}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /></svg>
                </button>
              )}
            </span>
          )}
        </div>
        {subtitle && <div className="tnum kb-col-sub">{subtitle}</div>}
      </div>
      <div ref={listRef} data-col-list="1" className="kb-col-list">
        {top}
        {nodes}
        {hidden > 0 && <button type="button" className="kb-more" onClick={() => setExpanded(true)}>{moreLabel(hidden)}</button>}
        {expanded && items.length > cut && <button type="button" className="kb-less" onClick={() => setExpanded(false)}>mostrar menos</button>}
        {items.length === 0 && !top && !bottom && !ph && <div className="mono dim kb-empty">{dragging ? "solte aqui" : emptyText}</div>}
        {bottom}
      </div>
      {footer}
    </section>
  );
}
