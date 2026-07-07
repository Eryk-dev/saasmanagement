import React from "react";
import { TrendBadge, EmptyState, PrimaryButton } from "../atoms.jsx";
import { PageHead, Pill } from "../components/viz.jsx";
import { leadScoreTone, leadAge, waLink, leadTier } from "../lib/ui.js";
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
    // stageSince local = agora: o contador "dias na coluna" zera na hora (o backend
    // recarimba igual ao detectar a troca de estágio no PATCH). Os slots de
    // tentativa também zeram: a contagem é sempre da etapa atual.
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage, stageSince: new Date().toISOString(), attempts: [] } : l));
    // Persist the move to the API (optimistic — the UI already updated above).
    api.update("leads", leadId, { stage, attempts: [] }).catch(err => console.warn("lead move not persisted:", err.message));
  }

  // Edição inline de campos do card (ex.: data da call, valor/período da proposta).
  // Otimista: atualiza a cópia local e persiste o patch (PATCH /api/leads/:id).
  function patchLead(leadId, patch) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...patch } : l));
    api.update("leads", leadId, patch).catch(err => console.warn("lead patch not persisted:", err.message));
  }

  if (!s) return (
    <EmptyState
      title="Nenhum pipeline"
      hint="Crie um SaaS (com funil) para gerenciar leads aqui."
      action={<PrimaryButton onClick={() => openForm("products")}>+ Criar SaaS</PrimaryButton>}
    />
  );

  // Abertos = estágios antes de "Ganho" (pós-venda/descarte ficam fora da conta).
  const wonIdx = stages.indexOf("Ganho");
  const openStages = wonIdx >= 0 ? stages.slice(0, wonIdx) : stages;
  const openLeads = saasAll.filter(l => openStages.includes(l.stage));
  const newWeek = saasAll.filter(l => l.createdAt && Date.now() - new Date(l.createdAt).getTime() <= 7 * 86400000).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Pipeline" sub={`${openLeads.length} ${openLeads.length === 1 ? "lead aberto" : "leads abertos"} · ${newWeek} ${newWeek === 1 ? "novo" : "novos"} esta semana`}>
        <span title="Classificação do lead: soma de contas operadas + anúncios publicados"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 4 }}>
          {[["A", "#16a34a", "#fff"], ["B", "#eab308", "#463500"], ["C", "#9aa2ad", "#fff"]].map(([g, tone, fg]) => (
            <span key={g} className="tnum" style={{
              width: 18, height: 18, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: tone, color: fg, fontFamily: "var(--display)", fontSize: 11, fontWeight: 700,
            }}>{g}</span>
          ))}
          <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>contas + anúncios</span>
        </span>
        {view !== "all" && <SaasTabs active={activeSaas} onSelect={setActiveSaas} />}
        <ViewToggle view={view} onChange={setView} />
        <PriorityFilter pri={pri} onChange={setPri} />
        {selected.size > 0 && (
          <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>{selected.size} selecionados</span>
        )}
        <PrimaryButton onClick={() => openForm("leads", { saas: activeSaas })}>+ novo lead</PrimaryButton>
      </PageHead>

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
          onPatch={patchLead}
          selected={selected}
          setSelected={setSelected}
          onOpenLead={onOpenLead}
        />
      )}
      {view === "all" && (
        <AllPipelines leads={priLeads} onMove={moveLeadTo} onPatch={patchLead} highlight={highlight} onOpenLead={onOpenLead} />
      )}
      {view === "list" && <LeadList leads={saasLeads} />}
      {view === "agenda" && <AgendaView leads={saasAll} onOpenLead={onOpenLead} />}
      {view === "forecast" && <ForecastView s={s} leads={saasAll} />}
    </div>
  );
}

function SaasTabs({ active, onSelect }) {
  const { SAAS } = window.SEED;
  if (SAAS.length <= 1) return null; // 1 produto: aba é ruído (volta sozinha com o 2º SaaS)
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
  const views = [["kanban","Kanban"],["all","Todos os pipelines"],["list","Lista"],["agenda","Agenda"],["forecast","Previsão"]];
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

// Só números reais aqui: TCV aberto (estágios antes de Ganho), previsão
// ponderada pela conversão do funil e fechado no mês (Ganho + stageSince).
function ForecastStrip({ s, leads }) {
  const stages = s.funnel.map(f => f.stage);
  const wonIdx = stages.indexOf("Ganho");
  const openStages = new Set(wonIdx >= 0 ? stages.slice(0, wonIdx) : stages);
  const open = leads.filter(l => openStages.has(l.stage));
  const tcv = open.reduce((a, l) => a + (l.amount || 0), 0);
  const weighted = open.reduce((a, l) => {
    const stageIdx = s.funnel.findIndex(f => f.stage === l.stage);
    const probability = stageIdx >= 0 ? s.funnel.slice(stageIdx).reduce((p, f, i) => p * (i === 0 ? 1 : f.conv), 1) : 0;
    return a + (l.amount || 0) * probability;
  }, 0);
  const month = new Date().toISOString().slice(0, 7);
  const wonLeads = leads.filter(l => l.stage === "Ganho" && String(l.stageSince || "").slice(0, 7) === month);
  const won = wonLeads.reduce((a, l) => a + (l.amount || 0), 0);
  return (
    <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, alignItems: "center" }}>
      <ForecastCell label="Valor aberto" v={window.fmt.money(tcv)} sub={`${open.length} leads em jogo`} />
      <ForecastCell label="Previsão ponderada" v={window.fmt.money(weighted)} sub="probabilidade × valor" />
      <ForecastCell label="Ganho no mês" v={window.fmt.money(won)} sub={`${wonLeads.length} ${wonLeads.length === 1 ? "fechado" : "fechados"}`} />
    </div>
  );
}

function ForecastCell({ label, v, sub }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, marginTop: 2 }}>{v}</div>
      {sub && <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────── All pipelines (stacked)
function AllPipelines({ leads, onMove, onPatch, highlight, onOpenLead }) {
  const { SAAS } = window.SEED;
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 0" }}>
      {SAAS.map(s => (
        <PipelineBand key={s.id} s={s} leads={leads.filter(l => l.saas === s.id)} onMove={onMove} onPatch={onPatch} highlight={highlight} onOpenLead={onOpenLead} />
      ))}
    </div>
  );
}

function PipelineBand({ s, leads, onMove, onPatch, highlight, onOpenLead }) {
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
        {stages.map((st, i) => (
          <KanbanColumn key={st}
            stage={st}
            meta={stageMeta[st]}
            cards={byStage[st] || []}
            highlight={highlight === st}
            stages={stages}
            onMove={onMove}
            onPatch={onPatch}
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
function KanbanBoard({ stages, stageMeta = {}, byStage, highlight, onMove, onPatch, selected, setSelected, onOpenLead }) {
  const [dragging, setDragging] = useStP(null);
  return (
    <div style={{ flex: 1, overflowX: "auto", padding: 14, display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(260px, 1fr)", gap: 10, alignItems: "start" }}>
      {stages.map((st, i) => (
        <KanbanColumn key={st}
          stage={st}
          meta={stageMeta[st]}
          cards={byStage[st] || []}
          highlight={highlight === st}
          stages={stages}
          onMove={onMove}
          onPatch={onPatch}
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

// Dias que o card está parado no estágio atual. Base: stageSince (carimbado a cada
// mudança de estágio); fallback createdAt pra cards antigos que ainda não moveram.
// null quando não há timestamp — aí o badge não aparece.
function daysInStage(card) {
  const ts = card?.stageSince || card?.createdAt;
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86400000));
}

function KanbanColumn({ stage, meta, cards, highlight, stages, onMove, onPatch, onDropCard, dragging, setDragging, selected, setSelected, compact, onOpenLead }) {
  const [over, setOver] = useStP(false);
  const total = cards.reduce((a, l) => a + (l.amount || 0), 0);
  // Card "parado": dias na coluna ≥ staleDays de Ajustes; sem config, 5 dias.
  const staleLimit = meta?.staleDays == null || meta?.staleDays === "" ? 5 : Number(meta.staleDays);
  const isStale = (l) => {
    const dd = daysInStage(l);
    return dd != null && dd >= staleLimit;
  };
  // Ordem temporal: mais novo primeiro. Usa o mesmo timestamp do badge "Nd"
  // (stageSince, fallback createdAt) pra ordem visual bater com os dias exibidos.
  const cardTs = (l) => {
    const t = new Date(l.stageSince || l.createdAt || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const ordered = [...cards].sort((a, b) => cardTs(b) - cardTs(a));
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (dragging) onDropCard(dragging); }}
      style={{
        background: "var(--bg-inset)",
        border: "1px solid " + (highlight ? "var(--accent-line)" : over ? "var(--accent-line)" : "var(--line-1)"),
        borderRadius: "var(--r-3)",
        padding: 8,
        minHeight: compact ? 120 : 240,
        display: "flex", flexDirection: "column", gap: 6,
        boxShadow: highlight ? "0 0 0 1px var(--accent-line)" : "none",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 4px 8px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--display)", display: "flex", alignItems: "center", gap: 7 }}>
          {meta?.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} />}
          {stage}
          <span className="mono" style={{ fontSize: 11, fontWeight: 400, color: "var(--fg-3)" }}>{cards.length}</span>
        </div>
        <span className="mono tnum" style={{ fontSize: 11, color: "var(--fg-3)" }}>{window.fmt.money(total)}</span>
      </div>
      {ordered.map(l => (
        <LeadCard
          key={l.id} d={l}
          stale={isStale(l)}
          stages={stages}
          currentStage={stage}
          onMove={onMove}
          onPatch={onPatch}
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

// Closers da operação: quem vai fazer a call. Marcado no card da coluna
// "Call closer" (campo lead.closer) e usado como cor dos eventos na Agenda.
const CLOSERS = [
  { id: "leonardo", short: "Leo", name: "Leonardo", tone: "#0f766e" },
  { id: "jonathan", short: "Jon", name: "Jonathan", tone: "#6d28d9" },
];

function CloserPicker({ d, onPatch }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, marginLeft: "auto", flexShrink: 0 }}>
      {CLOSERS.map(c => {
        const on = d.closer === c.id;
        return (
          <button key={c.id} draggable={false}
            onClick={(e) => { e.stopPropagation(); onPatch && onPatch(d.id, { closer: on ? "" : c.id }); }}
            title={on ? `Closer da call: ${c.name} (clique pra desmarcar)` : `Marcar ${c.name} como closer da call`}
            style={{
              height: 18, padding: "0 7px", borderRadius: 9,
              fontSize: 10, fontWeight: 700, fontFamily: "var(--mono)",
              background: on ? c.tone : "var(--bg-1)",
              color: on ? "#fff" : "var(--fg-3)",
              border: "1px solid " + (on ? c.tone : "var(--line-2)"),
              cursor: "pointer",
            }}>{c.short}</button>
        );
      })}
    </span>
  );
}

// Slots de tentativa por etapa (cadência do time): Qualificação = 5 ligações
// (máx. 1 por dia), Call closer = 3 remarcações da call, Negociação = 5 chamadas.
// Cada slot preenchido = uma tentativa feita sem sucesso (lead.attempts guarda a
// data de cada uma). Slots cheios = alerta "esgotado" (mover é decisão manual);
// mudou de etapa = zera (ver moveLeadTo).
const ATTEMPT_SLOTS = { "Qualificação": 5, "Call closer": 3, "Negociação": 5 };
const ATTEMPT_HINT = {
  "Qualificação": "tentativas de ligação (1 por dia)",
  "Call closer": "remarcações da call",
  "Negociação": "tentativas de chamada",
};

function AttemptSlots({ d, stage, onPatch }) {
  const total = ATTEMPT_SLOTS[stage] || 0;
  if (!total) return null;
  const attempts = Array.isArray(d.attempts) ? d.attempts.slice(0, total) : [];
  const exhausted = attempts.length >= total;
  const today = new Date().toDateString();
  // Qualificação: 1 tentativa por dia — o slot de hoje marcado trava novo clique.
  const dailyLock = stage === "Qualificação" && attempts.some(a => new Date(a).toDateString() === today);
  const locked = exhausted || dailyLock;
  const mark = (e) => {
    e.stopPropagation();
    if (locked) return;
    onPatch && onPatch(d.id, { attempts: [...attempts, new Date().toISOString()] });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {Array.from({ length: total }, (_, i) => {
        const at = attempts[i];
        return (
          <span key={i}
            onClick={at ? (e) => e.stopPropagation() : mark}
            draggable={false}
            title={at
              ? `tentativa ${i + 1}/${total} · ${new Date(at).toLocaleDateString("pt-BR")}`
              : dailyLock ? "tentativa de hoje já registrada"
              : `marcar tentativa ${i + 1}/${total} · ${ATTEMPT_HINT[stage]}`}
            style={{
              width: 11, height: 11, borderRadius: 3, flexShrink: 0,
              background: at ? (exhausted ? "var(--neg)" : "var(--warn)") : "var(--bg-1)",
              border: "1px solid " + (at ? "transparent" : locked ? "var(--line-1)" : "var(--line-2)"),
              cursor: at ? "default" : locked ? "not-allowed" : "pointer",
            }} />
        );
      })}
      {exhausted && <Pill tone="neg">esgotado</Pill>}
    </div>
  );
}

// Pill do próximo contato (callAt): atrasado (neg), hoje com hora (pos),
// futuro (mut). Sem callAt em estágio aberto, cobra o próximo passo (warn).
function nextContactPill(d) {
  if (!d.callAt) return { tone: "warn", text: "sem próximo passo" };
  const t = new Date(d.callAt);
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  if (t < startToday) return { tone: "neg", text: "atrasado" };
  if (t <= endToday) return { tone: "pos", text: `hoje ${t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` };
  return { tone: "mut", text: t.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") };
}

// Cartão compacto (padrão Pipedrive): nome, pills de tempo na etapa + próximo
// contato + novo, e valor. O fundo inteiro é tingido pela cor do potencial
// (contas + anúncios). TODA a edição vive no drawer do lead.
function LeadCard({ d, stale, currentStage, onDragStart, selected, onSelect, onOpen, onPatch }) {
  const tier = leadTier(d);
  const days = daysInStage(d);
  const wa = waLink(d.phone);
  const isNew = d.createdAt && Date.now() - new Date(d.createdAt).getTime() <= 2 * 86400000;
  const saasCfg = (window.SEED?.SAAS || []).find((x) => x.id === d.saas);
  const wonIdx = (saasCfg?.funnel || []).findIndex((f) => f.stage === "Ganho");
  const stageIdx = (saasCfg?.funnel || []).findIndex((f) => f.stage === currentStage);
  const isOpenStage = wonIdx < 0 || (stageIdx >= 0 && stageIdx < wonIdx);
  const next = isOpenStage ? nextContactPill(d) : null;
  const tinted = tier.key !== "sem";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { if (e.shiftKey) onSelect(); else onOpen && onOpen(); }}
      title={`${tier.label} (contas + anúncios)`}
      style={{
        background: tinted ? `color-mix(in srgb, ${tier.tone} 16%, var(--bg-1))` : "var(--bg-1)",
        border: "1px solid " + (selected ? "var(--accent-line)" : tinted ? `color-mix(in srgb, ${tier.tone} 55%, var(--line-1))` : "var(--line-1)"),
        borderLeft: `4px solid ${tier.tone}`,
        borderRadius: "var(--r-2)",
        padding: "9px 11px",
        cursor: "grab",
        boxShadow: "var(--shadow-1)",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {tier.grade && (
            <span className="tnum" style={{
              width: 19, height: 19, borderRadius: 5, flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: tier.tone, color: tier.badgeFg,
              fontFamily: "var(--display)", fontSize: 11.5, fontWeight: 700,
            }}>{tier.grade}</span>
          )}
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
            {d.company && (
              <span style={{ display: "block", fontSize: 11, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.company}</span>
            )}
          </span>
        </span>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" title={`Abrir WhatsApp · ${d.phone}`}
            draggable={false} onClick={(e) => e.stopPropagation()}
            className="mono" style={{ fontSize: 10.5, color: "#128c4b", textDecoration: "none", flexShrink: 0 }}>
            Wpp ↗
          </a>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
        {isNew && <Pill tone="accent">novo</Pill>}
        {days != null && <Pill tone={stale ? "warn" : "mut"} title="tempo nesta etapa">{days}d</Pill>}
        {next && <Pill tone={next.tone}>{next.text}</Pill>}
        <span className="mono tnum" style={{ fontSize: 11.5, fontWeight: 500, color: "var(--fg-2)", marginLeft: "auto" }}>{window.fmt.money(d.amount || 0)}</span>
      </div>
      {(ATTEMPT_SLOTS[currentStage] || currentStage === "Call closer") && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
          <AttemptSlots d={d} stage={currentStage} onPatch={onPatch} />
          {currentStage === "Call closer" && <CloserPicker d={d} onPatch={onPatch} />}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Agenda (semana)
// Visão semanal das calls agendadas (lead.callAt), estilo Google Agenda: colunas
// seg→dom, linhas por hora (7h→21h), navegação ‹ hoje ›. Cor do evento = closer
// (CLOSERS); cinza quando a call ainda não tem closer marcado. Clique abre o lead.
function AgendaView({ leads, onOpenLead }) {
  const [week, setWeek] = useStP(0); // offset em semanas a partir da atual
  const H0 = 7, H1 = 21, hourH = 44;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + week * 7);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  const end = new Date(monday); end.setDate(monday.getDate() + 7);
  const events = leads
    .filter(l => l.callAt)
    .map(l => ({ l, t: new Date(l.callAt) }))
    .filter(e => Number.isFinite(e.t.getTime()) && e.t >= monday && e.t < end);
  const fmtDay = (d, opts) => d.toLocaleDateString("pt-BR", opts).replace(/\./g, "");
  const label = `${fmtDay(days[0], { day: "2-digit", month: "short" })} · ${fmtDay(days[6], { day: "2-digit", month: "short", year: "numeric" })}`;
  const navBtn = {
    height: 26, padding: "0 10px", borderRadius: 5, fontSize: 12,
    background: "var(--bg-2)", border: "1px solid var(--line-1)", color: "var(--fg-2)", cursor: "pointer",
  };

  // Lanes: calls no mesmo horário dividem a largura da coluna (evento dura 1h).
  const layoutDay = (d) => {
    const dayEv = events.filter(e => e.t.toDateString() === d.toDateString()).sort((a, b) => a.t - b.t);
    const laneEnds = [];
    const placed = dayEv.map(e => {
      const start = e.t.getTime(), stop = start + 3600000;
      let lane = laneEnds.findIndex(t => t <= start);
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = stop;
      return { ...e, lane };
    });
    return { placed, lanes: Math.max(1, laneEnds.length) };
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button style={navBtn} onClick={() => setWeek(w => w - 1)}>‹</button>
        <button style={navBtn} onClick={() => setWeek(0)}>hoje</button>
        <button style={navBtn} onClick={() => setWeek(w => w + 1)}>›</button>
        <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--display)", marginLeft: 4 }}>{label}</span>
        <span className="mono dim" style={{ fontSize: 11 }}>
          {events.length === 0 ? "nenhuma call nesta semana" : `${events.length} ${events.length === 1 ? "call" : "calls"}`}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {CLOSERS.map(c => (
            <span key={c.id} className="mono" style={{ fontSize: 11, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: c.tone }} />{c.name}
            </span>
          ))}
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--fg-4)" }} />sem closer
          </span>
        </span>
      </div>

      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", overflow: "hidden" }}>
        {/* Cabeçalho dos dias */}
        <div style={{ display: "grid", gridTemplateColumns: "52px repeat(7, 1fr)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
          <span />
          {days.map((d, i) => {
            const isToday = d.toDateString() === new Date().toDateString();
            return (
              <div key={i} style={{ padding: "8px 6px", textAlign: "center", borderLeft: "1px solid var(--line-1)" }}>
                <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: isToday ? "var(--accent)" : "var(--fg-4)" }}>
                  {fmtDay(d, { weekday: "short" })}
                </div>
                <div className="tnum" style={{
                  fontSize: 14, fontWeight: 700, fontFamily: "var(--display)", marginTop: 2,
                  color: isToday ? "var(--accent)" : "var(--fg-1)",
                }}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>
        {/* Corpo: gutter de horas + 7 colunas com linhas por hora */}
        <div style={{ display: "grid", gridTemplateColumns: "52px repeat(7, 1fr)" }}>
          <div style={{ position: "relative", height: (H1 - H0) * hourH }}>
            {Array.from({ length: H1 - H0 }, (_, i) => (
              <span key={i} className="mono tnum" style={{ position: "absolute", top: i * hourH - 6, right: 6, fontSize: 10, color: "var(--fg-4)" }}>
                {i === 0 ? "" : `${H0 + i}h`}
              </span>
            ))}
          </div>
          {days.map((d, i) => {
            const { placed, lanes } = layoutDay(d);
            const isToday = d.toDateString() === new Date().toDateString();
            return (
              <div key={i} style={{
                position: "relative", height: (H1 - H0) * hourH,
                borderLeft: "1px solid var(--line-1)",
                backgroundImage: `repeating-linear-gradient(to bottom, var(--line-1) 0 1px, transparent 1px ${hourH}px)`,
                backgroundColor: isToday ? "color-mix(in srgb, var(--accent) 5%, transparent)" : "transparent",
              }}>
                {placed.map(({ l, t, lane }) => {
                  const c = CLOSERS.find(x => x.id === l.closer);
                  const tone = c ? c.tone : "var(--fg-4)";
                  const hour = Math.min(H1 - 1, Math.max(H0, t.getHours() + t.getMinutes() / 60));
                  const w = 100 / lanes;
                  return (
                    <div key={l.id}
                      onClick={() => onOpenLead && onOpenLead(l)}
                      title={`${t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${l.name}${l.company ? " · " + l.company : ""}${c ? " · closer " + c.name : " · sem closer"}`}
                      style={{
                        position: "absolute", top: (hour - H0) * hourH + 1,
                        left: `calc(${lane * w}% + 2px)`, width: `calc(${w}% - 4px)`,
                        height: hourH - 3, overflow: "hidden", cursor: "pointer",
                        background: `color-mix(in srgb, ${tone} 14%, var(--bg-1))`,
                        border: `1px solid color-mix(in srgb, ${tone} 45%, var(--line-1))`,
                        borderLeft: `3px solid ${tone}`, borderRadius: 5, padding: "3px 6px",
                      }}>
                      <div className="mono tnum" style={{ fontSize: 9.5, color: "var(--fg-3)" }}>
                        {t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{c ? ` · ${c.short}` : ""}
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                      {l.company && <div style={{ fontSize: 10, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.company}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
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
            <span className="mono dim" style={{ fontSize: 12 }}>{PEOPLE[l.owner]?.name || l.owner || ""}</span>
            <span className="mono dim tnum" style={{ fontSize: 12 }}>{leadAge(l)}</span>
            <span className="mono tnum" style={{ fontSize: 12, color: leadScoreTone(l.score) }}>{l.score ?? ""}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{l.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
