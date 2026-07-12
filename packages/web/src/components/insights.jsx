import React from "react";
import { Card } from "./viz.jsx";

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

function InsightRow({ it, onDismiss }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "10px 12px" }}>
      <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: TONES[it.tone] || "var(--fg-3)", border: "1px solid currentColor", borderRadius: 999, padding: "2px 8px", flexShrink: 0, marginTop: 1 }}>{it.tag}</span>
      <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-2)", flex: 1 }}>{it.text}</span>
      <button onClick={onDismiss} title="dispensar por 7 dias" aria-label="dispensar insight"
        style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-3)", fontSize: 12, lineHeight: 1 }}>✕</button>
    </div>
  );
}

// Lista crua (pra embutir em containers próprios, como o dashboard de forms).
// Some inteira quando não há nada visível — `header`/`style` moram no root pra
// não sobrar título/margem órfãos depois da última dispensa.
export function InsightsList({ items, scope, header, style }) {
  const [visible, dismiss] = useVisibleInsights(items, scope);
  if (!visible.length) return null;
  return (
    <div style={style}>
      {header}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((it) => <InsightRow key={it.id} it={it} onDismiss={() => dismiss(it.id)} />)}
      </div>
    </div>
  );
}

// Versão em Card (tela Publicidade). Some inteira quando tudo foi dispensado.
export function InsightsCard({ title = "Insights", hint, items, scope }) {
  const [visible, dismiss] = useVisibleInsights(items, scope);
  if (!visible.length) return null;
  return (
    <Card title={title} hint={hint}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px 14px" }}>
        {visible.map((it) => <InsightRow key={it.id} it={it} onDismiss={() => dismiss(it.id)} />)}
      </div>
    </Card>
  );
}
