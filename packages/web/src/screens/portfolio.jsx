import React from "react";
import { Led, Sparkline, TrendBadge, EmptyState } from "../atoms.jsx";
import { MRRTrajectory, NNMWaterfall, FunnelLadder, DeltaInline, computeFunnel } from "../charts.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
// Portfolio (Founder home) — the cockpit's hero screen.
// Operator-grade metrics: MRR trajectory hero + dense product rails + lateral attention.

function PortfolioScreen({ onNav, onJump }) {
  const { SAAS, PORTFOLIO, ATTENTION, GOALS } = window.SEED;

  if (!SAAS.length) return (
    <EmptyState
      title="Nenhum produto ainda"
      hint="Conecte um SaaS para começar — POST /api/products na REST, ou a tool update_product_metrics / create_deal no MCP. Os dados aparecem aqui na hora." />
  );

  // Build MRR trajectory series (per-product, in $k for chart units)
  const series = SAAS.map(s => ({
    id: s.id, name: s.name, label: s.name,
    values: s.mrrSeries,
    tone: window.productTone(s),
  }));
  const totalSeries = PORTFOLIO.mrrSeries30d.slice(-14);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto", background: "var(--bg-0)" }}>
      {/* Tape — portfolio totals strip */}
      <PortfolioTape />

      {/* Hero: chart + attention */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", borderBottom: "1px solid var(--line-1)" }}>
        <div style={{ padding: "18px 24px", borderRight: "1px solid var(--line-1)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <div className="bkt">mrr do portfólio · 14d</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                <span className="serif tnum" style={{ fontSize: 34, fontWeight: 600, color: "var(--fg-1)", lineHeight: 1 }}>{window.fmt.money(PORTFOLIO.mrr)}</span>
                <span className="tnum" style={{ fontSize: 13, fontWeight: 510, color: "var(--pos)" }}>
                  <span style={{ fontSize: 9 }}>↑</span> {window.fmt.money(PORTFOLIO.mrrDelta, { sign: true })}
                  <span className="dim" style={{ marginLeft: 6, fontWeight: 450 }}>MoM</span>
                </span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
              {SAAS.map(s => (
                <div key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11 }}>
                  <span className="mono" style={{ color: "var(--fg-3)" }}>{s.name}</span>
                  <span style={{ width: 14, height: 2, background: window.productTone(s), display: "inline-block" }} />
                </div>
              ))}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11 }}>
                <span className="mono dim">Portfólio</span>
                <span style={{ width: 14, height: 0, borderTop: "1.5px dashed var(--fg-4)", display: "inline-block" }} />
              </div>
            </div>
          </div>
          <MRRTrajectory
            series={series.map(s => ({ ...s, values: s.values }))}
            totalSeries={totalSeries.map(v => v / 3)}
            width={660}
            height={224}
            days={14}
            annotations={[{ dayIndex: 9, label: "pico de churn Quill" }]}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Led tone="var(--neg)" pulse />
              <div>
                <div className="bkt">atenção</div>
                <div className="mono dim" style={{ fontSize: 10, marginTop: 3 }}>{ATTENTION.length} sinais · sev × idade</div>
              </div>
            </div>
            <button onClick={() => onJump && onJump({ type: "attention" })} style={{ ...chromeBtnStyleSmall }}>
              <span className="mono" style={{ fontSize: 11 }}>ver todos</span>
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {ATTENTION.slice(0, 4).map((a, i) => <AttentionItem key={a.id} a={a} idx={i} onJump={onJump} />)}
          </div>
        </div>
      </div>

      {/* Product rails */}
      <div style={{ padding: "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
          <div>
            <div className="bkt">produtos</div>
            <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>3 produtos · ordenado por atenção · clique numa célula pra detalhar</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <ToolbarChip label="Ordem: atenção ↓" />
            <ToolbarChip label="Período: 14d" />
            <ToolbarChip label="Comparar" icon="⇄" onClick={() => onNav && onNav("saas")} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SAAS.map(s => <ProductRail key={s.id} s={s} onNav={onNav} />)}
        </div>
      </div>

      {/* Goals strip */}
      <div style={{ padding: "0 24px 18px", display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 14 }}>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="bkt">metas · este mês</div>
              <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>dia 12 / 31 · faixas verde/amarelo/vermelho</div>
            </div>
            <button onClick={() => onNav && onNav("goals")} style={chromeBtnStyleSmall}><span className="mono" style={{ fontSize: 11 }}>abrir metas →</span></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--line-1)" }}>
            {GOALS.slice(0, 6).map(g => <GoalCell key={g.id} g={g} />)}
          </div>
        </div>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="bkt">hoje · últimas 24h</div>
          <SignalRow label="Leads criados"      v="—" />
          <SignalRow label="Propostas enviadas" v="—" />
          <SignalRow label="Propostas vistas"   v="—" />
          <SignalRow label="Deals avançados"    v="—" />
          <SignalRow label="Novos clientes"     v="—" />
          <SignalRow label="Detratores (NPS≤6)" v="—" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Tape (portfolio totals)
function PortfolioTape() {
  const { PORTFOLIO, SAAS } = window.SEED;
  const sum = (fn) => SAAS.reduce((a, s) => a + (fn(s) || 0), 0);
  const nnmNet = sum(s => (s.nnm?.new || 0) + (s.nnm?.expansion || 0) + (s.nnm?.contraction || 0) + (s.nnm?.churn || 0));
  const tcvTotal = sum(s => s.tcv);
  const custDelta = sum(s => s.customersDelta);
  const healthAvg = SAAS.length ? Math.round(sum(s => s.health) / SAAS.length) : 0;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(7, 1fr)",
      borderBottom: "1px solid var(--line-1)",
      background: "var(--bg-inset)",
    }}>
      <TapeCell label="MRR"          value={window.fmt.money(PORTFOLIO.mrr)}           delta={PORTFOLIO.mrrDelta} dUnit="$" />
      <TapeCell label="ARR"          value={window.fmt.money(PORTFOLIO.arr)}           sub="anualizado" />
      <TapeCell label="Novo MRR líq." value={window.fmt.money(nnmNet, { sign: true })}  sub="este mês" tone={nnmNet >= 0 ? "var(--pos)" : "var(--neg)"} />
      <TapeCell label="NRR (pond.)"    value={window.fmt.pct(PORTFOLIO.nrr)}             sub="retenção líq." />
      <TapeCell label="TCV pipeline" value={window.fmt.money(tcvTotal)}                sub="qualificado+" />
      <TapeCell label="Clientes"     value={window.fmt.int(PORTFOLIO.customers)}       delta={custDelta} dUnit="int" sub="ativos" />
      <TapeCell label="Saúde (méd.)" value={String(healthAvg)}                         sub="ponderado" last />
    </div>
  );
}

function TapeCell({ label, value, delta, dUnit, sub, tone, last }) {
  return (
    <div style={{
      padding: "12px 16px",
      borderRight: last ? "none" : "1px solid var(--line-1)",
    }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span className="mono tnum" style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.01em", color: tone || "var(--fg-1)" }}>{value}</span>
        {delta != null && <DeltaInline value={delta} unit={dUnit} />}
      </div>
      {sub && <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────── Attention queue item
function AttentionItem({ a, idx, onJump }) {
  const { SAAS } = window.SEED;
  const saas = SAAS.find(s => s.id === a.saas);
  const sev = a.severity === "critical" ? "var(--neg)" :
              a.severity === "high"     ? "var(--accent)" :
                                          "var(--warn)";
  return (
    <button
      onClick={() => onJump && onJump(a.link)}
      style={{
        display: "block", textAlign: "left", width: "100%",
        padding: "12px 16px",
        borderBottom: "1px solid var(--line-1)",
        background: idx === 0 ? "var(--neg-soft)" : "transparent",
      }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="dot" style={{ color: sev, width: 6, height: 6 }} />
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{saas?.name}</span>
        </div>
        <span className="mono dim" style={{ fontSize: 10 }}>{a.age}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--fg-1)", marginTop: 4, lineHeight: 1.4 }}>{a.title}</div>
      <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>{a.detail}</div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>{a.metric} <span className="tnum" style={{ color: "var(--fg-1)" }}>{a.value}</span></span>
        <span className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>ir ↗</span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────── Product rail
function ProductRail({ s, onNav }) {
  const tone = window.productTone(s);
  return (
    <div
      onClick={() => onNav && onNav("saas", { saas: s.id })}
      style={{
        border: "1px solid var(--line-1)",
        borderLeft: `2px solid ${tone}`,
        background: "var(--bg-1)",
        borderRadius: "var(--r-3)",
        display: "grid",
        gridTemplateColumns: "minmax(220px, 240px) minmax(220px, 1fr) 220px minmax(280px, 1.2fr) 220px",
        cursor: "pointer",
      }}>
      {/* Col 1: identity */}
      <div style={{ padding: "14px 16px", borderRight: "1px solid var(--line-1)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.name}</span>
            <TrendBadge trend={s.healthTrend} />
          </div>
          <div className="mono dim" style={{ fontSize: 10, marginTop: 4 }}>{s.tag}</div>
        </div>
        <div className="mono dim" style={{ fontSize: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span>{s.motion}</span>
          <span>·</span>
          <span>{s.plan}</span>
          <span>·</span>
          <span>~{s.cycleDays}d cycle</span>
        </div>
      </div>

      {/* Col 2: MRR + sparkline */}
      <div style={{ padding: "14px 16px", borderRight: "1px solid var(--line-1)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>MRR</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
            <span className="mono tnum" style={{ fontSize: 22, fontWeight: 500 }}>{window.fmt.money(s.mrr)}</span>
            <DeltaInline value={s.mrrDelta} unit="$" />
          </div>
          <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>ARR anualizado {window.fmt.money(s.arr)}</div>
        </div>
        <div>
          <Sparkline data={s.mrrSeries} width={200} height={32} stroke={tone} />
        </div>
      </div>

      {/* Col 3: NNM waterfall */}
      <div style={{ padding: "14px 16px", borderRight: "1px solid var(--line-1)" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Novo MRR líq. · MoM</div>
        <NNMWaterfall data={s.nnm} width={196} compact />
      </div>

      {/* Col 4: funnel */}
      <div style={{ padding: "14px 16px", borderRight: "1px solid var(--line-1)" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
          Funil · {s.funnel.length} estágios
        </div>
        <FunnelLadder stages={computeFunnel(s)} accent={tone} />
      </div>

      {/* Col 5: vitals */}
      <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignContent: "space-between" }}>
        <MicroStat k="NRR"        v={window.fmt.pct(s.nrr)}           d={s.nrrDelta} dUnit="pp" />
        <MicroStat k="ACV"        v={window.fmt.money(s.acv)}         d={s.acvDelta} dUnit="pct" />
        <MicroStat k="Activation" v={window.fmt.pct(s.activation)}    d={s.activationDelta} dUnit="pp" />
        <MicroStat k="Churn /mo"  v={window.fmt.pct(s.churnRate, 1)}  d={s.churnRate > 0.04 ? +0.01 : 0} dUnit="pp" invert />
        <MicroStat k="Win rate"   v={window.fmt.pct(s.winRate)}       d={s.winRateDelta} dUnit="pp" />
        <MicroStat k="NPS"        v={s.nps}                           d={s.npsDelta} dUnit="int" />
        <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6, borderTop: "1px solid var(--line-1)", marginTop: 2 }}>
          <span className="mono dim" style={{ fontSize: 10 }}>{s.customers.toLocaleString()} clientes {window.fmt.int(s.customersDelta, { sign: true })}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>abrir →</span>
        </div>
      </div>
    </div>
  );
}

function MicroStat({ k, v, d, dUnit, invert }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 9, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{k}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 1 }}>
        <span className="mono tnum" style={{ fontSize: 13, fontWeight: 500 }}>{v}</span>
        <DeltaInline value={d} unit={dUnit} invert={invert} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Goals cell
function GoalCell({ g }) {
  const pct  = (g.current   / g.target) * 100;
  const proj = (g.projected / g.target) * 100;
  const tone = g.band === "green" ? "var(--pos)" : g.band === "yellow" ? "var(--warn)" : "var(--neg)";
  const fmt = (v) => g.unit === "$" ? window.fmt.money(v)
                  : g.unit === "pct" ? window.fmt.pct(v)
                  : g.unit === "x"   ? window.fmt.ratio(v)
                  :                    v;
  return (
    <div style={{ padding: "12px 14px", background: "var(--bg-1)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{g.scope}</span>
          <div style={{ fontSize: 13, color: "var(--fg-1)", marginTop: 2 }}>{g.name}</div>
        </div>
        <span className="mono tnum" style={{ fontSize: 13, color: tone }}>{Math.round(g.invert ? (g.target / g.current) * 100 : pct)}%</span>
      </div>
      <div style={{ position: "relative", height: 6, background: "var(--bg-3)", borderRadius: 3, marginTop: 8 }}>
        <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${Math.min(100, proj)}%`, background: "var(--bg-3)", borderRight: "1px dashed var(--line-strong)" }} />
        <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${Math.min(100, pct)}%`, background: tone, borderRadius: 3, opacity: 0.85 }} />
      </div>
      <div className="mono dim" style={{ fontSize: 10, marginTop: 4, display: "flex", justifyContent: "space-between" }}>
        <span>now {fmt(g.current)} · proj {fmt(g.projected)}</span>
        <span>target {fmt(g.target)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Signal row
function SignalRow({ label, v, d, invert }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{label}</span>
      <span className="mono tnum" style={{ fontSize: 13, color: "var(--fg-1)" }}>{v}</span>
      <DeltaInline value={d} unit="int" invert={invert} />
    </div>
  );
}

// ─────────────────────────────────────────────── Toolbar chip
function ToolbarChip({ label, icon, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      height: 26, padding: "0 10px",
      border: "1px solid " + (active ? "var(--line-strong)" : "var(--line-1)"),
      background: active ? "var(--bg-3)" : "var(--bg-2)",
      borderRadius: "var(--r-2)",
      color: "var(--fg-2)",
      fontSize: 12,
      fontFamily: "var(--mono)",
    }}>
      {icon && <span className="mono dim">{icon}</span>}
      {label}
    </button>
  );
}


export { PortfolioScreen, ToolbarChip, GoalCell };
