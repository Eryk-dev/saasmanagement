import React from "react";
// Controles de formulário no desenho do cockpit (14/09/2026). O checkbox e o
// campo numérico nativos saem com o visual do sistema operacional — caixinha
// azul do navegador, setinhas de spinner — no meio de telas com tokens. O
// toggle Off/On da Publicidade (metrics.jsx) já era um botão desenhado; aqui
// vira peça compartilhada, junto do checkbox e do campo de horas.

const { useEffect, useState } = React;

// Liga/desliga de uma configuração (efeito imediato no rascunho da tela).
export function Switch({ checked, onChange, label, disabled = false, size = "md" }) {
  const w = size === "sm" ? 30 : 36, h = size === "sm" ? 18 : 20, k = h - 6;
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: w, height: h, borderRadius: 999, padding: 2, flexShrink: 0,
        background: checked ? "var(--accent)" : "var(--bg-3)",
        border: "1px solid " + (checked ? "var(--accent)" : "var(--line-2)"),
        display: "inline-flex", alignItems: "center", justifyContent: checked ? "flex-end" : "flex-start",
        transition: "background 120ms ease", opacity: disabled ? 0.55 : 1, cursor: disabled ? "default" : "pointer",
      }}>
      <span style={{ width: k, height: k, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px oklch(0 0 0 / 0.3)" }} />
    </button>
  );
}

// Linha de configuração: título + explicação à esquerda, switch à direita. A
// linha inteira é clicável (alvo grande), sem <label> em volta de botão.
export function SwitchRow({ checked, onChange, title, hint, disabled = false }) {
  return (
    <div role="presentation" onClick={() => !disabled && onChange(!checked)}
      style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: disabled ? "default" : "pointer" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 2 }}>{hint}</div>}
      </div>
      <span onClick={(e) => e.stopPropagation()} style={{ paddingTop: 1 }}>
        <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
      </span>
    </div>
  );
}

// Caixa de marcar. Com `children`, vira linha clicável com o texto ao lado.
export function Checkbox({ checked, onChange, label, disabled = false, children }) {
  const box = (
    <span aria-hidden="true" style={{
      width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: checked ? "var(--accent)" : "var(--bg-1)",
      border: "1.5px solid " + (checked ? "var(--accent)" : "var(--line-strong)"),
      color: "#fff", transition: "background 100ms ease, border-color 100ms ease",
    }}>
      {checked && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>
      )}
    </span>
  );
  return (
    <button type="button" role="checkbox" aria-checked={!!checked} aria-label={children ? undefined : label} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{ display: "inline-flex", alignItems: children ? "flex-start" : "center", gap: 8, padding: children ? "2px 0" : 2, background: "transparent", textAlign: "left",
        fontSize: 13, color: "var(--fg-1)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <span style={{ paddingTop: children ? 1 : 0, display: "inline-flex" }}>{box}</span>
      {children && <span style={{ minWidth: 0 }}>{children}</span>}
    </button>
  );
}

// Duração em horas guardada em minutos. Campo de texto (vírgula ou ponto) com a
// unidade dentro — o type="number" trazia o spinner do navegador e não deixava
// digitar "1,5". O rascunho manda enquanto se digita; ao sair, reformata.
export function HoursInput({ minutes, onChange, label, min = 0.25 }) {
  const fmt = (m) => String(Math.round((Number(m) || 0) / 60 * 100) / 100).replace(".", ",");
  const [text, setText] = useState(() => fmt(minutes));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt(minutes)); }, [minutes, focused]); // eslint-disable-line react-hooks/exhaustive-deps
  const parse = (v) => Number(String(v).replace(",", ".").trim());
  const invalid = !(parse(text) >= min);
  return (
    <div className="inp" style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px 0 12px", borderColor: invalid ? "var(--neg)" : focused ? "var(--accent-line)" : undefined }}>
      <input value={text} inputMode="decimal" aria-label={label} aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (!invalid) setText(fmt(minutes)); }}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.,]/g, "");
          setText(v);
          const n = parse(v);
          if (n >= min) onChange(Math.max(1, Math.round(n * 60)));
        }}
        style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", font: "inherit", fontSize: 13, color: "var(--fg-1)", padding: 0, height: "100%" }} />
      <span className="mono dim" style={{ fontSize: 11.5 }}>h</span>
    </div>
  );
}
