import React from "react";
import "./lead-card.css";
import { toast } from "../atoms.jsx";
import { phoneLabel } from "../lib/ui.js";

// Identidade e superfícies do lead: pipeline, ficha, roteiro e inbox.
export function LeadGrade({ tier, muted = false, placeholder = false, size = 20 }) {
  if (!tier?.grade && !placeholder) return null;
  return <span className="lead-grade" title={tier?.label || "sem qualificação"}
    aria-label={tier?.label || "sem qualificação"}
    style={{ width: tier?.legacy ? size + 12 : size, height: size, background: muted || !tier?.grade ? "var(--bg-2)" : tier.tone,
      color: muted || !tier?.grade ? "var(--fg-3)" : tier.badgeFg }}>{tier?.grade || "—"}{tier?.legacy && <span className="lead-grade-legacy">L</span>}</span>;
}

export function LeadSection({ title, action, children, className = "" }) {
  return <section className={`lead-section ${className}`}>
    {title && <div className="lead-section-heading"><h3>{title}</h3>{action}</div>}
    {children}
  </section>;
}

export function LeadDisclosure({ title, hint, children, open = false }) {
  return <details className="lead-disclosure" open={open || undefined}>
    <summary><span>{title}</span>{hint && <small>{hint}</small>}<span aria-hidden="true" className="lead-disclosure-arrow">⌄</span></summary>
    <div className="lead-disclosure-body">{children}</div>
  </details>;
}

// Telefone do cliente no topo do card (09/10/2026), ao lado do nome e sem
// borda (uma linha só pra ele ocupava espaço demais): abrir o card pela Agenda
// pra ligar ou mandar mensagem obrigava a descer até "Editar" pra achar o
// número. Um clique copia; o rótulo vira "copiado" por um instante e o aviso
// confirma (ou diz que o navegador bloqueou, sem diálogo nativo).
export function LeadPhoneCopy({ phone }) {
  const [copied, setCopied] = React.useState(false);
  const t = React.useRef(0);
  React.useEffect(() => () => clearTimeout(t.current), []);
  const label = phoneLabel(phone);
  if (!label) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(label);
      setCopied(true); clearTimeout(t.current); t.current = setTimeout(() => setCopied(false), 1600);
      toast("Telefone copiado", "pos", 2000);
    } catch {
      toast("O navegador não deixou copiar · selecione o número", "warn");
    }
  };
  return (
    <button type="button" className="lead-panel-phone" onClick={copy} data-copied={copied ? "true" : undefined}
      title="Copiar telefone" aria-label={`Copiar telefone ${label}`}>
      <span className="tnum">{label}</span>
      <span className="lead-panel-phone-hint" aria-hidden="true">
        {copied ? "copiado" : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </span>
    </button>
  );
}
