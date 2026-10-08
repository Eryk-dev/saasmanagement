import React from "react";
import "./tickets.css";
import { api } from "../../lib/api.js";
import { useData } from "../../data.jsx";
import { EmptyState, PrimaryButton, toast } from "../../atoms.jsx";
import { Segmented } from "../../components/viz.jsx";
import { SearchInput } from "../../components/search-input.jsx";
import { useActiveSaas } from "../../lib/workspace.js";
import { currentUser, isAdminUser } from "../../lib/users.js";
import { useIsMobile } from "../../lib/responsive.js";
import { TICKET_STATUSES, STATUS_BY_KEY, PRIORITY_RANK, kindOf, isDone, slaState, agentStats, supportScope, fold, noScopeHint, linearKey, hermesHolding, hermesNeedsHuman } from "../../lib/tickets.js";
import { useBoardDnd } from "../../components/kanban/dnd.js";
import { useTicketsStore } from "./store.js";
import { parseTicketHash, openTicketHash, clearTicketHash, useTicketHash } from "./hash.js";
import { TicketsBoard } from "./board.jsx";
import { TicketsList } from "./list-view.jsx";
import { TicketDetail, confirmHermes } from "./detail.jsx";
import { NewTicketModal } from "./new-ticket.jsx";
import { AgentKpis } from "./agent-kpis.jsx";
import { Menu } from "../../components/menu.jsx";
import { ticketMenuItems } from "./context-menu.jsx";
import { CustomerCard } from "./customer-card.jsx";

// Suporte · fila de tickets do produto ativo. Mesmo desenho das Tarefas: a
// tela busca a própria lista (fora do SEED), escuta o cockpit-change, muda com
// mutação otimista e abre o ticket numa gaveta (#tickets/<id>). Duas
// visões, como o Pipeline: Kanban por status e Lista agrupada pelo SLA.
// O servidor aplica o escopo de produto de cada atendente; aqui só se evita
// mostrar uma fila que a API vai recusar.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const VIEW_KEY = "cockpit_tickets_view";
const FILTER_KEY = "cockpit_tickets_filter";
const readLs = (k, fallback, allowed) => { try { const v = localStorage.getItem(k); return allowed.includes(v) ? v : fallback; } catch { return fallback; } };
const writeLs = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const FILTERS = ["open", "mine", "unassigned", "risk", "hermes", "waiting", "done", "all"];
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
    // Com o Hermes: o card está com ele agora, ou foi entregue e espera o aceite.
    case "hermes": return kind !== "done" && (hermesHolding(t) || (!!t.hermes?.requested && !t.hermes?.labeled));
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
    case "risk": case "waiting": case "hermes": return false;
    default: return true;
  }
}
// Aguardando cliente e Em espera dividem a coluna Aguardando: o status segue
// separado (a pausa do SLA e o portal leem a diferença), o card mostra qual é.
// Soltar na coluna um ticket que ainda não espera = Aguardando cliente.
export const WAITING_COLUMN = { key: "waiting", label: "Aguardando", tone: "var(--warn)" };
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
  const [menu, setMenu] = useState(null); // { id, at: { x, y } }
  const [customerCard, setCustomerCard] = useState(null); // { ticketId, customer, via, anchor }
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
    return mine.filter((t) => [String(t.number), linearKey(t), t.subject, t.requester?.name, t.requester?.email, t.category, ...(t.tags || [])].some((v) => fold(v).includes(k)));
  }, [mine, q]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, searched.filter((t) => matchesFilter(t, f, { me, now })).length])), [searched, me, now]);
  // No filtro do Hermes, quem espera um aprovador (Validar, pergunta) vem primeiro.
  const visible = useMemo(() => {
    const order = queueOrder(now);
    const sort = filter === "hermes" ? (a, b) => (hermesNeedsHuman(b) - hermesNeedsHuman(a)) || order(a, b) : order;
    return searched.filter((t) => matchesFilter(t, filter, { me, now })).sort(sort);
  }, [searched, filter, me, now]);
  const totals = useMemo(() => {
    const open = mine.filter((t) => kindOf(t.status) !== "done");
    return { unassigned: open.filter((t) => !t.assignee).length, open: open.length };
  }, [mine]);
  const columns = useMemo(() => {
    const done = { ...DONE_COLUMN, tickets: searched.filter((t) => inDoneColumn(t, filter, { me })).sort((a, b) => doneAt(b) - doneAt(a)) };
    if (filter === "done") return [done];
    const open = TICKET_STATUSES.filter((s) => s.kind === "open")
      .map((s) => ({ key: s.key, label: s.label, tone: s.tone, tickets: visible.filter((t) => t.status === s.key) }));
    const waiting = { ...WAITING_COLUMN, tickets: visible.filter((t) => kindOf(t.status) === "waiting") };
    return [...open, waiting, done];
  }, [searched, visible, filter, me]);
  const agentName = useCallback((id) => (agents || []).find((a) => a.id === id)?.name || id || "—", [agents]);
  const byId = useMemo(() => new Map(mine.map((t) => [t.id, t])), [mine]);
  const myStats = useMemo(() => (me ? agentStats(mine, me, now) : null), [mine, me, now]);

  // ── Painel ───────────────────────────────────────────────────────────────
  useTicketHash((id) => setPanelId(id));
  const openPanel = useCallback((id) => { setPanelId(id); openTicketHash(id); }, []);
  const closePanel = useCallback(() => { clearTicketHash(); setPanelId(null); }, []);
  const onTicketChange = useCallback((t) => dispatch({ type: "UPSERT", ticket: t }), [dispatch]);
  const onDeleted = useCallback((id) => { dispatch({ type: "REMOVE", ids: [id] }); closePanel(); }, [dispatch, closePanel]);

  // ── Kanban: arrastar muda o status; soltar em Concluídos resolve ─────────
  // Toda alteração da fila (arrasto, círculo, menu) passa por aqui: otimista,
  // volta ao que era se a API recusar.
  const patchTicket = useCallback((id, patch, label) => {
    const before = byId.get(id);
    if (!before || Object.keys(patch).every((k) => (before[k] || "") === (patch[k] || ""))) return;
    if (!confirmHermes(before, patch)) return;
    const undo = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? ""]));
    mutate({
      ids: [id], silent: false, label,
      optimistic: () => dispatch({ type: "PATCH_LOCAL", id, patch }),
      request: () => api.ticketUpdate(id, patch),
      apply: (saved) => { dispatch({ type: "UPSERT", ticket: saved }); if (panelId === id) setPanelRefresh((v) => v + 1); },
      rollback: () => dispatch({ type: "PATCH_LOCAL", id, patch: undo }),
    });
  }, [byId, mutate, dispatch, panelId]);
  const setStatus = useCallback((id, status, label) => {
    patchTicket(id, { status }, label || `#${byId.get(id)?.number} em ${STATUS_BY_KEY[status]?.label || status}`);
  }, [byId, patchTicket]);
  const move = useCallback(({ ids, toKey }) => {
    for (const id of ids) {
      const before = byId.get(id);
      if (!before) continue;
      if (toKey === DONE_COLUMN.key) { if (!isDone(before)) setStatus(id, "resolved", `#${before.number} concluído`); }
      else if (toKey === WAITING_COLUMN.key) { if (kindOf(before.status) !== "waiting") setStatus(id, "pending_customer"); }
      else setStatus(id, toKey);
    }
  }, [byId, setStatus]);
  // O círculo do card: concluir = Resolvido; reabrir volta pra Em atendimento.
  const complete = useCallback((id, value) => {
    const before = byId.get(id);
    if (!before || isDone(before) === value) return;
    setStatus(id, value ? "resolved" : "open", `#${before.number} ${value ? "concluído" : "reaberto"}`);
  }, [byId, setStatus]);
  // ── Menu do clique direito ───────────────────────────────────────────────
  const openMenu = useCallback((id, at) => setMenu({ id, at }), []);
  const openCustomer = useCallback((t, match, anchor) => setCustomerCard({ ticketId: t.id, ...match, anchor }), []);
  const linkCustomer = useCallback((id, customer) => patchTicket(id, { customerId: customer.id }, `#${byId.get(id)?.number} vinculado a ${customer.name}`), [patchTicket, byId]);
  const copy = useCallback((text, ok) => {
    Promise.resolve(navigator.clipboard?.writeText(text)).then(() => toast(ok, "pos"), () => toast("Não deu pra copiar", "neg"));
  }, []);
  const removeTicket = useCallback(async (t) => {
    if (!window.confirm(`Apagar o ticket #${t.number}? A conversa, os anexos e o histórico somem. Para encerrar o atendimento, prefira Fechado.`)) return;
    try { await api.ticketDelete(t.id); toast("Ticket apagado", "pos"); dispatch({ type: "REMOVE", ids: [t.id] }); if (panelId === t.id) closePanel(); }
    catch (err) { toast(`Não deu pra apagar · ${err.message}`, "neg"); }
  }, [dispatch, panelId, closePanel]);
  const menuTicket = menu ? byId.get(menu.id) : null;

  const dnd = useBoardDnd({ boardRef, onDrop: move, getSelection: () => null, ghostLabel: (n) => `${n} tickets` });
  dndRef.current = dnd;

  const filtros = [
    { id: "open", label: "Abertos", n: counts.open },
    { id: "mine", label: "Meus", n: counts.mine },
    { id: "unassigned", label: "Sem responsável", n: counts.unassigned },
    { id: "risk", label: "SLA em risco", n: counts.risk, title: "estourados ou passando de 80% do prazo" },
    // Só aparece com o acompanhamento do Hermes ligado no produto (ou com algum
    // card ainda com ele, se desligarem no meio do caminho).
    ...(settings?.linear?.hermes?.enabled || counts.hermes
      ? [{ id: "hermes", label: "Com o Hermes", n: counts.hermes, title: "cards em que o Hermes está trabalhando; quem espera um aprovador vem primeiro" }]
      : []),
  ];
  const escondidos = [
    { id: "waiting", label: "Aguardando cliente", n: counts.waiting },
    { id: "done", label: "Resolvidos e fechados", n: counts.done },
    { id: "all", label: "Todos", n: counts.all },
  ];

  const sub = !handles ? "fila de suporte"
    : ["fila de suporte", `${totals.open} ${totals.open === 1 ? "aberto" : "abertos"}`, totals.unassigned ? `${totals.unassigned} sem responsável` : null].filter(Boolean).join(" · ");

  const panel = panelId && handles ? (
    <TicketDetail key={panelId} ticketId={panelId} summary={byId.get(panelId)} saasId={saasId} agents={agents} settings={settings} mobile={isMobile}
      refreshKey={panelRefresh} activityVersion={activityVersion} onClose={closePanel} onChange={onTicketChange} onDeleted={onDeleted} />
  ) : null;

  return (
    <div className="support-page tickets-page">
      <header className="tickets-head"><h1>Tickets</h1><div className="tickets-head-actions">
        {handles && <SearchInput value={q} onChange={setQ} placeholder="Buscar nº, assunto, cliente" label="Buscar tickets" width={230} />}
        {handles && <Segmented value={view} onChange={setView} options={[{ value: "kanban", label: "Kanban" }, { value: "list", label: "Lista" }]} />}
        {handles && <PrimaryButton onClick={() => setCreating(true)}>Abrir ticket</PrimaryButton>}
      </div></header>

      {!handles ? (
        <EmptyState title={`Você não atende tickets de ${product?.name || "este produto"}`}
          hint={noScopeHint(product?.name)} />
      ) : (
        <>
          {state.loaded && mine.length > 0 && myStats && (
            <div className="support-agent-summary capsule-navy" style={{ padding: "16px 22px", flexShrink: 0 }}>
              <AgentKpis stats={myStats} user={currentUser()} productName={product?.name || ""} onQueue={() => setFilter("mine")} onRisk={() => { setFilter("mine"); setView("list"); }} />
            </div>
          )}
          <div className="support-bar">
            {[...filtros, ...escondidos].map((f,i) => <React.Fragment key={f.id}>{i === filtros.length && <span className="tickets-filter-divider" />}<button className="tickets-filter" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} title={f.title}>{f.label} <span>{f.n}</span></button></React.Fragment>)}
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
                ? <TicketsList tickets={visible} agentName={agentName} selectedId={panelId} onOpen={openPanel} onMenu={openMenu} now={now} />
                : <TicketsBoard boardRef={boardRef} columns={columns} dnd={dnd} agentName={agentName} selectedId={panelId} onOpen={openPanel} onMenu={openMenu} onCustomer={openCustomer} onComplete={complete} now={now} />)}
            </div>
          </div>
          {panel}
          {customerCard && (
            <CustomerCard customer={customerCard.customer} via={customerCard.via} ticket={byId.get(customerCard.ticketId) || { id: customerCard.ticketId }} anchor={customerCard.anchor}
              tickets={mine} onLink={linkCustomer} onClose={() => setCustomerCard(null)} />
          )}
          {menuTicket && (
            <Menu x={menu.at.x} y={menu.at.y} title={`#${menuTicket.number} ${menuTicket.subject || ""}`} onClose={() => setMenu(null)}
              items={ticketMenuItems(menuTicket, { me, agents, saasId, categories: settings?.categories, canDelete: isAdminUser(), patch: patchTicket, copy, remove: removeTicket })} />
          )}
        </>
      )}

      {creating && (
        <NewTicketModal saasId={saasId} agents={agents} categories={settings?.categories || null} onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); dispatch({ type: "UPSERT", ticket: t }); openPanel(t.id); }} />
      )}
    </div>
  );
}
