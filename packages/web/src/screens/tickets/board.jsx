import React from "react";
import { UserAvatarRing } from "../../components/user-picker.jsx";
import { KanbanBoard, KanbanColumn } from "../../components/kanban/board.jsx";
import { useLongPress } from "../../components/kanban/dnd.js";
import { customerOf } from "./customer-card.jsx";
import { CompleteCircle } from "../../components/complete-circle.jsx";
import { LabelChip } from "../../components/label-chip.jsx";
import { PRIORITY_BY_KEY, STATUS_BY_KEY, slaLabel, waitingSince, isDone, categoryColor, linearInReview, linearKey } from "../../lib/tickets.js";

const { useState, useEffect, memo } = React;

// Kanban da fila sobre a casca compartilhada (components/kanban): uma coluna
// por STATUS (semântica fixa do servidor). Arrastar muda o status; a ordem
// dentro da coluna é a da fila (SLA mais apertado primeiro), não manual:
// ticket não se prioriza arrastando. Resolvido e Fechado dividem a coluna
// Concluídos, Aguardando cliente e Em espera dividem a Aguardando (o card em
// espera leva a etiqueta), e o círculo do card conclui (resolve) ou reabre
// como nas Tarefas.
// Coluna recolhida fica salva no navegador.
export const TicketCard = memo(function TicketCard({ t, agentName, selected, onOpen, onMenu, onCustomer, onComplete, dragProps, now }) {
  // O ✓ marca na hora e o card só troca de coluna depois do "pop" (mesma ideia
  // das Tarefas); a marca local some quando o status novo chega.
  const [marked, setMarked] = useState(null);
  useEffect(() => { setMarked(null); }, [t.status]);
  const done = marked ?? isDone(t);
  const pri = PRIORITY_BY_KEY[t.priority] || PRIORITY_BY_KEY.normal;
  const sla = slaLabel(t, now);
  const who = t.requester?.name || t.customerName || "";
  // Cliente cadastrado: o nome vira link pro cartão com os dados dele (o
  // contato que abriu vem primeiro; a empresa entra quando é outro nome).
  const match = onCustomer ? customerOf(t) : null;
  const customer = match?.customer || null;
  const whoText = customer && customer.name !== who ? [who, customer.name].filter(Boolean).join(" · ") : (who || customer?.name || "");
  const stop = (e) => e.stopPropagation();
  const wait = !done && t.lastMessage?.authorType === "customer" ? waitingSince(t.lastMessage.at, now) : null;
  const long = useLongPress((pt) => onMenu?.(t.id, pt));
  const toggle = (v) => { setMarked(v); setTimeout(() => onComplete(t.id, v), v ? 450 : 0); };
  return (
    <div role="button" tabIndex={0} className="support-card" aria-current={selected ? "true" : undefined} style={{ opacity: done ? 0.78 : 1 }}
      onClick={() => onOpen(t.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(t.id); } }} {...(dragProps || {})} {...(onMenu ? long : {})}
      onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(t.id, { x: e.clientX, y: e.clientY }); } : undefined}>
      <div className="support-card-meta">
        <span className="mono tnum" style={{ color: "var(--fg-4)", whiteSpace: "nowrap" }}>#{t.number}
          {/* Atalho pra issue: o clique no número não abre o ticket, abre o Linear. */}
          {linearKey(t) && <>{" · "}{t.linear.url
            ? <a href={t.linear.url} target="_blank" rel="noopener noreferrer" draggable={false} className="support-linear-link" title={`Abrir ${linearKey(t)} no Linear`}
                onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>#{linearKey(t)}</a>
            : `#${linearKey(t)}`}</>}
        </span>
        <span className="support-status" style={{ "--dot": pri.tone, color: t.priority === "urgent" ? pri.tone : "var(--fg-3)", fontSize: 11.5 }}>{pri.label}</span>
        {t.status === "on_hold" && <span className="chip" style={{ fontSize: 11, minHeight: 0, whiteSpace: "nowrap" }} title="status do ticket">{STATUS_BY_KEY.on_hold.label}</span>}
        {!done && linearInReview(t) && <span className="chip info" style={{ fontSize: 11, minHeight: 0, whiteSpace: "nowrap" }} title={`${t.linear.identifier} está em ${t.linear.stateName} no Linear`}>{t.linear.stateName}</span>}
        {t.category && <span style={{ marginLeft: "auto", minWidth: 0, display: "inline-flex" }}><LabelChip label={t.category} color={categoryColor(t.category)} small /></span>}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ paddingTop: 1 }}><CompleteCircle done={done} size={18} onToggle={toggle} doneTitle="Reabrir ticket" undoneTitle="Marcar como concluído" /></span>
        <div className="support-card-subject" style={{ flex: 1, color: done ? "var(--fg-3)" : undefined }}>{t.subject}</div>
      </div>
      {customer
        ? <div style={{ minWidth: 0, display: "flex" }}>
            <button type="button" className="support-customer-link support-ellipsis" draggable={false} title={`Ver dados de ${customer.name}`}
              onClick={(e) => { e.stopPropagation(); onCustomer(t, match, e.currentTarget); }} onPointerDown={stop} onMouseDown={stop} onContextMenu={stop}>{whoText}</button>
          </div>
        : whoText && <div className="support-ellipsis" style={{ fontSize: 12, color: "var(--fg-3)" }}>{whoText}</div>}
      <div className="support-card-meta">
        <span className="support-ellipsis" style={{ color: sla.tone, fontWeight: sla.state === "breached" || sla.state === "warning" ? 600 : 500 }} title="SLA">{sla.text}</span>
        {wait && <span title="o cliente escreveu por último" style={{ color: wait.tone, whiteSpace: "nowrap" }}>· {wait.text}</span>}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {t.messageCount > 0 && <span className="tnum" title="mensagens">{t.messageCount} msg</span>}
          {t.assignee
            ? <span title={agentName(t.assignee)}><UserAvatarRing id={t.assignee} name={agentName(t.assignee)} size={18} /></span>
            : <span title="sem responsável" style={{ width: 18, height: 18, borderRadius: 999, border: "1px dashed var(--line-2)" }} />}
        </span>
      </div>
    </div>
  );
});

const COLLAPSED_KEY = "cockpit_tickets_collapsed";
const readCollapsed = () => { try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "{}") || {}; } catch { return {}; } };

export function TicketsBoard({ boardRef, columns, dnd, agentName, selectedId, onOpen, onMenu, onCustomer, onComplete, now }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const collapse = (key, on) => setCollapsed((c) => {
    const next = { ...c, [key]: on };
    if (!on) delete next[key];
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  return (
    <KanbanBoard boardRef={boardRef}>
      {columns.map((col) => (
        <KanbanColumn key={col.key} colKey={col.key} dnd={dnd} label={col.label} items={col.tickets}
          before={<span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: col.tone, flexShrink: 0 }} />}
          collapsed={!!collapsed[col.key]} onExpand={() => collapse(col.key, false)} onCollapse={() => collapse(col.key, true)}
          moreLabel={(n) => `+${n} tickets`} emptyText={col.key === "done" ? "nenhum concluído" : "nenhum ticket"}
          renderItem={(t) => (
            <TicketCard key={t.id} t={t} agentName={agentName} selected={selectedId === t.id} onOpen={onOpen} onMenu={onMenu} onCustomer={onCustomer} onComplete={onComplete} now={now}
              dragProps={dnd.cardDragProps(t, col.key)} />
          )} />
      ))}
    </KanbanBoard>
  );
}
