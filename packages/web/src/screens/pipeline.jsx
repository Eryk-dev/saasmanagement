import React from "react";
import { Avatar, TrendBadge } from "../atoms.jsx";
import { DeltaInline } from "../charts.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { api } from "../lib/api.js";
// Pipeline — Kanban + List + Forecast tabs. Drag-and-drop between columns.
// Filters: SaaS, owner, score, stuck. Bulk actions on multi-select.

const { useState: useStP, useMemo: useMP } = React;

// Deals come straight from the API (window.SEED.DEALS) — all 3 products, each row
// already carries its own `saas`. A local copy lets drag-and-drop mutate
// optimistically before the move is persisted back to the API.

function PipelineScreen({ saasId, onJump, jumpFilter, onOpenDeal }) {
  const { SAAS } = window.SEED;
  const [activeSaas, setActiveSaas] = useStP(saasId || "leverads");
  const [view, setView] = useStP("kanban"); // kanban | all | list | forecast
  const [deals, setDeals] = useStP(() => window.SEED.DEALS.map(d => ({ ...d })));
  const [highlight, setHighlight] = useStP(jumpFilter?.stage || null);
  const [selected, setSelected] = useStP(new Set());

  const s = SAAS.find(x => x.id === activeSaas) || SAAS[0];

  // Deals for the active product
  const saasDeals = deals.filter(d => d.saas === activeSaas);

  // Group active-product deals by stage
  const stages = s.funnel.map(f => f.stage);
  const byStage = useMP(() => {
    const m = {}; stages.forEach(st => m[st] = []);
    saasDeals.forEach(d => {
      const st = stages.includes(d.stage) ? d.stage : stages[0];
      m[st].push(d);
    });
    return m;
  }, [deals, activeSaas, stages.join("|")]);

  function moveDealTo(dealId, stage) {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage } : d));
    // Persist the move to the API (optimistic — the UI already updated above).
    api.moveDeal(dealId, stage).catch(err => console.warn("deal move not persisted:", err.message));
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, background: "var(--bg-0)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {view !== "all" && <SaasTabs active={activeSaas} onSelect={setActiveSaas} />}
          {view !== "all" && <span style={{ color: "var(--line-2)" }}>·</span>}
          <ViewToggle view={view} onChange={setView} />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Filter label="Owner: All" />
          <Filter label="Score: Hot+Warm" />
          <Filter label="Stuck only" active={!!highlight} onClick={() => setHighlight(highlight ? null : "Discovery")} />
          <Filter label="Source: All" />
          {selected.size > 0 && (
            <span className="mono" style={{ fontSize: 11, color: "var(--accent)", marginLeft: 6 }}>
              {selected.size} selected · <button style={{ color: "var(--accent)", textDecoration: "underline" }}>bulk move</button>
            </span>
          )}
          <span className="kbd" style={{ marginLeft: 4 }}>N</span>
          <span style={{ fontSize: 11, color: "var(--fg-3)", marginRight: 6 }}>new deal</span>
        </div>
      </div>

      {/* Forecast strip — single-product views only */}
      {view !== "all" && <ForecastStrip s={s} deals={saasDeals} />}

      {/* Body */}
      {view === "kanban" && (
        <KanbanBoard
          stages={stages}
          byStage={byStage}
          highlight={highlight}
          onMove={moveDealTo}
          selected={selected}
          setSelected={setSelected}
          onOpenDeal={onOpenDeal}
        />
      )}
      {view === "all" && (
        <AllPipelines deals={deals} onMove={moveDealTo} highlight={highlight} onOpenDeal={onOpenDeal} />
      )}
      {view === "list" && <DealList deals={saasDeals} stages={stages} />}
      {view === "forecast" && <ForecastView s={s} deals={saasDeals} />}
    </div>
  );
}

function SaasTabs({ active, onSelect }) {
  const { SAAS } = window.SEED;
  return (
    <div style={{ display: "flex", gap: 2, padding: 2, background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)" }}>
      {SAAS.map(s => (
        <button key={s.id} onClick={() => onSelect(s.id)} style={{
          padding: "4px 10px", borderRadius: 4,
          background: active === s.id ? "var(--bg-0)" : "transparent",
          color: active === s.id ? "var(--fg-1)" : "var(--fg-3)",
          fontSize: 12, fontWeight: 500,
          border: active === s.id ? "1px solid var(--line-2)" : "1px solid transparent",
        }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: window.productTone(s), marginRight: 6 }} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

function ViewToggle({ view, onChange }) {
  const views = [["kanban","Kanban"],["all","All pipelines"],["list","List"],["forecast","Forecast"]];
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {views.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          padding: "4px 10px", borderRadius: 4,
          background: view === k ? "var(--bg-3)" : "transparent",
          color: view === k ? "var(--fg-1)" : "var(--fg-3)",
          fontSize: 12,
          border: "1px solid " + (view === k ? "var(--line-2)" : "transparent"),
        }}>{label}</button>
      ))}
    </div>
  );
}

function Filter({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      height: 24, padding: "0 8px",
      borderRadius: 4,
      border: "1px solid " + (active ? "var(--accent-line)" : "var(--line-1)"),
      background: active ? "var(--accent-soft)" : "var(--bg-2)",
      color: active ? "var(--accent)" : "var(--fg-3)",
      fontSize: 11,
      fontFamily: "var(--mono)",
    }}>{label}</button>
  );
}

function ForecastStrip({ s, deals }) {
  const tcv = deals.reduce((a, d) => a + d.amount, 0);
  const weighted = deals.reduce((a, d) => {
    const stageIdx = s.funnel.findIndex(f => f.stage === d.stage);
    const probability = stageIdx >= 0 ? s.funnel.slice(stageIdx).reduce((p, f, i) => p * (i === 0 ? 1 : f.conv), 1) : 0;
    return a + d.amount * probability;
  }, 0);
  const won = deals.filter(d => d.stage === "Closed Won").reduce((a, d) => a + d.amount, 0);
  return (
    <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "grid", gridTemplateColumns: "repeat(5, 1fr) auto", gap: 16, alignItems: "center" }}>
      <ForecastCell label="Open TCV"            v={window.fmt.money(tcv)}           d={+0.08} dUnit="pct" />
      <ForecastCell label="Weighted forecast"   v={window.fmt.money(weighted)}      d={+0.04} dUnit="pct" sub="probability × value" />
      <ForecastCell label="Closed-Won MTD"      v={window.fmt.money(won)}           d={+1}    dUnit="int" sub="2 deals" />
      <ForecastCell label="Coverage"            v={`${s.pipelineCoverage?.toFixed(1)}x`} d={+0.2} dUnit="x" sub={`vs 3.0x target`} />
      <ForecastCell label="Avg cycle"           v={`${s.cycleDays}d`} d={s.cycleDelta || -4} dUnit="int" invert sub="median 30d" />
      <button style={{ ...chromeBtnStyleSmall, height: 30, padding: "0 12px" }}><span className="mono" style={{ fontSize: 11 }}>Export ⇣</span></button>
    </div>
  );
}

function ForecastCell({ label, v, d, dUnit, sub, invert }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
        <span className="mono tnum" style={{ fontSize: 16, fontWeight: 500 }}>{v}</span>
        <DeltaInline value={d} unit={dUnit} invert={invert} />
      </div>
      {sub && <div className="mono dim" style={{ fontSize: 10 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────── All pipelines (stacked)
function AllPipelines({ deals, onMove, highlight, onOpenDeal }) {
  const { SAAS } = window.SEED;
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 0" }}>
      {SAAS.map(s => (
        <PipelineBand key={s.id} s={s} deals={deals.filter(d => d.saas === s.id)} onMove={onMove} highlight={highlight} onOpenDeal={onOpenDeal} />
      ))}
    </div>
  );
}

function PipelineBand({ s, deals, onMove, highlight, onOpenDeal }) {
  const [dragging, setDragging] = useStP(null);
  const [noop, setNoop] = useStP(new Set());
  const stages = s.funnel.map(f => f.stage);
  const byStage = {};
  stages.forEach(st => byStage[st] = []);
  deals.forEach(d => {
    const st = stages.includes(d.stage) ? d.stage : stages[0];
    byStage[st].push(d);
  });
  const tcv = deals.reduce((a, d) => a + (d.amount || 0), 0);
  const tone = window.productTone(s);

  return (
    <div style={{ marginBottom: 8, borderBottom: "1px solid var(--line-1)", paddingBottom: 8 }}>
      {/* Band header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 24px 10px", position: "sticky", left: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: tone }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</span>
          <span className="mono dim" style={{ fontSize: 11 }}>{s.tag}</span>
          <TrendBadge trend={s.healthTrend} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <span className="mono dim" style={{ fontSize: 11 }}>{deals.length} deals</span>
          <span className="mono tnum" style={{ fontSize: 13 }}>{window.fmt.money(tcv)} <span className="dim">open TCV</span></span>
        </div>
      </div>
      {/* Horizontal kanban */}
      <div style={{ overflowX: "auto", padding: "0 24px 4px", display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(220px, 1fr)", gap: 10, alignItems: "start" }}>
        {stages.map(st => (
          <KanbanColumn key={st}
            stage={st}
            cards={byStage[st] || []}
            highlight={highlight === st}
            onDropCard={(id) => { onMove(id, st); setDragging(null); }}
            dragging={dragging}
            setDragging={setDragging}
            selected={noop}
            setSelected={setNoop}
            onOpenDeal={onOpenDeal}
            compact
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Kanban
function KanbanBoard({ stages, byStage, highlight, onMove, selected, setSelected, onOpenDeal }) {
  const [dragging, setDragging] = useStP(null);
  return (
    <div style={{ flex: 1, overflowX: "auto", padding: 14, display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(260px, 1fr)", gap: 10, alignItems: "start" }}>
      {stages.map(st => (
        <KanbanColumn key={st}
          stage={st}
          cards={byStage[st] || []}
          highlight={highlight === st}
          onDropCard={(id) => { onMove(id, st); setDragging(null); }}
          dragging={dragging}
          setDragging={setDragging}
          selected={selected}
          setSelected={setSelected}
          onOpenDeal={onOpenDeal}
        />
      ))}
    </div>
  );
}

function KanbanColumn({ stage, cards, highlight, onDropCard, dragging, setDragging, selected, setSelected, compact, onOpenDeal }) {
  const [over, setOver] = useStP(false);
  const total = cards.reduce((a, d) => a + d.amount, 0);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (dragging) onDropCard(dragging); }}
      style={{
        background: "var(--bg-1)",
        border: "1px solid " + (highlight ? "var(--neg)" : over ? "var(--accent-line)" : "var(--line-1)"),
        borderRadius: "var(--r-3)",
        padding: 10,
        minHeight: compact ? 120 : 240,
        display: "flex", flexDirection: "column", gap: 6,
        boxShadow: highlight ? "0 0 0 1px oklch(0.68 0.18 25 / 0.2)" : "none",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 4px 6px", borderBottom: "1px solid var(--line-1)" }}>
        <div style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
          {highlight && <span className="dot" style={{ color: "var(--neg)" }} />}
          {stage}
          <span className="mono dim" style={{ fontSize: 10 }}>{cards.length}</span>
        </div>
        <span className="mono tnum dim" style={{ fontSize: 11 }}>{window.fmt.money(total)}</span>
      </div>
      {cards.map(d => (
        <DealCard
          key={d.id} d={d}
          onDragStart={() => setDragging(d.id)}
          selected={selected.has(d.id)}
          onSelect={() => {
            const next = new Set(selected); next.has(d.id) ? next.delete(d.id) : next.add(d.id); setSelected(next);
          }}
          onOpen={() => onOpenDeal && onOpenDeal(d)}
        />
      ))}
      {cards.length === 0 && <div className="mono dim" style={{ fontSize: 11, textAlign: "center", padding: "20px 0" }}>empty</div>}
    </div>
  );
}

function DealCard({ d, onDragStart, selected, onSelect, onOpen }) {
  const { PEOPLE } = window.SEED;
  const owner = PEOPLE[d.owner];
  const scoreTone = d.score === "hot" ? "var(--neg)" : d.score === "warm" ? "var(--warn)" : "var(--fg-4)";
  const stuckTone = d.flag === "stuck" ? "var(--neg)" : "transparent";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { if (e.shiftKey) onSelect(); else onOpen && onOpen(); }}
      style={{
        background: "var(--bg-2)",
        border: "1px solid " + (selected ? "var(--accent-line)" : "var(--line-1)"),
        borderLeft: `2px solid ${scoreTone}`,
        borderRadius: "var(--r-2)",
        padding: "8px 10px",
        cursor: "grab",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{d.title}</span>
        <span className="mono tnum dim" style={{ fontSize: 11, flexShrink: 0 }}>{window.fmt.money(d.amount)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--fg-3)", minWidth: 0 }}>
          <Avatar id={d.owner} name={owner?.name || d.owner} size={16} />
          <span className="mono">{d.age}d</span>
          {d.flag === "stuck" && <span className="mono" style={{ color: "var(--neg)" }}>· stuck</span>}
          {d.proposal && <span className="mono" style={{ color: "var(--accent)" }}>· prop</span>}
        </div>
        <span className="mono dim" style={{ fontSize: 10 }}>{d.source}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── List view
function DealList({ deals }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 24px" }}>
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
        <div className="mono" style={{
          display: "grid", gridTemplateColumns: "1.6fr 1fr 0.6fr 0.6fr 0.6fr 0.6fr 0.8fr",
          padding: "8px 12px",
          background: "var(--bg-inset)",
          fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase",
          borderBottom: "1px solid var(--line-1)",
        }}>
          <span>Deal</span><span>Stage</span><span style={{ textAlign: "right" }}>Amount</span>
          <span>Owner</span><span>Age</span><span>Score</span><span>Source</span>
        </div>
        {deals.map(d => (
          <div key={d.id} style={{
            display: "grid", gridTemplateColumns: "1.6fr 1fr 0.6fr 0.6fr 0.6fr 0.6fr 0.8fr",
            padding: "8px 12px",
            borderBottom: "1px solid var(--line-1)",
            alignItems: "center",
            fontSize: 13,
          }}>
            <span style={{ fontWeight: 500 }}>{d.title} {d.flag === "stuck" && <span style={{ color: "var(--neg)", fontSize: 10, marginLeft: 4 }}>stuck</span>}</span>
            <span className="mono dim" style={{ fontSize: 12 }}>{d.stage}</span>
            <span className="mono tnum" style={{ textAlign: "right" }}>{window.fmt.money(d.amount)}</span>
            <span className="mono dim" style={{ fontSize: 12 }}>{d.owner}</span>
            <span className="mono dim tnum" style={{ fontSize: 12 }}>{d.age}d</span>
            <span className="mono" style={{ fontSize: 12, color: d.score === "hot" ? "var(--neg)" : d.score === "warm" ? "var(--warn)" : "var(--fg-3)" }}>{d.score}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{d.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Forecast view
function ForecastView({ s, deals }) {
  const buckets = s.funnel.map((f, i) => {
    const dealsAt = deals.filter(d => d.stage === f.stage);
    const tcv = dealsAt.reduce((a, d) => a + d.amount, 0);
    const prob = s.funnel.slice(i).reduce((p, x, j) => p * (j === 0 ? 1 : x.conv), 1);
    return { stage: f.stage, tcv, prob, weighted: tcv * prob, count: dealsAt.length };
  });
  const max = Math.max(...buckets.map(b => b.tcv));
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "14px 18px", background: "var(--bg-1)" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Forecast by stage · weighted by historical conversion</div>
        {buckets.map(b => (
          <div key={b.stage} style={{ display: "grid", gridTemplateColumns: "120px 1fr 90px 90px 60px", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line-1)" }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>{b.stage}</span>
            <div style={{ height: 14, background: "var(--bg-3)", borderRadius: 3, position: "relative" }}>
              <div style={{ position: "absolute", inset: 0, width: `${(b.tcv/max)*100}%`, background: "var(--accent)", opacity: 0.25, borderRadius: 3 }} />
              <div style={{ position: "absolute", inset: 0, width: `${(b.weighted/max)*100}%`, background: "var(--accent)", borderRadius: 3 }} />
            </div>
            <span className="mono tnum" style={{ fontSize: 12, textAlign: "right" }}>{window.fmt.money(b.tcv)}</span>
            <span className="mono tnum" style={{ fontSize: 12, textAlign: "right", color: "var(--accent)" }}>{window.fmt.money(b.weighted)}</span>
            <span className="mono dim tnum" style={{ fontSize: 11, textAlign: "right" }}>{(b.prob*100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { PipelineScreen };
