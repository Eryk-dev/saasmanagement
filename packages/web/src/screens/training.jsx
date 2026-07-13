import React from "react";
import { PageHead, Segmented } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";

// Treinamentos — flashcards por vaga (SDR / Closer / …). Dois modos: ESTUDAR
// (vira o card, avança, embaralha, marca pra revisar) e EDITAR (configura os
// cards, salvo pro time todo). Os cards vêm da collection flashcards.

const { useState: useS, useEffect: useE, useRef: useR } = React;
const ROLE_ORDER = ["sdr", "closer", "integrator", "social"];
const uid = () => `card_${Math.random().toString(36).slice(2, 9)}`;

function TrainingScreen() {
  const [product] = useActiveSaas();
  const [cards, setCards] = useS(null);
  const [labels, setLabels] = useS({});
  const [aiOn, setAiOn] = useS(false);
  const [orig, setOrig] = useS(null);
  const [role, setRole] = useS("sdr");
  const [mode, setMode] = useS("study"); // study | edit
  const [err, setErr] = useS(null);
  const [saving, setSaving] = useS(false);
  const [note, setNote] = useS(null);

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setCards(null); setErr(null); setNote(null);
    api.flashcards(product.id).then((d) => {
      if (!alive) return;
      setCards(d.cards || []); setLabels(d.roleLabels || {}); setAiOn(!!d.aiConfigured); setOrig(JSON.stringify(d.cards || []));
      const first = ROLE_ORDER.find((r) => (d.cards || []).some((c) => c.role === r));
      if (first) setRole(first);
    }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [product?.id]);

  const dirty = cards && JSON.stringify(cards) !== orig;
  const rolesPresent = ROLE_ORDER.filter((r) => (cards || []).some((c) => c.role === r));
  // Sempre deixa SDR e Closer disponíveis pra criar, mesmo sem cards ainda.
  const roleTabs = [...new Set([...rolesPresent, "sdr", "closer"])].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  const roleCards = (cards || []).filter((c) => c.role === role);

  async function save() {
    setSaving(true); setNote(null);
    try {
      const r = await api.saveFlashcards(product.id, cards);
      setCards(r.cards); setOrig(JSON.stringify(r.cards));
      setNote({ ok: true, text: "flashcards salvos pro time" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setSaving(false);
  }
  function reset() { if (orig) setCards(JSON.parse(orig)); }
  function patchCard(id, field, value) { setCards((p) => p.map((c) => (c.id === id ? { ...c, [field]: value } : c))); }
  function addCard() { setCards((p) => [...(p || []), { id: uid(), role, front: "", back: "" }]); }
  function removeCard(id) { setCards((p) => p.filter((c) => c.id !== id)); }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Treinamentos" sub="flashcards por vaga · estude e configure os cards">
        <Segmented value={mode} onChange={setMode} options={[{ value: "study", label: "Estudar" }, { value: "edit", label: "Editar" }]} />
        {mode === "edit" && dirty && (
          <>
            <button onClick={reset} disabled={saving} className="mono dim" style={{ fontSize: 11.5 }}>descartar</button>
            <button onClick={save} disabled={saving}
              style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "salvando…" : "salvar"}
            </button>
          </>
        )}
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {!cards && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando flashcards…</div>}

        {cards && (
          <>
            {/* Vaga */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {roleTabs.map((r) => {
                const on = r === role;
                const n = cards.filter((c) => c.role === r).length;
                return (
                  <button key={r} onClick={() => setRole(r)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: "var(--r-2)",
                    background: on ? "var(--accent-soft)" : "var(--bg-1)", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"),
                    color: on ? "var(--accent)" : "var(--fg-2)", fontSize: 12.5, fontWeight: on ? 600 : 500,
                  }}>
                    {labels[r] || r}
                    <span className="mono dim" style={{ fontSize: 10.5 }}>{n}</span>
                  </button>
                );
              })}
            </div>

            {mode === "study"
              ? <StudyMode key={role} cards={roleCards} roleLabel={labels[role] || role} saasId={product.id} aiOn={aiOn} />
              : <EditMode cards={roleCards} onPatch={patchCard} onAdd={addCard} onRemove={removeCard} roleLabel={labels[role] || role} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Estudar (quiz digitado, correção por IA) ─────────────────────────────────
// O treinando DIGITA a resposta; a IA compara com o gabarito e diz se está
// correta/parcial/incorreta + nota + feedback. Tira a dependência da auto-
// avaliação e cada tentativa é gravada (métrica de treino por pessoa).
const VERDICT = {
  correto:   { label: "Correto",   color: "var(--pos)",  bg: "var(--pos-soft)" },
  parcial:   { label: "Parcial",   color: "var(--warn)", bg: "var(--warn-soft)" },
  incorreto: { label: "Incorreto", color: "var(--neg)",  bg: "var(--neg-soft)" },
};

function StudyMode({ cards, roleLabel, saasId, aiOn }) {
  const [order, setOrder] = useS(() => cards.map((_, i) => i)); // deck (índices em cards)
  const [pos, setPos] = useS(0);
  const [answer, setAnswer] = useS("");
  const [grading, setGrading] = useS(false);
  const [result, setResult] = useS(null);      // grade do card atual { verdict, score, feedback, missing, ideal }
  const [scores, setScores] = useS({});         // cardId -> { score, verdict }
  const [finished, setFinished] = useS(false);
  const [err, setErr] = useS(null);
  const inputRef = useR(null);

  const total = order.length;
  const safePos = Math.min(pos, Math.max(0, total - 1));
  const card = cards[order[safePos]];

  function runWith(ord) { setOrder(ord); setPos(0); setAnswer(""); setResult(null); setScores({}); setFinished(false); setErr(null); }
  useE(() => { runWith(cards.map((_, i) => i)); }, [cards]); // eslint-disable-line react-hooks/exhaustive-deps
  useE(() => { setResult(null); setErr(null); if (!finished) setTimeout(() => inputRef.current?.focus(), 20); }, [safePos, finished]);

  async function corrigir() {
    if (!card || !answer.trim() || grading) return;
    setGrading(true); setErr(null);
    try {
      const g = await api.gradeFlashcard(saasId, card.id, answer.trim());
      setResult(g);
      setScores((s) => ({ ...s, [card.id]: { score: g.score, verdict: g.verdict } }));
    } catch (e) {
      setErr(e.message || "falha ao corrigir");
    }
    setGrading(false);
  }
  function next() {
    setResult(null); setAnswer(""); setErr(null);
    if (safePos >= total - 1) setFinished(true);
    else setPos((p) => p + 1);
  }
  function shuffle() {
    const a = [...order];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    runWith(a);
  }

  const btn = { height: 32, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, cursor: "pointer" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const graded = Object.keys(scores).length;
  const avg = graded ? Math.round(Object.values(scores).reduce((s, x) => s + x.score, 0) / graded) : 0;

  if (cards.length === 0) return <EmptyState title="Sem flashcards nesta vaga" hint="Vá em Editar pra criar os primeiros cards." />;
  if (!aiOn) return (
    <div style={{ border: "1px solid var(--warn)", background: "var(--warn-soft)", borderRadius: "var(--r-3)", padding: "16px 18px", maxWidth: 640 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--warn)", marginBottom: 4 }}>Correção automática indisponível</div>
      <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>O treino digitado precisa da IA pra corrigir a resposta. Configure <span className="mono">OPENROUTER_API_KEY</span> (ou <span className="mono">ANTHROPIC_API_KEY</span>) no servidor. Enquanto isso, os cards podem ser lidos/editados na aba Editar.</div>
    </div>
  );

  // Resumo da sessão — a validação: nota média e o que revisar.
  if (finished) {
    const pct = avg;
    const tone = pct >= 80 ? "var(--pos)" : pct >= 50 ? "var(--warn)" : "var(--neg)";
    const weak = order.map((i) => cards[i]).filter((c) => c && scores[c.id] && scores[c.id].verdict !== "correto");
    const counts = { correto: 0, parcial: 0, incorreto: 0 };
    for (const v of Object.values(scores)) counts[v.verdict] = (counts[v.verdict] || 0) + 1;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "20px 22px" }}>
          <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Resultado do treino · {roleLabel}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 700, color: tone }}>{pct}</span>
            <span style={{ fontSize: 15, color: "var(--fg-2)" }}>nota média em {graded} de {total} cards</span>
          </div>
          <div className="mono dim" style={{ fontSize: 11.5, marginTop: 8 }}>
            <span style={{ color: "var(--pos)" }}>{counts.correto} corretos</span> · <span style={{ color: "var(--warn)" }}>{counts.parcial} parciais</span> · <span style={{ color: "var(--neg)" }}>{counts.incorreto} incorretos</span>
          </div>
        </div>
        {weak.length > 0 && (
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
            <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Pra reforçar ({weak.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {weak.map((c) => <div key={c.id} style={{ fontSize: 12.5, color: "var(--fg-2)", paddingLeft: 12, borderLeft: `2px solid ${VERDICT[scores[c.id].verdict]?.color || "var(--neg)"}` }}>{c.front}</div>)}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {weak.length > 0 && (
            <button onClick={() => runWith(order.filter((i) => cards[i] && scores[cards[i].id] && scores[cards[i].id].verdict !== "correto"))}
              style={{ ...btn, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600 }}>
              treinar de novo os {weak.length} fracos →
            </button>
          )}
          <button onClick={() => runWith(cards.map((_, i) => i))} style={btn}>↺ recomeçar</button>
          <button onClick={shuffle} style={btn}>⤨ embaralhar</button>
        </div>
      </div>
    );
  }

  const v = result ? VERDICT[result.verdict] || VERDICT.incorreto : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className="mono tnum" style={{ fontSize: 12, color: "var(--fg-3)" }}>{safePos + 1} / {total}</span>
        {graded > 0 && <span className="mono tnum" style={{ fontSize: 11.5, color: "var(--fg-3)" }}>nota média {avg}</span>}
        <span style={{ flex: 1 }} />
        <button onClick={shuffle} style={btn}>⤨ embaralhar</button>
      </div>

      {/* Pergunta */}
      <div style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", boxShadow: "var(--shadow-2)", padding: "20px 22px" }}>
        <div className="mono" style={{ ...kicker, marginBottom: 10 }}>{roleLabel} · pergunta</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.4, fontFamily: "var(--display)", color: "var(--fg-1)", whiteSpace: "pre-wrap" }}>{card.front}</div>
      </div>

      {/* Resposta digitada + correção */}
      {!result ? (
        <>
          <textarea ref={inputRef} value={answer} onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); corrigir(); } }}
            rows={4} placeholder="Digite sua resposta com suas palavras… (⌘/Ctrl+Enter corrige)"
            style={{ width: "100%", padding: "12px 14px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 14, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
          {err && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{err}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono dim" style={{ fontSize: 10.5 }}>a IA corrige comparando com o gabarito · sem colar do gabarito 😉</span>
            <span style={{ flex: 1 }} />
            <button onClick={corrigir} disabled={!answer.trim() || grading}
              style={{ ...btn, background: answer.trim() && !grading ? "var(--accent)" : "var(--bg-2)", color: answer.trim() && !grading ? "var(--accent-fg)" : "var(--fg-4)", border: "1px solid " + (answer.trim() && !grading ? "var(--accent)" : "var(--line-2)"), fontWeight: 600 }}>
              {grading ? "corrigindo…" : "corrigir resposta"}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Veredito + nota + feedback */}
          <div style={{ border: `1px solid ${v.color}`, background: v.bg, borderRadius: "var(--r-3)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: v.color }}>{v.label}</span>
              <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700, color: v.color }}>{result.score}</span>
              <span className="mono dim" style={{ fontSize: 10.5 }}>/ 100</span>
            </div>
            {result.feedback && <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.5 }}>{result.feedback}</div>}
            {result.missing && <div style={{ fontSize: 12, color: "var(--fg-2)" }}><b>Faltou:</b> {result.missing}</div>}
          </div>
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "12px 14px" }}>
            <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Resposta ideal (gabarito)</div>
            <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{result.ideal}</div>
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 8 }}>sua resposta: {answer}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1 }} />
            <button onClick={next} style={{ ...btn, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600 }}>
              {safePos >= total - 1 ? "ver resultado →" : "próximo →"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Editar ───────────────────────────────────────────────────────────────────
function EditMode({ cards, onPatch, onAdd, onRemove, roleLabel }) {
  const cap = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 3 };
  const area = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.4, resize: "vertical", fontFamily: "inherit" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 820 }}>
      <div className="mono dim" style={{ fontSize: 11 }}>{cards.length} card{cards.length === 1 ? "" : "s"} em {roleLabel} · frente = pergunta/gatilho · verso = resposta/técnica</div>
      {cards.map((c, i) => (
        <div key={c.id} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <span className="mono tnum" style={{ fontSize: 11, color: "var(--fg-4)" }}>#{i + 1}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => onRemove(c.id)} title="remover card" className="mono dim" style={{ fontSize: 13 }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            <label><span style={cap}>Frente · pergunta</span>
              <textarea rows={2} value={c.front} onChange={(e) => onPatch(c.id, "front", e.target.value)} placeholder="ex.: Objeção: 'tá caro'" style={area} /></label>
            <label><span style={cap}>Verso · resposta</span>
              <textarea rows={2} value={c.back} onChange={(e) => onPatch(c.id, "back", e.target.value)} placeholder="a técnica / resposta ideal" style={area} /></label>
          </div>
        </div>
      ))}
      <button onClick={onAdd} style={{ alignSelf: "flex-start", height: 30, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px dashed var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12 }}>
        ＋ adicionar card em {roleLabel}
      </button>
      <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>as alterações valem pra TODO o time do produto quando você clica em salvar (no topo). Cada vaga tem seu próprio baralho.</div>
    </div>
  );
}

export { TrainingScreen };
