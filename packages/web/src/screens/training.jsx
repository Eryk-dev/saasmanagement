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
      setCards(d.cards || []); setLabels(d.roleLabels || {}); setOrig(JSON.stringify(d.cards || []));
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
              ? <StudyMode key={role} cards={roleCards} roleLabel={labels[role] || role} />
              : <EditMode cards={roleCards} onPatch={patchCard} onAdd={addCard} onRemove={removeCard} roleLabel={labels[role] || role} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Estudar ──────────────────────────────────────────────────────────────────
// Flashcard é auto-avaliação: o treinando tenta responder, VIRA o card pra ver a
// resposta certa e marca "acertei" ou "errei". O placar da sessão e o resumo
// final (com os que errou pra revisar) é a validação do treino.
function StudyMode({ cards, roleLabel }) {
  const [order, setOrder] = useS(() => cards.map((_, i) => i)); // deck (índices em cards)
  const [pos, setPos] = useS(0);
  const [flipped, setFlipped] = useS(false);
  const [results, setResults] = useS({}); // cardId -> "right" | "wrong"
  const [finished, setFinished] = useS(false);

  const total = order.length;
  const safePos = Math.min(pos, Math.max(0, total - 1));
  const card = cards[order[safePos]];
  const right = order.filter((i) => results[cards[i]?.id] === "right").length;
  const wrong = order.filter((i) => results[cards[i]?.id] === "wrong").length;

  function runWith(ord) { setOrder(ord); setPos(0); setFlipped(false); setResults({}); setFinished(false); }
  useE(() => { runWith(cards.map((_, i) => i)); }, [cards]); // eslint-disable-line react-hooks/exhaustive-deps

  function grade(ok) {
    if (!card) return;
    setResults((r) => ({ ...r, [card.id]: ok ? "right" : "wrong" }));
    setFlipped(false);
    if (safePos >= total - 1) setFinished(true);
    else setPos((p) => p + 1);
  }
  function prev() { setFlipped(false); setPos((p) => Math.max(0, p - 1)); }
  function shuffle() {
    const a = [...order];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    runWith(a);
  }
  function reviewWrong() {
    const w = order.filter((i) => results[cards[i]?.id] === "wrong");
    if (w.length) runWith(w);
  }

  useE(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || finished) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (flipped && (e.key === "1" || e.key.toLowerCase() === "j")) { e.preventDefault(); grade(false); }
      else if (flipped && (e.key === "2" || e.key.toLowerCase() === "k")) { e.preventDefault(); grade(true); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const btn = { height: 32, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, cursor: "pointer" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };

  if (cards.length === 0) return <EmptyState title="Sem flashcards nesta vaga" hint="Vá em Editar pra criar os primeiros cards." />;

  // Resumo da sessão — a validação: quantos acertou e o que revisar.
  if (finished) {
    const pct = total ? Math.round((right / total) * 100) : 0;
    const tone = pct >= 80 ? "var(--pos)" : pct >= 50 ? "var(--warn)" : "var(--neg)";
    const wrongCards = order.filter((i) => results[cards[i]?.id] === "wrong").map((i) => cards[i]);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "20px 22px" }}>
          <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Resultado da sessão · {roleLabel}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 700, color: tone }}>{pct}%</span>
            <span style={{ fontSize: 15, color: "var(--fg-2)" }}>{right} de {total} corretos</span>
          </div>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--bg-3)", marginTop: 12, gap: 2 }}>
            <div style={{ width: `${(right / total) * 100}%`, background: "var(--pos)" }} />
            <div style={{ width: `${(wrong / total) * 100}%`, background: "var(--neg)" }} />
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>✓ {right} acertos · ✗ {wrong} erros</div>
        </div>

        {wrongCards.length > 0 && (
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
            <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Pra revisar ({wrongCards.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {wrongCards.map((c) => <div key={c.id} style={{ fontSize: 12.5, color: "var(--fg-2)", paddingLeft: 12, borderLeft: "2px solid var(--neg)" }}>{c.front}</div>)}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {wrongCards.length > 0 && (
            <button onClick={reviewWrong} style={{ ...btn, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600 }}>
              revisar os {wrongCards.length} que errei →
            </button>
          )}
          <button onClick={() => runWith(cards.map((_, i) => i))} style={btn}>↺ recomeçar</button>
          <button onClick={shuffle} style={btn}>⤨ embaralhar e recomeçar</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className="mono tnum" style={{ fontSize: 12, color: "var(--fg-3)" }}>{safePos + 1} / {total}</span>
        <span className="mono tnum" style={{ fontSize: 11.5 }}><span style={{ color: "var(--pos)" }}>✓ {right}</span> <span style={{ color: "var(--neg)", marginLeft: 6 }}>✗ {wrong}</span></span>
        <span style={{ flex: 1 }} />
        <button onClick={shuffle} style={btn}>⤨ embaralhar</button>
      </div>

      {/* O card */}
      <button onClick={() => setFlipped((f) => !f)} title="clique pra virar (Espaço)"
        style={{
          minHeight: 240, borderRadius: "var(--r-3)", textAlign: "left", cursor: "pointer",
          border: "1px solid " + (flipped ? "var(--accent-line)" : "var(--line-2)"),
          background: flipped ? "var(--accent-soft)" : "var(--bg-1)",
          boxShadow: "var(--shadow-2)", padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12,
          transition: "background 140ms ease, border-color 140ms ease",
        }}>
        <div className="mono" style={{ ...kicker, color: flipped ? "var(--accent)" : "var(--fg-4)" }}>
          {roleLabel} · {flipped ? "verso · resposta certa" : "frente · pergunta"}
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: flipped ? 17 : 22, fontWeight: flipped ? 500 : 700, lineHeight: 1.4, fontFamily: flipped ? "var(--sans)" : "var(--display)", color: "var(--fg-1)", whiteSpace: "pre-wrap" }}>
            {flipped ? (card.back || "(sem resposta cadastrada)") : card.front}
          </div>
        </div>
        <div className="mono dim" style={{ fontSize: 10.5 }}>{flipped ? "compare com a sua resposta e marque abaixo" : "responda de cabeça, depois clique pra conferir"}</div>
      </button>

      {/* Auto-avaliação: só aparece depois de revelar a resposta */}
      {flipped ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={prev} disabled={safePos === 0} style={{ ...btn, opacity: safePos === 0 ? 0.5 : 1 }}>← anterior</button>
          <span style={{ flex: 1 }} />
          <button onClick={() => grade(false)} style={{ ...btn, borderColor: "var(--neg)", color: "var(--neg)", background: "var(--neg-soft)", fontWeight: 600 }}>✗ errei</button>
          <button onClick={() => grade(true)} style={{ ...btn, borderColor: "var(--pos)", color: "#fff", background: "var(--pos)", fontWeight: 600 }}>✓ acertei</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={prev} disabled={safePos === 0} style={{ ...btn, opacity: safePos === 0 ? 0.5 : 1 }}>← anterior</button>
          <span style={{ flex: 1 }} />
          <button onClick={() => setFlipped(true)} style={{ ...btn, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600 }}>ver resposta</button>
        </div>
      )}
      <div className="mono dim" style={{ fontSize: 10.5 }}>atalhos: Espaço vira · 1 errei · 2 acertei · ← anterior</div>
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
