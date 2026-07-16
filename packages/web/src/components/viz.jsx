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
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, rowGap: 10, flexWrap: "wrap", padding: "var(--page-head-top) var(--pad-x) 0", flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--fg-1)" }}>{title}</h1>
        {sub && <div style={{ fontSize: 14.5, color: "var(--fg-3)", marginTop: 4 }}>{sub}</div>}
      </div>
      {children && <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", paddingTop: 6 }}>{children}</div>}
    </div>
  );
}

// Seletor segmentado (período, view). options: [{ value, label }]
export function Segmented({ value, options, onChange }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, background: "var(--bg-2)", flexShrink: 0 }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: value === o.value ? 600 : 500,
          background: value === o.value ? "var(--bg-1)" : "transparent",
          boxShadow: value === o.value ? "var(--shadow-segment)" : "none",
          color: value === o.value ? "var(--fg-1)" : "var(--fg-3)",
          transition: "var(--transition-ui)",
        }}>{o.label}</button>
      ))}
    </div>
  );
}

export function FilterTab({ active, count, children, onClick, style }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      padding: "7px 13px", borderRadius: "var(--r-2)",
      background: active ? "var(--btn-bg)" : hover ? "var(--bg-2)" : "transparent",
      color: active ? "var(--btn-fg)" : hover ? "var(--fg-1)" : "var(--fg-3)",
      fontSize: 13, fontWeight: active ? 600 : 500,
      transition: "var(--transition-ui)", ...style,
    }}>
      {children}
      {count != null && <span className="tnum" style={{ fontSize: 12, color: active ? "color-mix(in srgb, var(--btn-fg) 70%, transparent)" : "var(--fg-4)" }}>{count}</span>}
    </button>
  );
}

export function StatTile({ label, value, small, delta, tone = "flat" }) {
  const valueColor = tone === "down" ? "var(--neg)" : "var(--fg-1)";
  return (
    <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: "20px 24px", minWidth: 0, minHeight: 116 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-3)", marginBottom: 6 }}>{label}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 30, fontWeight: 700, letterSpacing: "-0.025em", whiteSpace: "nowrap", color: valueColor }}>
        {value}{small && <span style={{ fontSize: 14, fontWeight: 500, color: "var(--fg-3)", marginLeft: 4 }}>{small}</span>}
      </div>
      {delta != null && (
        <div style={{ fontSize: 12.5, color: "var(--fg-4)", marginTop: 4 }}>{delta}</div>
      )}
    </section>
  );
}

export function Card({ title, hint, action, children, style }) {
  return (
    <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", minWidth: 0, ...style }}>
      {(title || hint) && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "20px 24px 0", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h3>
          {hint && <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>{hint}</span>}
          {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
        </div>
      )}
      {children}
    </section>
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
    pos: "var(--pos)",
    warn: "var(--warn)",
    neg: "var(--neg)",
  };
  if (tones[tone]) {
    return (
      <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: tones[tone], fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", flexShrink: 0 }} />
        {children}
      </span>
    );
  }
  return (
    <span title={title} style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--r-1)", whiteSpace: "nowrap", color: tone === "accent" ? "var(--accent)" : "var(--fg-2)", background: tone === "accent" ? "var(--accent-soft)" : "var(--bg-2)" }}>
      {children}
    </span>
  );
}

Object.assign(window, { PageHead, Segmented, FilterTab, StatTile, Card, LineChart, Pill });
