import React from "react";
import { useEsc } from "../atoms.jsx";
import { useIsMobile } from "../lib/responsive.js";
// Popover ancorado (position: fixed, preso na viewport, vira pro lado que cabe).
// No celular vira folha no rodapé. Fecha no Esc (pilha do useEsc) e no clique
// fora. `anchor` = ref de elemento OU um rect { left, top, right, bottom }.
// Padrão único pra filtros, seletor de pessoas, data rápida e menções: antes
// cada tela media e posicionava o próprio dropdown.

const { useEffect, useLayoutEffect, useRef, useState } = React;

const rectOf = (anchor) => {
  if (!anchor) return null;
  if (anchor.current && anchor.current.getBoundingClientRect) return anchor.current.getBoundingClientRect();
  if (typeof anchor.getBoundingClientRect === "function") return anchor.getBoundingClientRect();
  return anchor.left != null ? anchor : null;
};

// Posição calculada de forma SÍNCRONA a partir do âncora (sem fase invisível:
// um elemento com visibility:hidden não recebe foco, e o autofocus dos filhos
// roda no primeiro commit). O useLayoutEffect só refina com a altura real.
function computePos(anchor, { width, align, gap, height = 0 }) {
  const r = rectOf(anchor);
  const iw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const ih = typeof window !== "undefined" ? window.innerHeight : 800;
  if (!r) return { left: 8, top: 8, width: Math.min(width, iw - 16) };
  const w = Math.min(width, iw - 16);
  let left = align === "end" ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, iw - w - 8));
  let top = r.bottom + gap;
  if (height && top + height > ih - 8) top = r.top - gap - height >= 8 ? r.top - gap - height : Math.max(8, ih - height - 8);
  return { left, top, width: w };
}

export function Popover({ anchor, onClose, width = 320, align = "start", gap = 6, title, children, style, maxHeight = 480 }) {
  const isMobile = useIsMobile();
  const ref = useRef(null);
  const [pos, setPos] = useState(() => computePos(anchor, { width, align, gap }));
  useEsc(onClose);

  useLayoutEffect(() => {
    if (isMobile) return undefined;
    const place = () => {
      const el = ref.current;
      const next = computePos(anchor, { width, align, gap, height: el ? el.offsetHeight : 0 });
      setPos((p) => (p && p.left === next.left && p.top === next.top && p.width === next.width ? p : next));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, isMobile, width, align, gap]);

  useEffect(() => {
    const onDown = (e) => {
      const el = ref.current; if (!el) return;
      const a = anchor?.current || (anchor && anchor.contains ? anchor : null);
      if (el.contains(e.target) || (a && a.contains && a.contains(e.target))) return;
      onClose && onClose();
    };
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", onDown); };
  }, [onClose, anchor]);

  const shell = {
    background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)",
    boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column", minHeight: 0,
  };
  if (isMobile) {
    return (
      <>
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 89, background: "oklch(0 0 0 / 0.3)" }} />
        <div ref={ref} data-tk-layer="1" role="dialog" style={{ ...shell, position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90, borderRadius: "var(--r-4) var(--r-4) 0 0", maxHeight: "72vh", paddingBottom: "env(safe-area-inset-bottom)", ...style }}>
          {title && <div style={{ display: "flex", alignItems: "center", padding: "12px 16px 4px" }}><span className="card-title">{title}</span><button onClick={onClose} aria-label="Fechar" style={{ marginLeft: "auto", fontSize: 16, color: "var(--fg-3)", width: 32, height: 32 }}>✕</button></div>}
          <div style={{ overflowY: "auto", minHeight: 0, padding: 10 }}>{children}</div>
        </div>
      </>
    );
  }
  return (
    <div ref={ref} data-tk-layer="1" role="dialog" style={{
      ...shell, position: "fixed", zIndex: 90, left: pos.left, top: pos.top, width: pos.width,
      maxHeight, padding: 8, ...style,
    }}>
      {title && <div className="kicker" style={{ padding: "4px 6px 8px" }}>{title}</div>}
      <div style={{ overflowY: "auto", minHeight: 0 }}>{children}</div>
    </div>
  );
}
