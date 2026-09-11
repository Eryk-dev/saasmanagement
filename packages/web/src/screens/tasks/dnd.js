import React from "react";
// Arrastar e soltar nativo (HTML5) do quadro, sem biblioteca: setData (sem ele
// o Firefox nem começa o arrasto), fantasma "N tarefas" no multi-arrasto,
// placeholder calculado pela posição do ponteiro, contador de profundidade
// (dragenter/leave nos filhos não pisca) e auto-scroll nas bordas.

const { useRef, useState, useEffect, useCallback } = React;

export function useBoardDnd({ boardRef, onDrop, getSelection }) {
  const dragRef = useRef(null);        // { ids, fromKey, height }
  const [drag, setDrag] = useState(null);
  const [placeholder, setPlaceholder] = useState(null); // { colKey, index }
  const depth = useRef(new Map());
  const pointer = useRef({ x: 0, y: 0 });
  const raf = useRef(0);
  const ghost = useRef(null);
  const onDropRef = useRef(onDrop); onDropRef.current = onDrop;
  const selRef = useRef(getSelection); selRef.current = getSelection;

  useEffect(() => {
    const onOver = (e) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    document.addEventListener("dragover", onOver);
    return () => document.removeEventListener("dragover", onOver);
  }, []);

  const stopAuto = () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = 0; };
  const autoScroll = useCallback(() => {
    const board = boardRef.current;
    if (board) {
      const { x, y } = pointer.current;
      const r = board.getBoundingClientRect();
      if (x > 0 && x < r.left + 48) board.scrollLeft -= 14;
      else if (x > r.right - 48) board.scrollLeft += 14;
      const el = document.elementFromPoint(x, y);
      const list = el?.closest?.("[data-col-list]");
      if (list) {
        const lr = list.getBoundingClientRect();
        if (y < lr.top + 40) list.scrollTop -= 12;
        else if (y > lr.bottom - 40) list.scrollTop += 12;
      }
    }
    raf.current = requestAnimationFrame(autoScroll);
  }, [boardRef]);

  const cleanup = useCallback(() => {
    dragRef.current = null;
    setDrag(null); setPlaceholder(null);
    depth.current.clear();
    stopAuto();
    if (ghost.current) { ghost.current.remove(); ghost.current = null; }
  }, []);

  const rectsOf = (listEl, ids) => Array.from(listEl?.querySelectorAll("[data-task]") || [])
    .filter((el) => !ids.has(el.dataset.task))
    .map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.task, mid: r.top + r.height / 2 }; });

  const cardDragProps = useCallback((task, colKey) => ({
    draggable: true,
    onDragStart: (e) => {
      const sel = selRef.current ? selRef.current() : null;
      const ids = sel && sel.has(task.id) && sel.size > 1 ? [...sel] : [task.id];
      try { e.dataTransfer.setData("text/plain", task.id); } catch { /* IE */ }
      e.dataTransfer.effectAllowed = "move";
      dragRef.current = { ids, fromKey: colKey, height: e.currentTarget.offsetHeight };
      if (ids.length > 1) {
        const g = document.createElement("div");
        g.textContent = `${ids.length} tarefas`;
        Object.assign(g.style, { position: "fixed", top: "-1000px", left: "-1000px", padding: "8px 12px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "8px", fontSize: "13px", fontWeight: "600", boxShadow: "var(--shadow-pop)", color: "var(--fg-1)" });
        document.body.appendChild(g); ghost.current = g;
        try { e.dataTransfer.setDragImage(g, 16, 16); } catch { /* sem suporte */ }
      }
      const el = e.currentTarget;
      setTimeout(() => { el.classList.add("is-dragging"); setDrag(dragRef.current); }, 0);
      stopAuto(); raf.current = requestAnimationFrame(autoScroll);
    },
    onDragEnd: (e) => { e.currentTarget.classList.remove("is-dragging"); cleanup(); },
  }), [autoScroll, cleanup]);

  const listDropProps = useCallback((colKey, listRef, { canReorder = true } = {}) => ({
    onDragEnter: (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      depth.current.set(colKey, (depth.current.get(colKey) || 0) + 1);
    },
    onDragOver: (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const ids = new Set(dragRef.current.ids);
      const idx = canReorder ? rectsOf(listRef.current, ids).filter((r) => r.mid < e.clientY).length : -1;
      setPlaceholder((p) => (p && p.colKey === colKey && p.index === idx ? p : { colKey, index: idx }));
    },
    onDragLeave: () => {
      const d = (depth.current.get(colKey) || 0) - 1;
      depth.current.set(colKey, Math.max(0, d));
      if (d <= 0) setPlaceholder((p) => (p && p.colKey === colKey ? null : p));
    },
    onDrop: (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const ids = new Set(dragRef.current.ids);
      const rs = rectsOf(listRef.current, ids);
      const idx = canReorder ? rs.filter((r) => r.mid < e.clientY).length : rs.length;
      const { fromKey } = dragRef.current;
      const payload = { ids: [...ids], fromKey, toKey: colKey, beforeId: canReorder ? (rs[idx]?.id || "") : "", afterId: canReorder && idx > 0 ? rs[idx - 1].id : "", index: idx };
      cleanup();
      onDropRef.current && onDropRef.current(payload);
    },
  }), [cleanup]);

  return { drag, placeholder, dragRef, cardDragProps, listDropProps };
}

// Toque longo (celular): abre o menu de contexto no lugar do arrasto.
export function useLongPress(onLong, { ms = 500, move = 8 } = {}) {
  const t = useRef(0), start = useRef(null);
  const cancel = () => { clearTimeout(t.current); t.current = 0; start.current = null; };
  return {
    onTouchStart: (e) => {
      const touch = e.touches[0]; start.current = { x: touch.clientX, y: touch.clientY };
      t.current = setTimeout(() => { t.current = 0; onLong({ x: touch.clientX, y: touch.clientY }); }, ms);
    },
    onTouchMove: (e) => {
      if (!start.current) return;
      const touch = e.touches[0];
      if (Math.abs(touch.clientX - start.current.x) > move || Math.abs(touch.clientY - start.current.y) > move) cancel();
    },
    onTouchEnd: cancel, onTouchCancel: cancel,
  };
}
