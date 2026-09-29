import React from "react";
import { useEsc } from "../atoms.jsx";
import { useIsMobile } from "../lib/responsive.js";
// Menu de contexto/ações com teclado (↑↓ Enter Esc, → abre submenu, ← volta),
// preso na viewport e com submenus. Generaliza o Menu dos mapas mentais.
// items: [{ label, content, kbd, icon, onClick, danger, disabled, checked, sep, children }]
// `content` troca o texto por um nó (ex.: badge); `label` segue como texto
// para a busca por letra e o leitor de tela.
// Posição: { x, y } (clique direito) ou `anchor` (ref/rect, abre embaixo).
// No celular vira folha no rodapé (submenu = segundo nível com "voltar").

const { useEffect, useLayoutEffect, useRef, useState } = React;

const rectOf = (anchor) => {
  if (!anchor) return null;
  if (anchor.current && anchor.current.getBoundingClientRect) return anchor.current.getBoundingClientRect();
  return anchor.left != null ? anchor : null;
};
// Coluna de ícone só quando algum item da lista tem ícone (senão sobra um vão
// à esquerda do texto); o ✓ do item marcado fica sempre à direita.
const hasIcons = (items) => items.some((it) => !it.sep && it.icon);
const Check = ({ style }) => <span aria-hidden="true" style={{ color: "var(--accent)", fontWeight: 700, ...style }}>✓</span>;
const enabled = (items) => items.map((it, i) => (it.sep || it.disabled ? -1 : i)).filter((i) => i >= 0);

const SUB_GAP = 6; // respiro entre o menu e o submenu: um não encosta no outro
// Cantos concêntricos: o destaque do item tem o raio do menu menos o respiro
// interno, senão o fundo do hover fica quadrado dentro de um menu arredondado.
const PAD = 6;
const ITEM_RADIUS = `calc(var(--r-3) - ${PAD}px)`;

function MenuList({ items, x, y, flipX, onClose, onCloseAll, minWidth, level = 0, autoFocus = true }) {
  const ref = useRef(null);
  const [active, setActive] = useState(-1);
  const icons = hasIcons(items);
  const [sub, setSub] = useState(null); // { index, x, y }
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x, top = y;
    // Submenu sem espaço à direita abre à esquerda do menu pai, com o mesmo respiro.
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, level && flipX != null ? flipX - r.width : x - r.width);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [x, y, flipX, items.length, level, minWidth]);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  const openSub = (i) => {
    const it = items[i]; if (!it?.children?.length) return;
    const btn = ref.current?.querySelector(`[data-idx="${i}"]`);
    const r = btn?.getBoundingClientRect();
    const box = ref.current?.getBoundingClientRect();
    // Parte da borda do MENU (não do item, que fica PAD+1px para dentro) e sobe o
    // padding para o 1º item do submenu alinhar com o item que o abriu.
    setSub({ index: i, x: (box?.right ?? x) + SUB_GAP, flipX: (box?.left ?? x) - SUB_GAP, y: (r?.top ?? y) - PAD - 1 });
  };
  const run = (it) => {
    if (it.disabled) return;
    if (it.children?.length) { const i = items.indexOf(it); setActive(i); openSub(i); return; }
    onCloseAll();
    try { it.onClick && it.onClick(); } catch (err) { console.warn("menu action", err); }
  };
  const onKey = (e) => {
    const list = enabled(items);
    if (!list.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); e.stopPropagation();
      const cur = list.indexOf(active);
      const next = e.key === "ArrowDown" ? list[(cur + 1) % list.length] : list[(cur - 1 + list.length) % list.length];
      setActive(next);
    } else if (e.key === "ArrowRight") {
      if (items[active]?.children?.length) { e.preventDefault(); e.stopPropagation(); openSub(active); }
    } else if (e.key === "ArrowLeft" && level > 0) {
      e.preventDefault(); e.stopPropagation(); onClose();
    } else if (e.key === "Enter" || e.key === " ") {
      if (active >= 0) { e.preventDefault(); e.stopPropagation(); run(items[active]); }
    } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
      const k = e.key.toLowerCase();
      const hit = list.find((i) => String(items[i].label || "").toLowerCase().startsWith(k) && i > active) ?? list.find((i) => String(items[i].label || "").toLowerCase().startsWith(k));
      if (hit != null) setActive(hit);
    }
  };

  return (
    <>
      <div ref={ref} tabIndex={-1} role="menu" data-tk-layer="1" onKeyDown={onKey}
        onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}
        style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 90 + level, minWidth: minWidth || 220, maxWidth: 320, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: PAD, outline: "none" }}>
        {items.map((it, i) => it.sep
          ? <div key={"s" + i} role="separator" style={{ height: 1, background: "var(--line-1)", margin: "4px 12px" }} />
          : (
            <button key={i} data-idx={i} role="menuitem" aria-label={it.content ? it.label : undefined} disabled={it.disabled} className={"tk-menu-item" + (active === i ? " is-active" : "")}
              onMouseEnter={() => { setActive(i); if (it.children?.length) openSub(i); else if (sub) setSub(null); }}
              onClick={(e) => { e.stopPropagation(); run(it); }}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: ITEM_RADIUS, fontSize: 12.5, textAlign: "left", color: it.danger ? "var(--neg)" : "var(--fg-1)", opacity: it.disabled ? 0.4 : 1, cursor: it.disabled ? "default" : "pointer" }}>
              {icons && <span style={{ width: 16, display: "inline-flex", justifyContent: "center", color: it.danger ? "var(--neg)" : "var(--fg-3)", flexShrink: 0 }}>{it.icon || ""}</span>}
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.content || it.label}</span>
              {it.checked && <Check style={{ marginLeft: 8 }} />}
              {it.kbd && <span className="kbd" style={{ marginLeft: 8 }}>{it.kbd}</span>}
              {it.children?.length ? <span className="dim" style={{ fontSize: 11 }}>›</span> : null}
            </button>
          ))}
      </div>
      {sub && items[sub.index]?.children?.length ? (
        <MenuList items={items[sub.index].children} x={sub.x} y={sub.y} flipX={sub.flipX} level={level + 1} minWidth={minWidth}
          onClose={() => { setSub(null); ref.current?.focus(); }} onCloseAll={onCloseAll} />
      ) : null}
    </>
  );
}

function Sheet({ items, onCloseAll, title }) {
  const [stack, setStack] = useState([]); // submenus abertos
  const cur = stack.length ? stack[stack.length - 1] : { label: title, items };
  const icons = hasIcons(cur.items);
  return (
    <>
      <div onClick={onCloseAll} style={{ position: "fixed", inset: 0, zIndex: "calc(var(--z-drawer) - 1)", background: "var(--scrim-soft)" }} />
      <div role="menu" data-tk-layer="1" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90, background: "var(--bg-1)", borderRadius: "var(--r-4) var(--r-4) 0 0", boxShadow: "var(--shadow-pop)", maxHeight: "72vh", overflowY: "auto", padding: "8px 8px calc(8px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "6px 8px 8px", gap: 8 }}>
          {stack.length > 0 && <button onClick={() => setStack((s) => s.slice(0, -1))} style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>← Voltar</button>}
          {cur.label && <span className="card-title" style={{ fontSize: 14 }}>{cur.label}</span>}
          <button onClick={onCloseAll} aria-label="Fechar" style={{ marginLeft: "auto", fontSize: 16, color: "var(--fg-3)", width: 32, height: 32 }}>✕</button>
        </div>
        {cur.items.map((it, i) => it.sep
          ? <div key={"s" + i} style={{ height: 1, background: "var(--line-1)", margin: "4px 8px" }} />
          : (
            <button key={i} role="menuitem" disabled={it.disabled} aria-label={it.content ? it.label : undefined}
              onClick={() => { if (it.children?.length) { setStack((s) => [...s, { label: it.label, items: it.children }]); return; } onCloseAll(); it.onClick && it.onClick(); }}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, minHeight: 44, padding: "8px 12px", borderRadius: "calc(var(--r-4) - 8px)", fontSize: 14, textAlign: "left", color: it.danger ? "var(--neg)" : "var(--fg-1)", opacity: it.disabled ? 0.4 : 1 }}>
              {icons && <span style={{ width: 18, display: "inline-flex", justifyContent: "center", color: "var(--fg-3)" }}>{it.icon || ""}</span>}
              <span style={{ flex: 1 }}>{it.content || it.label}</span>
              {it.checked && <Check />}
              {it.children?.length ? <span className="dim">›</span> : null}
            </button>
          ))}
      </div>
    </>
  );
}

export function Menu({ x, y, anchor, items, onClose, minWidth, title }) {
  const isMobile = useIsMobile();
  useEsc(onClose);
  useEffect(() => {
    const onDown = (e) => { if (!e.target.closest?.("[role=menu]")) onClose(); };
    const t = setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);
  const list = (items || []).filter(Boolean);
  if (isMobile) return <Sheet items={list} onCloseAll={onClose} title={title} />;
  const r = rectOf(anchor);
  const px = x ?? (r ? r.left : 8);
  const py = y ?? (r ? r.bottom + 4 : 8);
  return <MenuList items={list} x={px} y={py} onClose={onClose} onCloseAll={onClose} minWidth={minWidth} />;
}
