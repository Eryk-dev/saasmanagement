import React from "react";
import { Card } from "./viz.jsx";
import { PrimaryButton } from "../atoms.jsx";

// Insights compartilhados (Publicidade e Forms): sugestões por REGRA, cada uma
// com o porquê nos números e um ✕ pra dispensar. A dispensa vive no localStorage
// por 7 dias — se a regra continuar disparando depois disso, o insight volta
// (o problema provavelmente continua lá). `id` do item precisa ser ESTÁVEL
// (regra + alvo, sem números), senão qualquer variação de gasto ressuscita um
// insight já dispensado.
const TONES = { escalar: "var(--pos)", cortar: "var(--neg)", atencao: "var(--warn)" };
const LS_KEY = "cockpit:insights:dismissed";
const WEEK_MS = 7 * 86400000;

function readDismissed() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}

function persistDismiss(scopedId) {
  const map = readDismissed();
  map[scopedId] = Date.now();
  // Faxina: entradas vencidas saem pra chave não crescer pra sempre.
  for (const k of Object.keys(map)) if (Date.now() - map[k] >= WEEK_MS) delete map[k];
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* quota/incógnito */ }
}

// items: [{ id, tone: escalar|cortar|atencao, tag, text }]. `scope` prefixa o id
// na dispensa (ex.: "ads:leverads", "form:fo_x") pra não vazar entre telas.
function useVisibleInsights(items, scope) {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  const dismissed = readDismissed();
  const visible = (items || []).filter((it) => {
    const ts = dismissed[`${scope}:${it.id}`];
    return !(ts && Date.now() - ts < WEEK_MS);
  });
  const dismiss = (id) => { persistDismiss(`${scope}:${id}`); bump(); };
  return [visible, dismiss];
}

function InsightRow({ it, onDismiss, onApply }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "10px 12px" }}>
      <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TONES[it.tone] || "var(--fg-3)", border: "1px solid currentColor", borderRadius: 999, padding: "2px 8px", flexShrink: 0, marginTop: 1 }}>{it.tag}</span>
      <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-2)", flex: 1 }}>{it.text}</span>
      {it.action && (
        <button onClick={onApply} title={it.action.label}
          style={{ flexShrink: 0, height: 22, padding: "0 9px", borderRadius: 5, border: "1px solid var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
          aplicar
        </button>
      )}
      <button onClick={onDismiss} title="dispensar por 7 dias" aria-label="dispensar insight"
        style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-3)", fontSize: 12, lineHeight: 1 }}>✕</button>
    </div>
  );
}

// Popup de confirmação do "aplicar": mostra os passos EXATOS que vão ser
// executados (it.action.steps) e só age no confirmar. Depois de aplicado, o
// insight é dispensado (a sugestão foi atendida) e `onApplied` deixa a tela
// recarregar o estado vivo (status/orçamento na Meta).
function ApplyInsightModal({ item, onCancel, onApplied }) {
  const [phase, setPhase] = React.useState("confirm"); // confirm | running | done | error
  const [error, setError] = React.useState("");
  const running = phase === "running";

  async function run() {
    if (running) return;
    setPhase("running");
    try {
      await item.action.execute();
      setPhase("done");
    } catch (e) {
      setError(String(e?.message || e).slice(0, 300));
      setPhase("error");
    }
  }

  return (
    <div onClick={running ? undefined : (phase === "done" ? onApplied : onCancel)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px, 100%)", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 18 }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>{item.action.label}</div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 4, lineHeight: 1.5 }}>{item.text}</div>

        <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)", margin: "14px 0 6px" }}>
          O que vai ser feito
        </div>
        <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 5 }}>
          {item.action.steps.map((s, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-1)" }}>{s}</li>
          ))}
        </ul>

        {phase === "error" && (
          <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)", marginTop: 12 }}>
            A Meta recusou: {error} · nada além do que já foi confirmado foi alterado
          </div>
        )}
        {phase === "done" && (
          <div className="mono" style={{ fontSize: 12, color: "var(--pos)", marginTop: 12 }}>✓ aplicado na Meta</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          {phase === "done" ? (
            <PrimaryButton onClick={onApplied}>fechar</PrimaryButton>
          ) : (
            <>
              <button onClick={onCancel} disabled={running} style={{ height: 30, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5, opacity: running ? 0.6 : 1 }}>cancelar</button>
              <PrimaryButton onClick={run} disabled={running}>{running ? "aplicando…" : phase === "error" ? "tentar de novo" : "confirmar e aplicar"}</PrimaryButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Lista crua (pra embutir em containers próprios, como o dashboard de forms).
// Some inteira quando não há nada visível — `header`/`style` moram no root pra
// não sobrar título/margem órfãos depois da última dispensa.
export function InsightsList({ items, scope, header, style, onApplied }) {
  const [visible, dismiss] = useVisibleInsights(items, scope);
  const [applying, setApplying] = React.useState(null);
  if (!visible.length) return null;
  return (
    <div style={style}>
      {header}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((it) => (
          <InsightRow key={it.id} it={it} onDismiss={() => dismiss(it.id)} onApply={() => setApplying(it)} />
        ))}
      </div>
      {applying && (
        <ApplyInsightModal item={applying} onCancel={() => setApplying(null)}
          onApplied={() => { dismiss(applying.id); setApplying(null); onApplied?.(); }} />
      )}
    </div>
  );
}

// Versão em Card (tela Publicidade). Some inteira quando tudo foi dispensado.
export function InsightsCard({ title = "Insights", hint, items, scope, onApplied }) {
  const [visible, dismiss] = useVisibleInsights(items, scope);
  const [applying, setApplying] = React.useState(null);
  if (!visible.length) return null;
  return (
    <Card title={title} hint={hint}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px 14px" }}>
        {visible.map((it) => (
          <InsightRow key={it.id} it={it} onDismiss={() => dismiss(it.id)} onApply={() => setApplying(it)} />
        ))}
      </div>
      {applying && (
        <ApplyInsightModal item={applying} onCancel={() => setApplying(null)}
          onApplied={() => { dismiss(applying.id); setApplying(null); onApplied?.(); }} />
      )}
    </Card>
  );
}
