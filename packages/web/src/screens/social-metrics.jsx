import React from "react";

// Painéis de análise da Mídia social — gráficos em SVG puro, sem lib, herdando
// os tokens do cockpit (adaptam a claro/escuro sozinhos). Seguem o método de
// dataviz: sequencial de um hue (teal) pra magnitude, ênfase pro melhor
// horário, part-to-whole pra alcance seguidor×não-seguidor; marcas finas,
// pontas arredondadas, texto sempre em tinta (--fg), nunca na cor da série.

const { useState: useS, useRef: useR } = React;

const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };

export const fmtNum = (n) => {
  if (n == null || Number.isNaN(n)) return "–";
  const neg = n < 0; const a = Math.abs(n);
  let s;
  if (a >= 1e6) s = `${(a / 1e6).toFixed(1).replace(".", ",")} mi`;
  else if (a >= 1e3) s = `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(".", ",")} mil`;
  else s = String(a);
  return (neg ? "-" : "") + s;
};

// Cartão de seção — o contêiner padrão dos gráficos.
export function SectionCard({ title, right, children, note }) {
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <div className="mono" style={kicker}>{title}</div>
        {note && <span className="mono dim" style={{ fontSize: 10 }}>{note}</span>}
        {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

// Lista de barras horizontais — magnitude, hue único (teal). Rótulo à esquerda,
// barra ao centro, valor à direita. Track recessivo, ponta arredondada 4px.
export function BarList({ items, fmt = fmtNum, color = "var(--accent)", labelW = 120 }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((it) => (
        <div key={it.key ?? it.label} style={{ display: "flex", alignItems: "center", gap: 10 }} title={`${it.label}: ${fmt(it.value)}${it.note ? ` · ${it.note}` : ""}`}>
          <div style={{ width: labelW, flexShrink: 0, fontSize: 12, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</div>
          <div style={{ flex: 1, height: 14, background: "var(--bg-3)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, height: "100%", background: color, borderRadius: 4 }} />
          </div>
          <div className="tnum" style={{ width: 62, flexShrink: 0, textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--fg-1)" }}>
            {fmt(it.value)}{it.pct != null && <span className="dim" style={{ fontWeight: 400 }}> · {it.pct}%</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Barra part-to-whole de 2+ segmentos (alcance seguidor × não-seguidor). Gap de
// 2px entre fills, legenda sempre presente (≥2 séries), % direto no rótulo.
export function SplitBar({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 34, borderRadius: 6, overflow: "hidden", gap: 2, background: "var(--bg-3)" }}>
        {segments.map((s) => (
          <div key={s.label} title={`${s.label}: ${fmtNum(s.value)} (${Math.round((s.value / total) * 100)}%)`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color, minWidth: s.value > 0 ? 3 : 0 }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{s.label}</span>
            <span className="tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)" }}>{fmtNum(s.value)}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Linha/área de uma série no tempo, com crosshair + tooltip no hover. `cumulative`
// soma a série (curva de trajetória, pro ganho de seguidores). Um hue só.
export function AreaLine({ series, height = 132, cumulative = false, fmt = fmtNum, valueLabel = "" }) {
  const ref = useR(null);
  const [hover, setHover] = useS(null);
  if (!series || series.length < 2) return <div className="mono dim" style={{ fontSize: 11, padding: "20px 0" }}>série indisponível pra esse período</div>;

  const pts = [];
  let acc = 0;
  for (const p of series) { acc += p.value; pts.push({ date: p.date, value: cumulative ? acc : p.value }); }
  const W = 640, H = height, padT = 10, padB = 18, padX = 4;
  const vals = pts.map((p) => p.value);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const span = hi - lo || 1;
  const x = (i) => padX + (i / (pts.length - 1)) * (W - 2 * padX);
  const y = (v) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`;
  const zeroY = y(0);

  function onMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const r = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(r * (pts.length - 1)));
  }
  const hp = hover != null ? pts[hover] : null;

  return (
    <div ref={ref} style={{ position: "relative" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        {lo < 0 && <line x1={padX} x2={W - padX} y1={zeroY} y2={zeroY} stroke="var(--line-2)" strokeWidth="1" strokeDasharray="3 3" />}
        <path d={area} fill="var(--accent)" opacity="0.12" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hp && <>
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--fg-4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <circle cx={x(hover)} cy={y(hp.value)} r="4" fill="var(--accent)" stroke="var(--bg-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </>}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span className="mono dim" style={{ fontSize: 9.5 }}>{fmtDay(pts[0].date)}</span>
        <span className="mono dim" style={{ fontSize: 9.5 }}>{fmtDay(pts[pts.length - 1].date)}</span>
      </div>
      {hp && (
        <div style={{
          position: "absolute", top: -6, left: `${(hover / (pts.length - 1)) * 100}%`,
          transform: `translate(-50%, -100%)`, pointerEvents: "none",
          background: "var(--bg-0)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)",
          padding: "5px 8px", boxShadow: "var(--shadow-2)", whiteSpace: "nowrap", zIndex: 2,
        }}>
          <div className="mono dim" style={{ fontSize: 9.5 }}>{fmtDay(hp.date)}</div>
          <div className="tnum" style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(hp.value)} <span className="dim" style={{ fontWeight: 400, fontSize: 10.5 }}>{valueLabel}</span></div>
        </div>
      )}
    </div>
  );
}

// 24 barras de seguidores online por hora — ênfase: horas de pico em teal, o
// resto apagado. Rótulos só em 0/6/12/18/23.
export function HourBars({ hours, bestHours = [] }) {
  const max = Math.max(1, ...hours);
  const best = new Set(bestHours);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 110 }}>
        {hours.map((v, h) => (
          <div key={h} title={`${String(h).padStart(2, "0")}h · ${fmtNum(v)} online`}
            style={{ flex: 1, height: `${Math.max(3, (v / max) * 100)}%`, background: best.has(h) ? "var(--accent)" : "var(--line-2)", borderRadius: "3px 3px 0 0" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {[0, 6, 12, 18, 23].map((h) => <span key={h} className="mono dim" style={{ fontSize: 9.5 }}>{String(h).padStart(2, "0")}h</span>)}
      </div>
    </div>
  );
}

export function InsightsList({ items }) {
  if (!items?.length) return null;
  const tone = { pos: { c: "var(--pos)", bg: "var(--pos-soft)", g: "▲" }, warn: { c: "var(--warn)", bg: "var(--warn-soft)", g: "!" }, info: { c: "var(--accent)", bg: "var(--accent-soft)", g: "→" } };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
      {items.map((it, i) => {
        const t = tone[it.tone] || tone.info;
        return (
          <div key={i} style={{ display: "flex", gap: 10, border: "1px solid var(--line-1)", borderLeft: `3px solid ${t.c}`, borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: "10px 12px" }}>
            <span className="mono" style={{ color: t.c, fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{t.g}</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--fg-1)" }}>{it.text}</span>
          </div>
        );
      })}
    </div>
  );
}

// País ISO → bandeira emoji + nome PT (os que aparecem no público da LeverAds).
const COUNTRY = {
  BR: "🇧🇷 Brasil", US: "🇺🇸 Estados Unidos", PT: "🇵🇹 Portugal", AR: "🇦🇷 Argentina",
  MX: "🇲🇽 México", CO: "🇨🇴 Colômbia", CL: "🇨🇱 Chile", ES: "🇪🇸 Espanha",
  PY: "🇵🇾 Paraguai", UY: "🇺🇾 Uruguai", PE: "🇵🇪 Peru",
};
export const countryLabel = (iso) => COUNTRY[iso] || iso;
const GENDER = { F: "Mulheres", M: "Homens", U: "Não informado" };
export const genderLabel = (g) => GENDER[g] || g;

function fmtDay(d) {
  const t = new Date(d + "T12:00:00Z");
  return Number.isFinite(t.getTime()) ? t.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : d;
}
