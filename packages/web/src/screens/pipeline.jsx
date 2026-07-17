import React from "react";
import { Avatar, EmptyState, PrimaryButton } from "../atoms.jsx";
import { Card, FilterTab, Pill, Segmented, StatTile } from "../components/viz.jsx";
import { leadScoreTone, leadAge } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import {
  stageKind, phaseOf, openStages, workableStages, isWonStage,
  nextTouch, nextTouchPill, lossReasonLabel,
} from "../lib/funnel.js";
import { usersByRole, userTone, displayName, currentUser } from "../lib/users.js";
import { moveGate, MoveLeadModal, applyGatedMove } from "../components/stage-move.jsx";
import { useActiveSaas, pinActiveSaas } from "../lib/workspace.js";
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
  const { openForm, version } = useData();
  // Produto do WORKSPACE (seletor no pé da sidebar) — a tela não tem mais abas
  // próprias. Navegação com saas explícito (ex.: "ver no pipeline") pina uma vez.
  const [activeProduct] = useActiveSaas();
  const activeSaas = activeProduct?.id;
  useEfP(() => { pinActiveSaas(saasId); }, [saasId]);
  // Aba ativa persistida (localStorage): sobrevive ao refresh da página e à
  // remontagem da tela quando o tempo real recarrega o SEED. A antiga aba
  // "Análise" (e o alias "forecast") virou a TELA "Análise do pipeline" (menu
  // Análises); preferência salva nesses valores cai no Kanban.
  // "all" (Todos os pipelines) foi aposentada com o workspace por produto:
  // cada marca tem o cockpit inteiro só dela, nada de empilhar produtos.
  const VIEWS = ["kanban", "list", "agenda"];
  const [view, setViewState] = useStP(() => {
    try {
      const v = localStorage.getItem("cockpit_pipeline_view");
      return VIEWS.includes(v) ? v : "kanban";
    } catch { return "kanban"; }
  });
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem("cockpit_pipeline_view", v); } catch { /* ignore */ }
  };
  const [leads, setLeads] = useStP(() => window.SEED.LEADS.map(l => ({ ...l })));
  // Sem o remount global (app.jsx), a cópia local ressincroniza aqui quando o
  // tempo real recarrega o SEED — re-render suave, drag e scroll preservados.
  useEfP(() => { setLeads(window.SEED.LEADS.map((l) => ({ ...l }))); }, [version]);
  const [highlight, setHighlight] = useStP(jumpFilter?.stage || null);
  const [selected, setSelected] = useStP(new Set());
  // Fase do processo (fatia as colunas visíveis — a "view" de cada papel) +
  // pessoa (dono/closer). Fase persiste: o CS abre direto na view dele.
  const PHASES_OPTS = ["all", "sdr", "closer"];
  const [phase, setPhaseState] = useStP(() => {
    try { const v = localStorage.getItem("cockpit_pipeline_phase"); return PHASES_OPTS.includes(v) ? v : "all"; } catch { return "all"; }
  });
  const setPhase = (p) => {
    setPhaseState(p);
    try { localStorage.setItem("cockpit_pipeline_phase", p); } catch { /* ignore */ }
  };
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

  const saasLeads = leads.filter(l => l.saas === activeSaas).filter(personMatch);
  const saasAll = leads.filter(l => l.saas === activeSaas);

  // Group active-product leads by stage
  const stages = s ? s.funnel.map(f => f.stage) : [];
  // Fatia por fase do processo: SDR vê a pré-venda (+ Desqualificado, o terminal
  // dela); Closer vê da call em diante (sem Desqualificado); CS vê o pós-venda
  // (integração/acompanhamento + Ganho).
  const visibleStages = useMP(() => {
    const base = stagesForPhase(s, stages, phase);
    return base.filter((st) => !["ganho", "perdido", "desqualificado"].includes(stageKind(s, st)));
  }, [stages.join("|"), phase, activeSaas]);
  const byStage = useMP(() => {
    const m = {}; stages.forEach(st => m[st] = []);
    saasLeads.forEach(l => {
      const st = stages.includes(l.stage) ? l.stage : stages[0];
      m[st].push(l);
    });
    return m;
  }, [leads, activeSaas, person, stages.join("|")]);

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
  const phaseCounts = {
    sdr: saasAll.filter((l) => phaseOf(stageKind(s, l.stage)) === "sdr").length,
    closer: saasAll.filter((l) => ["closer", "entrega"].includes(phaseOf(stageKind(s, l.stage)))).length,
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <div style={{ padding: "28px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16, minHeight: "100%" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>Pipeline</h1>
            <div style={{ marginTop: 4, fontSize: 14.5, color: "var(--fg-3)" }}>
              {openLeads.length} {openLeads.length === 1 ? "lead aberto" : "leads abertos"} · {newWeek} {newWeek === 1 ? "novo" : "novos"} esta semana · arraste para mover
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 6, flexWrap: "wrap" }}>
            <ViewToggle view={view} onChange={setView} />
            <PrimaryButton onClick={() => openForm("leads", { saas: activeSaas })}>+ novo lead</PrimaryButton>
          </div>
        </div>

        {view === "kanban" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>fase:</span>
            <PhaseFilter phase={phase} counts={phaseCounts} onChange={setPhase} />
            <span style={{ width: 1, height: 18, background: "var(--line-1)", margin: "0 4px" }} />
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>pessoa:</span>
            <PersonFilter person={person} leads={saasAll} onChange={setPerson} me={me} />
          </div>
        )}

      {view === "kanban" && (
        <KanbanBoard
          s={s}
          stages={visibleStages}
          byStage={byStage}
          highlight={highlight}
          onMove={requestMove}
          selected={selected}
          setSelected={setSelected}
          onOpenLead={onOpenLead}
          wonLeads={saasAll.filter((l) => isWonStage(s, l.stage))}
          showWon={phase !== "sdr"}
        />
      )}
      {view === "list" && <LeadList leads={saasLeads} />}
      {view === "agenda" && <AgendaView leads={saasAll} onOpenLead={onOpenLead} />}

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
    </div>
  );
}

function ViewToggle({ view, onChange }) {
  return <Segmented value={view} onChange={onChange} options={[
    { value: "kanban", label: "Kanban" },
    { value: "list", label: "Lista" },
    { value: "agenda", label: "Agenda" },
  ]} />;
}

// Recorte do board por fase do processo — a "view" de cada papel do time:
//   sdr    = pré-venda + Desqualificado (o terminal dela)
//   closer = call → follow-up + Ganho/Perdido (sem Desqualificado)
//   cs     = pós-venda: integração/acompanhamento (fase entrega) + Ganho
function stagesForPhase(s, stages, phase) {
  if (phase === "all") return stages;
  return stages.filter(st => {
    const k = stageKind(s, st);
    const p = phaseOf(k);
    if (phase === "sdr") return p === "sdr" || k === "desqualificado";
    if (phase === "cs") return p === "entrega" || k === "ganho";
    return (p === "closer" || p === "entrega" || p === "fim") && k !== "desqualificado";
  });
}

// Fatia o board pela fase do processo (SDR = pré-venda; Closer = call em
// diante; CS = pós-venda).
function PhaseFilter({ phase, counts, onChange }) {
  const opts = [["all", "Todas"], ["sdr", "SDR"], ["closer", "Closer"]];
  return (
    <div style={{ display: "contents" }}>
      {opts.map(([k, label]) => (
        <FilterTab key={k} active={phase === k} count={k === "all" ? undefined : counts[k]} onClick={() => onChange(k)}>{label}</FilterTab>
      ))}
    </div>
  );
}

// Filtro por pessoa: "meus" (dono OU closer = usuário logado) ou alguém do time.
function PersonFilter({ person, leads, onChange, me }) {
  const users = window.SEED?.USERS || [];
  const selected = person === "me" ? me : person;
  const chip = (active) => ({
    height: 34, padding: "0 13px", borderRadius: 999, fontSize: 13, fontWeight: active ? 600 : 500,
    border: `1px solid ${active ? "var(--line-2)" : "var(--line-1)"}`,
    background: active ? "var(--bg-1)" : "transparent",
    color: active ? "var(--fg-1)" : "var(--fg-3)", boxShadow: active ? "var(--shadow-1)" : "none",
  });
  return (
    <div style={{ display: "contents" }}>
      <button onClick={() => onChange("")} style={chip(!selected)}>Todos</button>
      {users.map((u) => {
        const count = leads.filter((l) => [l.owner, l.closer, l.integrator].includes(u.id)).length;
        return (
          <button key={u.id} onClick={() => onChange(u.id)} style={chip(selected === u.id)}>
            {u.name || u.id}{count > 0 && <span className="tnum" style={{ marginLeft: 7, fontSize: 12, color: "var(--fg-4)" }}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────── Kanban
function KanbanBoard({ s, stages, byStage, highlight, onMove, selected, setSelected, onOpenLead, wonLeads, showWon }) {
  const [dragging, setDragging] = useStP(null);
  // O resumo do Ganho entra logo à direita do pós-venda (Acompanhamento), antes
  // das filas fora da régua (ex.: Nutrição); sem etapa de entrega visível, fim.
  const wonAfter = stages.reduce((acc, st, i) =>
    ["integracao", "posvenda"].includes(stageKind(s, st)) ? i : acc, stages.length - 1);
  return (
    <div style={{ flex: 1, overflowX: "auto", paddingBottom: 8, display: "flex", gap: 12, alignItems: "flex-start" }}>
      {stages.map((st, i) => (
        <React.Fragment key={st}>
          <KanbanColumn
            s={s}
            stage={st}
            cards={byStage[st] || []}
            highlight={highlight === st}
            onDropCard={(id) => { onMove(id, st); setDragging(null); }}
            dragging={dragging}
            setDragging={setDragging}
            selected={selected}
            setSelected={setSelected}
            onOpenLead={onOpenLead}
          />
          {showWon && i === wonAfter && <WonSummary leads={wonLeads} />}
        </React.Fragment>
      ))}
      {showWon && stages.length === 0 && <WonSummary leads={wonLeads} />}
    </div>
  );
}

function WonSummary({ leads }) {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const monthLeads = leads.filter((l) => String(l.stageSince || l.updatedAt || "").slice(0, 7) === month);
  const total = monthLeads.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const label = now.toLocaleDateString("pt-BR", { month: "long" });
  return (
    <div style={{ width: 220, flexShrink: 0, border: "1px dashed var(--line-2)", borderRadius: "var(--r-4)", padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pos)" }}>Ganho · {label}</div>
      <div className="tnum" style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{monthLeads.length}</div>
      <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>{window.fmt.money(total)} fechados</div>
    </div>
  );
}

function KanbanColumn({ s, stage, cards, highlight, onDropCard, dragging, setDragging, selected, setSelected, onOpenLead }) {
  const [over, setOver] = useStP(false);
  const [expanded, setExpanded] = useStP(false);
  const total = cards.reduce((a, l) => a + (l.amount || 0), 0);
  // Ordem temporal: mais novo primeiro (stageSince; fallback createdAt pra
  // cards antigos que ainda não moveram).
  const cardTs = (l) => {
    const t = new Date(l.stageSince || l.createdAt || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const ordered = [...cards].sort((a, b) => cardTs(b) - cardTs(a));
  const shown = expanded ? ordered : ordered.slice(0, 3);
  const hidden = ordered.length - shown.length;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (dragging) onDropCard(dragging); }}
      style={{
        width: 264, flexShrink: 0,
        background: over ? "var(--accent-soft)" : "var(--bg-2)",
        borderRadius: "var(--r-4)", padding: 10,
        boxShadow: highlight ? "0 0 0 2px var(--accent-line)" : "none",
        transition: "var(--transition-ui)",
      }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "6px 8px 10px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          {stage}
          <span className="mono tnum" style={{ fontSize: 11.5, fontWeight: 400, color: "var(--fg-4)" }}>{cards.length}</span>
        </div>
        <span className="tnum" style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{window.fmt.money(total)}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map(l => (
          <LeadCard
            key={l.id} d={l}
            s={s}
            currentStage={stage}
            onDragStart={() => setDragging(l.id)}
            selected={selected.has(l.id)}
            onSelect={() => {
              const next = new Set(selected); next.has(l.id) ? next.delete(l.id) : next.add(l.id); setSelected(next);
            }}
            onOpen={() => onOpenLead && onOpenLead(l)}
          />
        ))}
        {hidden > 0 && (
          <button onClick={() => setExpanded(true)} style={{ textAlign: "center", fontSize: 12, color: "var(--fg-4)", padding: "6px 0 2px" }}>+ {hidden} leads</button>
        )}
        {expanded && ordered.length > 3 && (
          <button onClick={() => setExpanded(false)} style={{ textAlign: "center", fontSize: 12, color: "var(--fg-4)", padding: "2px 0" }}>mostrar menos</button>
        )}
        {cards.length === 0 && <div style={{ fontSize: 12, textAlign: "center", color: "var(--fg-4)", padding: "18px 0" }}>vazio</div>}
      </div>
    </div>
  );
}

function LeadCard({ d, s, currentStage, onDragStart, selected, onSelect, onOpen }) {
  const saasCfg = s || (window.SEED?.SAAS || []).find((x) => x.id === d.saas);
  const kind = stageKind(saasCfg, currentStage);
  const phase = phaseOf(kind);
  const next = nextTouchPill(d, { isOpen: workableStages(saasCfg).includes(currentStage) });
  const ownerId = phase === "entrega" ? (d.integrator || d.closer || d.owner) : (d.closer || d.owner);
  const showAvatar = phase !== "sdr" && ownerId;
  const nextLabel = next?.text?.replace(/^[◆●]\s*/, "") || "";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { if (e.shiftKey) onSelect(); else onOpen && onOpen(); }}
      style={{
        background: "var(--bg-1)", border: `1px solid ${selected ? "var(--accent-line)" : "var(--line-1)"}`,
        borderRadius: "var(--r-3)", padding: "12px 14px", cursor: "grab", boxShadow: "var(--shadow-card)",
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
          {d.company && (
            <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.company}</div>
          )}
        </div>
        {showAvatar && <Avatar id={ownerId} name={displayName(ownerId)} size={24} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600 }}>{window.fmt.money(d.amount || 0)}</span>
        {nextLabel && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginLeft: "auto", fontSize: 11.5, color: next?.tone || "var(--fg-3)", fontWeight: 500, whiteSpace: "nowrap" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", flexShrink: 0 }} />{nextLabel}
          </span>
        )}
      </div>
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
  const saasCfgOf = (l) => (window.SEED?.SAAS || []).find((x) => x.id === l.saas);
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
    <div style={{ flex: 1, minWidth: 0 }}>
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
                  const who = kind === "toque" ? (l.owner || l.closer) : kind === "integração" ? (l.integrator || l.closer) : l.closer;
                  const tone = toneOf(who);
                  const isTouch = kind === "toque";
                  // Follow-up (lead em estágio de kind followup): ocupa só 20 min na
                  // agenda e vem com fundo ESCURO + letra clara, pra destacar da call.
                  const isFollowup = kind === "call" && stageKind(saasCfgOf(l), l.stage) === "followup";
                  const hour = Math.min(H1 - 1, Math.max(H0, t.getHours() + t.getMinutes() / 60));
                  const w = 100 / lanes;
                  const timeStr = t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={l.id + kind}
                      onClick={() => onOpenLead && onOpenLead(l)}
                      title={`${timeStr} · ${isFollowup ? "follow-up" : kind} · ${l.name}${l.company ? " · " + l.company : ""}${who ? " · " + displayName(who) : " · sem responsável"}`}
                      style={{
                        position: "absolute", top: (hour - H0) * hourH + 1,
                        left: `calc(${lane * w}% + 2px)`, width: `calc(${w}% - 4px)`,
                        height: isTouch ? 22 : isFollowup ? Math.round(hourH * 20 / 60) : hourH - 3, // follow-up = 20 min
                        overflow: "hidden", cursor: "pointer",
                        background: isTouch ? "transparent" : isFollowup ? `color-mix(in srgb, ${tone} 45%, var(--fg-1))` : `color-mix(in srgb, ${tone} 14%, var(--bg-1))`,
                        border: isTouch ? `1px dashed color-mix(in srgb, ${tone} 55%, var(--line-2))` : `1px solid color-mix(in srgb, ${tone} ${isFollowup ? 60 : 45}%, var(--line-1))`,
                        borderLeft: isTouch ? `2px dashed ${tone}` : `3px solid ${tone}`,
                        borderRadius: 5, padding: isFollowup ? "0 6px" : isTouch ? "1px 6px" : "3px 6px",
                        opacity: isTouch ? 0.85 : 1,
                        display: isFollowup ? "flex" : undefined, alignItems: isFollowup ? "center" : undefined,
                      }}>
                      {isFollowup ? (
                        <div className="mono" style={{ fontSize: 10, fontWeight: 600, color: "var(--bg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {timeStr} · {l.name}
                          {l.callUrl && <a href={l.callUrl} target="_blank" rel="noopener noreferrer" title="Entrar na videochamada" onClick={(e) => e.stopPropagation()} style={{ marginLeft: 4, textDecoration: "none" }}>🎥</a>}
                        </div>
                      ) : (
                        <>
                          <div className="mono tnum" style={{ fontSize: 9.5, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {isTouch ? `○ ${l.name}` : `${timeStr}${who ? ` · ${displayName(who).split(" ")[0]}` : ""}${kind === "integração" ? " · int" : ""}`}
                            {!isTouch && kind === "call" && l.callUrl && (
                              <a href={l.callUrl} target="_blank" rel="noopener noreferrer" title="Entrar na videochamada"
                                onClick={(e) => e.stopPropagation()} style={{ marginLeft: 4, textDecoration: "none" }}>🎥</a>
                            )}
                          </div>
                          {!isTouch && <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>}
                          {!isTouch && l.company && <div style={{ fontSize: 10, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.company}</div>}
                        </>
                      )}
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
  // Agrupada pelo próximo passo do GPS: Hoje → Amanhã → Próximos dias → Sem
  // próximo passo → Atrasados (recuperação vai pro fim, não é agenda) →
  // Finalizados (terminais/fora da régua). Dentro do dia, ordena pelo horário.
  const saasCfg = (window.SEED?.SAAS || []).find((x) => x.id === leads[0]?.saas);
  const workable = new Set(workableStages(saasCfg));
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const endTomorrow = new Date(endToday); endTomorrow.setDate(endTomorrow.getDate() + 1);
  const g = { today: [], tomorrow: [], upcoming: [], none: [], late: [], closed: [] };
  for (const l of leads) {
    if (l.stage && !workable.has(l.stage)) { g.closed.push({ l, at: 0 }); continue; }
    const t = nextTouch(l);
    if (!t) { g.none.push({ l, at: 0 }); continue; }
    if (t.at < startToday.getTime()) g.late.push({ l, at: t.at });
    else if (t.at <= endToday.getTime()) g.today.push({ l, at: t.at });
    else if (t.at <= endTomorrow.getTime()) g.tomorrow.push({ l, at: t.at });
    else g.upcoming.push({ l, at: t.at });
  }
  for (const k of ["today", "tomorrow", "upcoming", "late"]) g[k].sort((a, b) => a.at - b.at);
  const byScore = (a, b) => (Number(b.l.score) || 0) - (Number(a.l.score) || 0);
  g.none.sort(byScore);
  g.closed.sort(byScore);
  const sections = [
    ["Hoje", g.today], ["Amanhã", g.tomorrow], ["Próximos dias", g.upcoming],
    ["Sem próximo passo", g.none], ["Atrasados", g.late], ["Finalizados", g.closed],
  ].filter(([, rows]) => rows.length > 0);
  const cols = "1.6fr 1fr 0.6fr 0.6fr 0.6fr 0.6fr 0.8fr";

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
        <div className="mono" style={{
          display: "grid", gridTemplateColumns: cols,
          padding: "8px 12px",
          background: "var(--bg-inset)",
          fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase",
          borderBottom: "1px solid var(--line-1)",
        }}>
          <span>Lead</span><span>Estágio</span><span style={{ textAlign: "right" }}>Valor</span>
          <span>Dono</span><span>Idade</span><span>Score</span><span>Origem</span>
        </div>
        {sections.map(([label, rows]) => (
          <React.Fragment key={label}>
            <div className="mono" style={{
              padding: "7px 12px", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
              color: label === "Atrasados" ? "var(--neg)" : label === "Hoje" ? "var(--accent)" : "var(--fg-3)",
              background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)",
            }}>
              {label} · {rows.length}
            </div>
            {rows.map(({ l, at }) => (
              <div key={l.id} style={{
                display: "grid", gridTemplateColumns: cols,
                padding: "8px 12px",
                borderBottom: "1px solid var(--line-1)",
                alignItems: "center",
                fontSize: 13,
                opacity: label === "Finalizados" ? 0.65 : 1,
              }}>
                <span style={{ fontWeight: 500 }}>
                  {l.name} {l.company && <span className="dim" style={{ fontSize: 11, marginLeft: 4 }}>{l.company}</span>}
                  {at > 0 && (
                    <span className="mono dim" style={{ fontSize: 10.5, marginLeft: 6 }}>
                      {new Date(at).toLocaleString("pt-BR", label === "Hoje" || label === "Amanhã"
                        ? { hour: "2-digit", minute: "2-digit" }
                        : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </span>
                <span className="mono dim" style={{ fontSize: 12 }}>{l.stage}</span>
                <span className="mono tnum" style={{ textAlign: "right" }}>{window.fmt.money(l.amount || 0)}</span>
                <span className="mono dim" style={{ fontSize: 12 }}>{displayName(l.owner)}</span>
                <span className="mono dim tnum" style={{ fontSize: 12 }}>{leadAge(l)}</span>
                <span className="mono tnum" style={{ fontSize: 12, color: leadScoreTone(l.score) }}>{l.score ?? ""}</span>
                <span className="mono dim" style={{ fontSize: 11 }}>{l.source}</span>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Análise (forecast + funil real)
const paceCard = {
  border: "1px solid var(--line-1)",
  borderRadius: "var(--r-3)",
  background: "var(--bg-1)",
};

const dailyFmt = (value) => value == null
  ? "—"
  : Number(value).toLocaleString("pt-BR", { minimumFractionDigits: value > 0 && value < 10 ? 1 : 0, maximumFractionDigits: 1 });
const wholeFmt = (value) => value == null ? "—" : Math.round(value).toLocaleString("pt-BR");
const rateFmt = (rate) => rate == null ? "—" : `${Math.round(rate * 100)}%`;

function PaceMini({ label, value, sub, tone }) {
  return (
    <div style={{ minWidth: 0, padding: "11px 12px", borderRadius: "var(--r-2)", background: "var(--bg-2)", border: "1px solid var(--line-1)" }}>
      <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-4)" }}>{label}</div>
      <div className="tnum" style={{ marginTop: 4, fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, color: tone || "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, lineHeight: 1.35, color: "var(--fg-3)" }}>{sub}</div>
    </div>
  );
}

function EquationStep({ value, label, money }) {
  return (
    <div style={{ minWidth: 92, flex: "1 1 92px", padding: "9px 10px", textAlign: "center", borderRadius: "var(--r-2)", background: "var(--bg-2)", border: "1px solid var(--line-1)" }}>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>{money ? window.fmt.money(value || 0) : wholeFmt(value)}</div>
      <div className="mono" style={{ marginTop: 1, fontSize: 9.5, color: "var(--fg-4)", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function EquationArrow({ label }) {
  return (
    <div style={{ flex: "0 0 auto", alignSelf: "center", textAlign: "center", color: "var(--fg-4)" }}>
      <div className="mono" style={{ fontSize: 9.5 }}>{label}</div>
      <div style={{ fontSize: 14, lineHeight: 1 }}>→</div>
    </div>
  );
}

function DailyRole({ step, role, action, primary, primaryLabel, secondary, secondaryLabel, note }) {
  const target = primary?.perDay;
  const actual = primary?.today || 0;
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : primary?.remaining === 0 ? 100 : 0;
  const done = target != null && (target === 0 || actual >= target);
  return (
    <div style={{ ...paceCard, minWidth: 0, padding: "13px 14px", boxShadow: "inset 0 2px 0 var(--accent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span className="mono" style={{ fontSize: 9.5, color: "var(--accent)", letterSpacing: "0.08em" }}>{step}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)", letterSpacing: "0.07em", textTransform: "uppercase" }}>{role}</span>
      </div>
      <div style={{ marginTop: 7, fontSize: 12, color: "var(--fg-2)" }}>{action}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 2 }}>
        <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 27, fontWeight: 700, letterSpacing: "-0.02em" }}>{dailyFmt(target)}</span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{primaryLabel}/dia</span>
      </div>
      <div style={{ height: 5, marginTop: 9, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: done ? "var(--pos)" : "var(--accent)" }} />
      </div>
      <div className="mono" style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5, fontSize: 9.5, color: "var(--fg-4)" }}>
        <span>hoje {wholeFmt(actual)}</span>
        <span>{wholeFmt(primary?.remaining)} até o fim do mês</span>
      </div>
      {secondary && (
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
          <span style={{ color: "var(--fg-3)" }}>{secondaryLabel}</span>
          <span className="tnum" style={{ fontWeight: 600 }}>{dailyFmt(secondary.perDay)}/dia · hoje {wholeFmt(secondary.today)}</span>
        </div>
      )}
      {note && <div style={{ marginTop: 8, fontSize: 10.5, lineHeight: 1.35, color: "var(--fg-4)" }}>{note}</div>}
    </div>
  );
}

function analysisBuckets(s, leads) {
  const visible = new Set(openStages(s));
  return s.funnel.filter((f) => visible.has(f.stage)).map((f, i, stages) => {
    const at = leads.filter((l) => l.stage === f.stage);
    const tcv = at.reduce((sum, lead) => sum + (Number(lead.amount) || 0), 0);
    const sourceIndex = s.funnel.findIndex((stage) => stage.stage === f.stage);
    const prob = s.funnel.slice(sourceIndex).reduce((value, stage, offset) => {
      if (offset === 0) return value;
      const conversion = Number(stage.conv);
      return value * (Number.isFinite(conversion) && stage.conv !== "" && stage.conv != null ? conversion : 1);
    }, 1);
    return { stage: f.stage, tcv, prob, weighted: tcv * prob, count: at.length, index: i, total: stages.length };
  });
}

function PaceChart({ data, s, leads }) {
  const [year, month] = data.month.split("-").map(Number);
  const totalDays = new Date(year, month, 0).getDate();
  const currentDay = data.today.startsWith(data.month) ? Number(data.today.slice(8, 10)) : totalDays;
  const byDay = Array.from({ length: currentDay }, () => 0);
  for (const lead of leads) {
    if (!isWonStage(s, lead.stage) || !String(lead.stageSince || "").startsWith(data.month)) continue;
    const day = Number(String(lead.stageSince).slice(8, 10));
    if (day >= 1 && day <= currentDay) byDay[day - 1] += Number(lead.amount) || 0;
  }
  const cumulative = [];
  byDay.reduce((sum, amount, index) => (cumulative[index] = sum + amount), 0);
  if (cumulative.length && cumulative[cumulative.length - 1] === 0 && data.context.tcvMonth > 0) cumulative[cumulative.length - 1] = data.context.tcvMonth;
  const target = Number(data.cash.target) || 0;
  const max = Math.max(1, target, data.context.tcvMonth || 0);
  const x = (day) => 46 + ((day - 1) / Math.max(1, totalDays - 1)) * 662;
  const y = (value) => 140 - (value / max) * 114;
  const points = cumulative.map((value, index) => `${x(index + 1).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const lastValue = cumulative[cumulative.length - 1] || data.context.tcvMonth || 0;
  const lastX = x(Math.max(1, currentDay));
  const lastY = y(lastValue);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return (
    <svg viewBox="0 0 720 170" width="100%" height="170" preserveAspectRatio="none" style={{ display: "block" }}>
      {[max, max / 2, 0].map((value) => <line key={value} x1="46" y1={y(value)} x2="708" y2={y(value)} stroke="var(--line-faint)" strokeWidth="1" />)}
      <text x="38" y={y(max) + 4} textAnchor="end" style={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" }}>{Math.round(max / 1000)} mil</text>
      <text x="38" y="144" textAnchor="end" style={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" }}>0</text>
      <line x1={x(1)} y1={y(0)} x2={x(totalDays)} y2={y(target)} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="5 4" />
      {points && <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
      <circle cx={lastX} cy={lastY} r="3.5" fill="var(--accent)" />
      <text x={Math.min(640, lastX + 8)} y={Math.max(14, lastY - 6)} style={{ fontFamily: "var(--display)", fontSize: 11.5, fontWeight: 600, fill: "var(--fg-1)" }}>{window.fmt.money(lastValue)}</text>
      <text x="640" y={Math.max(16, y(target) + 14)} style={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" }}>meta</text>
      <text x="46" y="162" style={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" }}>01 {monthLabel}</text>
      <text x="708" y="162" textAnchor="end" style={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" }}>{totalDays} {monthLabel}</text>
    </svg>
  );
}

function AnalysisPaceSummary({ data, s, leads }) {
  const buckets = analysisBuckets(s, leads);
  const forecast = buckets.reduce((sum, bucket) => sum + bucket.weighted, 0);
  const closed = Number(data.context.tcvMonth) || 0;
  const pace = data.cash.elapsedBusinessDays > 0 ? (closed / data.cash.elapsedBusinessDays) * data.cash.totalBusinessDays : 0;
  const target = Number(data.cash.target) || 0;
  const paceVsTarget = target > 0 ? Math.round(((pace / target) - 1) * 100) : null;
  const monthLabel = new Date(`${data.month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long" });
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <StatTile label="Fechado no mês" value={window.fmt.money(closed)} delta={`${data.context.wonMonth} ganhos até dia ${Number(data.today.slice(8, 10))}`} />
        <StatTile label="Pace projetado" value={window.fmt.money(pace)} delta={`ritmo atual até ${data.cash.totalBusinessDays} dias úteis`} />
        <StatTile label="Meta do mês" value={window.fmt.money(target)} delta={paceVsTarget == null ? "meta não configurada" : `pace ${Math.abs(paceVsTarget)}% ${paceVsTarget >= 0 ? "acima" : "abaixo"} da meta`} />
        <StatTile label="Forecast ponderado" value={window.fmt.money(forecast)} delta="pipeline aberto × probabilidade" />
      </div>
      <Card title={`Pace de caixa · ${monthLabel}`} hint="fechado vs. meta, dia a dia">
        <div style={{ padding: "8px 16px 12px" }}><PaceChart data={data} s={s} leads={leads} /></div>
      </Card>
    </>
  );
}

function RevenuePaceDashboard({ s, leads }) {
  const { version } = useData();
  const [data, setData] = useStP(null);
  const [err, setErr] = useStP(null);
  useEfP(() => {
    let alive = true;
    setData(null); setErr(null);
    api.pipelinePace(s.id).then((d) => alive && setData(d)).catch((e) => alive && setErr(e));
    return () => { alive = false; };
  }, [s.id, version]);

  if (err) return <div style={{ ...paceCard, padding: 16 }}><div className="mono dim" style={{ fontSize: 12 }}>pace de caixa indisponível ({err.status || "erro"})</div></div>;
  if (!data) return <div style={{ ...paceCard, padding: 16 }}><div className="mono dim" style={{ fontSize: 12 }}>calculando pace de caixa…</div></div>;

  return <AnalysisPaceSummary data={data} s={s} leads={leads} />;

  const { cash, context, conversions, plan } = data;
  const statusMap = {
    ahead: { label: "acima do pace", tone: "pos", color: "var(--pos)" },
    attention: { label: "atenção ao pace", tone: "warn", color: "var(--warn)" },
    behind: { label: "abaixo do pace", tone: "neg", color: "var(--neg)" },
  };
  const status = statusMap[cash.status] || statusMap.behind;
  const actualWidth = Math.min(100, Math.max(0, cash.progress * 100));
  const expectedLeft = Math.min(100, Math.max(0, cash.expectedProgress * 100));
  const monthLabel = new Date(`${data.month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const sourceLabel = (rate) => rate.source === "history"
    ? `30d · ${rate.numerator}/${rate.denominator}`
    : rate.source === "goal" ? "meta configurada" : "benchmark";
  const averageSource = {
    initial_payments: "primeiras faturas pagas",
    paid_invoices: "faturas pagas recentes",
    won_tcv: "TCV dos ganhos recentes",
    configured_ticket: "ticket configurado",
  }[context.averageEntrySource] || "sem base de entrada";

  return (
    <>
      <section style={{ ...paceCard, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Pace de caixa · {monthLabel}</span>
          <Pill tone={status.tone}>{status.label}</Pill>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{cash.elapsedBusinessDays} de {cash.totalBusinessDays} dias úteis</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, marginTop: 14 }}>
          <div style={{ minWidth: 0, padding: "2px 0" }}>
            <div style={{ fontSize: 12, color: "var(--fg-3)" }}>Dinheiro recebido no mês</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 2, flexWrap: "wrap" }}>
              <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: "clamp(32px, 4vw, 48px)", fontWeight: 700, letterSpacing: "-0.035em" }}>{window.fmt.money(cash.collected)}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--fg-3)" }}>de {window.fmt.money(cash.target)}</span>
            </div>
            <div style={{ position: "relative", height: 12, marginTop: 14, borderRadius: 999, background: "var(--bg-3)" }}>
              <div style={{ width: `${actualWidth}%`, height: "100%", borderRadius: 999, background: status.color, transition: "width 150ms ease" }} />
              <span title={`esperado até hoje: ${window.fmt.money(cash.expectedToDate)}`} style={{ position: "absolute", left: `${expectedLeft}%`, top: -4, width: 2, height: 20, borderRadius: 2, background: "var(--fg-2)" }} />
            </div>
            <div className="mono" style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6, fontSize: 9.5, color: "var(--fg-4)" }}>
              <span>R$ 0</span>
              <span>marcador = {window.fmt.money(cash.expectedToDate)} esperados hoje</span>
              <span>{window.fmt.money(cash.target)}</span>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: status.color, fontWeight: 600 }}>
              {cash.deltaToPace >= 0 ? `${window.fmt.money(cash.deltaToPace)} acima` : `${window.fmt.money(Math.abs(cash.deltaToPace))} abaixo`} do ritmo esperado
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            <PaceMini label="Entrou hoje" value={window.fmt.money(cash.collectedToday)} sub="faturas baixadas hoje" tone={cash.collectedToday >= (cash.requiredDailyPace || Infinity) ? "var(--pos)" : undefined} />
            <PaceMini label="Falta entrar" value={window.fmt.money(cash.gap)} sub={`${cash.remainingBusinessDays} dias úteis restantes`} tone={cash.gap > 0 ? "var(--warn)" : "var(--pos)"} />
            <PaceMini label="Necessário por dia" value={cash.requiredDailyPace == null ? "—" : window.fmt.money(cash.requiredDailyPace)} sub="gap ÷ dias úteis restantes" />
            <PaceMini label="Projeção do mês" value={window.fmt.money(cash.projected)} sub={`ritmo atual de ${window.fmt.money(cash.actualDailyPace)}/dia`} tone={cash.projected >= cash.target ? "var(--pos)" : "var(--neg)"} />
            <PaceMini label="Recebíveis" value={window.fmt.money(cash.receivables)} sub={`${cash.receivableCount} em aberto · caixa + recebíveis ${window.fmt.money(cash.forecastWithReceivables)}`} />
            <PaceMini label="TCV ganho · MRR" value={`${window.fmt.money(context.tcvMonth)} · ${window.fmt.money(context.mrr)}`} sub={`${context.wonMonth} ganhos · contexto, não caixa`} />
          </div>
        </div>
      </section>

      <section style={{ ...paceCard, padding: "15px 18px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 15, fontWeight: 700 }}>Plano diário para fechar o gap</h3>
          <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>cálculo de trás para frente a partir de {window.fmt.money(cash.gap)}</span>
        </div>

        <div style={{ display: "flex", alignItems: "stretch", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
          <EquationStep value={plan.leads.remaining} label="leads" />
          <EquationArrow label={`${rateFmt(conversions.contactRate.value)} contatados`} />
          <EquationStep value={plan.contacts.remaining} label="contatos" />
          <EquationArrow label={`${rateFmt(conversions.bookingRate.value)} agendam`} />
          <EquationStep value={plan.callsBooked.remaining} label="calls agendadas" />
          <EquationArrow label={`${rateFmt(conversions.showRate.value)} comparecem`} />
          <EquationStep value={plan.calls.remaining} label="calls realizadas" />
          <EquationArrow label={`${rateFmt(conversions.closeRate.value)} fecham`} />
          <EquationStep value={plan.wins.remaining} label="ganhos" />
          <EquationArrow label={`${context.averageEntry ? window.fmt.money(context.averageEntry) : "sem entrada"} cada`} />
          <EquationStep value={cash.gap} label="caixa restante" money />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(205px, 1fr))", gap: 9, marginTop: 12 }}>
          <DailyRole step="01" role="Aquisição" action="Gerar demanda suficiente" primary={plan.leads} primaryLabel="leads" note="Entrada do funil: mídia, indicação, orgânico e outbound." />
          <DailyRole step="02" role="SDR" action="Transformar demanda em agenda" primary={plan.contacts} primaryLabel="contatos" secondary={plan.callsBooked} secondaryLabel="Calls agendadas" note={`${rateFmt(conversions.contactRate.value)} dos leads precisam ser contatados.`} />
          <DailyRole step="03" role="Closer" action="Converter calls em dinheiro" primary={plan.calls} primaryLabel="calls" secondary={plan.wins} secondaryLabel="Ganhos" note={`${plan.proposals.today} proposta(s) criada(s) hoje · entrada média ${context.averageEntry ? window.fmt.money(context.averageEntry) : "indisponível"}.`} />
          <DailyRole step="04" role="CS" action="Absorver os novos clientes" primary={plan.onboardings} primaryLabel="integrações" note="Capacidade de entrega acompanha os ganhos previstos, sem contar TCV como caixa." />
        </div>
        {(context.averageEntrySource === "won_tcv" || context.averageEntrySource === "configured_ticket") && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: "var(--r-2)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 11.5 }}>
            A entrada média ainda é uma estimativa por {context.averageEntrySource === "won_tcv" ? "TCV ganho" : "ticket configurado"}. Baixe as faturas pagas para calibrar o plano pelo caixa real.
          </div>
        )}
        {plan.blockedBy && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: "var(--r-2)", background: "var(--neg-soft)", color: "var(--neg)", fontSize: 11.5 }}>
            O desdobramento parou em {{ averageEntry: "entrada média", closeRate: "call → ganho", showRate: "comparecimento", bookingRate: "agendamento", contactRate: "contato" }[plan.blockedBy]}: a taxa atual é zero ou ainda não há base suficiente.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 1, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line-1)" }}>
          <div style={{ padding: "5px 8px" }}>
            <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", textTransform: "uppercase" }}>Entrada média</div>
            <div className="tnum" style={{ marginTop: 2, fontSize: 13, fontWeight: 600 }}>{context.averageEntry ? window.fmt.money(context.averageEntry) : "—"}</div>
            <div style={{ fontSize: 9.5, color: "var(--fg-4)" }}>{averageSource}</div>
          </div>
          {[["Contato", conversions.contactRate], ["Agendamento", conversions.bookingRate], ["Comparecimento", conversions.showRate], ["Call → ganho", conversions.closeRate]].map(([label, rate]) => (
            <div key={label} style={{ padding: "5px 8px" }}>
              <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", textTransform: "uppercase" }}>{label}</div>
              <div className="tnum" style={{ marginTop: 2, fontSize: 13, fontWeight: 600 }}>{rateFmt(rate.value)}</div>
              <div style={{ fontSize: 9.5, color: "var(--fg-4)" }}>{sourceLabel(rate)}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ForecastView({ s, leads }) {
  const buckets = analysisBuckets(s, leads);
  const totals = buckets.reduce((sum, bucket) => ({ count: sum.count + bucket.count, tcv: sum.tcv + bucket.tcv, weighted: sum.weighted + bucket.weighted }), { count: 0, tcv: 0, weighted: 0 });
  const cols = "1.2fr .6fr .9fr .7fr .9fr";
  return (
    <section style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "20px 24px 14px", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>Forecast por etapa</h3>
        <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>pipeline aberto × probabilidade histórica de fechar</span>
      </div>
      <div className="tbl-x">
        <div style={{ minWidth: 700 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "10px 24px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
            <span>Etapa</span><span style={{ textAlign: "right" }}>Leads</span><span style={{ textAlign: "right" }}>Valor aberto</span><span style={{ textAlign: "right" }}>Prob.</span><span style={{ textAlign: "right" }}>Ponderado</span>
          </div>
          {buckets.map((bucket) => (
            <div key={bucket.stage} style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 24px", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 13.5 }}>
              <span style={{ fontWeight: 600 }}>{bucket.stage}</span>
              <span className="tnum" style={{ textAlign: "right" }}>{bucket.count}</span>
              <span className="tnum" style={{ textAlign: "right" }}>{window.fmt.money(bucket.tcv)}</span>
              <span className="tnum" style={{ textAlign: "right", color: "var(--fg-3)" }}>{Math.round(bucket.prob * 100)}%</span>
              <span className="tnum" style={{ textAlign: "right", fontWeight: 600 }}>{window.fmt.money(bucket.weighted)}</span>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 24px", alignItems: "center", borderTop: "1px solid var(--line-1)", fontSize: 13.5, background: "var(--bg-inset)" }}>
            <span style={{ fontWeight: 700 }}>Total ponderado</span><span className="tnum" style={{ textAlign: "right" }}>{totals.count}</span><span className="tnum" style={{ textAlign: "right" }}>{window.fmt.money(totals.tcv)}</span><span /><span className="tnum" style={{ textAlign: "right", fontWeight: 700 }}>{window.fmt.money(totals.weighted)}</span>
          </div>
        </div>
      </div>
    </section>
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
    <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      <RevenuePaceDashboard s={s} leads={leads} />
      <ForecastView s={s} leads={leads} />
    </div>
  );
}

export { PipelineScreen, AnaliseView };
