import React from "react";
// Primitivos visuais do redesign (fase 1): cabeçalho de página, tile de número
// grande, card e gráfico de linha. Padrão Stripe: poucos números grandes no topo,
// linhas simples com rótulo no último ponto. Uma série por gráfico (nunca eixo duplo).

const { useState, useEffect, useRef } = React;

// Largura real do container (os gráficos são SVG com coordenadas absolutas —
// viewBox esticado distorceria o texto).
export function useWidth(initial = 600) {
  const ref = useRef(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setW(e.contentRect.width); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function PageHead({ title, sub, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, rowGap: 8, flexWrap: "wrap", padding: "14px var(--pad-x)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-1)" }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, letterSpacing: "-0.015em" }}>{title}</h1>
        {sub && <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ flex: 1 }} />
      {children}
    </div>
  );
}

// Seletor segmentado (período, view). options: [{ value, label }]
export function Segmented({ value, options, onChange }) {
  return (
    <div style={{ display: "flex", border: "1px solid var(--line-2)", borderRadius: "var(--r-1)", overflow: "hidden", flexShrink: 0 }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: "5px 12px", fontSize: 12.5, fontWeight: 500,
          background: value === o.value ? "var(--bg-2)" : "transparent",
          color: value === o.value ? "var(--fg-1)" : "var(--fg-3)",
        }}>{o.label}</button>
      ))}
    </div>
  );
}

export function StatTile({ label, value, small, delta, tone = "flat" }) {
  const tones = {
    up: { color: "var(--pos)", background: "var(--pos-soft)" },
    down: { color: "var(--neg)", background: "var(--neg-soft)" },
    flat: { color: "var(--fg-3)", background: "var(--hover)" },
  };
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-1)", padding: "14px 16px", minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)" }}>{label}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 6, whiteSpace: "nowrap" }}>
        {value}{small && <span style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-3)", marginLeft: 4 }}>{small}</span>}
      </div>
      {delta != null && (
        <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 500, borderRadius: 999, padding: "2px 9px", marginTop: 8, ...tones[tone] }}>{delta}</span>
      )}
    </div>
  );
}

export function Card({ title, hint, action, children, style }) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-1)", minWidth: 0, ...style }}>
      {(title || hint) && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "13px 16px 0" }}>
          <h3 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 14.5, fontWeight: 700 }}>{title}</h3>
          {hint && <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{hint}</span>}
          {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

// Gráfico de linha de UMA série. data: [{ x: rótulo curto, v: número }].
// Grade horizontal recessiva, área suave, ponto + valor no fim.
export function LineChart({ data, color = "var(--chart-1)", fill = true, height = 190, fmtValue = (v) => String(v) }) {
  const [ref, w] = useWidth();
  const padL = 46, padR = 16, padT = 20, padB = 24;
  const iw = Math.max(40, w - padL - padR);
  const ih = height - padT - padB;
  const vals = (data || []).map((d) => d.v);
  const max = Math.max(1, ...vals);
  const X = (i) => padL + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const Y = (v) => padT + ih - (v / max) * ih;

  if (!data || !data.length) {
    return (
      <div ref={ref} style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-4)", fontSize: 12.5 }}>
        sem dados no período
      </div>
    );
  }

  const pts = data.map((d, i) => `${X(i).toFixed(1)},${Y(d.v).toFixed(1)}`).join(" ");
  const areaPts = `${X(0).toFixed(1)},${Y(0).toFixed(1)} ${pts} ${X(data.length - 1).toFixed(1)},${Y(0).toFixed(1)}`;
  const last = data[data.length - 1];
  const gridVals = [max, max / 2, 0];

  return (
    <div ref={ref} style={{ padding: "0 0 4px" }}>
      <svg width={w} height={height} role="img">
        {gridVals.map((gv, i) => (
          <g key={i}>
            <line x1={padL} y1={Y(gv)} x2={w - padR} y2={Y(gv)} stroke="var(--line-1)" strokeWidth="1" />
            <text x={padL - 8} y={Y(gv) + 3.5} textAnchor="end" style={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" }}>
              {fmtValue(gv)}
            </text>
          </g>
        ))}
        {fill && <polygon points={areaPts} fill={color} opacity="0.08" />}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={X(data.length - 1)} cy={Y(last.v)} r="3.5" fill={color} />
        <text x={Math.min(X(data.length - 1), w - padR) - 2} y={Math.max(12, Y(last.v) - 10)} textAnchor="end"
          style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, fill: "var(--fg-1)" }}>
          {fmtValue(last.v)}
        </text>
        <text x={padL} y={height - 6} style={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" }}>{data[0].x}</text>
        <text x={w - padR} y={height - 6} textAnchor="end" style={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" }}>{last.x}</text>
      </svg>
    </div>
  );
}

// Pill de status pequena (tempo na etapa, horário, alerta).
export function Pill({ tone = "mut", children, title }) {
  const tones = {
    pos: { color: "var(--pos)", background: "var(--pos-soft)" },
    warn: { color: "var(--warn)", background: "var(--warn-soft)" },
    neg: { color: "var(--neg)", background: "var(--neg-soft)" },
    mut: { color: "var(--fg-2)", background: "var(--hover)" },
    accent: { color: "var(--accent)", background: "var(--accent-soft)" },
  };
  return (
    <span className="mono" title={title} style={{ fontSize: 11, fontWeight: 500, padding: "2.5px 9px", borderRadius: 999, whiteSpace: "nowrap", ...tones[tone] }}>
      {children}
    </span>
  );
}

Object.assign(window, { PageHead, Segmented, StatTile, Card, LineChart, Pill });
