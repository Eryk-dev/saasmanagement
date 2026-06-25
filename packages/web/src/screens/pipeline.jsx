import React from "react";
import { Avatar, TrendBadge, EmptyState, PrimaryButton } from "../atoms.jsx";
import { DeltaInline } from "../charts.jsx";
import { chromeBtnStyleSmall, leadScoreTone, leadAge, waLink } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
// Pipeline — Kanban + List + Forecast tabs. Drag-and-drop between columns.
// Funil unificado: os LEADS são os cards do pipeline (window.SEED.LEADS). Cada
// lead já carrega seu `saas` + `stage`. Uma cópia local deixa o drag-and-drop
// mutar otimisticamente antes de persistir (PATCH /api/leads/:id).
// Filtros: SaaS, prioridade (P0/P1/P2).

const { useState: useStP, useMemo: useMP } = React;

function PipelineScreen({ saasId, onJump, jumpFilter, onOpenLead }) {
  const { SAAS } = window.SEED;
  const { openForm } = useData();
  const [activeSaas, setActiveSaas] = useStP(saasId || "leverads");
  const [view, setView] = useStP("kanban"); // kanban | all | list | forecast
  const [leads, setLeads] = useStP(() => window.SEED.LEADS.map(l => ({ ...l })));
  const [highlight, setHighlight] = useStP(jumpFilter?.stage || null);
  const [selected, setSelected] = useStP(new Set());
  const [pri, setPri] = useStP("all");

  const s = SAAS.find(x => x.id === activeSaas) || SAAS[0];

  // Priority filter is global (kanban + list + all). Forecast deliberately uses the
  // full product pipeline so the $ totals don't shrink when narrowing by priority.
  const priLeads = pri === "all" ? leads : leads.filter(l => l.priority === pri);
  const saasLeads = priLeads.filter(l => l.saas === activeSaas);
  const saasAll = leads.filter(l => l.saas === activeSaas);

  // Group active-product leads by stage
  const stages = s ? s.funnel.map(f => f.stage) : [];
  // Config por estágio vinda de Ajustes (cor + regra "parado → Nd").
  const stageMeta = s ? Object.fromEntries(s.funnel.map(f => [f.stage, f])) : {};
  const byStage = useMP(() => {
    const m = {}; stages.forEach(st => m[st] = []);
    saasLeads.forEach(l => {
      const st = stages.includes(l.stage) ? l.stage : stages[0];
      m[st].push(l);
    });
    return m;
  }, [leads, activeSaas, pri, stages.join("|")]);

  function moveLeadTo(leadId, stage) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage } : l));
    // Persist the move to the API (optimistic — the UI already updated above).
    api.moveLead(leadId, stage).catch(err => console.warn("lead move not persisted:", err.message));
  }

  if (!s) return (
    <EmptyState
      title="Nenhum pipeline"
      hint="Crie um SaaS (com funil) para gerenciar leads aqui."
      action={<PrimaryButton onClick={() => openForm("products")}>+ Criar SaaS</PrimaryButton>}
    />
  );

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
          <PriorityFilter pri={pri} onChange={setPri} />
          <Filter label="Só travados" active={!!highlight} onClick={() => setHighlight(highlight ? null : "Discovery")} />
          {selected.size > 0 && (
            <span className="mono" style={{ fontSize: 11, color: "var(--accent)", marginLeft: 6 }}>
              {selected.size} selecionados · <button style={{ color: "var(--accent)", textDecoration: "underline" }}>mover em massa</button>
            </span>
          )}
          <button onClick={() => openForm("leads", { saas: activeSaas })} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)", marginLeft: 4 }}>
            <span style={{ fontSize: 11 }}>+ novo lead</span>
          </button>
        </div>
      </div>

      {/* Forecast strip — single-product views only */}
      {view !== "all" && <ForecastStrip s={s} leads={saasAll} />}

      {/* Body */}
      {view === "kanban" && (
        <KanbanBoard
          stages={stages}
          stageMeta={stageMeta}
          byStage={byStage}
          highlight={highlight}
          onMove={moveLeadTo}
          selected={selected}
          setSelected={setSelected}
          onOpenLead={onOpenLead}
        />
      )}
      {view === "all" && (
        <AllPipelines leads={priLeads} onMove={moveLeadTo} highlight={highlight} onOpenLead={onOpenLead} />
      )}
      {view === "list" && <LeadList leads={saasLeads} />}
      {view === "forecast" && <ForecastView s={s} leads={saasAll} />}
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
  const views = [["kanban","Kanban"],["all","Todos os pipelines"],["list","Lista"],["forecast","Previsão"]];
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

// Filtro de prioridade — dobrado para dentro do pipeline (era a antiga tela Leads).
function PriorityFilter({ pri, onChange }) {
  const opts = [["all","Todos"],["P0","P0"],["P1","P1"],["P2","P2"]];
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {opts.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          height: 24, padding: "0 9px", borderRadius: 4,
          border: "1px solid " + (pri === k ? "var(--accent-line)" : "var(--line-1)"),
          background: pri === k ? "var(--accent-soft)" : "var(--bg-2)",
          color: pri === k ? "var(--accent)" : "var(--fg-3)",
          fontSize: 11, fontFamily: "var(--mono)",
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

function ForecastStrip({ s, leads }) {
  const tcv = leads.reduce((a, l) => a + (l.amount || 0), 0);
  const weighted = leads.reduce((a, l) => {
    const stageIdx = s.funnel.findIndex(f => f.stage === l.stage);
    const probability = stageIdx >= 0 ? s.funnel.slice(stageIdx).reduce((p, f, i) => p * (i === 0 ? 1 : f.conv), 1) : 0;
    return a + (l.amount || 0) * probability;
  }, 0);
  const wonLeads = leads.filter(l => l.stage === "Closed Won");
  const won = wonLeads.reduce((a, l) => a + (l.amount || 0), 0);
  return (
    <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "grid", gridTemplateColumns: "repeat(5, 1fr) auto", gap: 16, alignItems: "center" }}>
      <ForecastCell label="TCV aberto"            v={window.fmt.money(tcv)}           d={+0.08} dUnit="pct" />
      <ForecastCell label="Previsão ponderada"   v={window.fmt.money(weighted)}      d={+0.04} dUnit="pct" sub="probabilidade × valor" />
      <ForecastCell label="Fechado no mês"      v={window.fmt.money(won)}           d={+1}    dUnit="int" sub={`${wonLeads.length} fechados`} />
      <ForecastCell label="Cobertura"            v={`${s.pipelineCoverage?.toFixed(1)}x`} d={+0.2} dUnit="x" sub={`vs meta 3.0x`} />
      <ForecastCell label="Ciclo médio"           v={`${s.cycleDays}d`} d={s.cycleDelta || -4} dUnit="int" invert sub="mediana 30d" />
      <button style={{ ...chromeBtnStyleSmall, height: 30, padding: "0 12px" }}><span className="mono" style={{ fontSize: 11 }}>Exportar ⇣</span></button>
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
function AllPipelines({ leads, onMove, highlight, onOpenLead }) {
  const { SAAS } = window.SEED;
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 0" }}>
      {SAAS.map(s => (
        <PipelineBand key={s.id} s={s} leads={leads.filter(l => l.saas === s.id)} onMove={onMove} highlight={highlight} onOpenLead={onOpenLead} />
      ))}
    </div>
  );
}

function PipelineBand({ s, leads, onMove, highlight, onOpenLead }) {
  const [dragging, setDragging] = useStP(null);
  const [noop, setNoop] = useStP(new Set());
  const stages = s.funnel.map(f => f.stage);
  const stageMeta = Object.fromEntries(s.funnel.map(f => [f.stage, f]));
  const byStage = {};
  stages.forEach(st => byStage[st] = []);
  leads.forEach(l => {
    const st = stages.includes(l.stage) ? l.stage : stages[0];
    byStage[st].push(l);
  });
  const tcv = leads.reduce((a, l) => a + (l.amount || 0), 0);
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
          <span className="mono dim" style={{ fontSize: 11 }}>{leads.length} leads</span>
          <span className="mono tnum" style={{ fontSize: 13 }}>{window.fmt.money(tcv)} <span className="dim">TCV aberto</span></span>
        </div>
      </div>
      {/* Horizontal kanban */}
      <div style={{ overflowX: "auto", padding: "0 24px 4px", display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(220px, 1fr)", gap: 10, alignItems: "start" }}>
        {stages.map(st => (
          <KanbanColumn key={st}
            stage={st}
            meta={stageMeta[st]}
            cards={byStage[st] || []}
            highlight={highlight === st}
            isFirst={st === stages[0]}
            onDropCard={(id) => { onMove(id, st); setDragging(null); }}
            dragging={dragging}
            setDragging={setDragging}
            selected={noop}
            setSelected={setNoop}
            onOpenLead={onOpenLead}
            compact
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Kanban
function KanbanBoard({ stages, stageMeta = {}, byStage, highlight, onMove, selected, setSelected, onOpenLead }) {
  const [dragging, setDragging] = useStP(null);
  return (
    <div style={{ flex: 1, overflowX: "auto", padding: 14, display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(260px, 1fr)", gap: 10, alignItems: "start" }}>
      {stages.map(st => (
        <KanbanColumn key={st}
          stage={st}
          meta={stageMeta[st]}
          cards={byStage[st] || []}
          highlight={highlight === st}
          isFirst={st === stages[0]}
          onDropCard={(id) => { onMove(id, st); setDragging(null); }}
          dragging={dragging}
          setDragging={setDragging}
          selected={selected}
          setSelected={setSelected}
          onOpenLead={onOpenLead}
        />
      ))}
    </div>
  );
}

function KanbanColumn({ stage, meta, cards, highlight, isFirst, onDropCard, dragging, setDragging, selected, setSelected, compact, onOpenLead }) {
  const [over, setOver] = useStP(false);
  const total = cards.reduce((a, l) => a + (l.amount || 0), 0);
  // Auto-regra de Ajustes: idade numérica (dias) ≥ staleDays → card "parado".
  const staleDays = meta?.staleDays;
  const isStale = (l) => staleDays != null && staleDays !== "" && typeof l.age === "number" && l.age >= Number(staleDays);
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
          {meta?.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} />}
          {stage}
          <span className="mono dim" style={{ fontSize: 10 }}>{cards.length}</span>
          {staleDays != null && staleDays !== "" && <span className="mono dim" style={{ fontSize: 9 }}>parado→{staleDays}d</span>}
        </div>
        <span className="mono tnum dim" style={{ fontSize: 11 }}>{window.fmt.money(total)}</span>
      </div>
      {cards.map(l => (
        <LeadCard
          key={l.id} d={l}
          stale={isStale(l)}
          inbox={isFirst}
          onDragStart={() => setDragging(l.id)}
          selected={selected.has(l.id)}
          onSelect={() => {
            const next = new Set(selected); next.has(l.id) ? next.delete(l.id) : next.add(l.id); setSelected(next);
          }}
          onOpen={() => onOpenLead && onOpenLead(l)}
        />
      ))}
      {cards.length === 0 && <div className="mono dim" style={{ fontSize: 11, textAlign: "center", padding: "20px 0" }}>vazio</div>}
    </div>
  );
}

function LeadCard({ d, stale, inbox, onDragStart, selected, onSelect, onOpen }) {
  const { PEOPLE } = window.SEED;
  const owner = PEOPLE[d.owner];
  const scoreTone = leadScoreTone(d.score);
  const priTone = d.priority === "P0" ? "var(--neg)" : d.priority === "P1" ? "var(--warn)" : "var(--fg-4)";
  const commentCount = (d.comments || []).length;
  // Atalho de WhatsApp só nos cards do inbox (primeiro estágio) e quando há telefone.
  const wa = inbox ? waLink(d.phone) : null;

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
        <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{d.name}</span>
        <span className="mono tnum dim" style={{ fontSize: 11, flexShrink: 0 }}>{window.fmt.money(d.amount || 0)}</span>
      </div>
      {d.company && <div className="mono dim" style={{ fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.company}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--fg-3)", minWidth: 0 }}>
          <Avatar id={d.owner} name={owner?.name || d.owner} size={16} />
          <span className="mono">{leadAge(d)}</span>
          {stale && <span className="mono" style={{ color: "var(--neg)" }}>· parado</span>}
          {d.priority && <span className="mono" style={{ color: priTone }}>· {d.priority}</span>}
          {d.proposalUrl && <span className="mono" style={{ color: "var(--accent)" }}>· prop</span>}
          {commentCount > 0 && <span className="mono" title={`${commentCount} comentário(s)`}>· ❞ {commentCount}</span>}
        </div>
        <span className="mono dim" style={{ fontSize: 10 }}>{d.source}</span>
      </div>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" title={`Abrir WhatsApp · ${d.phone}`}
          draggable={false} onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, height: 24, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid #25D36655", background: "#25D3660f", color: "#25D366", fontSize: 11, fontFamily: "var(--mono)", textDecoration: "none" }}>
          WhatsApp ↗
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── List view
function LeadList({ leads }) {
  const { PEOPLE } = window.SEED;
  const rows = [...leads].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
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
          <span>Lead</span><span>Estágio</span><span style={{ textAlign: "right" }}>Valor</span>
          <span>Dono</span><span>Idade</span><span>Score</span><span>Origem</span>
        </div>
        {rows.map(l => (
          <div key={l.id} style={{
            display: "grid", gridTemplateColumns: "1.6fr 1fr 0.6fr 0.6fr 0.6fr 0.6fr 0.8fr",
            padding: "8px 12px",
            borderBottom: "1px solid var(--line-1)",
            alignItems: "center",
            fontSize: 13,
          }}>
            <span style={{ fontWeight: 500 }}>{l.name} {l.company && <span className="dim" style={{ fontSize: 11, marginLeft: 4 }}>{l.company}</span>}</span>
            <span className="mono dim" style={{ fontSize: 12 }}>{l.stage}</span>
            <span className="mono tnum" style={{ textAlign: "right" }}>{window.fmt.money(l.amount || 0)}</span>
            <span className="mono dim" style={{ fontSize: 12 }}>{PEOPLE[l.owner]?.name || l.owner || "—"}</span>
            <span className="mono dim tnum" style={{ fontSize: 12 }}>{leadAge(l)}</span>
            <span className="mono tnum" style={{ fontSize: 12, color: leadScoreTone(l.score) }}>{l.score ?? "—"}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{l.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Forecast view
function ForecastView({ s, leads }) {
  const buckets = s.funnel.map((f, i) => {
    const at = leads.filter(l => l.stage === f.stage);
    const tcv = at.reduce((a, l) => a + (l.amount || 0), 0);
    const prob = s.funnel.slice(i).reduce((p, x, j) => p * (j === 0 ? 1 : x.conv), 1);
    return { stage: f.stage, tcv, prob, weighted: tcv * prob, count: at.length };
  });
  const max = Math.max(1, ...buckets.map(b => b.tcv));
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "14px 18px", background: "var(--bg-1)" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Previsão por estágio · ponderada pela conversão histórica</div>
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
