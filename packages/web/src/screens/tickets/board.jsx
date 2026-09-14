import React from "react";
import { UserAvatarRing } from "../../components/user-picker.jsx";
import { PRIORITY_BY_KEY, slaLabel, waitingSince } from "../../lib/tickets.js";

const { useRef, memo } = React;

// Kanban da fila: uma coluna por STATUS (semântica fixa do servidor). Arrastar
// muda o status; a ordem dentro da coluna é a da fila (SLA mais apertado
// primeiro), não manual — ticket não se prioriza arrastando.
export const TicketCard = memo(function TicketCard({ t, agentName, selected, onOpen, dragProps, now }) {
  const pri = PRIORITY_BY_KEY[t.priority] || PRIORITY_BY_KEY.normal;
  const sla = slaLabel(t, now);
  const who = t.requester?.name || t.customerName || "";
  const wait = t.lastMessage?.authorType === "customer" ? waitingSince(t.lastMessage.at, now) : null;
  return (
    <div role="button" tabIndex={0} data-task={t.id} className="support-card" aria-current={selected ? "true" : undefined}
      onClick={() => onOpen(t.id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(t.id); }} {...(dragProps || {})}>
      <div className="support-card-meta">
        <span className="mono tnum" style={{ color: "var(--fg-4)" }}>#{t.number}</span>
        <span className="support-status" style={{ "--dot": pri.tone, color: t.priority === "urgent" ? pri.tone : "var(--fg-3)", fontSize: 11.5 }}>{pri.label}</span>
        {t.category && <span className="support-ellipsis" style={{ marginLeft: "auto", color: "var(--fg-4)" }}>{t.category}</span>}
      </div>
      <div className="support-card-subject">{t.subject}</div>
      {who && <div className="support-ellipsis" style={{ fontSize: 12, color: "var(--fg-3)" }}>{who}</div>}
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

function Column({ status, cards, dnd, agentName, selectedId, onOpen, now }) {
  const listRef = useRef(null);
  const over = dnd.placeholder?.colKey === status.key;
  return (
    <section className="support-col" data-over={over ? "1" : undefined} aria-label={status.label}>
      <div className="support-col-head">
        <span className="support-status" style={{ "--dot": status.tone, fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{status.label}</span>
        <span className="mono tnum dim" style={{ fontSize: 11.5 }}>{cards.length}</span>
      </div>
      <div ref={listRef} data-col-list="1" className="support-col-list" {...dnd.listDropProps(status.key, listRef, { canReorder: false })}>
        {cards.map((t) => (
          <TicketCard key={t.id} t={t} agentName={agentName} selected={selectedId === t.id} onOpen={onOpen} now={now}
            dragProps={dnd.cardDragProps(t, status.key)} />
        ))}
        {cards.length === 0 && <div className="mono dim" style={{ fontSize: 11, textAlign: "center", padding: "22px 0" }}>{dnd.drag ? "solte aqui" : "nenhum ticket"}</div>}
      </div>
    </section>
  );
}

export function TicketsBoard({ boardRef, columns, dnd, agentName, selectedId, onOpen, now }) {
  return (
    <div ref={boardRef} className="support-board">
      {columns.map((c) => (
        <Column key={c.status.key} status={c.status} cards={c.tickets} dnd={dnd} agentName={agentName} selectedId={selectedId} onOpen={onOpen} now={now} />
      ))}
    </div>
  );
}
