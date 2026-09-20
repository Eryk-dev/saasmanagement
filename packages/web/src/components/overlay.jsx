import React from "react";
import { useEsc } from "../atoms.jsx";
import { ErrorBoundary } from "./error-boundary.jsx";

// A moldura dos painéis, escrita uma vez (14/09/2026).
//
// Eram mais de trinta overlays à mão, com CINCO cores de véu diferentes
// (oklch .45, oklch .4, rgba(8,18,26,.45), rgba(0,0,0,.35) e um color-mix
// claro que deixava o fundo lavado em umas telas e escuro em outras) e
// z-index de 60 a 1200 sem escala. Quem abre painel novo usa Modal ou Drawer
// daqui: o véu, a camada, o Esc, o clique fora e o ErrorBoundary já vêm.
//
// `fechavel={false}` enquanto salva: o Esc e o clique fora param, como o
// useEsc(null) já fazia. Alarme que exige decisão (WaHotAlert, TrainingGate)
// segue sendo exceção deliberada e não usa estas peças.

function Shell({ onClose, fechavel = true, label, camada, veu, alinhamento, padding, children, style }) {
  useEsc(fechavel ? onClose : null);
  return (
    <div
      onClick={fechavel ? onClose : undefined}
      style={{
        position: "fixed", inset: 0, zIndex: camada, background: veu,
        display: "flex", justifyContent: alinhamento.justify, alignItems: alinhamento.align,
        padding, ...style,
      }}
    >
      <ErrorBoundary variant="modal" label={label} onReset={onClose}>
        {children}
      </ErrorBoundary>
    </div>
  );
}

// Modal centrado. `largura` vira max-width; o painel nunca passa da janela.
export function Modal({ onClose, fechavel = true, label, largura = 560, padding = 16, children, style, painelStyle }) {
  return (
    <Shell onClose={onClose} fechavel={fechavel} label={label}
      camada="var(--z-modal)" veu="var(--scrim)"
      alinhamento={{ justify: "center", align: "center" }} padding={padding} style={style}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={label}
        style={{
          width: `min(${largura}px, 100%)`, maxHeight: "calc(100dvh - 32px)", overflow: "auto",
          background: "var(--bg-1)", border: 0, borderRadius: "var(--r-4)",
          boxShadow: "var(--shadow-pop)", ...painelStyle,
        }}>
        {children}
      </div>
    </Shell>
  );
}

// Gaveta lateral. Detalhe é gaveta sobre a tela, nunca rota nova.
export function Drawer({ onClose, fechavel = true, label, largura = 520, children, style, painelStyle }) {
  return (
    <Shell onClose={onClose} fechavel={fechavel} label={label}
      camada="var(--z-drawer)" veu="var(--scrim-soft)"
      alinhamento={{ justify: "flex-end", align: "stretch" }} padding={12} style={style}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={label}
        style={{
          width: `min(${largura}px, 100%)`, height: "100%", overflow: "auto", borderRadius: "var(--r-4)",
          background: "var(--bg-1)", borderLeft: 0,
          boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column", ...painelStyle,
        }}>
        {children}
      </div>
    </Shell>
  );
}

// Passos numerados no CABEÇALHO do painel, não parágrafo de instrução no pé:
// fluxo de várias etapas diz onde você está antes de você começar a preencher.
// (régua de 12/09, redesign de Contratos)
export function PassosDoPainel({ passos = [], atual = 0, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", ...style }}>
      {passos.map((p, i) => (
        <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: i === atual ? 700 : 500, color: i === atual ? "var(--fg-1)" : "var(--fg-4)" }}>
          <span className="tnum" style={{
            width: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700,
            background: i === atual ? "var(--accent-soft)" : "var(--bg-2)",
            color: i === atual ? "var(--accent)" : "var(--fg-4)",
          }}>{i + 1}</span>
          {p}
          {i < passos.length - 1 && <span style={{ color: "var(--line-2)", marginLeft: 4 }}>·</span>}
        </span>
      ))}
    </div>
  );
}
