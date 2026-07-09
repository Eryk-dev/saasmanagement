import React from "react";
import { TrendBadge, EmptyState, PrimaryButton } from "../atoms.jsx";
import { PageHead, Pill } from "../components/viz.jsx";
import { leadScoreTone, leadAge, waLink, leadTier } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import {
  stageKind, phaseOf, PHASES, openStages, workableStages, isWonStage, cadenceOf,
  nextTouchPill, lossReasonLabel,
} from "../lib/funnel.js";
import { usersByRole, userTone, displayName, currentUser } from "../lib/users.js";
import { moveGate, MoveLeadModal, applyGatedMove } from "../components/stage-move.jsx";
// Pipeline — Kanban + List + Agenda + Análise. Drag-and-drop between columns.
// Funil unificado: os LEADS são os cards do pipeline (window.SEED.LEADS). Cada
// lead já carrega seu `saas` + `stage`. Uma cópia local deixa o drag-and-drop
// mutar otimisticamente antes de persistir (PATCH /api/leads/:id).
// Processo SDR → Closer: toda decisão de comportamento vem do `kind` do estágio
// (lib/funnel.js), nunca do nome. Movimentos gateados: handoff SDR→Closer exige
// closer; perda/desqualificação exige motivo (components/stage-move.jsx).

const { useState: useStP, useMemo: useMP, useEffect: useEfP } = React;

function PipelineScreen({ saasId, onJump, jumpFilter, onOpenLead }) {
  const { SAAS } = window.SEED;
  const { openForm } = useData();
  const [activeSaas, setActiveSaas] = useStP(saasId || "leverads");
  // Aba ativa persistida (localStorage): sobrevive ao refresh da página e à
  // remontagem da tela quando o tempo real recarrega o SEED. "forecast" é o
  // nome antigo da aba Análise — alias pra não perder a preferência salva.
  const VIEWS = ["kanban", "all", "list", "agenda", "analise"];
  const [view, setViewState] = useStP(() => {
    try {
      const v = localStorage.getItem("cockpit_pipeline_view");
      if (v === "forecast") return "analise";
      return VIEWS.includes(v) ? v : "kanban";
    } catch { return "kanban"; }
  });
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem("cockpit_pipeline_view", v); } catch { /* ignore */ }
  };
  const [leads, setLeads] = useStP(() => window.SEED.LEADS.map(l => ({ ...l })));
  const [highlight, setHighlight] = useStP(jumpFilter?.stage || null);
  const [selected, setSelected] = useStP(new Set());
  const [pri, setPri] = useStP("all");
  // Fase do processo (fatia as colunas visíveis) + pessoa (dono/closer).
  const [phase, setPhase] = useStP("all"); // all | sdr | closer
  const [person, setPersonState] = useStP(() => {
    try { return localStorage.getItem("cockpit_pipeline_person") || ""; } catch { return ""; }
  });
  const setPerson = (p) => {
    setPersonState(p);
    try { localStorage.setItem("cockpit_pipeline_person", p); } catch { /* ignore */ }
  };
  // Gate de movimento pendente (handoff / motivo de perda).
  const [pendingMove, setPendingMove] = useStP(null); // { lead, toStage, gate, saasCfg }

  const s = SAAS.find(x => x.id === activeSaas) || SAAS[0];
  const saasCfgOf = (l) => SAAS.find(x => x.id === l.saas);

  const me = currentUser()?.id || "";
  const personMatch = (l) => {
    if (!person) return true;
    const who = person === "me" ? me : person;
    return who ? l.owner === who || l.closer === who : true;
  };

  // Priority filter is global (kanban + list + all). Análise deliberately uses the
  // full product pipeline so the $ totals don't shrink when narrowing by priority.
  const priLeads = (pri === "all" ? leads : leads.filter(l => l.priority === pri)).filter(personMatch);
  const saasLeads = priLeads.filter(l => l.saas === activeSaas);
  const saasAll = leads.filter(l => l.saas === activeSaas);

  // Group active-product leads by stage
  const stages = s ? s.funnel.map(f => f.stage) : [];
  // Config por estágio vinda de Ajustes (cor + regra "parado → Nd" + cadência).
  const stageMeta = s ? Object.fromEntries(s.funnel.map(f => [f.stage, f])) : {};
  // Fatia por fase do processo: SDR vê a pré-venda (+ Desqualificado, o terminal
  // dela); Closer vê da call em diante (sem Desqualificado).
  const visibleStages = useMP(() => {
    if (phase === "all") return stages;
    return stages.filter(st => {
      const k = stageKind(s, st);
      const p = phaseOf(k);
      if (phase === "sdr") return p === "sdr" || k === "desqualificado";
      return (p === "closer" || p === "entrega" || p === "fim") && k !== "desqualificado";
    });
  }, [stages.join("|"), phase, activeSaas]);
  const byStage = useMP(() => {
    const m = {}; stages.forEach(st => m[st] = []);
    saasLeads.forEach(l => {
      const st = stages.includes(l.stage) ? l.stage : stages[0];
      m[st].push(l);
    });
    return m;
  }, [leads, activeSaas, pri, person, stages.join("|")]);

  // Movimento otimista: o servidor recarimba stageSince, zera o contador de
  // tentativas, preenche motivo/GPS (applyStageMove) — o local espelha o básico.
  function commitMoveLocal(leadId, patch) {
    setLeads(prev => prev.map(l => l.id === leadId
      ? { ...l, ...patch, stageSince: new Date().toISOString(), stageAttempts: 0 }
      : l));
  }

  // Todo movimento passa pelo gate: handoff SDR→Closer e perda pedem input.
  function requestMove(leadId, stage) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || lead.stage === stage) return;
    const cfg = saasCfgOf(lead);
    const gate = moveGate(cfg, lead, stage);
    if (gate) { setPendingMove({ lead, toStage: stage, gate, saasCfg: cfg }); return; }
    commitMoveLocal(leadId, { stage });
    api.update("leads", leadId, { stage }).catch(err => console.warn("lead move not persisted:", err.message));
  }

  // Edição inline de campos do card (ex.: responsável). Otimista.
  function patchLead(leadId, patch) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...patch } : l));
    api.update("leads", leadId, patch).catch(err => console.warn("lead patch not persisted:", err.message));
  }

  // Toque registrado direto no card (dots de cadência): vira activity na
  // timeline; o servidor conta a tentativa e re-agenda o próximo passo sozinho
  // (onActivityCreated). O local espelha pra resposta visual imediata.
  function logTouch(lead, stage) {
    const cad = cadenceOf(saasCfgOf(lead), stage);
    const now = Date.now();
    setLeads(prev => prev.map(l => l.id === lead.id ? {
      ...l,
      stageAttempts: (Number(l.stageAttempts) || 0) + 1,
      lastActivityAt: new Date(now).toISOString(),
      lastActivityType: "call",
      ...(cad.retryDays ? { nextActionAt: new Date(now + cad.retryDays * 86400000).toISOString() } : {}),
    } : l));
    api.logActivity({
      saas: lead.saas, lead: lead.id, type: "call",
      text: "tentativa de contato (card)",
      author: me,
    }).catch(err => console.warn("toque não registrado:", err.message));
  }

  if (!s) return (
    <EmptyState
      title="Nenhum pipeline"
      hint="Crie um SaaS (com funil) para gerenciar leads aqui."
      action={<PrimaryButton onClick={() => openForm("products")}>+ Criar SaaS</PrimaryButton>}
    />
  );

  // Abertos = régua antes do ganho (pós-venda/descarte ficam fora da conta).
  const open = openStages(s);
  const openLeads = saasAll.filter(l => open.includes(l.stage));
  const newWeek = saasAll.filter(l => l.createdAt && Date.now() - new Date(l.createdAt).getTime() <= 7 * 86400000).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Pipeline" sub={`${openLeads.length} ${openLeads.length === 1 ? "lead aberto" : "leads abertos"} · ${newWeek} ${newWeek === 1 ? "novo" : "novos"} esta semana`}>
        <span title="Classificação do lead: soma de contas operadas + anúncios publicados"
          className="hide-mobile" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 4 }}>
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
        {(view === "kanban" || view === "all") && <PhaseFilter phase={phase} onChange={setPhase} />}
        <PriorityFilter pri={pri} onChange={setPri} />
        <PersonFilter person={person} onChange={setPerson} me={me} />
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
          s={s}
          stages={visibleStages}
          stageMeta={stageMeta}
          byStage={byStage}
          highlight={highlight}
          onMove={requestMove}
          onPatch={patchLead}
          onLogTouch={logTouch}
          selected={selected}
          setSelected={setSelected}
          onOpenLead={onOpenLead}
        />
      )}
      {view === "all" && (
        <AllPipelines leads={priLeads} onMove={requestMove} onPatch={patchLead} onLogTouch={logTouch} highlight={highlight} onOpenLead={onOpenLead} phase={phase} />
      )}
      {view === "list" && <LeadList leads={saasLeads} />}
      {view === "agenda" && <AgendaView leads={saasAll} onOpenLead={onOpenLead} />}
      {view === "analise" && <AnaliseView s={s} leads={saasAll} />}

      {pendingMove && (
        <MoveLeadModal
          lead={pendingMove.lead}
          toStage={pendingMove.toStage}
          gate={pendingMove.gate}
          saasCfg={pendingMove.saasCfg}
          onCancel={() => setPendingMove(null)}
          onConfirm={(patch, extra) => {
            commitMoveLocal(pendingMove.lead.id, patch);
            applyGatedMove(patch, extra, pendingMove.lead.id).catch(err => console.warn("movimento não persistido:", err.message));
            setPendingMove(null);
          }}
        />
      )}
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
  const views = [["kanban","Kanban"],["all","Todos os pipelines"],["list","Lista"],["agenda","Agenda"],["analise","Análise"]];
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

// Fatia o board pela fase do processo (SDR = pré-venda; Closer = call em diante).
function PhaseFilter({ phase, onChange }) {
  const opts = [["all", "Todas"], ["sdr", "SDR"], ["closer", "Closer"]];
  return (
    <div style={{ display: "flex", gap: 2, padding: 2, background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)" }}>
      {opts.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          padding: "3px 9px", borderRadius: 4, fontSize: 11, fontFamily: "var(--mono)",
          background: phase === k ? "var(--bg-0)" : "transparent",
          color: phase === k ? "var(--fg-1)" : "var(--fg-3)",
          border: "1px solid " + (phase === k ? "var(--line-2)" : "transparent"),
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

// Filtro por pessoa: "meus" (dono OU closer = usuário logado) ou alguém do time.
function PersonFilter({ person, onChange, me }) {
  const users = window.SEED?.USERS || [];
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <button onClick={() => onChange(person === "me" ? "" : "me")} disabled={!me}
        title={me ? "só leads onde sou dono ou closer" : "faça login pra filtrar os seus"}
        style={{
          height: 24, padding: "0 9px", borderRadius: 4, fontSize: 11, fontFamily: "var(--mono)",
          border: "1px solid " + (person === "me" ? "var(--accent-line)" : "var(--line-1)"),
          background: person === "me" ? "var(--accent-soft)" : "var(--bg-2)",
          color: person === "me" ? "var(--accent)" : "var(--fg-3)",
          opacity: me ? 1 : 0.5,
        }}>meus</button>
      {users.length > 0 && (
        <select value={person === "me" ? "" : person} onChange={(e) => onChange(e.target.value)}
          style={{ height: 24, padding: "0 6px", borderRadius: 4, fontSize: 11, background: "var(--bg-2)", border: "1px solid var(--line-1)", color: person && person !== "me" ? "var(--fg-1)" : "var(--fg-3)" }}>
          <option value="">time todo</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
        </select>
      )}
    </div>
  );
}

// Só números reais aqui: TCV aberto (régua antes do ganho), previsão
// ponderada pela conversão do funil e fechado no mês (kind ganho + stageSince).
function ForecastStrip({ s, leads }) {
  const openSet = new Set(openStages(s));
  const open = leads.filter(l => openSet.has(l.stage));
  const tcv = open.reduce((a, l) => a + (l.amount || 0), 0);
  const weighted = open.reduce((a, l) => {
    const stageIdx = s.funnel.findIndex(f => f.stage === l.stage);
    const probability = stageIdx >= 0 ? s.funnel.slice(stageIdx).reduce((p, f, i) => p * (i === 0 ? 1 : f.conv), 1) : 0;
    return a + (l.amount || 0) * probability;
  }, 0);
  const month = new Date().toISOString().slice(0, 7);
  const wonLeads = leads.filter(l => isWonStage(s, l.stage) && String(l.stageSince || "").slice(0, 7) === month);
  const won = wonLeads.reduce((a, l) => a + (l.amount || 0), 0);
  return (
    <div style={{ padding: "12px var(--pad-x)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, alignItems: "center" }}>
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
function AllPipelines({ leads, onMove, onPatch, onLogTouch, highlight, onOpenLead, phase }) {
  const { SAAS } = window.SEED;
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 0" }}>
      {SAAS.map(s => (
        <PipelineBand key={s.id} s={s} leads={leads.filter(l => l.saas === s.id)} onMove={onMove} onPatch={onPatch} onLogTouch={onLogTouch} highlight={highlight} onOpenLead={onOpenLead} phase={phase} />
      ))}
    </div>
  );
}

function PipelineBand({ s, leads, onMove, onPatch, onLogTouch, highlight, onOpenLead, phase = "all" }) {
  const [dragging, setDragging] = useStP(null);
  const [noop, setNoop] = useStP(new Set());
  const allStages = s.funnel.map(f => f.stage);
  const stages = phase === "all" ? allStages : allStages.filter(st => {
    const k = stageKind(s, st);
    const p = phaseOf(k);
    if (phase === "sdr") return p === "sdr" || k === "desqualificado";
    return (p === "closer" || p === "entrega" || p === "fim") && k !== "desqualificado";
  });
  const stageMeta = Object.fromEntries(s.funnel.map(f => [f.stage, f]));
  const byStage = {};
  allStages.forEach(st => byStage[st] = []);
  leads.forEach(l => {
    const st = allStages.includes(l.stage) ? l.stage : allStages[0];
    byStage[st].push(l);
  });
  const tcv = leads.reduce((a, l) => a + (l.amount || 0), 0);
  const tone = window.productTone(s);

  return (
    <div style={{ marginBottom: 8, borderBottom: "1px solid var(--line-1)", paddingBottom: 8 }}>
      {/* Band header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px var(--pad-x) 10px", position: "sticky", left: 0 }}>
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
      <div style={{ overflowX: "auto", padding: "0 var(--pad-x) 4px", display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(220px, 1fr)", gap: 10, alignItems: "start" }}>
        {stages.map((st, i) => (
          <KanbanColumn key={st}
            s={s}
            stage={st}
            meta={stageMeta[st]}
            cards={byStage[st] || []}
            highlight={highlight === st}
            phaseStart={phaseKicker(s, stages, i)}
            onMove={onMove}
            onPatch={onPatch}
            onLogTouch={onLogTouch}
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
// Kicker de fase (SDR / CLOSER / ENTREGA / FIM) mostrado na 1ª coluna de cada
// grupo — a separação visual do processo.
function phaseKicker(s, stages, i) {
  const p = phaseOf(stageKind(s, stages[i]));
  if (!p) return null;
  const prev = i > 0 ? phaseOf(stageKind(s, stages[i - 1])) : null;
  return p !== prev ? PHASES[p]?.label || null : null;
}

function KanbanBoard({ s, stages, stageMeta = {}, byStage, highlight, onMove, onPatch, onLogTouch, selected, setSelected, onOpenLead }) {
  const [dragging, setDragging] = useStP(null);
  return (
    <div style={{ flex: 1, overflowX: "auto", padding: 14, display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(260px, 1fr)", gap: 10, alignItems: "start" }}>
      {stages.map((st, i) => (
        <KanbanColumn key={st}
          s={s}
          stage={st}
          meta={stageMeta[st]}
          cards={byStage[st] || []}
          highlight={highlight === st}
          phaseStart={phaseKicker(s, stages, i)}
          onMove={onMove}
          onPatch={onPatch}
          onLogTouch={onLogTouch}
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

function KanbanColumn({ s, stage, meta, cards, highlight, phaseStart, onMove, onPatch, onLogTouch, onDropCard, dragging, setDragging, selected, setSelected, compact, onOpenLead }) {
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
        borderTop: phaseStart ? "3px solid var(--line-strong)" : undefined,
        borderRadius: "var(--r-3)",
        padding: 8,
        minHeight: compact ? 120 : 240,
        display: "flex", flexDirection: "column", gap: 6,
        boxShadow: highlight ? "0 0 0 1px var(--accent-line)" : "none",
      }}>
      {phaseStart && (
        <div className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--fg-4)", padding: "0 4px", textTransform: "uppercase" }}>
          {phaseStart}
        </div>
      )}
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
          s={s}
          stale={isStale(l)}
          currentStage={stage}
          onMove={onMove}
          onPatch={onPatch}
          onLogTouch={onLogTouch}
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

// Picker de responsável por fase: SDR (dono) na pré-venda, closer da call em
// diante, integrador na entrega. Lê o time real (users + roles, Ajustes → Equipe).
function pickerFor(s, stage) {
  const k = stageKind(s, stage);
  const p = phaseOf(k);
  if (p === "sdr") {
    const opts = usersByRole("sdr");
    return opts.length ? { field: "owner", options: opts, hint: "SDR dono do lead" } : null;
  }
  if (p === "closer") {
    const opts = usersByRole("closer");
    return opts.length ? { field: "closer", options: opts, hint: "closer responsável" } : null;
  }
  if (k === "integracao") {
    const opts = usersByRole("integrator");
    return opts.length ? { field: "closer", options: opts, hint: "quem faz a integração" } : null;
  }
  return null;
}

function TeamPicker({ d, field, options, hint, onPatch }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, marginLeft: "auto", flexShrink: 0 }}>
      {options.map(u => {
        const on = d[field] === u.id;
        const tone = `oklch(0.55 0.13 ${userTone(u.id)})`;
        const short = (u.name || u.id).split(" ")[0].slice(0, 4);
        return (
          <button key={u.id} draggable={false}
            onClick={(e) => { e.stopPropagation(); onPatch && onPatch(d.id, { [field]: on ? "" : u.id }); }}
            title={on ? `${hint}: ${u.name || u.id} (clique pra desmarcar)` : `Marcar ${u.name || u.id} · ${hint}`}
            style={{
              height: 18, padding: "0 7px", borderRadius: 9,
              fontSize: 10, fontWeight: 700, fontFamily: "var(--mono)",
              background: on ? tone : "var(--bg-1)",
              color: on ? "#fff" : "var(--fg-3)",
              border: "1px solid " + (on ? tone : "var(--line-2)"),
              cursor: "pointer",
            }}>{short}</button>
        );
      })}
    </span>
  );
}

// Dots de cadência do estágio (funnel[].cadence de Ajustes): cada dot = um toque
// feito nesta etapa (lead.stageAttempts, mantido pelo servidor a partir da
// timeline). Clicar registra o toque (activity) — e o GPS re-agenda sozinho.
function AttemptSlots({ d, s, stage, onLogTouch }) {
  const cad = cadenceOf(s, stage);
  const total = Number(cad.maxAttempts) || 0;
  if (!total) return null;
  const legacy = Array.isArray(d.attempts) ? d.attempts.length : 0;
  const count = Math.min(total, Math.max(Number(d.stageAttempts) || 0, legacy));
  const exhausted = count >= total;
  // Trava de cadência: com retryDays, 1 toque por janela — o último toque de
  // hoje trava novo clique (o de amanhã o GPS cobra via nextActionAt).
  const today = new Date().toDateString();
  const touchedToday = ["whatsapp", "call", "email", "meeting"].includes(d.lastActivityType) &&
    d.lastActivityAt && new Date(d.lastActivityAt).toDateString() === today;
  const legacyToday = Array.isArray(d.attempts) && d.attempts.some(a => new Date(a).toDateString() === today);
  const dailyLock = (Number(cad.retryDays) || 0) >= 1 && (touchedToday || legacyToday);
  const locked = exhausted || dailyLock;
  const mark = (e) => {
    e.stopPropagation();
    if (locked) return;
    onLogTouch && onLogTouch(d, stage);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {Array.from({ length: total }, (_, i) => {
        const filled = i < count;
        return (
          <span key={i}
            onClick={filled ? (e) => e.stopPropagation() : mark}
            draggable={false}
            title={filled
              ? `toque ${i + 1}/${total} registrado`
              : dailyLock ? "toque de hoje já registrado — próximo no prazo da cadência"
              : `registrar toque ${i + 1}/${total} (vira contato na timeline)`}
            style={{
              width: 11, height: 11, borderRadius: 3, flexShrink: 0,
              background: filled ? (exhausted ? "var(--neg)" : "var(--warn)") : "var(--bg-1)",
              border: "1px solid " + (filled ? "transparent" : locked ? "var(--line-1)" : "var(--line-2)"),
              cursor: filled ? "default" : locked ? "not-allowed" : "pointer",
            }} />
        );
      })}
      {exhausted && <Pill tone="neg">esgotado</Pill>}
    </div>
  );
}

// Cartão compacto (padrão Pipedrive): nome, pills de tempo na etapa + próximo
// contato + novo, e valor. O fundo inteiro é tingido pela cor do potencial
// (contas + anúncios). TODA a edição vive no drawer do lead.
function LeadCard({ d, s, stale, currentStage, onDragStart, selected, onSelect, onOpen, onPatch, onLogTouch }) {
  const tier = leadTier(d);
  const days = daysInStage(d);
  const wa = waLink(d.phone);
  const isNew = d.createdAt && Date.now() - new Date(d.createdAt).getTime() <= 2 * 86400000;
  const saasCfg = s || (window.SEED?.SAAS || []).find((x) => x.id === d.saas);
  // Pill de próximo toque em todo estágio trabalhável (inclui Nutrição pós-régua).
  const isOpenStage = workableStages(saasCfg).includes(currentStage);
  const next = nextTouchPill(d, { isOpen: isOpenStage });
  const kind = stageKind(saasCfg, currentStage);
  const lost = (kind === "perdido" || kind === "desqualificado") && d.lostReason;
  const tinted = tier.key !== "sem";
  const picker = pickerFor(saasCfg, currentStage);

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
        {next && <Pill tone={next.key === "late" ? "neg" : next.key === "today" ? "pos" : next.key === "none" ? "warn" : "mut"}>{next.text}</Pill>}
        {lost && <Pill tone="mut" title={d.lostNote || ""}>{lossReasonLabel(saasCfg, d.lostReason)}</Pill>}
        <span className="mono tnum" style={{ fontSize: 11.5, fontWeight: 500, color: "var(--fg-2)", marginLeft: "auto" }}>{window.fmt.money(d.amount || 0)}</span>
      </div>
      {(Number(cadenceOf(saasCfg, currentStage).maxAttempts) > 0 || picker) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
          <AttemptSlots d={d} s={saasCfg} stage={currentStage} onLogTouch={onLogTouch} />
          {picker && <TeamPicker d={d} field={picker.field} options={picker.options} hint={picker.hint} onPatch={onPatch} />}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Agenda (semana)
// Visão semanal das calls agendadas (lead.callAt) + integrações (integrationAt),
// estilo Google Agenda. Cor do evento = responsável (lead.closer, matiz do
// avatar); cinza quando não tem. Toggle "toques" sobrepõe os próximos contatos
// do GPS (nextActionAt) em estilo leve. Clique abre o lead.
function AgendaView({ leads, onOpenLead }) {
  const [week, setWeek] = useStP(0); // offset em semanas a partir da atual
  const [showTouches, setShowTouchesState] = useStP(() => {
    try { return localStorage.getItem("cockpit_agenda_touches") === "1"; } catch { return false; }
  });
  const setShowTouches = (v) => {
    setShowTouchesState(v);
    try { localStorage.setItem("cockpit_agenda_touches", v ? "1" : "0"); } catch { /* ignore */ }
  };
  const H0 = 7, H1 = 21, hourH = 44;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + week * 7);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  const end = new Date(monday); end.setDate(monday.getDate() + 7);
  // Eventos: call agendada (callAt), integração (integrationAt) e — opcional —
  // toque do GPS (nextActionAt). O mesmo lead pode ter os três.
  const events = leads
    .flatMap(l => [
      l.callAt ? { l, t: new Date(l.callAt), kind: "call" } : null,
      l.integrationAt ? { l, t: new Date(l.integrationAt), kind: "integração" } : null,
      showTouches && l.nextActionAt ? { l, t: new Date(l.nextActionAt), kind: "toque" } : null,
    ])
    .filter(e => e && Number.isFinite(e.t.getTime()) && e.t >= monday && e.t < end);
  const fmtDay = (d, opts) => d.toLocaleDateString("pt-BR", opts).replace(/\./g, "");
  const label = `${fmtDay(days[0], { day: "2-digit", month: "short" })} · ${fmtDay(days[6], { day: "2-digit", month: "short", year: "numeric" })}`;
  const navBtn = {
    height: 26, padding: "0 10px", borderRadius: 5, fontSize: 12,
    background: "var(--bg-2)", border: "1px solid var(--line-1)", color: "var(--fg-2)", cursor: "pointer",
  };

  // Time da legenda: quem tem papel de closer/integrador (Ajustes → Equipe).
  const team = [...usersByRole("closer"), ...usersByRole("integrator")]
    .filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i);
  const toneOf = (id) => id ? `oklch(0.55 0.13 ${userTone(id)})` : "var(--fg-4)";

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

  const calls = events.filter(e => e.kind !== "toque").length;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button style={navBtn} onClick={() => setWeek(w => w - 1)}>‹</button>
        <button style={navBtn} onClick={() => setWeek(0)}>hoje</button>
        <button style={navBtn} onClick={() => setWeek(w => w + 1)}>›</button>
        <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--display)", marginLeft: 4 }}>{label}</span>
        <span className="mono dim" style={{ fontSize: 11 }}>
          {calls === 0 ? "nenhuma call nesta semana" : `${calls} ${calls === 1 ? "call" : "calls"}`}
        </span>
        <label className="mono" style={{ fontSize: 11, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={showTouches} onChange={(e) => setShowTouches(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
          mostrar toques
        </label>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {team.map(u => (
            <span key={u.id} className="mono" style={{ fontSize: 11, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: toneOf(u.id) }} />{u.name || u.id}
            </span>
          ))}
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: "var(--fg-4)" }} />sem responsável
          </span>
        </span>
      </div>

      <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
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
                {placed.map(({ l, t, lane, kind }) => {
                  const who = kind === "toque" ? (l.owner || l.closer) : l.closer;
                  const tone = toneOf(who);
                  const isTouch = kind === "toque";
                  const hour = Math.min(H1 - 1, Math.max(H0, t.getHours() + t.getMinutes() / 60));
                  const w = 100 / lanes;
                  return (
                    <div key={l.id + kind}
                      onClick={() => onOpenLead && onOpenLead(l)}
                      title={`${t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${kind} · ${l.name}${l.company ? " · " + l.company : ""}${who ? " · " + displayName(who) : " · sem responsável"}`}
                      style={{
                        position: "absolute", top: (hour - H0) * hourH + 1,
                        left: `calc(${lane * w}% + 2px)`, width: `calc(${w}% - 4px)`,
                        height: isTouch ? 22 : hourH - 3, overflow: "hidden", cursor: "pointer",
                        background: isTouch ? "transparent" : `color-mix(in srgb, ${tone} 14%, var(--bg-1))`,
                        border: isTouch ? `1px dashed color-mix(in srgb, ${tone} 55%, var(--line-2))` : `1px solid color-mix(in srgb, ${tone} 45%, var(--line-1))`,
                        borderLeft: isTouch ? `2px dashed ${tone}` : `3px solid ${tone}`,
                        borderRadius: 5, padding: isTouch ? "1px 6px" : "3px 6px",
                        opacity: isTouch ? 0.85 : 1,
                      }}>
                      <div className="mono tnum" style={{ fontSize: 9.5, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {isTouch ? `○ ${l.name}` : `${t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${who ? ` · ${displayName(who).split(" ")[0]}` : ""}${kind === "integração" ? " · int" : ""}`}
                      </div>
                      {!isTouch && <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>}
                      {!isTouch && l.company && <div style={{ fontSize: 10, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.company}</div>}
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
  const rows = [...leads].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)" }}>
      <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
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
            <span className="mono dim" style={{ fontSize: 12 }}>{displayName(l.owner)}</span>
            <span className="mono dim tnum" style={{ fontSize: 12 }}>{leadAge(l)}</span>
            <span className="mono tnum" style={{ fontSize: 12, color: leadScoreTone(l.score) }}>{l.score ?? ""}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{l.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Análise (forecast + funil real)
function ForecastView({ s, leads }) {
  const buckets = s.funnel.map((f, i) => {
    const at = leads.filter(l => l.stage === f.stage);
    const tcv = at.reduce((a, l) => a + (l.amount || 0), 0);
    const prob = s.funnel.slice(i).reduce((p, x, j) => p * (j === 0 ? 1 : x.conv), 1);
    return { stage: f.stage, tcv, prob, weighted: tcv * prob, count: at.length };
  });
  const max = Math.max(1, ...buckets.map(b => b.tcv));
  return (
    <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "14px 18px", background: "var(--bg-1)" }}>
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
  );
}

// Saúde do PROCESSO: conversão real estágio→estágio (histórico da timeline),
// tempo mediano por etapa, motivos de perda e SLA de 1º toque — GET /api/funnel.
function FunnelAnalytics({ s }) {
  const [days, setDays] = useStP(30);
  const [data, setData] = useStP(null);
  const [err, setErr] = useStP(null);
  useEfP(() => {
    let alive = true;
    setData(null); setErr(null);
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    api.funnelAnalytics(s.id, { since }).then(d => alive && setData(d)).catch(e => alive && setErr(e));
    return () => { alive = false; };
  }, [s.id, days]);

  const card = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "14px 18px", background: "var(--bg-1)" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 };

  if (err) return <div style={card}><div className="mono dim" style={{ fontSize: 12 }}>análise indisponível ({err.status || "erro"})</div></div>;
  if (!data) return <div style={card}><div className="mono dim" style={{ fontSize: 12 }}>carregando análise…</div></div>;

  const pct = (v) => v == null ? "—" : `${Math.round(v * 100)}%`;
  const maxEntered = Math.max(1, ...data.stages.map(st => st.entered));
  const maxReason = Math.max(1, ...data.lossReasons.map(r => r.count));
  const ft = data.firstTouch || {};
  const stat = (label, v, sub) => (
    <div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700, marginTop: 2 }}>{v}</div>
      {sub && <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{sub}</div>}
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Saúde do processo</span>
        <span style={{ flex: 1 }} />
        {[30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} style={{
            height: 22, padding: "0 9px", borderRadius: 4, fontSize: 10.5, fontFamily: "var(--mono)",
            background: days === d ? "var(--accent-soft)" : "var(--bg-2)",
            border: "1px solid " + (days === d ? "var(--accent-line)" : "var(--line-1)"),
            color: days === d ? "var(--accent)" : "var(--fg-3)",
          }}>{d}d</button>
        ))}
      </div>

      <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16 }}>
        {stat("Win rate", pct(data.winRate), `${data.wonCount} ganhos · ${data.lostCount} perdidos`)}
        {stat("1º toque (mediana)", ft.medianHours == null ? "—" : `${ft.medianHours}h`, ft.untouched ? `${ft.untouched} sem nenhum toque` : "todos tocados")}
        {stat("Toque em até 4h", ft.touched ? `${Math.round((ft.buckets.h4 / ft.touched) * 100)}%` : "—", `${ft.buckets?.h4 ?? 0} de ${ft.touched ?? 0} leads tocados`)}
        {stat("Cobertura do histórico", data.coverage.leads ? `${Math.round((data.coverage.withHistory / data.coverage.leads) * 100)}%` : "—", `${data.coverage.withHistory}/${data.coverage.leads} leads com timeline`)}
      </div>

      <div style={card}>
        <div className="mono" style={kicker}>Conversão real estágio → estágio · leads que passaram + mediana de dias na etapa</div>
        {data.stages.map((st) => (
          <div key={st.stage} style={{ display: "grid", gridTemplateColumns: "130px 1fr 56px 84px 84px", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line-1)" }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--fg-2)" }}>{st.stage}</span>
            <div style={{ height: 12, background: "var(--bg-3)", borderRadius: 3, position: "relative" }}>
              <div style={{ position: "absolute", inset: 0, width: `${(st.entered / maxEntered) * 100}%`, background: "var(--accent)", opacity: 0.55, borderRadius: 3 }} />
            </div>
            <span className="mono tnum" style={{ fontSize: 12, textAlign: "right" }}>{st.entered}</span>
            <span className="mono tnum" style={{ fontSize: 11.5, textAlign: "right", color: st.convToNext != null && st.convToNext < 0.3 ? "var(--neg)" : "var(--fg-3)" }}>
              {st.convToNext == null ? "" : `${pct(st.convToNext)} →`}
            </span>
            <span className="mono dim tnum" style={{ fontSize: 11, textAlign: "right" }}>
              {st.medianDaysInStage == null ? "" : `~${st.medianDaysInStage}d na etapa`}
            </span>
          </div>
        ))}
      </div>

      <div style={card}>
        <div className="mono" style={kicker}>Motivos de perda · perdidos + desqualificados do período</div>
        {data.lossReasons.length === 0 && <div className="mono dim" style={{ fontSize: 12 }}>nenhuma perda no período 🎉</div>}
        {data.lossReasons.map((r) => (
          <div key={r.reason} style={{ display: "grid", gridTemplateColumns: "130px 1fr 40px", gap: 10, alignItems: "center", padding: "6px 0" }}>
            <span className="mono" style={{ fontSize: 12, color: r.reason === "nao_informado" ? "var(--fg-4)" : "var(--fg-2)" }}>
              {lossReasonLabel(s, r.reason)}
            </span>
            <div style={{ height: 10, background: "var(--bg-3)", borderRadius: 3, position: "relative" }}>
              <div style={{ position: "absolute", inset: 0, width: `${(r.count / maxReason) * 100}%`, background: "var(--neg)", opacity: 0.6, borderRadius: 3 }} />
            </div>
            <span className="mono tnum" style={{ fontSize: 12, textAlign: "right" }}>{r.count}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function AnaliseView({ s, leads }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 14 }}>
      <ForecastView s={s} leads={leads} />
      <FunnelAnalytics s={s} />
    </div>
  );
}

export { PipelineScreen };
