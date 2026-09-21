import React from "react";
import "./pipeline.css";
import { LeadGrade } from "../components/lead-card.jsx";
import { Avatar, EmptyState, PrimaryButton } from "../atoms.jsx";
import { Card, FilterTab, Segmented, StatTile } from "../components/viz.jsx";
import { Popover } from "../components/popover.jsx";
import { leadTier } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import {
  stageKind, phaseOf, openStages, workableStages, ladderOf, isWonStage, isWonLead, wonAtOf,
  nextTouch, nextTouchPill, lossReasonLabel,
} from "../lib/funnel.js";
import { usersByRole, userColor, displayName, currentUser, allUsers, canSeeScreen } from "../lib/users.js";
import { isNoShowStage } from "../lib/scripts.js";
import { mentoriaFit, mentoriaOfferLine, VERBA_RANK } from "../lib/mentoria.js";
import { moveGate, MoveLeadModal, applyGatedMove } from "../components/stage-move.jsx";
import { useActiveSaas, pinActiveSaas } from "../lib/workspace.js";
import { bizDay } from "../lib/format.js";
import { KanbanBoard, KanbanColumn } from "../components/kanban/board.jsx";
import { useBoardDnd } from "../components/kanban/dnd.js";
// Pipeline — Kanban + Lista. Drag-and-drop between columns.
// Funil unificado: os LEADS são os cards do pipeline (window.SEED.LEADS). Cada
// lead já carrega seu `saas` + `stage`. Uma cópia local deixa o drag-and-drop
// mutar otimisticamente antes de persistir (PATCH /api/leads/:id).
// Processo SDR → Closer: toda decisão de comportamento vem do `kind` do estágio
// (lib/funnel.js), nunca do nome. Movimentos gateados: handoff SDR→Closer exige
// closer; perda/desqualificação exige motivo (components/stage-move.jsx).

const { useState: useStP, useMemo: useMP, useEffect: useEfP } = React;

// Posição do lead na régua de qualidade (S melhor, E pior, sem qualificação por
// último). Usa a MESMA leadTier do card, do drawer e do Publicidade — uma régua
// só pra o número não divergir entre as telas.
const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };
const tierRank = (l) => TIER_RANK[leadTier(l).grade] ?? 9;

function PipelineScreen({ saasId, onJump, jumpFilter, onOpenLead }) {
  const { SAAS } = window.SEED;
  const { openForm, version } = useData();
  // Produto do WORKSPACE (seletor no pé da sidebar) — a tela não tem mais abas
  // próprias. Navegação com saas explícito (ex.: "ver no pipeline") pina uma vez.
  const [activeProduct] = useActiveSaas();
  const activeSaas = activeProduct?.id;
  useEfP(() => { pinActiveSaas(saasId); }, [saasId]);
  // A preferência da visualização acompanha as três abas do CRM final.
  const VIEWS = ["kanban", "list", "analysis"];
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
  // Busca no KANBAN (protótipo, 14/09): existia só na Lista. Com cinco colunas
  // e dez cards em cada, achar um lead pelo nome era rolar o board inteiro de
  // lado. Filtra os cards das colunas; o cabeçalho continua contando a coluna
  // inteira, senão a busca passa a mentir sobre o tamanho da etapa.
  const [buscaBoard, setBuscaBoard] = useStP("");
  // Fase do processo (fatia as colunas visíveis — a "view" de cada papel) +
  // pessoa (dono/closer/integrador). Fase persiste: o CS abre direto na view dele.
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
  // Ordem dentro de cada coluna: "toque" (cronológica, o que já existia),
  // "ultimo" (a mesma fila invertida — o fim do próximo toque no topo) ou
  // "qualidade" (melhor cliente no topo). Vale pra TODAS as colunas de uma vez —
  // não configurar coluna a coluna. Persistida como o resto dos filtros da tela.
  const [sortMode, setSortModeState] = useStP(() => {
    try { const v = localStorage.getItem("cockpit_pipeline_sort"); return ["qualidade", "ultimo"].includes(v) ? v : "toque"; } catch { return "toque"; }
  });
  const setSortMode = (m) => {
    setSortModeState(m);
    try { localStorage.setItem("cockpit_pipeline_sort", m); } catch { /* ignore */ }
  };
  // Desqualificado é o "cemitério" (leads pra reaproveitar depois): fica OCULTO
  // por padrão pra não poluir o fluxo, e um botão revela a coluna. O atalho
  // existia e se perdeu no redesign; voltou aqui. Persistido como os filtros.
  const [showDiscarded, setShowDiscardedState] = useStP(() => {
    try { return localStorage.getItem("cockpit_pipeline_discarded") === "1"; } catch { return false; }
  });
  const setShowDiscarded = (v) => {
    setShowDiscardedState(v);
    try { localStorage.setItem("cockpit_pipeline_discarded", v ? "1" : "0"); } catch { /* ignore */ }
  };
  // "N atrasados" é clicável e filtra o board (12/09): o número respondia a
  // pergunta "quantos?" e deixava a seguinte — "quais?" — pra rolagem.
  // Não persiste: é um recorte do momento, não um filtro de trabalho.
  const [onlyLate, setOnlyLate] = useStP(false);
  // Gate de movimento pendente (handoff / motivo de perda).
  const [pendingMove, setPendingMove] = useStP(null); // { lead, toStage, gate, saasCfg }

  useEfP(() => { setSelected(new Set()); setPendingMove(null); }, [activeSaas]);

  const s = SAAS.find(x => x.id === activeSaas) || SAAS[0];
  const saasCfgOf = (l) => SAAS.find(x => x.id === l.saas);

  const me = currentUser()?.id || "";
  // Vínculo com a pessoa = dono, closer OU integrador — a MESMA régua do
  // contador do chip (PersonFilter). O board filtrava só dono/closer e os
  // cards de quem é integrador (Eryk) sumiam com o chip contando 15.
  const personMatch = (l) => {
    if (!person) return true;
    const who = person === "me" ? me : person;
    return who ? l.owner === who || l.closer === who || l.integrator === who : true;
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
    // Ganho e Perdido nunca viram coluna (o Ganho tem o resumo próprio à direita);
    // Desqualificado só aparece quando o botão "descartados" está ligado.
    return base.filter((st) => {
      const k = stageKind(s, st);
      if (k === "ganho" || k === "perdido") return false;
      if (k === "desqualificado") return false;
      return true;
    });
  }, [stages.join("|"), phase, activeSaas, showDiscarded]);
  // Quantos no cemitério do produto ativo (pro contador do botão).
  const discardedCount = useMP(
    () => saasLeads.filter((l) => stageKind(s, l.stage) === "desqualificado").length,
    [leads, activeSaas, person],
  );
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
    api.update("leads", leadId, { stage }).catch(err => { console.warn("lead move not persisted:", err.message); window.toast && window.toast("O movimento do card não foi salvo · tente de novo", "neg"); });
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
  const phaseCounts = {
    all: openLeads.length,
    sdr: openLeads.filter((l) => phaseOf(stageKind(s, l.stage)) === "sdr").length,
    closer: openLeads.filter((l) => ["closer", "entrega"].includes(phaseOf(stageKind(s, l.stage)))).length,
  };
  // "N atrasados" filtra o board: é a pergunta que se faz olhando o número.
  const lateOnly = useMP(() => {
    if (!onlyLate) return byStage;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const out = {};
    for (const st of Object.keys(byStage)) {
      const kind = stageKind(s, st);
      out[st] = (byStage[st] || []).filter((l) => {
        const at = nextTouch(l, { kind })?.at;
        return at != null && Number.isFinite(at) && at < hoje.getTime();
      });
    }
    return out;
  }, [byStage, onlyLate, activeSaas]);

  // A busca filtra os CARDS, não as colunas: o cabeçalho segue contando a
  // etapa inteira (byStage), então buscar não encolhe o funil na cara de quem
  // olha. Nome, empresa e telefone, a mesma régua da Lista.
  const boardRows = useMP(() => {
    const t = buscaBoard.trim().toLowerCase();
    if (!t) return lateOnly;
    const out = {};
    for (const st of Object.keys(lateOnly)) {
      out[st] = (lateOnly[st] || []).filter((l) =>
        `${l.name || ""} ${l.company || ""} ${l.phone || ""}`.toLowerCase().includes(t));
    }
    return out;
  }, [lateOnly, buscaBoard]);

  // ── Ações em massa ───────────────────────────────────────────────────────
  // O checkbox do card existia desde sempre e não fazia NADA: selecionar dez
  // leads não abria ação nenhuma. Controle morto é o defeito que o handoff
  // mais cobra, então a seleção passa a abrir a barra com mover, atribuir e
  // registrar toque.
  const selLeads = useMP(() => leads.filter((l) => selected.has(l.id)), [leads, selected]);
  // Etapa com PORTÃO (Ganho pede valor e plano, Perdido exige motivo, a
  // passagem pro closer escolhe quem assume) não entra no "mover para": esses
  // são um a um, com o modal. A opção some com o motivo no title.
  const bulkStages = useMP(() => {
    if (!selLeads.length) return [];
    return visibleStages.map((st) => {
      const travada = selLeads.find((l) => l.stage !== st && moveGate(saasCfgOf(l), l, st));
      return { stage: st, travada: !!travada };
    });
  }, [visibleStages.join("|"), selLeads]);

  function bulkPatch(patch, rotulo) {
    const ids = [...selected];
    if (!ids.length) return;
    setLeads((prev) => prev.map((l) => ids.includes(l.id) ? { ...l, ...patch } : l));
    Promise.allSettled(ids.map((id) => api.update("leads", id, patch)))
      .then((rs) => {
        const falhas = rs.filter((r) => r.status === "rejected").length;
        if (falhas) window.toast?.(`${falhas} de ${ids.length} não salvaram · tente de novo`, "neg");
        else window.toast?.(`${ids.length} ${ids.length === 1 ? "lead" : "leads"} · ${rotulo}`, "pos");
      });
    setSelected(new Set());
  }

  function bulkMove(stage) {
    const ids = [...selected];
    if (!ids.length) return;
    setLeads((prev) => prev.map((l) => ids.includes(l.id)
      ? { ...l, stage, stageSince: new Date().toISOString(), stageAttempts: 0 } : l));
    Promise.allSettled(ids.map((id) => api.update("leads", id, { stage })))
      .then((rs) => {
        const falhas = rs.filter((r) => r.status === "rejected").length;
        if (falhas) window.toast?.(`${falhas} de ${ids.length} não moveram · tente de novo`, "neg");
        else window.toast?.(`${ids.length} ${ids.length === 1 ? "lead movido" : "leads movidos"} para ${stage}`, "pos");
      });
    setSelected(new Set());
  }

  // Toque em massa: a mesma gravação do "toque e próximo" de Minhas atividades
  // (tentativa +1, último contato agora), pra varrer uma coluna parada.
  function bulkTouch() {
    const alvos = selLeads;
    if (!alvos.length) return;
    const agora = new Date().toISOString();
    const ids = alvos.map((l) => l.id);
    setLeads((prev) => prev.map((l) => ids.includes(l.id)
      ? { ...l, stageAttempts: (Number(l.stageAttempts) || 0) + 1, lastActivityAt: agora, lastActivityType: "whatsapp" } : l));
    Promise.allSettled(alvos.map((l) => api.logActivity({ saas: l.saas, lead: l.id, type: "whatsapp", text: "toque registrado em massa (pipeline)", author: me })))
      .then((rs) => {
        const falhas = rs.filter((r) => r.status === "rejected").length;
        if (falhas) window.toast?.(`${falhas} de ${ids.length} toques não foram registrados · tente de novo`, "neg");
        else window.toast?.(`${ids.length} ${ids.length === 1 ? "toque registrado" : "toques registrados"}`, "pos");
      });
    setSelected(new Set());
  }

  return (
    <div className="pipeline-page">
      <div className="pipeline-content">
        <header className="pipeline-header">
          <div><h1 className="page-title">Pipeline</h1><div style={{marginTop:6}} /></div>
          <div className="pipeline-header-actions">
            <ViewToggle view={view} onChange={setView} />
            <button className="pipeline-create" onClick={() => openForm("leads", { saas: activeSaas })}>Cadastrar lead</button>
          </div>
        </header>
        <section className="pipeline-filters" aria-label="Filtros do pipeline">
          <label className="pipeline-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20.4 20.4-4.2-4.2"/></svg>
            <input aria-label="Buscar lead ou empresa" value={buscaBoard} onChange={e => setBuscaBoard(e.target.value)} placeholder="buscar lead ou empresa…" />
          </label>
          <span className="pipeline-kicker">fase</span>
          <div className="pipeline-segment" aria-label="Fase">
            {[["all","Todas"],["sdr","SDR"],["closer","Closer"]].map(([id,label]) => <button key={id} aria-pressed={phase===id} onClick={()=>setPhase(id)}>{label} <span>{phaseCounts[id]}</span></button>)}
          </div>
          <PersonFilter person={person} leads={saasAll} onChange={setPerson} me={me} />
          <select className="pipeline-order" aria-label="Ordenar leads" value={sortMode} onChange={e=>setSortMode(e.target.value)}>
            <option value="toque">Próximo toque</option><option value="ultimo">Último toque</option><option value="qualidade">Qualidade</option>
          </select>
          {(buscaBoard || phase!=="all" || person || onlyLate || sortMode!=="toque") && <button className="pipeline-clear" onClick={()=>{setBuscaBoard("");setPhase("all");setPerson("");setOnlyLate(false);setSortMode("toque");}}>Limpar filtros</button>}
          <span className="pipeline-count">{visibleStages.reduce((n,st)=>n+(boardRows[st]?.length||0),0)} leads</span>
        </section>
      {/* ── Ações em massa (14/09) ─────────────────────────────────────────
          O checkbox do card não fazia nada: dava pra selecionar dez leads e
          não acontecia ação nenhuma. Agora a seleção abre a barra. */}
      {view === "kanban" && selected.size > 0 && (
        <BulkBar
          n={selected.size}
          stages={bulkStages}
          users={allUsers()}
          onMove={bulkMove}
          onAssign={(userId, field) => bulkPatch({ [field]: userId }, `atribuídos a ${displayName(userId)}`)}
          onTouch={bulkTouch}
          onClear={() => setSelected(new Set())}
        />
      )}

      {view === "kanban" && (
        <PipelineBoard
          s={s}
          stages={visibleStages}
          byStage={boardRows}
          fullByStage={boardRows}
          sortMode={sortMode}
          highlight={highlight}
          onMove={requestMove}
          selected={selected}
          setSelected={setSelected}
          onOpenLead={onOpenLead}
          wonLeads={saasAll.filter((l) => isWonLead(s, l))}
          showWon={phase !== "sdr"}
          onLate={() => setOnlyLate(v=>!v)}
        />
      )}
      {view === "list" && <LeadList leads={visibleStages.flatMap(st=>boardRows[st]||[])} s={s} sortMode={sortMode} onOpenLead={onOpenLead} />}
      {view === "analysis" && <PipelineAnalysis s={s} leads={visibleStages.flatMap(st=>boardRows[st]||[])} />}
      <footer className="pipeline-discarded">
        <button onClick={() => setShowDiscarded(!showDiscarded)} aria-expanded={showDiscarded}>{showDiscarded ? "Esconder" : "Mostrar"} descartados · {discardedCount}</button>
        <span>descartado não conta no funil, mas volta com um clique</span>
        {showDiscarded && <div className="pipeline-discarded-leads">{saasLeads.filter(l=>stageKind(s,l.stage)==="desqualificado").map(l=><button key={l.id} onClick={()=>requestMove(l.id,open[0])}>{l.name} <span>voltar ↩</span></button>)}</div>}
      </footer>

      {pendingMove && (
        <MoveLeadModal
          lead={pendingMove.lead}
          toStage={pendingMove.toStage}
          gate={pendingMove.gate}
          saasCfg={pendingMove.saasCfg}
          onCancel={() => setPendingMove(null)}
          onConfirm={(patch, extra) => {
            commitMoveLocal(pendingMove.lead.id, patch);
            applyGatedMove(patch, extra, pendingMove.lead.id).catch(err => { console.warn("movimento não persistido:", err.message); window.toast && window.toast("O movimento do card não foi salvo · tente de novo", "neg"); });
            setPendingMove(null);
          }}
        />
      )}
      </div>
    </div>
  );
}

// ── Barra de ações em massa ─────────────────────────────────────────────────
// Aparece quando há card selecionado. "Mover para" não oferece etapa com
// portão (Ganho pede valor e plano, Perdido exige motivo, a passagem pro
// closer escolhe quem assume): esses são um a um, com o modal, e a opção some
// dizendo por quê. "Atribuir" grava no campo da FASE da etapa de destino de
// cada lead, a mesma régua do assumir em Minhas atividades.
function BulkBar({ n, stages, users, onMove, onAssign, onTouch, onClear }) {
  // Âncora por ref, não por e.currentTarget: o synthetic event zera o
  // currentTarget depois do handler e o popover nasceria no canto da tela.
  const refMover = React.useRef(null);
  const refAtribuir = React.useRef(null);
  const [aberto, setAberto] = useStP(null);
  return (
    <section style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "11px 16px", borderRadius: "var(--r-3)", border: "1px solid var(--accent-line)", background: "var(--accent-soft)" }}>
      <span className="tnum" style={{ fontSize: 13.5, fontWeight: 650, color: "var(--accent)" }}>
        {n} {n === 1 ? "lead selecionado" : "leads selecionados"}
      </span>
      <span style={{ flex: 1 }} />
      <button ref={refMover} onClick={() => setAberto(aberto === "mover" ? null : "mover")} style={bulkBtn}>mover para ▾</button>
      <button ref={refAtribuir} onClick={() => setAberto(aberto === "atribuir" ? null : "atribuir")} style={bulkBtn}>atribuir ▾</button>
      <button onClick={onTouch} title="registra uma tentativa de contato em cada um (tentativa +1 e último contato agora)" style={bulkBtn}>registrar toque</button>
      <button onClick={onClear} className="mono" style={{ background: "none", border: 0, padding: "0 4px", fontSize: 12, color: "var(--fg-3)", fontWeight: 600, cursor: "pointer" }}>limpar</button>
      {aberto === "mover" && (
        <Popover anchor={refMover} onClose={() => setAberto(null)} width={230} title="Mover para" align="end">
          {stages.map(({ stage, travada }) => (
            <button key={stage} disabled={travada}
              title={travada ? "esta etapa pede valor, motivo ou quem assume — mova um a um, pelo card" : ""}
              onClick={() => { setAberto(null); onMove(stage); }}
              style={{ ...bulkItem, opacity: travada ? 0.45 : 1, cursor: travada ? "not-allowed" : "pointer" }}>
              {stage}
            </button>
          ))}
        </Popover>
      )}
      {aberto === "atribuir" && (
        <Popover anchor={refAtribuir} onClose={() => setAberto(null)} width={230} title="Atribuir a" align="end">
          {users.map((u) => (
            <button key={u.id} onClick={() => { setAberto(null); onAssign(u.id, "owner"); }} style={bulkItem}>
              <Avatar id={u.id} name={displayName(u.id)} size={20} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName(u.id)}</span>
            </button>
          ))}
        </Popover>
      )}
    </section>
  );
}
const bulkBtn = { height: 30, padding: "0 12px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const bulkItem = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: "var(--r-2)", background: "none", border: 0, textAlign: "left", fontSize: 12.5, color: "var(--fg-1)", cursor: "pointer" };

function ViewToggle({ view, onChange }) {
  return <div className="pipeline-views" aria-label="Visualização">{[["kanban","Kanban"],["list","Lista"],["analysis","Análise"]].map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>onChange(id)}>{label}</button>)}</div>;
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

// Filtro por pessoa: "meus" (dono, closer OU integrador = usuário logado) ou
// alguém do time. O contador do chip usa a MESMA régua do personMatch do board.
function PersonFilter({ person, leads, onChange, me }) {
  const users = window.SEED?.USERS || [];
  const selected = person === "me" ? me : person;
  return <div className="pipeline-segment pipeline-people" aria-label="Responsável">
    <button aria-pressed={!selected} onClick={()=>onChange("")}>Todos</button>
    {users.map(u=><button key={u.id} aria-label={u.name || u.id} title={u.name || u.id} aria-pressed={selected===u.id} onClick={()=>onChange(u.id)}>{initials(u.name || u.id)}</button>)}
  </div>;
}
const initials = name => String(name || "").split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();

// ─────────────────────────────────────────────── Kanban
function PipelineBoard({ s, stages, byStage, fullByStage, sortMode, highlight, onMove, selected, setSelected, onOpenLead, wonLeads, showWon, onLate }) {
  const boardRef = React.useRef(null);
  // Arrastar e soltar da casca compartilhada (components/kanban). Um lead por
  // vez: movimento com portão abre o modal, e a seleção tem a barra de massa.
  const dnd = useBoardDnd({ boardRef, onDrop: ({ ids, toKey }) => ids.forEach((id) => onMove(id, toKey)) });
  // O resumo do Ganho entra na POSIÇÃO que o FUNIL declara pro ganho: logo depois
  // da última etapa VISÍVEL que vem ANTES do ganho na ordem do funil (Follow-up),
  // e a entrega (Integração) segue à direita dele. Ancorar por "última etapa de
  // venda" jogava o resumo pro FIM quando havia etapa de kind contato (Nutrição /
  // No show) DEPOIS da Integração — elas contavam como venda e o resumo pulava a
  // Integração. Sem etapa antes do ganho visível, cai no fim (comportamento antigo).
  const fullOrder = (s?.funnel || []).map((f) => f.stage);
  const wonPos = fullOrder.findIndex((st) => stageKind(s, st) === "ganho");
  const wonAfter = wonPos < 0
    ? stages.length - 1
    : stages.reduce((acc, st, i) => (fullOrder.indexOf(st) < wonPos ? i : acc), stages.length - 1);
  return (
    // Grid de colunas IGUAIS (prancha, 14/09): o board era um flex com colunas
    // de 264px fixos, que deixava faixa vazia à direita com poucas etapas e
    // rolava de lado com muitas. O layout "fill" da casca faz as duas coisas:
    // enche a largura quando cabe e rola quando não cabe.
    <KanbanBoard boardRef={boardRef} layout="fill">
      {stages.map((st, i) => (
        <React.Fragment key={st}>
          <StageColumn
            s={s}
            stage={st}
            cards={byStage[st] || []}
            todos={(fullByStage || byStage)[st] || []}
            sortMode={sortMode}
            onLate={onLate}
            highlight={highlight === st}
            dnd={dnd}
            selected={selected}
            setSelected={setSelected}
            onOpenLead={onOpenLead}
          />
          {showWon && i === wonAfter && <WonSummary leads={wonLeads} />}
        </React.Fragment>
      ))}
      {showWon && stages.length === 0 && <WonSummary leads={wonLeads} />}
    </KanbanBoard>
  );
}

function WonSummary({ leads }) {
  const now = new Date();
  // Mês do NEGÓCIO (bizDay, America/Sao_Paulo), igual à Meta do mês da Visão
  // geral: o slice do ISO cortava em UTC e uma venda das 21h+ do dia 31 caía no
  // mês seguinte só neste card, divergindo da meta.
  const month = bizDay(now).slice(0, 7);
  // Mês pela DATA DA VENDA (wonAt), não pelo stageSince: o card anda pra
  // Integração e recarimba o stageSince, o que jogaria o ganho pro mês errado.
  const monthLeads = leads.filter((l) => bizDay(wonAtOf(l)).slice(0, 7) === month);
  const total = monthLeads.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const label = now.toLocaleDateString("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });
  // A borda tracejada dava cara de placeholder vazio justamente no bloco que
  // mostra o que já foi fechado. Agora é um bloco --pos soft (12/09).
  // A coluna do Ganho na prancha (14/09): título com a contagem, o DINHEIRO
  // grande em verde, o ticket médio embaixo e as vendas do mês em linhas com
  // o dono à direita. Era um bloco com a CONTAGEM grande e o dinheiro numa
  // linha de 12,5px — e o que fecha o mês é o dinheiro.
  const ticket = monthLeads.length ? total / monthLeads.length : 0;
  const recentes = [...monthLeads].sort((a, b) => new Date(wonAtOf(b) || 0) - new Date(wonAtOf(a) || 0));
  return <section className="capsule-navy pipeline-won">
    <header><div className="pipeline-won-title"><span>Ganho em {label}</span><span className="pipeline-won-count">{monthLeads.length}</span></div>
      <div className="pipeline-won-total">{window.fmt.moneyFull(total)}</div>
      <div className="pipeline-won-ticket">ticket médio {window.fmt.moneyFull(ticket)}</div>
    </header>
    <div className="pipeline-won-list">{recentes.map(l=><div className="pipeline-won-row" key={l.id}><span>{l.company || l.name}</span><strong>{window.fmt.moneyFull(l.amount||0)}</strong><small>{initials(displayName(l.closer||l.owner))}</small></div>)}
      {!recentes.length && <div className="pipeline-empty">nenhuma venda fechada no mês</div>}
    </div>
  </section>;
}

function StageColumn({ s, stage, cards, todos, sortMode, highlight, dnd, selected, setSelected, onOpenLead, onLate }) {
  // O cabeçalho (contagem, dinheiro, atraso) mede a ETAPA INTEIRA; o corpo
  // mostra o que a busca deixou. Senão buscar encolhe o funil na cara de quem
  // olha, e o board passa a mentir sobre o tamanho da etapa.
  const todosCards = todos && todos.length >= cards.length ? todos : cards;
  const filtrando = todosCards.length !== cards.length;
  const total = todosCards.reduce((a, l) => a + (l.amount || 0), 0);
  // Ordem cronológica pelo próximo contato (atrasado primeiro, depois hoje,
  // amanhã...); sem próximo passo vai pro fim, do mais novo na etapa pro mais
  // antigo (stageSince; fallback createdAt pra cards que ainda não moveram).
  const stageTs = (l) => {
    const t = new Date(l.stageSince || l.createdAt || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const colKind = stageKind(s, stage); // compromisso segue a etapa da coluna (call vs integração)
  const nextTs = (l) => nextTouch(l, { kind: colKind })?.at ?? Infinity;
  const byTouch = (a, b) => nextTs(a) - nextTs(b) || stageTs(b) - stageTs(a);
  // Qualidade: S no topo, E no fim, quem não respondeu a qualificação por
  // último. Empate na mesma grade cai na ordem de sempre (próximo toque), então
  // trocar pra "qualidade" reordena por prioridade sem perder a urgência dentro
  // de cada faixa.
  // Último toque: a MESMA fila do próximo toque, invertida — quem estava no fim
  // (sem próximo passo, depois o toque mais distante) sobe pro topo. É pra
  // varrer a coluna de trás pra frente sem rolar até o fundo.
  // Na fila da Mentoria a "qualidade" não vem da régua de contas × anúncios
  // (esse lead nem vende ainda): vem da VERBA que ele declarou no form, que é
  // o que qualifica essa fila. Assim a coluna abre pelo dinheiro que tem nela.
  const rankOf = (l) => (mentoriaFit(l) ? VERBA_RANK[l.aprender_verba] ?? 8 : tierRank(l));
  const ordered = sortMode === "qualidade"
    ? [...cards].sort((a, b) => rankOf(a) - rankOf(b) || byTouch(a, b))
    : sortMode === "ultimo"
      ? [...cards].sort((a, b) => byTouch(b, a))
      : [...cards].sort(byTouch);
  // Mesma régua do nextTs acima (nextTouch pelo kind da coluna): o número do
  // cabeçalho e a ordem da coluna nunca discordam.
  const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
  const colLate = todosCards.filter((l) => { const t = nextTs(l); return Number.isFinite(t) && t < hoje0.getTime(); }).length;
  const colToday = todosCards.filter((l) => { const t = nextTs(l); return Number.isFinite(t) && t >= hoje0.getTime() && t < hoje0.getTime() + 86400000; }).length;
  // Cabeçalho da prancha: nome e contagem à esquerda, o ATRASO à direita na
  // mesma linha, e o dinheiro da coluna na linha de baixo.
  return (
    <KanbanColumn
      colKey={stage} dnd={dnd} label={stage} items={ordered} cut={Infinity} highlight={highlight}
      count={todosCards.length}
      meta={<>
        {filtrando && <span className="tnum" style={{ fontSize: 11, color: "var(--accent)", whiteSpace: "nowrap" }}>{cards.length} na busca</span>}
        {(colLate > 0 || colToday > 0) && (
          <button className="pipeline-late" onClick={onLate} aria-label={`Filtrar atrasados de ${stage}`} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", color: colLate > 0 ? "var(--neg)" : "var(--warn)" }}>
            {[colLate > 0 ? `${colLate} atrasado${colLate === 1 ? "" : "s"}` : null, colToday > 0 ? `${colToday} hoje` : null].filter(Boolean).join(" · ")}
          </button>
        )}
      </>}
      subtitle={window.fmt.moneyFull(total)}
      moreLabel={(n) => `+${n} leads`}
      emptyText={filtrando ? "nenhum card nesta busca" : "arraste um lead para cá"}
      renderItem={(l) => (
        <LeadCard
          key={l.id} d={l}
          s={s}
          currentStage={stage}
          dragProps={dnd.cardDragProps(l, stage)}
          selected={selected.has(l.id)}
          onSelect={() => {
            const next = new Set(selected); next.has(l.id) ? next.delete(l.id) : next.add(l.id); setSelected(next);
          }}
          onOpen={() => onOpenLead && onOpenLead(l)}
        />
      )}
    />
  );
}

// O texto do próximo passo quando o lead não tem nota escrita: o compromisso
// que a etapa espera. É o mesmo vocabulário da fila de Minhas atividades.
function nextStepText(d, kind, stage) {
  if (kind === "call" && d.callAt) {
    const t = new Date(d.callAt);
    if (Number.isFinite(t.getTime())) {
      const dia = t.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
      return `Call ${dia}, ${t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    }
  }
  if (kind === "integracao" && d.integrationAt) return "Integração marcada";
  return { novo: "Primeiro contato", contato: "Nova tentativa", qualificacao: "Retomar o contato", proposta: "Cobrar retorno da proposta", followup: "Follow-up da proposta" }[kind] || "";
}

function LeadCard({ d, s, currentStage, dragProps, selected, onSelect, onOpen }) {
  const saasCfg = s || (window.SEED?.SAAS || []).find((x) => x.id === d.saas);
  const kind = stageKind(saasCfg, currentStage);
  const phase = phaseOf(kind);
  const next = nextTouchPill(d, { isOpen: workableStages(saasCfg).includes(currentStage), kind });
  const ownerId = phase === "entrega" ? (d.integrator || d.closer || d.owner) : (d.closer || d.owner);
  const showAvatar = ownerId;
  const nextLabel = next?.text?.replace(/^[◆●]\s*/, "") || "";
  // Qualidade do cliente (A/B/C) pela régua de contas × anúncios — a mesma do
  // Publicidade e do drawer. Só mostra quando o lead respondeu a qualificação.
  const tier = leadTier(d);
  const fit = mentoriaFit(d);

  // O card da prancha (14/09): checkbox VISÍVEL, nível e nome na primeira
  // linha, empresa, o próximo passo em texto, e valor + prazo no rodapé. A
  // borda fica vermelha suave quando o card está atrasado, que é o que faz a
  // coluna travada ser lida de longe sem abrir nada.
  const atrasado = next?.tone === "var(--neg)";
  const passo = d.nextActionNote || nextStepText(d, kind, currentStage);
  return (
    <div
      className="lead-board-card" data-late={atrasado || undefined} data-selected={selected || undefined}
      role="button" tabIndex={0} aria-label={`Abrir lead: ${d.name}`}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen?.(); } }}
      {...dragProps}
      onClick={(e) => { if (e.shiftKey) onSelect(); else onOpen && onOpen(); }}
      style={{
        background: "var(--bg-1)",
        border: `1px solid ${selected ? "var(--accent-line)" : atrasado ? "color-mix(in srgb, var(--neg) 28%, var(--bg-1))" : "var(--line-1)"}`,
        borderRadius: 18, padding: "12px 14px", boxShadow: "var(--shadow-card)",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button onClick={(e) => { e.stopPropagation(); onSelect(); }} role="checkbox" aria-checked={selected} aria-label={`Selecionar ${d.name}`}
          title="selecionar para ação em massa"
          style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 999, cursor: "pointer",
            border: `1px solid ${selected ? "var(--accent)" : "var(--line-2)"}`,
            background: selected ? "var(--accent)" : "var(--bg-1)",
            padding: 0, color: "oklch(1 0 0)", fontSize: 10, lineHeight: "12px", textAlign: "center" }}>{selected ? "✓" : ""}</button>
        <LeadGrade tier={tier} size={20} placeholder />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
        {showAvatar && <span className="pipeline-owner" title={displayName(ownerId)}>{initials(displayName(ownerId))}</span>}
      </div>
      {d.company && (
        <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.company}</div>
      )}
      {/* O PRÓXIMO PASSO em texto: é o que a prancha põe no card, e é o que
          diz o que fazer sem abrir o lead. */}
      <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {passo || "sem próximo passo"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        {/* Lead da fila da Mentoria não tem proposta gerada, então o valor do
            card seria sempre R$ 0: no lugar dele entra a oferta que a verba
            declarada encaixa, que é o que decide por qual card começar. */}
        {fit && !d.amount
          ? <span className="tnum" title={`Verba declarada: ${fit.verbaLabel}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>{mentoriaOfferLine(fit)}</span>
          : <span className="tnum" style={{ fontSize: 13, fontWeight: 700 }}>{window.fmt.moneyFull(d.amount || 0)}</span>}
        {nextLabel && (
          <span className="tnum" style={{ marginLeft: "auto", fontSize: 11.5, color: next?.tone || "var(--fg-4)", fontWeight: 600, whiteSpace: "nowrap" }}>{nextLabel}</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── List view
// Grade aprovada; em janelas menores a rolagem fica dentro da tabela.
export const LIST_GRID = "32px minmax(180px,1fr) 132px minmax(150px,1fr) 86px 96px";
export const LIST_GRID_GAP = 10;
export const LIST_GRID_BUDGET = 820;
// Legacy grouping helper retained for consumers; the approved list is continuous.
export const LIST_SECTIONS = [["late","Atrasados"],["today","Hoje"],["tomorrow","Amanhã"],["upcoming","Próximos dias"],["none","Sem próximo passo"],["closed","Finalizados"]];
function orderLeads(leads,s,sortMode) {
  const touch = l => nextTouch(l,{kind:stageKind(s,l.stage)})?.at ?? Infinity;
  const byTouch = (a,b) => touch(a)-touch(b) || new Date(b.stageSince||b.createdAt||0)-new Date(a.stageSince||a.createdAt||0);
  const rank = l => mentoriaFit(l) ? VERBA_RANK[l.aprender_verba] ?? 8 : tierRank(l);
  return [...leads].sort(sortMode==="qualidade" ? (a,b)=>rank(a)-rank(b)||byTouch(a,b) : sortMode==="ultimo" ? (a,b)=>byTouch(b,a) : byTouch);
}
function LeadList({ leads, s, sortMode, onOpenLead }) {
  return <section className="pipeline-list">
    <div className="pipeline-list-table">
      <div className="pipeline-list-head">{["nv","lead","etapa","próximo passo","valor","prazo"].map(t=><span key={t}>{t}</span>)}</div>
      <div className="pipeline-list-rows">{orderLeads(leads,s,sortMode).map(l=>{
        const kind=stageKind(s,l.stage), due=nextTouchPill(l,{kind,isOpen:workableStages(s).includes(l.stage)});
        return <button className="pipeline-list-row" data-late={due?.tone === "var(--neg)" || undefined} key={l.id} onClick={()=>onOpenLead?.(l)} aria-label={`Abrir lead: ${l.name}`}>
          <span><LeadGrade tier={leadTier(l)} size={18} placeholder /></span>
          <span><strong>{l.name}</strong><small>{l.company}</small></span>
          <span>{l.stage}</span><span>{l.nextActionNote||nextStepText(l,kind,l.stage)||"sem próximo passo"}</span>
          <span>{window.fmt.moneyFull(l.amount||0)}</span><span style={{color:due?.tone}}>{due?.key === "none" ? "sem data" : due?.text?.replace(/^[◆●]\s*/,"")||"sem data"}</span>
        </button>;
      })}{!leads.length&&<div className="pipeline-empty">nenhum lead com esses filtros</div>}</div>
    </div>
  </section>;
}
function PipelineAnalysis({s,leads}) {
  const {version}=useData();
  const [read,setRead]=useStP({key:null}), [attempt,setAttempt]=useStP(0);
  useEfP(()=>{let alive=true;setRead({key:s.id});api.pipelinePace(s.id).then(data=>{if(alive)setRead({key:s.id,data});}).catch(error=>{if(alive)setRead({key:s.id,error});});return()=>{alive=false;};},[s.id,version,attempt]);
  const data=read.key===s.id?read.data:null;
  const buckets=analysisBuckets(s,leads,data?.conversions);
  const total=buckets.reduce((n,b)=>n+b.weighted,0), max=Math.max(1,...buckets.map(b=>b.weighted));
  return <section className="pipeline-analysis">
    <header><div><h2><i/>esteira aberta</h2><p>{buckets.reduce((n,b)=>n+b.count,0)} leads nas etapas comerciais</p></div><div className="pipeline-forecast"><span>forecast ponderado</span><strong>{data?window.fmt.moneyFull(total):"—"}</strong><small>{data?"valor × probabilidade de ganhar":""}</small></div></header>
    {read.error ? <div role="alert" className="pipeline-empty">Não foi possível carregar a análise. <button onClick={()=>setAttempt(n=>n+1)}>Tentar novamente</button></div> : !data ? <div role="status" className="pipeline-empty">Calculando análise…</div> : <>
      <div className="pipeline-analysis-scroll"><div className="pipeline-analysis-table">
        <div className="pipeline-analysis-head">{["etapa","","leads","em jogo","prob.","ponderado"].map((t,i)=><span key={i}>{t}</span>)}</div>
        {buckets.map(b=><div className="pipeline-analysis-row" key={b.stage}><span>{b.stage}</span><span className="pipeline-bar"><i style={{width:`${Math.max(3,b.weighted/max*100)}%`}}/></span><strong>{b.count}</strong><span>{window.fmt.moneyFull(b.tcv)}</span><span>{rateFmt(b.prob)}</span><strong>{window.fmt.moneyFull(b.weighted)}</strong></div>)}
      </div></div>
      <div className="pipeline-analysis-note">Probabilidades pelas conversões reais do funil; etapas sem histórico usam as taxas configuradas. Entrega e descartados ficam fora da esteira aberta.</div>
    </>}
  </section>;
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

function PaceSection({title,hint,children,className=""}) {
  return <section className={`pace-section ${className}`}><header><h2>{title}</h2>{hint && <p>{hint}</p>}</header>{children}</section>;
}

function PaceMini({ label, value, sub, tone }) {
  return (
    <div className="pace-mini">
      <div className="kicker">{label}</div>
      <div className="tnum" style={{ marginTop: 4, fontFamily: "var(--display)", fontSize: 18, fontWeight: 700, color: tone || "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, lineHeight: 1.35, color: "var(--fg-3)" }}>{sub}</div>
    </div>
  );
}

function EquationStep({ value, label, money, sub }) {
  return (
    <div className="pace-equation-step">
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>{money ? window.fmt.money(value || 0) : wholeFmt(value)}</div>
      <div className="kicker" style={{ marginTop: 1 }}>{label}</div>
      {sub && <div style={{ marginTop: 1, fontSize: 9.5, color: "var(--fg-4)" }}>{sub}</div>}
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

// Probabilidade de um lead na etapa virar ganho, compondo as taxas reais da
// janela do funil (30 dias móveis; fallback no último mês fechado, com as
// mesmas contas da Visão geral) — contato → agendamento → comparecimento →
// fechamento.
// O fechamento usa a taxa EFETIVA (calibrada pela ponta a ponta real quando a
// amostra deixa, vide routes.pipeline-pace.js) — sem isso o produto das taxas
// truncadas de janela subestimava o funil em 2-3x.
// Etapas de entrega (integração/pós-venda) contam como certas; kind fora do
// funil comercial retorna null (cai na conversão configurada do funil).
function winProbByKind(kind, conversions) {
  if (!conversions) return null;
  const contact = conversions.contactRate.value, book = conversions.bookingRate.value;
  const show = conversions.showRate.value;
  const close = conversions.closeRateEffective?.value ?? conversions.closeRate.value;
  switch (kind) {
    case "novo": return contact * book * show * close;
    case "contato":
    case "qualificacao": return book * show * close;
    case "call": return show * close;
    case "proposta":
    case "followup": return close;
    case "integracao":
    case "posvenda": return 1;
    default: return null;
  }
}

function analysisBuckets(s, leads, conversions) {
  const visible = new Set(openStages(s));
  return s.funnel.filter((f) => visible.has(f.stage)).map((f, i, stages) => {
    const at = leads.filter((l) => l.stage === f.stage);
    const tcv = at.reduce((sum, lead) => sum + (Number(lead.amount) || 0), 0);
    const histProb = winProbByKind(stageKind(s, f.stage), conversions);
    // Probabilidade pelo funil configurado: produto das taxas `conv` das etapas
    // que ainda faltam ATÉ o ganho. Varria o array até o fim, o que já incluía
    // terminais e filas fora da régua (Nutrição, No show, Mentoria); com o
    // Ganho no meio do funil passaria a incluir a entrega também. A régua
    // (ladderOf) é exatamente o caminho de venda, então é ela que manda.
    const ladder = ladderOf(s);
    const sourceIndex = ladder.indexOf(f.stage);
    const confProb = sourceIndex === -1 ? 1 : ladder.slice(sourceIndex + 1).reduce((value, name) => {
      const row = s.funnel.find((x) => x.stage === name);
      const conversion = Number(row?.conv);
      return value * (Number.isFinite(conversion) && row?.conv !== "" && row?.conv != null ? conversion : 1);
    }, 1);
    const prob = histProb ?? confProb;
    return { stage: f.stage, tcv, prob, weighted: tcv * prob, count: at.length, index: i, total: stages.length };
  });
}

// Engenharia reversa da meta: desdobra o gap (meta − fechado no mês, TCV) em
// ganhos → calls → agendamentos → contatos → leads pelas taxas reais, e estima
// quanto disso a esteira aberta já deve entregar (etapas comerciais, sem
// entrega). newLeads = leads que ainda precisam ENTRAR além da esteira.
function goalMath(data, s, leads) {
  const conv = data.conversions;
  const rContact = conv.contactRate.value, rBook = conv.bookingRate.value;
  const rShow = conv.showRate.value;
  // Fechamento efetivo: calibrado pela ponta a ponta (ganhos÷leads 30d) quando
  // a amostra deixa — a cadeia toda passa a fechar no que a história mostra.
  const rClose = conv.closeRateEffective?.value ?? conv.closeRate.value;
  // Persegue a META ATUAL, não a base: batida a meta, o servidor re-ancora na
  // próxima super meta (chaseTarget/chaseGap), e a Análise inteira encadeia por
  // cima desse teto. Abaixo de 100% o chaseTarget É a base, então nada muda.
  const baseTarget = Number(data.sale.target) || 0;
  const chaseTarget = data.sale.chaseTarget != null ? Number(data.sale.chaseTarget) : null;
  const target = chaseTarget != null ? chaseTarget : baseTarget;
  const superMode = chaseTarget != null && chaseTarget > baseTarget;
  const chasePct = data.sale.chasePct || null;
  const closed = Number(data.sale.sold) || 0; // vendido RECONHECIDO (faturado só pelo recebido) — o mesmo da meta
  const gap = data.sale.chaseGap != null ? Number(data.sale.chaseGap) : Math.max(0, target - closed);
  const ticket = data.context.averageEntry;
  const need = (n, r) => n === 0 ? 0 : n != null && r > 0 ? Math.ceil(n / r) : null;
  const wins = gap === 0 ? 0 : ticket > 0 ? Math.ceil(gap / ticket) : null;
  const calls = need(wins, rClose);
  const bookings = need(calls, rShow);
  const contacts = need(bookings, rBook);
  const leadsNeeded = need(contacts, rContact);

  const open = new Set(openStages(s));
  let pipeWins = 0, pipeValue = 0, pipeCount = 0;
  for (const l of leads) {
    if (!open.has(l.stage)) continue;
    const kind = stageKind(s, l.stage);
    if (kind === "integracao" || kind === "posvenda") continue;
    const p = winProbByKind(kind, conv);
    if (p == null) continue;
    pipeCount++; pipeWins += p; pipeValue += (Number(l.amount) || 0) * p;
  }
  const fullProb = rContact * rBook * rShow * rClose;
  const missingWins = wins == null ? null : Math.max(0, wins - Math.floor(pipeWins));
  const newLeads = missingWins == null ? null
    : missingWins === 0 ? 0
    : fullProb > 0 ? Math.ceil(missingWins / fullProb) : null;
  // Investimento: CPL real dos últimos 30d (spend ÷ leads criados, da API).
  const cpl = Number(data.marketing?.cpl) > 0 ? Number(data.marketing.cpl) : null;
  const investNeeded = cpl != null && leadsNeeded != null ? leadsNeeded * cpl : null;
  const investNew = cpl != null && newLeads != null ? newLeads * cpl : null;
  const blockedBy = gap === 0 ? null
    : ticket == null || ticket <= 0 ? "ticket médio"
    : rClose <= 0 ? "taxa de fechamento"
    : rShow <= 0 ? "comparecimento"
    : rBook <= 0 ? "agendamento"
    : rContact <= 0 ? "contato"
    : null;
  return {
    gap, target, closed, ticket, wins, calls, bookings, contacts, leadsNeeded,
    pipeWins, pipeValue, pipeCount, missingWins, newLeads, blockedBy,
    cpl, investNeeded, investNew,
    daysLeft: data.sale.remainingBusinessDays,
    baseTarget, superMode, chasePct,
  };
}

function PaceChart({ data, s, leads }) {
  // Desenha em pixels reais do container (ResizeObserver): o antigo
  // preserveAspectRatio="none" esticava texto e linha em tela larga e cortava
  // o rótulo do eixo ("120 mil" virava "20 mil").
  const wrapRef = React.useRef(null);
  const [w, setW] = useStP(720);
  useEfP(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect?.width;
      if (cw) setW(Math.max(200, Math.round(cw)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [year, month] = data.month.split("-").map(Number);
  const totalDays = new Date(year, month, 0).getDate();
  const currentDay = data.today.startsWith(data.month) ? Number(data.today.slice(8, 10)) : totalDays;
  // Série do SERVIDOR (sale.byDay): o vendido RECONHECIDO dia a dia — faturado
  // e recorrente entram só pelo que caiu, a mesma régua da faixa de meta. Sem
  // ela (API antiga), cai no cálculo local por lead.amount.
  const byDay = Array.isArray(data.sale?.byDay) && data.sale.byDay.length
    ? data.sale.byDay.slice(0, currentDay)
    : (() => {
      const local = Array.from({ length: currentDay }, () => 0);
      for (const lead of leads) {
        if (!isWonLead(s, lead) || !String(wonAtOf(lead)).startsWith(data.month)) continue;
        // Dia da VENDA (wonAt), não do card: stageSince muda quando o card anda.
        const day = Number(String(wonAtOf(lead)).slice(8, 10));
        if (day >= 1 && day <= currentDay) local[day - 1] += Number(lead.amount) || 0;
      }
      return local;
    })();
  const cumulative = [];
  byDay.reduce((sum, amount, index) => (cumulative[index] = sum + (Number(amount) || 0)), 0);
  if (cumulative.length && cumulative[cumulative.length - 1] === 0 && data.sale.sold > 0) cumulative[cumulative.length - 1] = data.sale.sold;
  // A linha da meta segue a META ATUAL: batida a base, sobe pra super meta que
  // o pace persegue, então o gráfico não fica com a meta atrás do vendido.
  const superChase = data.sale.chaseTarget != null && data.sale.chaseTarget > (Number(data.sale.target) || 0);
  const target = Number(data.sale.chaseTarget || data.sale.target) || 0;
  const targetLabel = superChase ? `super meta ${data.sale.chasePct}% ${window.fmt.money(target)}` : `meta ${window.fmt.money(target)}`;
  const max = Math.max(1, target, data.sale.sold || 0);
  const H = 190, padL = 64, padR = 16, yTop = 22, yZero = 152;
  const x = (day) => padL + ((day - 1) / Math.max(1, totalDays - 1)) * (w - padL - padR);
  const y = (value) => yZero - (value / max) * (yZero - yTop);
  const points = cumulative.map((value, index) => `${x(index + 1).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const lastValue = cumulative[cumulative.length - 1] || data.sale.sold || 0;
  const lastX = x(Math.max(1, currentDay));
  const lastY = y(lastValue);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const kFmt = (v) => (v >= 1000 ? `${Math.round(v / 1000)} mil` : String(Math.round(v)));
  const axis = { fontFamily: "var(--mono)", fontSize: 10, fill: "var(--fg-4)" };
  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg role="img" aria-label={`Vendido acumulado em ${monthLabel}: ${window.fmt.moneyFull(lastValue)}. ${targetLabel}.`} width={w} height={H} style={{ display: "block", maxWidth: "100%" }}>
        {[max, max / 2, 0].map((value) => (
          <React.Fragment key={value}>
            <line x1={padL} y1={y(value)} x2={w - padR} y2={y(value)} stroke="var(--line-faint)" strokeWidth="1" />
            <text x={padL - 10} y={y(value) + 3.5} textAnchor="end" style={axis}>{kFmt(value)}</text>
          </React.Fragment>
        ))}
        <line x1={x(1)} y1={y(0)} x2={x(totalDays)} y2={y(target)} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x={w - padR - 4} y={Math.max(12, y(target) - 8)} textAnchor="end" style={axis}>{targetLabel}</text>
        {points && <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        <circle cx={lastX} cy={lastY} r="3.5" fill="var(--accent)" />
        <text
          x={Math.min(lastX + 10, w - padR - 4)}
          y={Math.min(yZero - 4, Math.max(14, lastY - 8))}
          textAnchor={lastX + 90 > w - padR ? "end" : "start"}
          style={{ fontFamily: "var(--display)", fontSize: 12, fontWeight: 600, fill: "var(--fg-1)" }}>{window.fmt.money(lastValue)}</text>
        <text x={padL} y={H - 8} style={axis}>01 {monthLabel}</text>
        <text x={w - padR} y={H - 8} textAnchor="end" style={axis}>{totalDays} {monthLabel}</text>
      </svg>
    </div>
  );
}

function AnalysisPaceSummary({ data, s, leads }) {
  const buckets = analysisBuckets(s, leads, data.conversions);
  const forecast = buckets.reduce((sum, bucket) => sum + bucket.weighted, 0);
  const g = goalMath(data, s, leads);
  const closed = Number(data.sale.sold) || 0; // vendido RECONHECIDO (faturado só pelo recebido) — o mesmo da meta
  const pace = data.sale.elapsedBusinessDays > 0 ? (closed / data.sale.elapsedBusinessDays) * data.sale.totalBusinessDays : 0;
  // Tudo comparado com a META ATUAL (super meta quando a base já caiu).
  const target = g.target;
  const paceVsTarget = target > 0 ? Math.round(((pace / target) - 1) * 100) : null;
  const monthLabel = new Date(`${data.month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long" });
  const metaLabel = g.superMode ? `Super meta ${g.chasePct}%` : "Meta do mês";
  const alvo = g.superMode ? "super meta" : "meta";
  const leadsDelta = g.gap === 0 ? (g.superMode || closed > g.baseTarget ? "super metas batidas" : "meta do mês batida")
    : g.newLeads == null ? `desdobramento travado em ${g.blockedBy}`
    : g.newLeads === 0 ? "a esteira aberta já cobre o gap"
    : `~${dailyFmt(g.daysLeft > 0 ? g.newLeads / g.daysLeft : null)}/dia útil, além da esteira`;
  return (
    <>
      {/* PACE, META E FORECAST NUM QUADRO SÓ (13/09): eram cinco tiles de peso
          igual, e a relação entre eles — que é a leitura da tela — ficava por
          conta de quem olha. Aqui o fechado e o projetado aparecem contra a
          meta, com a barra de quanto já foi. */}
      <section className="pace-summary">
        <div className="pace-summary-values">
          <div style={{ minWidth: 142 }}>
            <div className="kicker">fechado no mês</div>
            <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{window.fmt.moneyFull(closed)}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{`${data.context.wonMonth} ganhos até dia ${Number(data.today.slice(8, 10))}`}</div>
          </div>
          <div style={{ minWidth: 142 }}>
            <div className="kicker">pace projetado</div>
            <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, lineHeight: 1.15, color: paceVsTarget == null ? "var(--fg-1)" : paceVsTarget >= 0 ? "var(--pos)" : "var(--neg)" }}>{window.fmt.moneyFull(pace)}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
              {paceVsTarget == null ? `ritmo atual até ${data.sale.totalBusinessDays} dias úteis` : `${Math.abs(paceVsTarget)}% ${paceVsTarget >= 0 ? "acima" : "abaixo"} da ${alvo}`}
            </div>
          </div>
          <div style={{ minWidth: 142 }}>
            <div className="kicker">{metaLabel.toLowerCase()}</div>
            <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{window.fmt.moneyFull(target)}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{`${data.sale.elapsedBusinessDays} de ${data.sale.totalBusinessDays} dias úteis corridos`}</div>
          </div>
          <div style={{ minWidth: 142 }}>
            <div className="kicker">forecast ponderado</div>
            <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{window.fmt.moneyFull(forecast)}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>pipeline aberto × probabilidade real</div>
          </div>
          <div style={{ minWidth: 142 }}>
            <div className="kicker">{`leads novos pra ${alvo}`}</div>
            <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, lineHeight: 1.15, color: g.gap === 0 || g.newLeads === 0 ? "var(--pos)" : "var(--fg-1)" }}>{g.gap === 0 ? "0" : wholeFmt(g.newLeads)}</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{leadsDelta}</div>
          </div>
        </div>
        {/* Onde o mês está contra a meta, e onde DEVERIA estar hoje. */}
        {target > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ position: "relative", height: 10, borderRadius: 999, background: "var(--bg-2)", overflow: "visible" }}>
              <div style={{ height: "100%", width: `${Math.min(100, Math.round((closed / target) * 100))}%`, background: "var(--accent)", borderRadius: 999 }} />
              {data.sale.totalBusinessDays > 0 && (
                <span title="onde o pace deveria estar hoje"
                  style={{ position: "absolute", top: -3, left: `${Math.min(100, Math.round((data.sale.elapsedBusinessDays / data.sale.totalBusinessDays) * 100))}%`, width: 2, height: 16, background: "var(--fg-3)" }} />
              )}
            </div>
            <div className="pace-progress-note">
              {`${Math.round((closed / target) * 100)}% da meta · o risquinho é onde o pace deveria estar hoje (${Math.round((data.sale.elapsedBusinessDays / Math.max(1, data.sale.totalBusinessDays)) * 100)}%)`}
            </div>
          </div>
        )}
      </section>
      <PaceSection className="pace-chart" title={`Pace de venda · ${monthLabel}`} hint="vendido reconhecido (faturado só pelo recebido) vs. meta, dia a dia">
        <div className="pace-chart-plot"><PaceChart data={data} s={s} leads={leads} /></div><div className="pace-chart-legend"><span>━ vendido acumulado</span><span>┄ linha da meta</span></div>
      </PaceSection>
    </>
  );
}

// Card da engenharia reversa: cadeia leads → contatos → calls → ganhos → gap,
// ritmo diário pro que resta do mês e cobertura da esteira aberta.
function GoalReversePlan({ data, s, leads }) {
  const g = goalMath(data, s, leads);
  const conversions = data.conversions;
  const plan = data.plan || {};
  const money = window.fmt.moneyFull;
  const perDay = (n) => (n == null || g.daysLeft <= 0 ? null : n / g.daysLeft);
  // Janela das taxas no rótulo: "real jul · 12/44" (mês fechado) ou "real 30d".
  const rateJanela = data.rateWindow?.mode === "month"
    ? new Date(`${data.rateWindow.month}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")
    : "30d";
  const sourceLabel = (rate) => rate.source === "history"
    ? `real ${rateJanela} · ${rate.numerator}/${rate.denominator}`
    : rate.source === "calibrated" ? "o que a cadeia usa"
    : rate.source === "matured" ? `${rate.numerator}/${rate.denominator} com tempo de fechar`
    : rate.source === "goal" ? "meta configurada" : "benchmark";
  const ticketSource = {
    initial_payments: "primeiras faturas pagas",
    paid_invoices: "faturas pagas recentes",
    won_tcv: "média dos ganhos (90d)",
    configured_ticket: "ticket configurado",
  }[data.context.averageEntrySource] || "sem base de ticket";

  // A cadeia persegue a ponta a ponta MADURA quando ela existe (janela móvel
  // destruncada); senão, a crua.
  const pontaAPonta = conversions.leadToWinMature || conversions.leadToWin;

  const alvo = g.superMode ? `super meta ${g.chasePct}%` : "meta";
  if (g.gap === 0) {
    return (
      <PaceSection className="pace-reverse" title="Engenharia reversa da meta" hint={g.closed > g.baseTarget ? "todas as super metas batidas" : "meta do mês batida"}>
        <div style={{ padding: "14px 24px 20px", fontSize: 13.5, color: "var(--fg-2)" }}>
          Fechado {money(g.closed)}{g.closed > g.baseTarget ? `, ${Math.round((g.closed / g.baseTarget) * 100)}% da meta base` : ` de ${money(g.baseTarget)}`}. Tudo que a esteira render agora é gordura no mês.
        </div>
      </PaceSection>
    );
  }

  return (
    <PaceSection className="pace-reverse" title={`Para fechar os ${money(g.gap)} que faltam`} hint={`de trás pra frente, com as conversões reais dos últimos ${rateJanela === "30d" ? "30 dias" : rateJanela}`}>
      <div className="pace-reverse-body">
        {/* COMPROMISSOS, não texto (13/09): a cadeia de setas dizia a mesma
            coisa, mas ninguém sai dela sabendo o que prometer. Cada linha é uma
            promessa com o número e a taxa que a justifica. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { n: wholeFmt(g.wins), o: "ganhos até o fim do mês", porque: g.ticket ? `ticket ${money(g.ticket)}` : "ticket indisponível" },
            { n: wholeFmt(g.calls), o: "calls precisam acontecer", porque: `call → ganho ${rateFmt(conversions.closeRateEffective?.value ?? conversions.closeRate.value)}` },
            g.newLeads == null ? null : {
              n: wholeFmt(g.newLeads),
              o: g.pipeCount > 0 ? `leads novos (além dos ${wholeFmt(g.pipeCount)} no funil)` : "leads novos",
              porque: `lead → call ${rateFmt(conversions.bookingRate.value)}`,
            },
            g.investNew != null && g.newLeads > 0 ? { n: money(g.investNew), o: "de verba a mais", porque: `CPL ${money(g.cpl)}` } : null,
          ].filter(Boolean).map((c, i) => (
            <div key={c.o} className="pace-commitment" style={{borderTop: i ? "1px solid var(--line-faint)" : undefined}}>
              <span className="tnum" style={{ minWidth: 92, fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{c.n}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--fg-1)" }}>{c.o}</span>
              <span className="mono dim" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{c.porque}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "stretch", gap: 7, flexWrap: "wrap" }}>
          {g.investNew != null && (
            <>
              <EquationStep value={g.investNew} label="investimento" money sub="só o lead novo" />
              <EquationArrow label={`CPL ${money(g.cpl)}`} />
            </>
          )}
          <EquationStep value={g.newLeads} label="leads novos" sub={g.pipeCount > 0 ? `+${wholeFmt(g.pipeCount)} na esteira` : null} />
          <EquationArrow label={g.pipeCount > 0
            ? `com a esteira · ${rateFmt(conversions.contactRate.value)} contatados`
            : `${rateFmt(conversions.contactRate.value)} contatados`} />
          <EquationStep value={g.contacts} label="contatos" />
          <EquationArrow label={`${rateFmt(conversions.bookingRate.value)} agendam`} />
          <EquationStep value={g.bookings} label="calls agendadas" />
          <EquationArrow label={`${rateFmt(conversions.showRate.value)} comparecem`} />
          <EquationStep value={g.calls} label="calls feitas" />
          <EquationArrow label={`${rateFmt(conversions.closeRateEffective?.value ?? conversions.closeRate.value)} fecham${conversions.closeRateEffective?.source === "calibrated" ? " (efetiva)" : ""}`} />
          <EquationStep value={g.wins} label="ganhos" />
          <EquationArrow label={`${g.ticket ? money(g.ticket) : "sem ticket"} cada`} />
          <EquationStep value={g.gap} label={`falta pra ${alvo}`} money />
        </div>

        {/* O parágrafo de rodapé (esteira, demanda bruta, calibração) virou
            um ⓘ: é a explicação da conta, consultada uma vez, não lida todo
            dia. */}
        <div className="pace-coverage">
          <span>
            {g.newLeads === 0
              ? `A esteira aberta (${g.pipeCount} leads trabalháveis) já cobre o gap: o jogo é converter o que está dentro.`
              : g.newLeads == null
                ? "Não dá pra estimar os leads novos necessários (tem taxa zerada na cadeia)."
                : `A esteira aberta (${g.pipeCount} leads) deve render ~${wholeFmt(g.pipeWins)} ganhos; o resto é lead novo.`}
          </span>
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-4)", cursor: "help", borderBottom: "1px dotted var(--line-2)" }}
            title={[
              `esteira aberta: ${g.pipeCount} leads trabalháveis, ~${wholeFmt(g.pipeWins)} ganhos (${money(g.pipeValue)} ponderado) nessas taxas`,
              g.newLeads > 0 ? `leads novos até o fim do mês: ~${wholeFmt(g.newLeads)} (${dailyFmt(perDay(g.newLeads))}/dia útil)` : null,
              g.investNew != null && g.newLeads > 0 ? `ao CPL real de ${money(g.cpl)}, ~${money(g.investNew)} de investimento (${money(perDay(g.investNew) || 0)}/dia útil)` : null,
              g.cpl == null && g.newLeads > 0 ? "sem spend registrado nos últimos 30 dias, não dá pra estimar o investimento (sincronize a Publicidade)" : null,
              g.leadsNeeded != null ? `sem descontar a esteira a cadeia pediria ${wholeFmt(g.leadsNeeded)} leads${g.investNeeded != null ? ` (${money(g.investNeeded)} de mídia)` : ""} — demanda bruta, só vale tratando a esteira como perdida` : null,
              conversions.closeRateEffective?.source === "calibrated" && pontaAPonta
                ? `fechamento efetivo ${rateFmt(conversions.closeRateEffective.value)}, calibrado pra bater com a ponta a ponta real (${wholeFmt(pontaAPonta.numerator)} ganhos de ${wholeFmt(pontaAPonta.denominator)} leads em ${rateJanela}). Multiplicar as 4 taxas medidas dá menos porque cada uma tem base diferente.` : null,
              conversions.leadToWinMature
                ? `o denominador desconta quem não teve tempo de fechar: dos ${wholeFmt(conversions.leadToWin.denominator)} leads da janela, ${wholeFmt(conversions.leadToWinMature.denominator)} já tiveram chance real.` : null,
            ].filter(Boolean).join("\n")}>
            como a conta é feita ⓘ
          </span>
          {canSeeScreen("pipeline") && <a className="pace-pipeline-link" href="#pipeline">Abrir o pipeline →</a>}
        </div>

        {g.blockedBy && (
          <div style={{ padding: "8px 12px", borderRadius: "var(--r-2)", background: "var(--neg-soft)", color: "var(--neg)", fontSize: 12 }}>
            O desdobramento parou em {g.blockedBy}: a base atual é zero ou insuficiente pra calcular.
          </div>
        )}

        <details className="pace-details"><summary>Ritmo diário e origem das taxas</summary><div className="pace-details-body">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <PaceMini label="Leads novos/dia útil" value={dailyFmt(perDay(g.newLeads))} sub={`hoje ${wholeFmt(plan.leads?.today)} · ${g.daysLeft} dias úteis restantes`} />
          <PaceMini label="Contatos/dia útil" value={dailyFmt(perDay(g.contacts))} sub={`hoje ${wholeFmt(plan.contacts?.today)} leads tocados`} />
          <PaceMini label="Calls/dia útil" value={dailyFmt(perDay(g.calls))} sub={`hoje ${wholeFmt(plan.calls?.today)} na agenda`} />
          <PaceMini label="Ganhos/dia útil" value={dailyFmt(perDay(g.wins))} sub={`hoje ${wholeFmt(plan.wins?.today)} · ticket ${g.ticket ? money(g.ticket) : "indisponível"}`} />
          {g.investNew != null && g.newLeads > 0 && (
            <PaceMini label="Mídia/dia útil" value={money(perDay(g.investNew) || 0)} sub={`${money(g.investNew)} pros ${wholeFmt(g.newLeads)} leads novos`} />
          )}
        </div>

        {data.paceAdjust && (
          <div style={{ padding: "8px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)", fontSize: 11.5, color: "var(--fg-3)" }}>
            <b>Inclui histórico pré-cockpit</b> (dados reais de antes do registro no sistema, somados ao funil):{" "}
            {[
              data.paceAdjust.leads && `+${data.paceAdjust.leads} leads`,
              data.paceAdjust.contacted && `+${data.paceAdjust.contacted} contatos`,
              data.paceAdjust.booked && `+${data.paceAdjust.booked} agendadas`,
              data.paceAdjust.shown && `+${data.paceAdjust.shown} comparecimentos`,
              data.paceAdjust.won && `+${data.paceAdjust.won} ganhos`,
            ].filter(Boolean).join(" · ")}.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, paddingTop: 14, borderTop: "1px solid var(--line-faint)" }}>
          <div>
            <div className="kicker">Ticket médio</div>
            <div className="tnum" style={{ marginTop: 2, fontSize: 13, fontWeight: 600 }}>{g.ticket ? money(g.ticket) : "—"}</div>
            <div style={{ fontSize: 10, color: "var(--fg-4)" }}>{ticketSource}</div>
          </div>
          <div>
            <div className="kicker">CPL</div>
            <div className="tnum" style={{ marginTop: 2, fontSize: 13, fontWeight: 600 }}>{g.cpl != null ? money(g.cpl) : "—"}</div>
            <div style={{ fontSize: 10, color: "var(--fg-4)" }}>
              {g.cpl != null ? `real 30d · ${money(data.marketing.spend30)} / ${data.marketing.leads30} leads` : "sem spend no período"}
            </div>
          </div>
          {[["Contato", conversions.contactRate], ["Agendamento", conversions.bookingRate], ["Comparecimento", conversions.showRate], ["Call → ganho", conversions.closeRate],
            ...(conversions.closeRateEffective?.source === "calibrated"
              ? [["Call → ganho efetivo", { ...conversions.closeRateEffective, source: "calibrated" }]] : []),
            ...(conversions.leadToWin ? [["Lead → ganho", conversions.leadToWin]] : []),
            ...(conversions.leadToWinMature ? [["Lead → ganho maduro", conversions.leadToWinMature]] : [])].map(([label, rate]) => (
            <div key={label}>
              <div className="kicker">{label}</div>
              <div className="tnum" style={{ marginTop: 2, fontSize: 13, fontWeight: 600 }}>{rateFmt(rate.value)}</div>
              <div style={{ fontSize: 10, color: "var(--fg-4)" }}>{sourceLabel(rate)}</div>
            </div>
          ))}
        </div>
        </div></details>
      </div>
    </PaceSection>
  );
}

function ForecastView({ s, leads, conversions }) {
  const buckets = analysisBuckets(s, leads, conversions);
  const totals = buckets.reduce((sum, b) => ({count:sum.count+b.count,tcv:sum.tcv+b.tcv,weighted:sum.weighted+b.weighted}),{count:0,tcv:0,weighted:0});
  const max = Math.max(1,...buckets.map(b=>b.weighted));
  return <section className="pace-section pace-forecast">
    <header><h2>Forecast da esteira</h2><div><strong>{window.fmt.moneyFull(totals.weighted)}</strong><span>{totals.count} leads na esteira aberta</span></div></header>
    <div className="tbl-x"><table><thead><tr><th>Etapa</th><th aria-label="Participação no forecast"/><th>Leads</th><th>Em jogo</th><th>Prob.</th><th>Ponderado</th></tr></thead>
      <tbody>{buckets.map(b=><tr key={b.stage}><th scope="row">{b.stage}</th><td><span className="pace-forecast-bar"><i style={{width:`${b.weighted ? Math.max(3,b.weighted/max*100) : 0}%`}}/></span></td><td>{b.count}</td><td>{window.fmt.moneyFull(b.tcv)}</td><td>{rateFmt(b.prob)}</td><td>{window.fmt.moneyFull(b.weighted)}</td></tr>)}</tbody>
      <tfoot><tr><th>Total ponderado</th><td/><td>{totals.count}</td><td>{window.fmt.moneyFull(totals.tcv)}</td><td/><td>{window.fmt.moneyFull(totals.weighted)}</td></tr></tfoot></table></div>
    {!totals.count && <p>Nenhum lead nas etapas comerciais do produto ativo.</p>}
    <p>Probabilidade = produto das taxas que faltam até o ganho. As conversões reais têm prioridade; etapas sem histórico usam as taxas configuradas do funil.</p>
  </section>;
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

  if (err) return <div style={card}><div className="mono dim" style={{ fontSize: 12 }}>análise indisponível ({err.status || "erro"})</div></div>;
  if (!data) return <div style={card}><div className="mono dim" style={{ fontSize: 12 }}>carregando análise…</div></div>;

  const pct = (v) => v == null ? "—" : `${Math.round(v * 100)}%`;
  const maxEntered = Math.max(1, ...data.stages.map(st => st.entered));
  const maxReason = Math.max(1, ...data.lossReasons.map(r => r.count));
  const ft = data.firstTouch || {};
  const stat = (label, v, sub) => (
    <div>
      <div className="kicker">{label}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700, marginTop: 2 }}>{v}</div>
      {sub && <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{sub}</div>}
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="kicker">Saúde do processo</span>
        <span style={{ flex: 1 }} />
        {[30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} style={{
            height: 22, padding: "0 9px", borderRadius: 999, fontSize: 10.5, fontFamily: "var(--mono)",
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
        <div className="kicker" style={{ marginBottom: 10 }}>Conversão real estágio → estágio · leads que passaram + mediana de dias na etapa</div>
        {data.stages.map((st) => (
          <div key={st.stage} style={{ display: "grid", gridTemplateColumns: "minmax(84px, 130px) 1fr minmax(40px, 56px) minmax(58px, 84px) minmax(58px, 84px)", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line-1)" }}>
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
        <div className="kicker" style={{ marginBottom: 10 }}>Motivos de perda · perdidos + desqualificados do período</div>
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

// Idem a grade da agenda (agora em agenda-grid.jsx): quem monta isto é
// screens/analise.jsx (a tela própria de
// Análise do pipeline), não o VIEWS daqui.
// ⚠️ NÃO É CÓDIGO MORTO (conferido em 12/09/2026). O `VIEWS` desta tela só tem
// kanban e list, então o AnaliseView (com PaceChart, GoalReversePlan,
// ForecastView, FunnelAnalytics, analysisBuckets, goalMath, PaceMini,
// EquationStep) não é alcançável PELO PIPELINE — quem o importa é a tela
// própria, screens/analise.jsx. Remover as linhas "que ninguém alcança" quebra
// aquela tela. A grade da agenda morava aqui pelo mesmo motivo e mudou de casa
// em 12/09 pra screens/agenda-grid.jsx.
function AnaliseView({ s, leads }) {
  const { version } = useData();
  const [read, setRead] = useStP({});
  const [attempt,setAttempt] = useStP(0);
  useEfP(() => {
    let alive = true;
    setRead({});
    api.pipelinePace(s.id).then(data => {if(alive)setRead({data});}).catch(error => {if(alive)setRead({error});});
    return () => { alive = false; };
  }, [s.id, version, attempt]);
  const {data,error}=read;
  return <div className="pace-body">
    {error ? <div role="alert" className="pace-state">Não foi possível carregar a análise. <button onClick={()=>setAttempt(n=>n+1)}>Tentar novamente</button></div>
      : !data ? <div role="status" className="pace-state">Calculando análise…</div>
      : <><AnalysisPaceSummary data={data} s={s} leads={leads}/><GoalReversePlan data={data} s={s} leads={leads}/><ForecastView s={s} leads={leads} conversions={data.conversions}/></>}
  </div>;
}

export { PipelineScreen, AnaliseView, BulkBar };