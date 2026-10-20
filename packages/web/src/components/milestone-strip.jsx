// Régua de marcos enxuta no card do cliente (20/10/2026): em vez da lista
// inteira aberta, uma barra com um segmento por marco (cor pelo estado), o
// próximo marco em uma linha com "✓ feito" e a lista completa só ao pedir.
// Estados vêm de lib/milestones.js: done · late · soon · next.

import React, { useState } from "react";

const DAY = 86_400_000;
const STATE = { done: "feito", late: "atrasado", soon: "vence em breve", next: "depois" };

function dueLabel(m, now = Date.now()) {
  const days = Math.round((Date.parse(m.dueAt) - now) / DAY);
  if (m.status === "late") return days === 0 ? "vence hoje" : `venceu há ${Math.abs(days)} d`;
  if (m.status === "soon") return days <= 0 ? "vence hoje" : `vence em ${days} d`;
  return `em ${new Date(m.dueAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

export function MilestoneStrip({ milestones, onToggle }) {
  const [open, setOpen] = useState(false);
  const next = milestones.find((m) => m.status !== "done");
  return <div className="customer-peek-ms">
    <div className="customer-peek-ms-bar">
      {milestones.map((m) => <button key={m.key} type="button" data-s={m.status} aria-pressed={m.status === "done"}
        title={`${m.label} · ${STATE[m.status]}`} aria-label={`${m.label}: ${STATE[m.status]}`} onClick={() => onToggle(m)} />)}
    </div>
    <div className="customer-peek-ms-next">
      {next ? <>
        <span>Próximo: <b>{next.label}</b> <em data-s={next.status}>{dueLabel(next)}</em></span>
        <button type="button" onClick={() => onToggle(next)}>✓ feito</button>
      </> : <span>Todos os marcos feitos.</span>}
      <button type="button" className="customer-peek-ms-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "esconder" : "ver todos"}</button>
    </div>
    {open && <div className="customer-peek-checks">
      {milestones.map((m) => <button key={m.key} type="button" aria-pressed={m.status === "done"} onClick={() => onToggle(m)}>
        <i>{m.status === "done" ? "✓" : ""}</i><span>{m.label}</span>
      </button>)}
    </div>}
  </div>;
}
