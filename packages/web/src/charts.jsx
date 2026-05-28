import React from "react";
// Chart primitives — purpose-built for the SaaS operator cockpit.
// Exports: MRRTrajectory, NNMWaterfall, FunnelLadder, MetricTile, BigNumber, MiniBars

const { useMemo: useM, useState: useSc, useLayoutEffect: useLEc, useRef: useRc, useEffect: useEc } = React;

// Hook: measure element width using clientWidth + window resize listener.
// (ResizeObserver does not fire reliably in some sandboxed iframes.)
function useElementWidth(initial = 600) {
  const ref = useRc(null);
  const [w, setW] = useSc(initial);
  useLEc(() => {
    function measure() {
      if (!ref.current) return;
      const cw = ref.current.clientWidth;
      if (cw > 0) setW(Math.max(280, Math.floor(cw)));
    }
    measure();
    // Schedule a couple of follow-up measurements to catch late layout passes
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 240);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("resize", measure); };
  }, []);
  return [ref, w];
}

// ─────────────────────────────────────────────── Multi-line MRR trajectory
// One line per product, plus an optional "portfolio total" line.
function MRRTrajectory({ series, height = 220, days = 14, totalSeries, annotations = [] }) {
  const [boxRef, width] = useElementWidth(560);
  const padL = 44, padR = 56, padT = 16, padB = 24;
  const plotW = Math.max(60, width - padL - padR);
  const plotH = height - padT - padB;

  const allVals = series.flatMap(s => s.values).concat(totalSeries || []);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;

  const xAt = (i, n) => padL + (i / (n - 1)) * plotW;
  const yAt = (v) => padT + (1 - (v - min) / range) * plotH;

  function path(values) {
    return values.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i, values.length).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ");
  }

  // y-axis ticks (3 lines)
  const ticks = [min, min + range/2, max].map(v => ({ v, y: yAt(v) }));
  const xTicks = [0, Math.floor((days-1)/2), days - 1];

  return (
    <div ref={boxRef} style={{ width: "100%" }}>
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      {/* Grid */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={padL + plotW} y1={t.y} y2={t.y} stroke="var(--line-1)" strokeDasharray="2 3" />
          <text x={padL - 8} y={t.y + 3} fontSize="10" fontFamily="var(--mono)" fill="var(--fg-4)" textAnchor="end">
            R${Math.round(t.v)}k
          </text>
        </g>
      ))}
      {/* Total line (faint, behind) */}
      {totalSeries && (
        <path d={path(totalSeries)} stroke="var(--fg-4)" strokeWidth="1" strokeDasharray="3 3" fill="none" />
      )}
      {/* Product lines */}
      {series.map((s) => (
        <g key={s.id}>
          <path d={path(s.values)} stroke={s.tone || "var(--accent)"} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {/* End-point label */}
          <circle cx={xAt(s.values.length - 1, s.values.length)} cy={yAt(s.values[s.values.length - 1])} r="3" fill={s.tone || "var(--accent)"} />
          <text x={xAt(s.values.length - 1, s.values.length) + 8} y={yAt(s.values[s.values.length - 1]) + 3}
                fontSize="11" fontFamily="var(--mono)" fill={s.tone || "var(--accent)"}>{s.label || s.name}</text>
        </g>
      ))}
      {/* X-axis labels */}
      {xTicks.map((i) => (
        <text key={i} x={xAt(i, days)} y={height - 8} fontSize="10" fontFamily="var(--mono)" fill="var(--fg-4)" textAnchor="middle">
          {i === days - 1 ? "hoje" : `−${days - 1 - i}d`}
        </text>
      ))}
      {/* Annotations (e.g., "Quill churn spike") */}
      {annotations.map((a, i) => {
        const x = xAt(a.dayIndex, days);
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={padT} y2={padT + plotH} stroke="var(--warn)" strokeDasharray="2 3" opacity="0.6" />
            <rect x={x + 4} y={padT - 2} width={a.label.length * 6 + 10} height="16" rx="3" fill="var(--bg-2)" stroke="var(--warn-soft)" />
            <text x={x + 9} y={padT + 9} fontSize="10" fontFamily="var(--mono)" fill="var(--warn)">{a.label}</text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

// ─────────────────────────────────────────────── NNM Waterfall
// data: { new, expansion, contraction, churn } in $
function NNMWaterfall({ data, width = 220, height = 110, compact = false }) {
  const items = [
    { k: "Novo",        v: data.new,         tone: "var(--pos)" },
    { k: "Expansão",    v: data.expansion,   tone: "var(--info)" },
    { k: "Contração",   v: data.contraction, tone: "var(--warn)" },
    { k: "Churn",       v: data.churn,       tone: "var(--neg)" },
  ];
  const net = items.reduce((a, x) => a + x.v, 0);
  const maxAbs = Math.max(...items.map(x => Math.abs(x.v)), Math.abs(net));
  const barH = compact ? 6 : 8;
  const rowH = compact ? 18 : 24;
  return (
    <div style={{ width, fontFamily: "var(--mono)", fontSize: 10 }}>
      {items.map((x) => {
        const w = maxAbs ? (Math.abs(x.v) / maxAbs) * (width - 110) : 0;
        return (
          <div key={x.k} style={{ display: "grid", gridTemplateColumns: "70px 1fr 40px", alignItems: "center", height: rowH, gap: 6 }}>
            <span style={{ color: "var(--fg-3)" }}>{x.k}</span>
            <div style={{ position: "relative", height: barH, background: "var(--bg-3)", borderRadius: 2 }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: w, background: x.tone, opacity: x.v < 0 ? 0.7 : 0.85, borderRadius: 2 }} />
            </div>
            <span className="tnum" style={{ color: x.tone, textAlign: "right" }}>{window.fmt.money(x.v, { sign: true })}</span>
          </div>
        );
      })}
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 40px", borderTop: "1px solid var(--line-1)", paddingTop: 6, marginTop: 4, height: rowH, alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--fg-2)", fontWeight: 500 }}>Líquido</span>
        <span></span>
        <span className="tnum" style={{ color: net >= 0 ? "var(--pos)" : "var(--neg)", textAlign: "right", fontWeight: 500 }}>{window.fmt.money(net, { sign: true })}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Funnel ladder
// Stages as inverted bars with conversion rate annotation between them.
function FunnelLadder({ stages, accent = "var(--accent)", showCount = true }) {
  const maxCount = Math.max(...stages.map(s => s.count));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {stages.map((s, i) => {
        const w = (s.count / maxCount) * 100;
        const flag = s.flag;
        const tone = flag === "bottleneck" ? "var(--neg)" :
                     flag === "regression" ? "var(--warn)" :
                     accent;
        return (
          <React.Fragment key={s.stage}>
            <div style={{ display: "grid", gridTemplateColumns: "92px 1fr 56px 56px", gap: 8, alignItems: "center", fontFamily: "var(--mono)", fontSize: 10.5 }}>
              <span style={{ color: "var(--fg-3)" }}>{String(i+1).padStart(2,"0")} {s.stage}</span>
              <div style={{ height: 14, position: "relative", background: "var(--bg-3)", borderRadius: 2 }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${w}%`, background: tone, opacity: 0.85, borderRadius: 2 }} />
                {flag && (
                  <span style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: tone, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>{({ bottleneck: "gargalo", regression: "regressão" })[flag] || flag}</span>
                )}
              </div>
              <span className="tnum" style={{ color: "var(--fg-2)", textAlign: "right" }}>{showCount ? s.count.toLocaleString() : ""}</span>
              <span className="tnum" style={{ color: i === 0 ? "var(--fg-4)" : (s.flag === "bottleneck" ? "var(--neg)" : "var(--fg-3)"), textAlign: "right" }}>
                {i === 0 ? "—" : `${(s.conv*100).toFixed(0)}%`}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────── Metric tile
function MetricTile({ k, v, d, unit, dUnit, invert, small, sub, footnote }) {
  return (
    <div style={{ padding: small ? "10px 12px" : "14px 16px", background: "var(--bg-1)" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{k}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: small ? 2 : 4 }}>
        <span className="mono tnum" style={{ fontSize: small ? 16 : 22, fontWeight: 500 }}>{v}</span>
        {d != null && <DeltaInline value={d} unit={dUnit || unit} invert={invert} />}
      </div>
      {sub && <div className="mono dim" style={{ fontSize: 10, marginTop: 3 }}>{sub}</div>}
      {footnote && <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>{footnote}</div>}
    </div>
  );
}

function DeltaInline({ value, unit, invert }) {
  if (value === 0 || value == null) return <span className="mono dim tnum" style={{ fontSize: 11 }}>—</span>;
  const dir = value > 0 ? 1 : -1;
  const good = invert ? -dir : dir;
  const color = good > 0 ? "var(--pos)" : "var(--neg)";
  let str = "";
  if (unit === "$" || unit === "money") str = window.fmt.money(value, { sign: true });
  else if (unit === "pct" || unit === "pp") str = window.fmt.pctDelta(value);
  else if (unit === "x") str = `${value > 0 ? "+" : ""}${value.toFixed(2)}x`;
  else str = `${value > 0 ? "+" : ""}${value}`;
  return <span className="mono tnum" style={{ fontSize: 11, color }}>{str}</span>;
}

// ─────────────────────────────────────────────── Big Number (hero)
function BigNumber({ value, label, delta, dUnit, sublabel, invert, size = 36 }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
        <span className="mono tnum" style={{ fontSize: size, fontWeight: 500, letterSpacing: "-0.02em" }}>{value}</span>
        {delta != null && <DeltaInline value={delta} unit={dUnit} invert={invert} />}
      </div>
      {sublabel && <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>{sublabel}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────── Mini bars (cohort retention style)
function MiniBars({ values, max, width = 120, height = 28, tone = "var(--accent)" }) {
  const m = max || Math.max(...values);
  const bw = (width - (values.length - 1) * 2) / values.length;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {values.map((v, i) => {
        const h = (v / m) * (height - 2);
        return <rect key={i} x={i * (bw + 2)} y={height - h} width={bw} height={h} fill={tone} opacity={0.85} rx="1" />;
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────── Product accent color helper
function productTone(s) {
  // Mid-lightness so lines read well on BOTH the paper (light) and charcoal (dark) themes.
  const dark = document.body.dataset.theme === "dark";
  return `oklch(${dark ? 0.74 : 0.56} 0.15 ${s.accent})`;
}

Object.assign(window, { MRRTrajectory, NNMWaterfall, FunnelLadder, MetricTile, BigNumber, MiniBars, productTone, DeltaInline });

export { MRRTrajectory, NNMWaterfall, FunnelLadder, MetricTile, BigNumber, MiniBars, productTone, DeltaInline };
