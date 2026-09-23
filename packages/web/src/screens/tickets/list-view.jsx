import React from "react";
import { UserAvatarRing } from "../../components/user-picker.jsx";
import { STATUS_BY_KEY, PRIORITY_BY_KEY, slaLabel, waitingSince, linearInReview } from "../../lib/tickets.js";

const { useState } = React;

// Lista da fila, agrupada pelo que exige ação primeiro: SLA estourado, depois o
// que vence logo, o resto no prazo, os pausados (esperando o cliente) e, por
// último, os resolvidos. A grade tem piso por coluna e um orçamento que o smoke
// confere; em janelas menores, a rolagem fica dentro da tabela.
export const TICKETS_GRID = "minmax(230px,2fr) minmax(120px,.9fr) minmax(100px,.7fr) minmax(150px,1.1fr) minmax(120px,.8fr) minmax(110px,.8fr)";
export const TICKETS_GRID_GAP = 12;
export const TICKETS_GRID_BUDGET = 926;
export const TICKET_SECTIONS = [
  ["breached", "SLA estourado", "var(--neg)"],
  ["warning", "Vence em breve", "var(--warn)"],
  ["ok", "No prazo", "var(--accent)"],
  ["paused", "Aguardando o cliente", "var(--fg-4)"],
  ["done", "Resolvidos", "var(--fg-4)"],
];

export function sectionOf(t, now) {
  const sla = slaLabel(t, now);
  if (sla.state === "met" || STATUS_BY_KEY[t.status]?.kind === "done") return "done";
  if (sla.state === "breached") return "breached";
  if (sla.state === "warning") return "warning";
  if (sla.state === "paused" || STATUS_BY_KEY[t.status]?.kind === "waiting") return "paused";
  return "ok";
}

export function TicketsList({ tickets, agentName, selectedId, onOpen, now }) {
  const [showDone, setShowDone] = useState(false);
  const groups = Object.fromEntries(TICKET_SECTIONS.map(([k]) => [k, []]));
  for (const t of tickets) groups[sectionOf(t, now)].push(t);
  const sections = TICKET_SECTIONS.filter(([k]) => groups[k].length);
  if (!sections.length) return null;
  return (
    <div className="support-list">
      <div className="tbl-x" style={{ border: 0, borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ minWidth: TICKETS_GRID_BUDGET }}>
          <div className="kicker" style={{ display: "grid", gridTemplateColumns: TICKETS_GRID, gap: TICKETS_GRID_GAP, padding: "11px 18px", background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }}>
            <span>Ticket</span><span>Status</span><span>Prioridade</span><span>SLA</span><span>Responsável</span><span>Atividade</span>
          </div>
          {sections.map(([key, label, tone]) => {
            const rows = groups[key];
            const folded = key === "done" && !showDone;
            return (
              <React.Fragment key={key}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 18px", background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: tone, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: key === "breached" ? "var(--neg)" : "var(--fg-1)" }}>{label}</span>
                  <span className="tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{rows.length}</span>
                  {folded && (
                    <button type="button" onClick={() => setShowDone(true)} className="mono" style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--accent)", fontWeight: 600 }}>mostrar</button>
                  )}
                </div>
                {!folded && rows.map((t) => {
                  const st = STATUS_BY_KEY[t.status] || STATUS_BY_KEY.new;
                  const pri = PRIORITY_BY_KEY[t.priority] || PRIORITY_BY_KEY.normal;
                  const sla = slaLabel(t, now);
                  const last = t.lastMessage;
                  const wait = last?.authorType === "customer" && st.kind !== "done" ? waitingSince(last.at, now) : null;
                  const updated = waitingSince(t.updatedAt || t.createdAt, now);
                  return (
                    <div key={t.id} role="button" tabIndex={0} className="support-row" aria-current={selectedId === t.id ? "true" : undefined}
                      style={{ gridTemplateColumns: TICKETS_GRID, gap: TICKETS_GRID_GAP, opacity: key === "done" ? 0.7 : 1 }}
                      onClick={() => onOpen(t.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(t.id); } }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="support-ellipsis" style={{ fontWeight: 600 }}>
                          <span className="mono tnum" style={{ color: "var(--fg-4)", fontWeight: 400, marginRight: 6 }}>#{t.number}</span>{t.subject}
                        </div>
                        <div className="support-ellipsis" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
                          {[t.requester?.name, t.category, t.messageCount ? `${t.messageCount} msg` : ""].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <span className="support-status support-ellipsis" style={{ "--dot": st.tone }}>{st.label}</span>
                        {linearInReview(t) && <div className="chip info" style={{ fontSize: 10.5, minHeight: 0 }} title={`${t.linear.identifier} está em ${t.linear.stateName} no Linear`}>{t.linear.stateName}</div>}
                      </div>
                      <span className="support-ellipsis" style={{ fontSize: 12, color: t.priority === "urgent" ? pri.tone : "var(--fg-2)", fontWeight: t.priority === "urgent" ? 600 : 400 }}>{pri.label}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="support-ellipsis" style={{ fontSize: 12.5, color: sla.tone, fontWeight: sla.state === "breached" ? 600 : 400 }}>{sla.text}</div>
                        {wait && <div className="mono" style={{ fontSize: 10.5, color: wait.tone }}>cliente esperando {wait.text.replace(/^há /, "")}</div>}
                      </div>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {t.assignee
                          ? <><UserAvatarRing id={t.assignee} name={agentName(t.assignee)} size={18} /><span className="support-ellipsis" style={{ fontSize: 12.5 }}>{agentName(t.assignee)}</span></>
                          : <span style={{ fontSize: 12, color: "var(--warn)" }}>sem dono</span>}
                      </span>
                      <span className="mono support-ellipsis" style={{ fontSize: 11, color: "var(--fg-4)" }}>{updated?.text || ""}</span>
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
