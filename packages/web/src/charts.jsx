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

  const allVals = series.flatMap(s => s.values || []).concat(totalSeries || []);
  if (!allVals.length) return (
    <div ref={boxRef} className="mono dim" style={{ width: "100%", height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
      sem histórico de MRR ainda
    </div>
  );
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

// ─────────────────────────────────────────────── Funil dinâmico
// Calcula o funil REAL de um SaaS a partir dos dados: para cada estágio configurado
// (s.funnel = [{ stage, flag? }]), conta quantos itens (leads + deals daquele SaaS)
// ALCANÇARAM aquele estágio — i.e. cujo estágio atual está naquele ponto OU adiante.
// Isso dá um funil que só decresce e conversões em 0–100%. A conversão de cada
// estágio é alcançou[i] / alcançou[i-1]. Gargalo é detectado dinamicamente (conv baixa
// com volume suficiente); um flag fixo na config ainda é respeitado.
function computeFunnel(s) {
  const stages = (s.funnel || []).map((f) => f.stage);
  if (!stages.length) return [];
  const seed = window.SEED || {};
  const items = [
    ...(seed.LEADS || []).filter((l) => l.saas === s.id),
    ...(seed.DEALS || []).filter((d) => d.saas === s.id),
  ];
  const idxOf = (st) => stages.indexOf(st);
  const reached = stages.map((_, i) => items.filter((it) => idxOf(it.stage) >= i).length);
  const rows = stages.map((stage, i) => {
    const prev = i === 0 ? null : reached[i - 1];
    const conv = i === 0 ? 1 : prev > 0 ? reached[i] / prev : 0;
    return { stage, count: reached[i], conv, prev, i };
  });
  // Gargalo dinâmico: o estágio (não-primeiro, com entrada >= 3) de MENOR conversão,
  // desde que abaixo de 60%. Sem volume suficiente, nenhum gargalo.
  let worst = null;
  for (const r of rows) {
    if (r.i > 0 && r.prev >= 3 && r.conv < 0.6 && (!worst || r.conv < worst.conv)) worst = r;
  }
  return rows.map((r) => ({ stage: r.stage, count: r.count, conv: r.conv, flag: worst && r.i === worst.i ? "bottleneck" : undefined }));
}

// ─────────────────────────────────────────────── Funnel ladder
// Stages as inverted bars with conversion rate annotation between them.
function FunnelLadder({ stages, accent = "var(--accent)", showCount = true }) {
  const maxCount = Math.max(1, ...stages.map(s => s.count));
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

// ─────────────────────────────────────────────── Funnel view (rich)
// Funil de conversão completo: header (total/ganhos/conversão/perdidos) + barras
// + breakdown "Saíram do funil". Conversão de cada etapa SOBRE O TOTAL DE
// CADASTROS. Etapas terminais (Perdido/Sem resposta/Desqualificado) saem do funil
// linear e viram "perdidos". Estágios POSITIVOS pós-ganho (ex.: Mentoria) não
// entram como etapa — leads ali contam como ganhos. `bare` remove a moldura
// externa (p/ encaixar dentro de outro card). Reusado por Pipeline e Portfólio.
const FUNNEL_LOST_RE = /perdido|lost|sem\s*resposta|nutri|churn|descart|desqualif/i;
const FUNNEL_WON_RE = /ganho|won|fechad|pago/i;

function FunnelView({ s, leads, embedded, bare }) {
  const all = (s.funnel || []).map(f => f.stage);
  const lostStages = all.filter(st => FUNNEL_LOST_RE.test(st));
  const wonIdx = all.findIndex(st => FUNNEL_WON_RE.test(st));
  // Funil linear = do início até o ganho (inclusive), sem terminais. Estágios
  // POSITIVOS pós-ganho (ex.: Mentoria) não entram como etapa do funil.
  const linear = all.filter((st, i) => !FUNNEL_LOST_RE.test(st) && (wonIdx < 0 || i <= wonIdx));
  // Posição no funil de um lead: estágio positivo pós-ganho conta como "chegou
  // ao ganho" (último degrau); terminal/desconhecido = fora (-1).
  const linIdx = st => {
    const i = linear.indexOf(st);
    if (i >= 0) return i;
    const fi = all.indexOf(st);
    if (wonIdx >= 0 && fi > wonIdx && !FUNNEL_LOST_RE.test(st)) return linear.length - 1;
    return -1;
  };
  const total = leads.length; // total de cadastros (denominador)
  const reached = linear.map((_, i) => i === 0 ? total : leads.filter(l => linIdx(l.stage) >= i).length);
  const rows = linear.map((stage, i) => {
    const convTotal = total > 0 ? reached[i] / total : 0;       // % do total de cadastros
    const step = i === 0 ? 1 : reached[i - 1] > 0 ? reached[i] / reached[i - 1] : 0; // queda entre etapas (gargalo)
    return { stage, conv: convTotal, step, count: reached[i], prev: i === 0 ? null : reached[i - 1], i };
  });
  let worst = null;
  for (const r of rows) if (r.i > 0 && r.prev >= 3 && r.step < 0.6 && (!worst || r.step < worst.step)) worst = r;
  const data = rows.map(r => ({ stage: r.stage, count: r.count, conv: r.conv, flag: worst && r.i === worst.i ? "bottleneck" : undefined }));

  // Ganhos = no estágio de ganho OU pós-ganho positivo (ex.: Mentoria/cliente).
  const won = leads.filter(l => { const fi = all.indexOf(l.stage); return wonIdx >= 0 && fi >= wonIdx && !FUNNEL_LOST_RE.test(l.stage); }).length;
  const lost = leads.filter(l => lostStages.includes(l.stage)).length;
  const lostRows = lostStages.map(st => ({ stage: st, count: leads.filter(l => l.stage === st).length }));
  const overall = total > 0 ? won / total : 0;
  const tone = window.productTone ? window.productTone(s) : "var(--accent)";

  const boxStyle = bare
    ? {}
    : { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "16px 18px", background: "var(--bg-1)", maxWidth: 820 };

  const panel = (
    <div style={boxStyle}>
      <div style={{ display: "flex", gap: bare ? 18 : 26, flexWrap: "wrap", marginBottom: bare ? 14 : 18 }}>
        <FunnelStat label="Total de cadastros" value={total} />
        <FunnelStat label="Ganhos" value={won} tone={tone} />
        <FunnelStat label="Conversão geral" value={`${(overall * 100).toFixed(1)}%`} />
        <FunnelStat label="Perdidos / desqualif." value={lost} dim />
      </div>
      {data.length > 0
        ? <FunnelLadder stages={data} accent={tone} />
        : <div className="mono dim" style={{ fontSize: 11 }}>Sem cadastros ainda.</div>}
      {lostRows.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-1)" }}>
          <div className="mono" style={{ fontSize: 9, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 6 }}>Saíram do funil</div>
          {lostRows.map(r => (
            <div key={r.stage} style={{ display: "grid", gridTemplateColumns: "92px 1fr 56px 56px", gap: 8, alignItems: "center", fontFamily: "var(--mono)", fontSize: 10.5, padding: "1.5px 0" }}>
              <span style={{ color: "var(--fg-4)" }}>{r.stage}</span>
              <span />
              <span className="tnum" style={{ color: "var(--fg-3)", textAlign: "right" }}>{r.count}</span>
              <span className="tnum" style={{ color: "var(--fg-4)", textAlign: "right" }}>{total > 0 ? `${(r.count / total * 100).toFixed(0)}%` : ""}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mono dim" style={{ fontSize: 10, marginTop: 14, color: "var(--fg-4)" }}>
        % = sobre o total de cadastros · <span style={{ color: "var(--neg)" }}>gargalo</span> = maior queda entre etapas
      </div>
    </div>
  );
  if (bare || embedded) return panel;
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 24px" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Funil de conversão</div>
      {panel}
    </div>
  );
}

function FunnelStat({ label, value, tone, dim }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 22, fontWeight: 600, color: dim ? "var(--fg-3)" : (tone || "var(--fg-1)"), marginTop: 3 }}>{value}</div>
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

Object.assign(window, { MRRTrajectory, NNMWaterfall, FunnelLadder, MetricTile, BigNumber, MiniBars, productTone, DeltaInline, computeFunnel });

export { MRRTrajectory, NNMWaterfall, FunnelLadder, FunnelView, MetricTile, BigNumber, MiniBars, productTone, DeltaInline, computeFunnel };
