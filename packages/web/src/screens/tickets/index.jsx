import React from "react";
import "./tickets.css";
import { api } from "../../lib/api.js";
import { useData } from "../../data.jsx";
import { EmptyState, PrimaryButton, toast } from "../../atoms.jsx";
import { PageHead, Segmented } from "../../components/viz.jsx";
import { AvisoTopo, BarraFiltros } from "../../components/story.jsx";
import { SearchInput } from "../../components/search-input.jsx";
import { useActiveSaas } from "../../lib/workspace.js";
import { currentUser } from "../../lib/users.js";
import { useIsMobile } from "../../lib/responsive.js";
import { TICKET_STATUSES, STATUS_BY_KEY, PRIORITY_RANK, kindOf, isDone, slaState, supportScope, fold, noScopeHint } from "../../lib/tickets.js";
import { useBoardDnd } from "../../components/kanban/dnd.js";
import { useTicketsStore } from "./store.js";
import { parseTicketHash, openTicketHash, clearTicketHash, useTicketHash } from "./hash.js";
import { TicketsBoard } from "./board.jsx";
import { TicketsList } from "./list-view.jsx";
import { TicketDetail } from "./detail.jsx";
import { NewTicketModal } from "./new-ticket.jsx";

// Suporte · fila de tickets do produto ativo. Mesmo desenho das Tarefas: a
// tela busca a própria lista (fora do SEED), escuta o cockpit-change, muda com
// mutação otimista e abre o ticket num modal (#tickets/<id>). Duas
// visões, como o Pipeline: Kanban por status e Lista agrupada pelo SLA.
// O servidor aplica o escopo de produto de cada atendente; aqui só se evita
// mostrar uma fila que a API vai recusar.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const VIEW_KEY = "cockpit_tickets_view";
const FILTER_KEY = "cockpit_tickets_filter";
const readLs = (k, fallback, allowed) => { try { const v = localStorage.getItem(k); return allowed.includes(v) ? v : fallback; } catch { return fallback; } };
const writeLs = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const FILTERS = ["open", "mine", "unassigned", "risk", "waiting", "done", "all"];
const SLA_RANK = { breached: 0, warning: 1, ok: 2, paused: 3, met: 4, none: 5 };

export function matchesFilter(t, filter, { me, now }) {
  const kind = kindOf(t.status);
  switch (filter) {
    case "open": return kind !== "done";
    case "mine": return kind !== "done" && !!me && t.assignee === me;
    case "unassigned": return kind !== "done" && !t.assignee;
    case "risk": { if (kind === "done") return false; const s = slaState(t, now).overall; return s === "breached" || s === "warning"; }
    case "waiting": return kind === "waiting";
    case "done": return kind === "done";
    default: return true;
  }
}
// Coluna Concluídos do Kanban: Resolvido e Fechado juntos, o mais recente no
// topo. Segue o recorte de pessoa do filtro (Meus, Sem responsável); nos
// filtros de trabalho em aberto (SLA em risco, Aguardando) fica vazia, mas
// continua lá pra receber o card arrastado.
export const DONE_COLUMN = { key: "done", label: "Concluídos", tone: "var(--pos)" };
export function inDoneColumn(t, filter, { me }) {
  if (!isDone(t)) return false;
  switch (filter) {
    case "mine": return !!me && t.assignee === me;
    case "unassigned": return !t.assignee;
    case "risk": case "waiting": return false;
    default: return true;
  }
}
const doneAt = (t) => new Date(t.sla?.resolvedAt || t.closedAt || t.updatedAt || 0).getTime() || 0;

// Fila: o SLA mais apertado primeiro, depois a prioridade, depois o mais antigo.
export function queueOrder(now) {
  const due = (t) => new Date((t.sla?.firstResponseAt ? t.sla?.resolutionDue : t.sla?.firstResponseDue) || 8.64e15).getTime();
  return (a, b) => (SLA_RANK[slaState(a, now).overall] - SLA_RANK[slaState(b, now).overall])
    || (due(a) - due(b))
    || ((PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2))
    || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

export function TicketsScreen() {
  const { version } = useData();
  const [product] = useActiveSaas();
  const saasId = product?.id || "";
  const isMobile = useIsMobile();
  const me = currentUser()?.id || "";
  const scope = supportScope();
  const handles = scope === null || scope.includes(saasId);
  const { state, dispatch, mutate, inflight } = useTicketsStore(saasId);

  const [view, setViewState] = useState(() => readLs(VIEW_KEY, "kanban", ["kanban", "list"]));
  const setView = (v) => { setViewState(v); writeLs(VIEW_KEY, v); };
  const [filter, setFilterState] = useState(() => readLs(FILTER_KEY, "open", FILTERS));
  const setFilter = (v) => { setFilterState(v); writeLs(FILTER_KEY, v); };
  const [q, setQ] = useState("");
  const [agents, setAgents] = useState(null);
  const [settings, setSettings] = useState(null);
  const [panelId, setPanelId] = useState(() => parseTicketHash());
  const [panelRefresh, setPanelRefresh] = useState(0);
  const [activityVersion, setActivityVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const boardRef = useRef(null);
  const dndRef = useRef(null);
  const queued = useRef(false);

  // ── Carga + tempo real ───────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!handles || !saasId) return;
    if (dndRef.current?.dragRef.current || inflight.current.size) { queued.current = true; return; }
    try {
      const list = await api.tickets({ saas: saasId });
      dispatch({ type: "RECONCILE", tickets: list || [], keep: new Set(inflight.current) });
    } catch (err) {
      if (!state.loaded) dispatch({ type: "ERROR", error: err.message || "erro" });
      else toast("Não deu pra atualizar a fila · tente de novo", "neg");
    }
  }, [handles, saasId, dispatch, inflight]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refetch(); }, [refetch, version]);
  useEffect(() => {
    let t = 0;
    const on = (e) => {
      const c = e.detail?.collection;
      if (c === "ticket_events") { setActivityVersion((v) => v + 1); return; }
      if (c !== "tickets" && c !== "ticket_settings") return;
      clearTimeout(t);
      t = setTimeout(() => { refetch(); setPanelRefresh((v) => v + 1); }, 500);
    };
    window.addEventListener("cockpit-change", on);
    const iv = setInterval(() => { if (queued.current && !dndRef.current?.dragRef.current && !inflight.current.size) { queued.current = false; refetch(); } }, 800);
    // O relógio do SLA anda sem ninguém gravar nada: a fila relê a cada minuto.
    const tick = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 60_000);
    return () => { clearTimeout(t); clearInterval(iv); clearInterval(tick); window.removeEventListener("cockpit-change", on); };
  }, [refetch, inflight]);
  useEffect(() => {
    if (!handles || !saasId) return;
    let vivo = true;
    api.supportAgents().then((a) => { if (vivo) setAgents(a || []); }).catch(() => { if (vivo) setAgents([]); });
    api.supportSettings(saasId).then((s) => { if (vivo) setSettings(s); }).catch(() => { if (vivo) setSettings(null); });
    return () => { vivo = false; };
  }, [handles, saasId, version]);

  // ── Derivados ────────────────────────────────────────────────────────────
  const mine = useMemo(() => state.tickets.filter((t) => t.saas === saasId), [state.tickets, saasId]);
  const searched = useMemo(() => {
    const k = fold(q.trim()).replace(/^#/, "");
    if (!k) return mine;
    return mine.filter((t) => [String(t.number), t.subject, t.requester?.name, t.requester?.email, t.category, ...(t.tags || [])].some((v) => fold(v).includes(k)));
  }, [mine, q]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, searched.filter((t) => matchesFilter(t, f, { me, now })).length])), [searched, me, now]);
  const visible = useMemo(() => searched.filter((t) => matchesFilter(t, filter, { me, now })).sort(queueOrder(now)), [searched, filter, me, now]);
  const risk = useMemo(() => {
    const open = mine.filter((t) => kindOf(t.status) !== "done");
    const states = open.map((t) => slaState(t, now).overall);
    return {
      breached: states.filter((s) => s === "breached").length,
      warning: states.filter((s) => s === "warning").length,
      unassigned: open.filter((t) => !t.assignee).length,
      open: open.length,
    };
  }, [mine, now]);
  const columns = useMemo(() => {
    const done = { ...DONE_COLUMN, tickets: searched.filter((t) => inDoneColumn(t, filter, { me })).sort((a, b) => doneAt(b) - doneAt(a)) };
    if (filter === "done") return [done];
    const open = TICKET_STATUSES.filter((s) => s.kind !== "done")
      .map((s) => ({ key: s.key, label: s.label, tone: s.tone, tickets: visible.filter((t) => t.status === s.key) }));
    return [...open, done];
  }, [searched, visible, filter, me]);
  const agentName = useCallback((id) => (agents || []).find((a) => a.id === id)?.name || id || "—", [agents]);
  const byId = useMemo(() => new Map(mine.map((t) => [t.id, t])), [mine]);

  // ── Painel ───────────────────────────────────────────────────────────────
  useTicketHash((id) => setPanelId(id));
  const openPanel = useCallback((id) => { setPanelId(id); openTicketHash(id); }, []);
  const closePanel = useCallback(() => { clearTicketHash(); setPanelId(null); }, []);
  const onTicketChange = useCallback((t) => dispatch({ type: "UPSERT", ticket: t }), [dispatch]);
  const onDeleted = useCallback((id) => { dispatch({ type: "REMOVE", ids: [id] }); closePanel(); }, [dispatch, closePanel]);

  // ── Kanban: arrastar muda o status; soltar em Concluídos resolve ─────────
  const setStatus = useCallback((id, status, label) => {
    const before = byId.get(id);
    if (!before || before.status === status) return;
    mutate({
      ids: [id], silent: false, label: label || `#${before.number} em ${STATUS_BY_KEY[status]?.label || status}`,
      optimistic: () => dispatch({ type: "PATCH_LOCAL", id, patch: { status } }),
      request: () => api.ticketUpdate(id, { status }),
      apply: (saved) => { dispatch({ type: "UPSERT", ticket: saved }); if (panelId === id) setPanelRefresh((v) => v + 1); },
      rollback: () => dispatch({ type: "PATCH_LOCAL", id, patch: { status: before.status } }),
    });
  }, [byId, mutate, dispatch, panelId]);
  const move = useCallback(({ ids, toKey }) => {
    for (const id of ids) {
      const before = byId.get(id);
      if (!before) continue;
      if (toKey === DONE_COLUMN.key) { if (!isDone(before)) setStatus(id, "resolved", `#${before.number} concluído`); }
      else setStatus(id, toKey);
    }
  }, [byId, setStatus]);
  // O círculo do card: concluir = Resolvido; reabrir volta pra Em atendimento.
  const complete = useCallback((id, value) => {
    const before = byId.get(id);
    if (!before || isDone(before) === value) return;
    setStatus(id, value ? "resolved" : "open", `#${before.number} ${value ? "concluído" : "reaberto"}`);
  }, [byId, setStatus]);
  const dnd = useBoardDnd({ boardRef, onDrop: move, getSelection: () => null, ghostLabel: (n) => `${n} tickets` });
  dndRef.current = dnd;

  const filtros = [
    { id: "open", label: "Abertos", n: counts.open },
    { id: "mine", label: "Meus", n: counts.mine },
    { id: "unassigned", label: "Sem responsável", n: counts.unassigned },
    { id: "risk", label: "SLA em risco", n: counts.risk, title: "estourados ou passando de 80% do prazo" },
  ];
  const escondidos = [
    { id: "waiting", label: "Aguardando cliente", n: counts.waiting },
    { id: "done", label: "Resolvidos e fechados", n: counts.done },
    { id: "all", label: "Todos", n: counts.all },
  ];

  const aviso = risk.breached > 0
    ? { tom: "neg", titulo: `${risk.breached} ${risk.breached === 1 ? "ticket estourou" : "tickets estouraram"} o SLA`, nota: risk.warning ? `e ${risk.warning} ${risk.warning === 1 ? "vence" : "vencem"} em breve` : "" }
    : risk.warning > 0
      ? { tom: "warn", titulo: `${risk.warning} ${risk.warning === 1 ? "ticket vence" : "tickets vencem"} o prazo em breve`, nota: "passaram de 80% do SLA" }
      : risk.unassigned > 0
        ? { tom: "info", titulo: `${risk.unassigned} ${risk.unassigned === 1 ? "ticket sem responsável" : "tickets sem responsável"}`, nota: "ninguém foi atribuído ainda", filtro: "unassigned" }
        : null;

  const sub = !handles ? "fila de suporte"
    : ["fila de suporte", `${risk.open} ${risk.open === 1 ? "aberto" : "abertos"}`, risk.unassigned ? `${risk.unassigned} sem responsável` : null].filter(Boolean).join(" · ");

  const panel = panelId && handles ? (
    <TicketDetail key={panelId} ticketId={panelId} summary={byId.get(panelId)} saasId={saasId} agents={agents} settings={settings} mobile={isMobile}
      refreshKey={panelRefresh} activityVersion={activityVersion} onClose={closePanel} onChange={onTicketChange} onDeleted={onDeleted} />
  ) : null;

  return (
    <div className="support-page">
      <PageHead title="Tickets" sub={sub}>
        {handles && <SearchInput value={q} onChange={setQ} placeholder="Buscar nº, assunto, cliente" label="Buscar tickets" width={230} />}
        {handles && <Segmented value={view} onChange={setView} options={[{ value: "kanban", label: "Kanban" }, { value: "list", label: "Lista" }]} />}
        {handles && <PrimaryButton onClick={() => setCreating(true)}>+ Ticket</PrimaryButton>}
      </PageHead>

      {!handles ? (
        <EmptyState title={`Você não atende tickets de ${product?.name || "este produto"}`}
          hint={noScopeHint(product?.name)} />
      ) : (
        <>
          {aviso && (
            <div style={{ padding: "14px var(--pad-x) 0", flexShrink: 0 }}>
              <AvisoTopo tom={aviso.tom} titulo={aviso.titulo} nota={aviso.nota}
                acao={{ label: "Ver na lista", onClick: () => { setFilter(aviso.filtro || "risk"); setView("list"); } }} />
            </div>
          )}
          <div className="support-bar">
            <BarraFiltros valor={filter} onChange={setFilter} filtros={filtros} escondidos={escondidos} />
          </div>
          <div className="support-body">
            <div className="support-main">
              {!state.loaded && !state.error && <div className="mono dim" style={{ fontSize: 12, padding: "24px var(--pad-x)" }}>carregando…</div>}
              {state.error && !mine.length && (
                <div style={{ margin: "16px var(--pad-x)", padding: "12px 14px", borderRadius: "var(--r-3)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5 }}>
                  Não deu pra carregar a fila ({state.error}). <button type="button" onClick={refetch} style={{ fontWeight: 700, color: "inherit", textDecoration: "underline" }}>recarregar</button>
                </div>
              )}
              {state.loaded && mine.length === 0 && !state.error && (
                <EmptyState title="Nenhum ticket ainda" hint="Abra o primeiro ticket pela equipe ou ligue o portal do cliente em Configurações de SLA. O prazo começa a contar na abertura."
                  action={<PrimaryButton onClick={() => setCreating(true)}>+ Abrir ticket</PrimaryButton>} />
              )}
              {state.loaded && mine.length > 0 && visible.length === 0 && (
                <div className="mono dim" style={{ fontSize: 12, padding: "14px var(--pad-x) 0" }}>
                  Nenhum ticket {q.trim() ? `com "${q.trim()}"` : "neste filtro"} · <button type="button" onClick={() => { setQ(""); setFilter("open"); }} style={{ color: "var(--accent)", fontWeight: 600 }}>ver os abertos</button>
                </div>
              )}
              {state.loaded && mine.length > 0 && (view === "list"
                ? <TicketsList tickets={visible} agentName={agentName} selectedId={panelId} onOpen={openPanel} now={now} />
                : <TicketsBoard boardRef={boardRef} columns={columns} dnd={dnd} agentName={agentName} selectedId={panelId} onOpen={openPanel} onComplete={complete} now={now} />)}
            </div>
          </div>
          {panel}
        </>
      )}

      {creating && (
        <NewTicketModal saasId={saasId} agents={agents} categories={settings?.categories || null} onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); dispatch({ type: "UPSERT", ticket: t }); openPanel(t.id); }} />
      )}
    </div>
  );
}
