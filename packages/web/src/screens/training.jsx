import React from "react";
import { PageHead, Segmented } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { FocusShell } from "./training-focus.jsx";

// Treinamentos — flashcards estilo Anki com repetição espaçada (FSRS) POR
// PESSOA. Três modos: ESTUDAR (baralhos da sua vaga com contadores novo/
// aprendendo/revisar → sessão de virar o card e se avaliar em 4 botões),
// EDITAR (a base oficial do time, por vaga) e EQUIPE (quem está em dia).
// A sessão tem MODO FOCO: tela cheia escura com glow e áudio ambiente
// (training-focus.jsx) — mesma fila e estado, só muda a concha e os tamanhos.

const { useState: useS, useEffect: useE, useRef: useR } = React;
const uid = () => `card_${Math.random().toString(36).slice(2, 9)}`;

// Cores dos três contadores, iguais ao Anki: novo azul, aprendendo laranja,
// revisar verde.
const COUNT = [
  { key: "new", label: "novo", color: "var(--accent)" },
  { key: "learning", label: "aprendendo", color: "var(--warn)" },
  { key: "review", label: "revisar", color: "var(--pos)" },
];

// 4 botões do Anki: Errei volta em minutos; Fácil espaça dias.
const RATINGS = [
  { rating: 1, label: "Errei", color: "var(--neg)", bg: "var(--neg-soft)" },
  { rating: 2, label: "Difícil", color: "var(--warn)", bg: "var(--warn-soft)" },
  { rating: 3, label: "Bom", color: "var(--pos)", bg: "var(--pos-soft)" },
  { rating: 4, label: "Fácil", color: "var(--accent)", bg: "var(--accent-soft)" },
];

const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
const btn = { height: 32, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, cursor: "pointer" };

function TrainingScreen() {
  const [product] = useActiveSaas();
  const [mode, setMode] = useS("study"); // study | edit | team

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {mode === "study" && <Study key={product?.id} saasId={product?.id} mode={mode} setMode={setMode} />}
      {mode === "edit" && <Edit key={product?.id} saasId={product?.id} mode={mode} setMode={setMode} />}
      {mode === "team" && <Team key={product?.id} saasId={product?.id} mode={mode} setMode={setMode} />}
    </div>
  );
}

const MODES = [{ value: "study", label: "Estudar" }, { value: "edit", label: "Editar" }, { value: "team", label: "Equipe" }];

function Head({ mode, setMode, children }) {
  return (
    <PageHead title="Treinamentos" sub="flashcards com repetição espaçada (FSRS) · sua fila é só sua">
      {children}
      <Segmented value={mode} onChange={setMode} options={MODES} />
    </PageHead>
  );
}

// ── Estudar: baralhos → sessão (normal ou em foco) ───────────────────────────
function Study({ saasId, mode, setMode }) {
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);
  const [session, setSession] = useS(null); // role em sessão
  const [focus, setFocus] = useS(false);

  function load() {
    if (!saasId) return;
    setErr(null);
    api.trainingQueue(saasId).then(setData).catch((e) => setErr(e.message));
  }
  useE(load, [saasId]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => {
    if (err) return <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>;
    if (!data) return <div className="mono dim" style={{ fontSize: 12 }}>montando sua fila…</div>;
    if (session) {
      const deck = data.decks.find((d) => d.role === session);
      return <Session saasId={saasId} label={deck?.label || session} dayEnd={data.dayEnd}
        cards={data.queue[session] || []} focus={focus} onToggleFocus={() => setFocus((f) => !f)}
        onExit={() => { setSession(null); setFocus(false); load(); }} />;
    }
    if (!data.decks.length) return <EmptyState title="Nenhum baralho pra você" hint="Peça pro gestor te dar uma vaga (SDR/closer/…) em Ajustes → Usuários." />;
    return (
      <>
        <DeckList decks={data.decks} newPerDay={data.newPerDay}
          onStudy={(role, foco) => { setSession(role); setFocus(!!foco); }} />
        <ConsistencyCard saasId={saasId} />
      </>
    );
  };

  return (
    <>
      <Head mode={mode} setMode={setMode} />
      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
        {body()}
      </div>
    </>
  );
}

function DeckList({ decks, newPerDay, onStudy }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
      {decks.map((d) => {
        const total = d.counts.new + d.counts.learning + d.counts.review;
        return (
          <div key={d.role} style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 18px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-1)" }}>{d.label}</div>
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>{d.total} card{d.total === 1 ? "" : "s"} no baralho</div>
            </div>
            {COUNT.map((c) => (
              <div key={c.key} style={{ textAlign: "center", minWidth: 64 }}>
                <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 700, color: d.counts[c.key] ? c.color : "var(--fg-4)" }}>{d.counts[c.key]}</div>
                <div className="mono" style={{ ...kicker }}>{c.label}</div>
              </div>
            ))}
            {total > 0 ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onStudy(d.role, true)} title="modo foco: tela cheia + áudio ambiente"
                  style={{ ...btn, fontFamily: "var(--mono)", fontSize: 12 }}>◐ foco</button>
                <button onClick={() => onStudy(d.role, false)}
                  style={{ ...btn, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600 }}>
                  Estudar →
                </button>
              </div>
            ) : (
              <span className="mono" style={{ fontSize: 11.5, color: "var(--pos)" }}>✓ em dia</span>
            )}
          </div>
        );
      })}
      <div className="mono dim" style={{ fontSize: 10.5 }}>até {newPerDay} cards novos por baralho por dia · o que você erra volta mais cedo, o que acerta espaça · muda o limite em Editar</div>
    </div>
  );
}

// ── Sessão (o coração do Anki): frente → virar → 1-4 ─────────────────────────
// Com focus=true a MESMA sessão (mesma fila, mesmo estado) veste a FocusShell:
// tela cheia escura, card maior, textos fora do card em branco translúcido —
// vars de tema só DENTRO de superfícies (--bg-1), que funcionam nos 2 temas.
function Session({ saasId, label, cards, dayEnd, onExit, focus, onToggleFocus }) {
  const [queue, setQueue] = useS(cards);
  const [flipped, setFlipped] = useS(false);
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS(null);
  const [tally, setTally] = useS({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const card = queue[0];

  async function rate(rating) {
    if (!card || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.trainingReview(saasId, card.entryId || card.id, rating);
      setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
      setQueue((q) => {
        const rest = q.slice(1);
        // aprendendo com due ainda hoje volta NESTA sessão (learning steps do Anki)
        if (new Date(r.srs.due) <= new Date(dayEnd)) rest.push({ ...card, srs: r.srs, preview: r.preview });
        return rest;
      });
      setFlipped(false);
    } catch (e) { setErr(e.message || "falha ao salvar a revisão"); }
    setBusy(false);
  }

  // Atalhos do Anki: espaço/enter vira; 1-4 avalia. Esc é da FocusShell.
  useE(() => {
    function onKey(e) {
      if (e.target?.tagName === "TEXTAREA" || e.target?.tagName === "INPUT") return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!flipped && card) setFlipped(true); }
      else if (flipped && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); rate(Number(e.key)); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = { new: 0, learning: 0, review: 0 };
  for (const c of queue) {
    if (!c.srs || c.srs.state === 0) counts.new++;
    else if (c.srs.state === 2) counts.review++;
    else counts.learning++;
  }
  const done = tally[1] + tally[2] + tally[3] + tally[4];
  const inkDim = "rgba(255,255,255,0.5)"; // textos soltos sobre o preto do foco

  let body;
  if (!card) {
    const good = tally[3] + tally[4];
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 640 }}>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "20px 22px" }}>
          <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Sessão concluída · {label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 700, color: "var(--pos)" }}>{done}</span>
            <span style={{ fontSize: 15, color: "var(--fg-2)" }}>revisões · {done ? Math.round((good / done) * 100) : 0}% bem lembradas</span>
          </div>
          <div className="mono dim" style={{ fontSize: 11.5, marginTop: 8 }}>
            {RATINGS.map((r) => <span key={r.rating} style={{ marginRight: 12, color: tally[r.rating] ? r.color : "var(--fg-4)" }}>{tally[r.rating]} {r.label.toLowerCase()}</span>)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 10, lineHeight: 1.5 }}>Fila de hoje zerada — o FSRS traz cada card de volta na hora certa. Volte amanhã.</div>
        </div>
        <ConsistencyCard saasId={saasId} />
        <button onClick={onExit} style={{ ...btn, alignSelf: "flex-start", ...(focus ? { background: "transparent", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.2)" } : {}) }}>← voltar aos baralhos</button>
      </div>
    );
  } else {
    const bucket = !card.srs || card.srs.state === 0 ? "new" : card.srs.state === 2 ? "review" : "learning";
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: focus ? 16 : 12, width: "100%", maxWidth: focus ? 760 : 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: focus ? "center" : "flex-start" }}>
          {!focus && <button onClick={onExit} className="mono dim" style={{ fontSize: 12 }}>← baralhos</button>}
          {!focus && <span style={{ flex: 1 }} />}
          {COUNT.map((c) => (
            <span key={c.key} className="mono tnum" title={c.label}
              style={{ fontSize: 12, color: focus ? inkDim : c.color, textDecoration: bucket === c.key ? "underline" : "none", opacity: counts[c.key] ? 1 : 0.35 }}>
              {counts[c.key]}
            </span>
          ))}
          <span className="mono tnum" style={{ fontSize: 11.5, color: focus ? inkDim : "var(--fg-3)" }}>· {done} feitas</span>
          {!focus && <button onClick={onToggleFocus} title="modo foco: tela cheia + áudio ambiente" className="mono dim" style={{ fontSize: 12, cursor: "pointer" }}>◐ foco</button>}
        </div>

        {/* O card */}
        <div onClick={() => !flipped && setFlipped(true)}
          style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)",
            boxShadow: focus ? "0 24px 90px rgba(0,0,0,0.55)" : "var(--shadow-2)",
            padding: focus ? "34px 34px 28px" : "26px 26px 22px", minHeight: focus ? 220 : 180,
            display: "flex", flexDirection: "column", gap: 14, cursor: flipped ? "default" : "pointer" }}>
          <div className="mono" style={kicker}>{label} · {bucket === "new" ? "card novo" : bucket === "review" ? "revisão" : "aprendendo"}{card.sub ? ` · ${card.sub}` : ""}</div>
          <CardFace card={card} flipped={flipped} focus={focus} />
        </div>

        {err && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{err}</div>}

        {!flipped ? (
          <button onClick={() => setFlipped(true)}
            style={{ ...btn, height: focus ? 48 : 40, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600, fontSize: focus ? 14.5 : 13.5 }}>
            Mostrar resposta <span style={{ opacity: 0.7, fontWeight: 400 }}>(espaço)</span>
          </button>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {RATINGS.map((r) => (
              <button key={r.rating} onClick={() => rate(r.rating)} disabled={busy}
                style={{ height: focus ? 58 : 52, borderRadius: "var(--r-2)", border: `1px solid ${r.color}`, background: r.bg, color: r.color, fontWeight: 700, fontSize: focus ? 15 : 13.5, cursor: "pointer", opacity: busy ? 0.6 : 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                <span>{r.label} <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 10.5 }}>({r.rating})</span></span>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.8 }}>{card.preview?.[r.rating] || ""}</span>
              </button>
            ))}
          </div>
        )}
        {!focus && <div className="mono dim" style={{ fontSize: 10.5 }}>seja honesto com você: o algoritmo só funciona se o clique refletir o que você lembrou de verdade</div>}
      </div>
    );
  }

  return focus ? <FocusShell onExit={onToggleFocus}>{body}</FocusShell> : body;
}

// ── Faces do card por tipo ────────────────────────────────────────────────────
// basic: texto ± imagem · cloze: deleção alvo escondida na frente ({{c1::…}},
// formato do Anki) · occlusion: imagem com a máscara ALVO tapada; virar revela.
const CLOZE_RE = /\{\{c(\d+)::(.*?)\}\}/gs;

function renderCloze(text, sub, revealed) {
  const target = Number(String(sub || "").slice(1)); // "c1" → 1
  const out = [];
  let last = 0, k = 0;
  for (const m of String(text || "").matchAll(CLOZE_RE)) {
    out.push(text.slice(last, m.index));
    const [content, hint] = m[2].split("::");
    if (Number(m[1]) === target) {
      out.push(revealed
        ? <span key={k++} style={{ color: "var(--accent)", fontWeight: 800 }}>{content}</span>
        : <span key={k++} style={{ color: "var(--accent)", fontWeight: 800 }}>[{hint || "…"}]</span>);
    } else {
      out.push(content);
    }
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function OcclusionView({ card, flipped, focus }) {
  const pct = (v) => `${v * 100}%`;
  return (
    <div style={{ position: "relative", alignSelf: "flex-start", maxWidth: "100%" }}>
      <img src={api.trainingAssetUrl(card.image)} alt="" draggable={false}
        style={{ maxWidth: "100%", maxHeight: focus ? 380 : 300, display: "block", borderRadius: 6 }} />
      {(card.masks || []).filter((m) => m.id === card.sub).map((m) => (
        <div key={m.id} style={{
          position: "absolute", left: pct(m.x), top: pct(m.y), width: pct(m.w), height: pct(m.h),
          background: flipped ? "transparent" : "var(--accent)",
          border: "2.5px solid var(--accent)", borderRadius: 4, boxSizing: "border-box",
        }} />
      ))}
    </div>
  );
}

function CardFace({ card, flipped, focus }) {
  const front = { fontSize: focus ? 26 : 21, fontWeight: 700, lineHeight: 1.45, fontFamily: "var(--display)", color: "var(--fg-1)", whiteSpace: "pre-wrap" };
  const back = { fontSize: focus ? 16.5 : 15, color: "var(--fg-1)", lineHeight: 1.55, whiteSpace: "pre-wrap" };
  const divider = <div style={{ borderTop: "1px solid var(--line-1)" }} />;
  const img = card.image && card.type !== "occlusion"
    ? <img src={api.trainingAssetUrl(card.image)} alt="" style={{ maxWidth: "100%", maxHeight: focus ? 320 : 240, borderRadius: 6, alignSelf: "flex-start" }} />
    : null;

  if (card.type === "cloze") {
    return (<>
      <div style={front}>{renderCloze(card.front, card.sub, flipped)}</div>
      {img}
      {flipped && card.back?.trim() && <>{divider}<div style={back}>{card.back}</div></>}
    </>);
  }
  if (card.type === "occlusion") {
    return (<>
      {card.front?.trim() && <div style={{ ...front, fontSize: focus ? 18 : 15.5 }}>{card.front}</div>}
      <OcclusionView card={card} flipped={flipped} focus={focus} />
      {flipped && card.back?.trim() && <>{divider}<div style={back}>{card.back}</div></>}
    </>);
  }
  return (<>
    <div style={front}>{card.front}</div>
    {img}
    {flipped && <>{divider}<div style={back}>{card.back}</div></>}
  </>);
}

// ── Consistência: streak + heatmap de revisões (estilo GitHub) ───────────────
function ConsistencyCard({ saasId }) {
  const [s, setS] = useS(null);
  useE(() => {
    let alive = true;
    api.trainingStats(saasId).then((d) => alive && setS(d)).catch(() => { /* widget é opcional */ });
    return () => { alive = false; };
  }, [saasId]);
  if (!s) return null;
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "16px 18px", maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="mono" style={kicker}>Consistência</span>
        <span style={{ flex: 1 }} />
        <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, color: s.streak ? "var(--accent)" : "var(--fg-4)" }}>{s.streak}</span>
        <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>dia{s.streak === 1 ? "" : "s"} seguido{s.streak === 1 ? "" : "s"}</span>
        <span className="mono dim" style={{ fontSize: 11 }}>· melhor {s.bestStreak}d · hoje {s.doneToday}</span>
      </div>
      <Heatmap days={s.days} today={s.today} />
    </div>
  );
}

// Escala sequencial num matiz só (o accent do produto): superfície → accent.
// Intensidade = revisões do dia relativas ao máximo da própria pessoa.
const HEAT = [
  "var(--bg-inset)",
  "color-mix(in oklab, var(--accent) 28%, var(--bg-1))",
  "color-mix(in oklab, var(--accent) 50%, var(--bg-1))",
  "color-mix(in oklab, var(--accent) 74%, var(--bg-1))",
  "var(--accent)",
];
const DOW_LABELS = { 1: "seg", 3: "qua", 5: "sex" };

function Heatmap({ days, today }) {
  // 26 colunas de semanas (dom–sáb) terminando hoje. As chaves já são "dias
  // de estudo" (fuso SP, virada 4h) — a aritmética aqui é toda em UTC puro.
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 25 * 7);
  const max = Math.max(1, ...Object.values(days || {}));
  const weeks = [];
  let prevMonth = -1;
  for (let w = 0; w < 26; w++) {
    const first = new Date(start); first.setUTCDate(start.getUTCDate() + w * 7);
    const month = first.getUTCMonth();
    const label = month !== prevMonth ? first.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "") : "";
    prevMonth = month;
    const cells = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(start); d.setUTCDate(start.getUTCDate() + w * 7 + dow);
      if (d > end) { cells.push(null); continue; }
      const key = d.toISOString().slice(0, 10);
      const count = days?.[key] || 0;
      cells.push({ key, count, level: count ? Math.ceil((count / max) * 4) : 0,
        title: `${count} revis${count === 1 ? "ão" : "ões"} · ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}` });
    }
    weeks.push({ label, cells });
  }
  const cell = { width: 11, height: 11, borderRadius: 3 };
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "inline-flex", gap: 3 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 17, marginRight: 3 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
            <div key={dow} className="mono" style={{ ...cell, width: 24, fontSize: 8.5, color: "var(--fg-4)", display: "flex", alignItems: "center" }}>{DOW_LABELS[dow] || ""}</div>
          ))}
        </div>
        {weeks.map((wk, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div className="mono" style={{ height: 14, fontSize: 8.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{wk.label}</div>
            {wk.cells.map((c, j) => c ? (
              <div key={j} title={c.title} style={{ ...cell, background: HEAT[c.level], border: c.level === 0 ? "1px solid var(--line-1)" : "1px solid transparent" }} />
            ) : <div key={j} style={{ ...cell, background: "transparent" }} />)}
          </div>
        ))}
      </div>
      <div className="mono dim" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, marginTop: 8 }}>
        menos
        {HEAT.map((h, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 3, display: "inline-block", background: h, border: i === 0 ? "1px solid var(--line-1)" : "1px solid transparent" }} />)}
        mais
      </div>
    </div>
  );
}

// ── Editar: a base oficial do time ───────────────────────────────────────────
const ROLE_ORDER = ["sdr", "closer", "integrator", "social"];

function Edit({ saasId, mode, setMode }) {
  const [cards, setCards] = useS(null);
  const [labels, setLabels] = useS({});
  const [settings, setSettings] = useS({ newPerDay: 10 });
  const [orig, setOrig] = useS(null);
  const [role, setRole] = useS("sdr");
  const [err, setErr] = useS(null);
  const [saving, setSaving] = useS(false);
  const [note, setNote] = useS(null);

  useE(() => {
    if (!saasId) return;
    let alive = true;
    setCards(null); setErr(null); setNote(null);
    api.flashcards(saasId).then((d) => {
      if (!alive) return;
      setCards(d.cards || []); setLabels(d.roleLabels || {}); setSettings(d.settings || { newPerDay: 10 });
      setOrig(JSON.stringify({ cards: d.cards || [], settings: d.settings }));
      const first = ROLE_ORDER.find((r) => (d.cards || []).some((c) => c.role === r));
      if (first) setRole(first);
    }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [saasId]);

  const dirty = cards && JSON.stringify({ cards, settings }) !== orig;
  const rolesPresent = ROLE_ORDER.filter((r) => (cards || []).some((c) => c.role === r));
  const roleTabs = [...new Set([...rolesPresent, "sdr", "closer"])].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  const roleCards = (cards || []).filter((c) => c.role === role);

  async function save() {
    setSaving(true); setNote(null);
    try {
      const r = await api.saveFlashcards(saasId, cards, settings);
      setCards(r.cards); setSettings(r.settings); setOrig(JSON.stringify({ cards: r.cards, settings: r.settings }));
      setNote({ ok: true, text: "base salva pro time — cards novos entram como 'novo' pra cada um" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setSaving(false);
  }
  function reset() { if (orig) { const o = JSON.parse(orig); setCards(o.cards); setSettings(o.settings || { newPerDay: 10 }); } }
  function patchCard(id, field, value) { setCards((p) => p.map((c) => (c.id === id ? { ...c, [field]: value } : c))); }
  function addCard() { setCards((p) => [...(p || []), { id: uid(), role, front: "", back: "" }]); }
  function removeCard(id) { setCards((p) => p.filter((c) => c.id !== id)); }

  return (
    <>
      <Head mode={mode} setMode={setMode}>
        {dirty && (
          <>
            <button onClick={reset} disabled={saving} className="mono dim" style={{ fontSize: 11.5 }}>descartar</button>
            <button onClick={save} disabled={saving}
              style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "salvando…" : "salvar"}
            </button>
          </>
        )}
      </Head>
      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {!cards && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando flashcards…</div>}
        {cards && (
          <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
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
              <span style={{ flex: 1 }} />
              <label className="mono dim" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}>
                novos/dia
                <input type="number" min={0} max={200} value={settings.newPerDay}
                  onChange={(e) => setSettings((s) => ({ ...s, newPerDay: Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0))) }))}
                  style={{ width: 58, height: 26, padding: "0 8px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12 }} />
              </label>
            </div>
            <EditCards cards={roleCards} saasId={saasId} onPatch={patchCard} onAdd={addCard} onRemove={removeCard} roleLabel={labels[role] || role} />
          </>
        )}
      </div>
    </>
  );
}

const capStyle = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 3 };
const areaStyle = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.4, resize: "vertical", fontFamily: "inherit" };
const CARD_TYPES = [
  { id: "basic", label: "básico" },
  { id: "cloze", label: "cloze" },
  { id: "occlusion", label: "oclusão" },
];

function EditCards({ cards, saasId, onPatch, onAdd, onRemove, roleLabel }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 820 }}>
      <div className="mono dim" style={{ fontSize: 11 }}>{cards.length} card{cards.length === 1 ? "" : "s"} em {roleLabel} · básico (frente/verso) · cloze ({"{{c1::…}}"}) · oclusão de imagem · cole imagem com Ctrl+V em qualquer card</div>
      {cards.map((c, i) => <CardEditor key={c.id} card={c} index={i} saasId={saasId} onPatch={onPatch} onRemove={onRemove} />)}
      <button onClick={onAdd} style={{ alignSelf: "flex-start", height: 30, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px dashed var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12 }}>
        ＋ adicionar card em {roleLabel}
      </button>
      <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>a base é do TIME: card novo entra como "novo" pra todo mundo; card removido some pra todo mundo. O RITMO de cada pessoa (quando o card volta) é individual. Cloze e oclusão viram VÁRIOS sub-cards (um por deleção/máscara).</div>
    </div>
  );
}

function CardEditor({ card, index, saasId, onPatch, onRemove }) {
  const frontRef = useR(null);
  const type = card.type || "basic";
  const masks = card.masks || [];
  const subCount = type === "cloze"
    ? new Set([...String(card.front || "").matchAll(/\{\{c(\d+)::/g)].map((m) => m[1])).size
    : type === "occlusion" ? masks.length : 0;

  // Ctrl+V com imagem em qualquer campo do card anexa a imagem ao card.
  async function onPaste(e) {
    const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    try {
      const { id } = await api.trainingAsset(saasId, item.getAsFile());
      onPatch(card.id, "image", id);
    } catch { /* o ImageAttach mostra erro no upload manual */ }
  }

  // Envolve a seleção da frente em {{cN::…}} — N é o próximo índice livre.
  function markCloze() {
    const el = frontRef.current;
    if (!el) return;
    const front = card.front || "";
    const s = el.selectionStart ?? front.length, e = el.selectionEnd ?? front.length;
    const n = Math.max(0, ...[...front.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]))) + 1;
    const sel = front.slice(s, e) || "…";
    onPatch(card.id, "front", `${front.slice(0, s)}{{c${n}::${sel}}}${front.slice(e)}`);
  }

  return (
    <div onPaste={onPaste} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="mono tnum" style={{ fontSize: 11, color: "var(--fg-4)" }}>#{index + 1}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {CARD_TYPES.map((t) => (
            <button key={t.id} onClick={() => onPatch(card.id, "type", t.id)} className="mono"
              style={{ height: 22, padding: "0 9px", borderRadius: 11, fontSize: 10.5, cursor: "pointer",
                border: `1px solid ${type === t.id ? "var(--accent-line)" : "var(--line-2)"}`,
                background: type === t.id ? "var(--accent-soft)" : "transparent",
                color: type === t.id ? "var(--accent)" : "var(--fg-3)" }}>{t.label}</button>
          ))}
        </div>
        {subCount > 0 && <span className="mono dim" style={{ fontSize: 10.5 }}>{subCount} sub-card{subCount === 1 ? "" : "s"}</span>}
        <span style={{ flex: 1 }} />
        <button onClick={() => onRemove(card.id)} title="remover card" className="mono dim" style={{ fontSize: 13 }}>✕</button>
      </div>

      {type === "occlusion" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label><span style={capStyle}>Pergunta (opcional) · aparece acima da imagem</span>
            <textarea rows={1} value={card.front || ""} onChange={(e) => onPatch(card.id, "front", e.target.value)} placeholder="ex.: O que fica neste campo do CRM?" style={areaStyle} /></label>
          {card.image
            ? <OcclusionEditor card={card} onPatch={onPatch} />
            : <ImageAttach saasId={saasId} value={card.image} onChange={(id) => onPatch(card.id, "image", id)} hint="a oclusão precisa de uma imagem — cole (Ctrl+V) ou escolha o arquivo" />}
          <label><span style={capStyle}>Verso (opcional) · explicação extra ao virar</span>
            <textarea rows={1} value={card.back || ""} onChange={(e) => onPatch(card.id, "back", e.target.value)} style={areaStyle} /></label>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            <label><span style={capStyle}>{type === "cloze" ? <>Texto · marque deleções com {"{{c1::…}}"}</> : "Frente · pergunta"}</span>
              <textarea ref={frontRef} rows={type === "cloze" ? 3 : 2} value={card.front || ""} onChange={(e) => onPatch(card.id, "front", e.target.value)}
                placeholder={type === "cloze" ? "ex.: A escada é {{c1::anual}} → {{c2::semestral}} → {{c3::serviço único}}" : "ex.: Objeção: 'tá caro'"} style={areaStyle} /></label>
            <label><span style={capStyle}>{type === "cloze" ? "Verso (opcional) · contexto extra" : "Verso · resposta"}</span>
              <textarea rows={2} value={card.back || ""} onChange={(e) => onPatch(card.id, "back", e.target.value)} placeholder={type === "cloze" ? "" : "a técnica / resposta ideal"} style={areaStyle} /></label>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            {type === "cloze" && (
              <button onClick={markCloze} className="mono" style={{ height: 24, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px dashed var(--accent-line)", background: "transparent", color: "var(--accent)", fontSize: 10.5, cursor: "pointer" }}>
                marcar seleção como cloze
              </button>
            )}
            <ImageAttach saasId={saasId} value={card.image} onChange={(id) => onPatch(card.id, "image", id)} hint="imagem (opcional): cole com Ctrl+V ou escolha" compact />
          </div>
        </div>
      )}
    </div>
  );
}

function ImageAttach({ saasId, value, onChange, hint, compact }) {
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS(null);
  async function upload(file) {
    if (!file) return;
    setBusy(true); setErr(null);
    try { const { id } = await api.trainingAsset(saasId, file, file.name || "card.png"); onChange(id); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  if (value) {
    return (
      <div style={{ position: "relative", alignSelf: "flex-start" }}>
        <img src={api.trainingAssetUrl(value)} alt="" style={{ maxHeight: compact ? 120 : 220, maxWidth: "100%", borderRadius: 6, border: "1px solid var(--line-1)", display: "block" }} />
        <button onClick={() => onChange("")} title="remover imagem" className="mono"
          style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕</button>
      </div>
    );
  }
  return (
    <label className="mono dim" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 10.5, padding: compact ? "4px 10px" : "14px 16px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", cursor: "pointer" }}>
      {busy ? "enviando imagem…" : (err ? <span style={{ color: "var(--neg)" }}>{err}</span> : `🖼 ${hint}`)}
      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => upload(e.target.files?.[0])} />
    </label>
  );
}

// Desenhe retângulos sobre a imagem: cada máscara vira um sub-card (esconde
// só ela na frente; virar revela). Clique numa máscara pra apagar.
function OcclusionEditor({ card, onPatch }) {
  const boxRef = useR(null);
  const [draft, setDraft] = useS(null);
  const masks = card.masks || [];
  const pct = (v) => `${v * 100}%`;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const rel = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  function up() {
    if (!draft) return;
    const m = { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) };
    setDraft(null);
    if (m.w < 0.01 || m.h < 0.01) return;
    const next = Math.max(0, ...masks.map((x) => Number(String(x.id).slice(1)) || 0)) + 1;
    onPatch(card.id, "masks", [...masks, { id: `m${next}`, ...m }]);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignSelf: "flex-start", maxWidth: "100%" }}>
      <div ref={boxRef} onMouseDown={(e) => { e.preventDefault(); const p = rel(e); setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
        onMouseMove={(e) => { if (draft) { const p = rel(e); setDraft((d) => ({ ...d, x1: p.x, y1: p.y })); } }}
        onMouseUp={up} onMouseLeave={up}
        style={{ position: "relative", cursor: "crosshair", alignSelf: "flex-start", maxWidth: "100%" }}>
        <img src={api.trainingAssetUrl(card.image)} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: 340, display: "block", borderRadius: 6 }} />
        {masks.map((m) => (
          <div key={m.id} onMouseDown={(e) => e.stopPropagation()} onClick={() => onPatch(card.id, "masks", masks.filter((x) => x.id !== m.id))}
            title={`${m.id} — clique pra apagar`}
            style={{ position: "absolute", left: pct(m.x), top: pct(m.y), width: pct(m.w), height: pct(m.h), background: "color-mix(in oklab, var(--accent) 75%, transparent)", border: "2px solid var(--accent)", borderRadius: 4, boxSizing: "border-box", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span className="mono" style={{ fontSize: 9.5, color: "var(--accent-fg)", fontWeight: 700 }}>{m.id}</span>
          </div>
        ))}
        {draft && (
          <div style={{ position: "absolute", left: pct(Math.min(draft.x0, draft.x1)), top: pct(Math.min(draft.y0, draft.y1)), width: pct(Math.abs(draft.x1 - draft.x0)), height: pct(Math.abs(draft.y1 - draft.y0)), border: "2px dashed var(--accent)", borderRadius: 4, boxSizing: "border-box" }} />
        )}
      </div>
      <div className="mono dim" style={{ fontSize: 10 }}>arraste pra tapar uma área · cada máscara vira um sub-card · clique numa máscara pra apagar · <button onClick={() => onPatch(card.id, "image", "")} style={{ background: "none", border: "none", color: "var(--neg)", cursor: "pointer", fontSize: 10, fontFamily: "var(--mono)", padding: 0 }}>trocar imagem</button></div>
    </div>
  );
}

// ── Equipe: quem está em dia ─────────────────────────────────────────────────
function Team({ saasId, mode, setMode }) {
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);

  useE(() => {
    if (!saasId) return;
    let alive = true;
    api.trainingTeam(saasId).then((d) => alive && setData(d)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [saasId]);

  const users = (data?.users || []).filter((u) => u.deckSize > 0).sort((a, b) => (b.dueToday - a.dueToday) || (b.doneToday - a.doneToday));
  const th = { textAlign: "left", padding: "8px 10px", ...kicker, fontFamily: "var(--mono)", whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", fontSize: 12.5, color: "var(--fg-1)", borderTop: "1px solid var(--line-1)", whiteSpace: "nowrap" };

  return (
    <>
      <Head mode={mode} setMode={setMode} />
      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {!data && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando equipe…</div>}
        {data && (users.length === 0 ? <EmptyState title="Ninguém com baralho ainda" hint="Dê vagas (SDR/closer/…) pros usuários em Ajustes." /> : (
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", overflow: "auto", maxWidth: 920 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>
                <th style={th}>Pessoa</th><th style={th}>Pra hoje</th><th style={th}>Feitas hoje</th>
                <th style={th}>Acerto 7d</th><th style={th}>Sequência</th><th style={th}>Viu do baralho</th><th style={th}>Último estudo</th>
              </tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={td}><b>{u.name}</b> <span className="mono dim" style={{ fontSize: 10.5 }}>{(u.roles || []).join(" · ")}</span></td>
                    <td style={{ ...td, color: u.dueToday ? "var(--warn)" : "var(--pos)", fontWeight: 600 }} className="tnum">
                      {u.dueToday ? `${u.dueToday}${u.overdue ? ` (${u.overdue} atrasados)` : ""}` : "em dia ✓"}
                    </td>
                    <td style={td} className="tnum">{u.doneToday}</td>
                    <td style={td} className="tnum">{u.again7dPct == null ? "—" : `${100 - u.again7dPct}%`}</td>
                    <td style={td} className="tnum">{u.streak ? `${u.streak}d 🔥` : "—"}</td>
                    <td style={td} className="tnum">{u.seen}/{u.deckSize}</td>
                    <td style={{ ...td, color: "var(--fg-3)" }} className="mono">{u.lastReviewAt ? new Date(u.lastReviewAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "nunca"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {data && <div className="mono dim" style={{ fontSize: 10.5 }}>acerto 7d = revisões da semana que NÃO caíram em "Errei" · sequência = dias seguidos estudando</div>}
      </div>
    </>
  );
}

export { TrainingScreen };
