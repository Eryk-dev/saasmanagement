import React from "react";
import "./lead-card.css";

// Identidade e superfícies do lead: pipeline, ficha, roteiro e inbox.
export function LeadGrade({ tier, muted = false, placeholder = false, size = 20 }) {
  if (!tier?.grade && !placeholder) return null;
  return <span className="lead-grade" title={tier?.label || "sem qualificação"}
    aria-label={tier?.label || "sem qualificação"}
    style={{ width: tier?.legacy ? size + 12 : size, height: size, background: muted || !tier?.grade ? "var(--bg-2)" : tier.tone,
      color: muted || !tier?.grade ? "var(--fg-3)" : tier.badgeFg }}>{tier?.grade || "—"}{tier?.legacy && <small style={{ fontSize: 9, marginLeft: 3, color: "inherit" }}>L</small>}</span>;
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
