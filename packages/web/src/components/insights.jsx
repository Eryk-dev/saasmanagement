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
// executados (it.action.steps) e só age no confirmar. Ações de TEXTO (copy)
// declaram `action.prepare()` — gera os campos (ex.: headline por IA) e eles
// ficam EDITÁVEIS antes de confirmar, com "gerar outra" pra nova sugestão; o
// execute recebe os valores finais editados. Depois de aplicado, o insight é
// dispensado e `onApplied` deixa a tela recarregar o estado vivo.
const fieldStyle = {
  width: "100%", padding: "6px 10px",
  background: "var(--bg-2)", border: "1px solid var(--line-2)",
  borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13,
};
function ApplyInsightModal({ item, onCancel, onApplied }) {
  const a = item.action;
  // preparing | confirm | prepare-error | running | done | error
  const [phase, setPhase] = React.useState(a.prepare ? "preparing" : "confirm");
  const [fields, setFields] = React.useState(null); // [{ key, label, value, multiline }]
  const [error, setError] = React.useState("");
  const busy = phase === "running" || phase === "preparing";

  async function prepare() {
    setPhase("preparing");
    setError("");
    try {
      setFields(await a.prepare());
      setPhase("confirm");
    } catch (e) {
      setError(String(e?.message || e).slice(0, 300));
      setPhase("prepare-error");
    }
  }
  React.useEffect(() => { if (a.prepare) prepare(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (key, value) => setFields((fs) => fs.map((f) => (f.key === key ? { ...f, value } : f)));
  const values = () => Object.fromEntries((fields || []).map((f) => [f.key, String(f.value || "").trim()]));
  const ready = !a.prepare || (fields && fields.every((f) => f.optional || String(f.value || "").trim()));

  async function run() {
    if (busy || !ready) return;
    setPhase("running");
    setError("");
    try {
      await a.execute(values());
      setPhase("done");
    } catch (e) {
      setError(String(e?.message || e).slice(0, 300));
      setPhase("error");
    }
  }

  return (
    <div onClick={busy ? undefined : (phase === "done" ? onApplied : onCancel)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(500px, 100%)", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 18 }}>
        <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>{a.label}</div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 4, lineHeight: 1.5 }}>{item.text}</div>

        {phase === "preparing" && (
          <div className="mono" style={{ fontSize: 12, color: "var(--fg-3)", margin: "16px 0 4px" }}>gerando sugestão…</div>
        )}
        {phase === "prepare-error" && (
          <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)", margin: "16px 0 4px" }}>Falha ao gerar: {error}</div>
        )}

        {fields && phase !== "preparing" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {fields.map((f) => (
              <div key={f.key}>
                <label style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>{f.label}</label>
                {f.multiline ? (
                  <textarea value={f.value} rows={2} onChange={(e) => setField(f.key, e.target.value)} disabled={busy}
                    style={{ ...fieldStyle, resize: "vertical" }} />
                ) : (
                  <input value={f.value} onChange={(e) => setField(f.key, e.target.value)} disabled={busy} style={fieldStyle} />
                )}
              </div>
            ))}
            {a.prepare && phase !== "done" && (
              <button onClick={prepare} disabled={busy}
                style={{ alignSelf: "flex-start", height: 24, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5, opacity: busy ? 0.6 : 1 }}>
                ↻ gerar outra
              </button>
            )}
          </div>
        )}

        <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)", margin: "14px 0 6px" }}>
          O que vai ser feito
        </div>
        <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 5 }}>
          {a.steps.map((s, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-1)" }}>{s}</li>
          ))}
        </ul>

        {phase === "error" && (
          <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)", marginTop: 12 }}>
            Falhou: {error} · nada além do que já foi confirmado foi alterado
          </div>
        )}
        {phase === "done" && (
          <div className="mono" style={{ fontSize: 12, color: "var(--pos)", marginTop: 12 }}>✓ aplicado</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          {phase === "done" ? (
            <PrimaryButton onClick={onApplied}>fechar</PrimaryButton>
          ) : (
            <>
              <button onClick={onCancel} disabled={phase === "running"} style={{ height: 30, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5, opacity: phase === "running" ? 0.6 : 1 }}>cancelar</button>
              {phase !== "prepare-error" ? (
                <PrimaryButton onClick={run} disabled={busy || !ready}>{phase === "running" ? "aplicando…" : phase === "error" ? "tentar de novo" : "confirmar e aplicar"}</PrimaryButton>
              ) : (
                <PrimaryButton onClick={prepare}>gerar de novo</PrimaryButton>
              )}
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
