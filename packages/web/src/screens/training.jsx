import React from "react";
import { Segmented } from "../components/viz.jsx";
import { EmptyState, PrimaryButton } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useData } from "../data.jsx";
import { currentUser } from "../lib/users.js";
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
const page = { flex: 1, overflow: "auto", padding: "28px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16, minHeight: 0 };

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
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>Treinamentos</h1>
        <div style={{ marginTop: 4, fontSize: 14.5, color: "var(--fg-3)" }}>flashcards com repetição espaçada (FSRS) · sua fila é só sua</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6, flexWrap: "wrap" }}>
        {children}
        <Segmented value={mode} onChange={setMode} options={MODES} />
      </div>
    </div>
  );
}

// ── Estudar: baralhos → sessão (normal ou em foco) ───────────────────────────
function Study({ saasId, mode, setMode }) {
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);
  const [session, setSession] = useS(null); // role em sessão
  const [focus, setFocus] = useS(false);
  const [exam, setExam] = useS(null); // prova aberta

  function load() {
    if (!saasId) return;
    setErr(null);
    api.trainingQueue(saasId).then(setData).catch((e) => setErr(e.message));
  }
  useE(load, [saasId]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => {
    if (err) return <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>;
    if (!data) return <div className="mono dim" style={{ fontSize: 12 }}>montando sua fila…</div>;
    if (exam) return <ExamScreen saasId={saasId} exam={exam} onDone={() => { setExam(null); load(); }} />;
    if (session) {
      return <Session saasId={saasId} label="Treino do dia" dayEnd={data.dayEnd}
        roleLabels={Object.fromEntries(data.decks.map((d) => [d.role, d.label]))}
        cards={mixQueues(data.decks, data.queue)} focus={focus} onToggleFocus={() => setFocus((f) => !f)}
        onExit={() => { setSession(null); setFocus(false); load(); }} />;
    }
    if (!data.decks.length) return <EmptyState title="Nenhum baralho pra você" hint="Peça pro gestor te dar uma vaga (SDR/closer/…) em Ajustes → Usuários." />;
    return (
      <>
        <StartCard decks={data.decks} exam={data.exam} onExam={() => setExam(data.exam)}
          onStudy={(foco) => { setSession(true); setFocus(!!foco); }} />
        <DeckList decks={data.decks} />
        <RoleGuides />
      </>
    );
  };

  return (
    <div style={page}>
      <Head mode={mode} setMode={setMode} />
      {body()}
    </div>
  );
}

// Fila única do dia: revezamento (round-robin) entre TODOS os baralhos da
// pessoa. Ela não escolhe tema: a cadência passa por geral + vaga sempre,
// mesmo que a sessão seja interrompida no meio.
function mixQueues(decks, queue) {
  const lists = decks.map((d) => [...(queue[d.role] || [])]).filter((l) => l.length);
  const out = [];
  while (lists.some((l) => l.length)) {
    for (const l of lists) if (l.length) out.push(l.shift());
  }
  return out;
}

// O bloco "da vez": a próxima coisa a fazer, uma por vez. Prova de checkpoint
// pendente vem antes; senão, o treino do dia com a quebra dos números (novos do
// dia + aprendendo/revisões que o FSRS devolveu pra fixar); zerou, descanso.
function StartCard({ decks, exam, onExam, onStudy }) {
  const sum = (k) => decks.reduce((a, d) => a + d.counts[k], 0);
  const novos = sum("new"), aprendendo = sum("learning"), revisar = sum("review");
  const total = novos + aprendendo + revisar;
  const shell = { border: "1px solid var(--accent-line)", background: "var(--accent-soft)", borderRadius: "var(--r-4)", padding: "16px 20px", maxWidth: 760 };
  if (exam) {
    return (
      <div style={{ ...shell, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)" }}>Da vez</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>Prova de checkpoint</div>
          <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 2 }}>você aprendeu {exam.count} cards desde a última · mostra que ficou de verdade</div>
        </div>
        <button onClick={onExam} style={{ height: 40, padding: "0 18px", borderRadius: "var(--r-2)", fontSize: 13.5, fontWeight: 600, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "1px solid var(--btn-bg)", boxShadow: "var(--shadow-btn)", cursor: "pointer" }}>
          Fazer prova →
        </button>
      </div>
    );
  }
  if (!total) return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "18px 24px", maxWidth: 760, fontSize: 13.5, color: "var(--fg-2)" }}>
      Fila de hoje zerada 🎉 O FSRS traz cada card de volta na hora certa. Volte amanhã.
    </div>
  );
  const parts = [
    novos ? `${novos} novos do dia` : "",
    aprendendo ? `${aprendendo} aprendendo (voltaram pra fixar)` : "",
    revisar ? `${revisar} ${revisar === 1 ? "revisão vencida" : "revisões vencidas"}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <div style={{ ...shell, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)" }}>Da vez</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>Treino do dia · {total} card{total === 1 ? "" : "s"}</div>
        <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 2 }}>{parts}</div>
        <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>temas misturados na cadência certa · você não escolhe, só responde</div>
      </div>
      <button onClick={() => onStudy(false)} style={{ height: 40, padding: "0 18px", borderRadius: "var(--r-2)", fontSize: 13.5, fontWeight: 600, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "1px solid var(--btn-bg)", boxShadow: "var(--shadow-btn)", cursor: "pointer" }}>
        Estudar →
      </button>
      <button onClick={() => onStudy(true)} title="modo foco: tela cheia + áudio ambiente" style={{ height: 40, padding: "0 14px", borderRadius: "var(--r-2)", fontSize: 13, background: "var(--bg-1)", color: "var(--fg-2)", border: "1px solid var(--line-2)", cursor: "pointer" }}>
        ◐ foco
      </button>
    </div>
  );
}

// Tiles por tema = PONTUAÇÃO: % do baralho dominado (cards que já graduaram
// pra revisão no FSRS). A fila do dia fica no bloco "da vez"; aqui é placar.
function DeckList({ decks }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
      {decks.map((d) => {
        const learned = d.learned || 0;
        const pct = d.total > 0 ? Math.round((learned / d.total) * 100) : 0;
        const tone = pct >= 80 ? "var(--pos)" : pct >= 40 ? "var(--warn)" : "var(--info)";
        const pendToday = d.counts.new + d.counts.learning + d.counts.review;
        return (
          <div key={d.role} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{d.label}</div>
                <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 3 }}>{learned} de {d.total} cards dominados</div>
              </div>
              <span style={{ height: 22, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: "var(--r-1)", background: d.role.startsWith("geral") ? "var(--bg-2)" : "var(--accent-soft)", color: d.role.startsWith("geral") ? "var(--fg-3)" : "var(--accent)", fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>
                {d.role.startsWith("geral") ? "todo o time" : "sua vaga"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 14 }}>
              <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 30, fontWeight: 700, color: tone }}>{pct}%</span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>pontuação</span>
            </div>
            <div style={{ height: 7, marginTop: 8, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: tone, transition: "width 200ms ease" }} />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 10 }}>
              {pendToday > 0
                ? `${pendToday} no treino de hoje (${d.counts.new} novos · ${d.counts.learning} aprendendo · ${d.counts.review} revisar)`
                : "nada pendente hoje nesse tema"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Sessão (o coração do Anki): frente → virar → 1-4 ─────────────────────────
// Com focus=true a MESMA sessão (mesma fila, mesmo estado) veste a FocusShell:
// tela cheia escura, card maior, textos fora do card em branco translúcido —
// vars de tema só DENTRO de superfícies (--bg-1), que funcionam nos 2 temas.
function Session({ saasId, label, cards, dayEnd, onExit, focus, onToggleFocus, roleLabels }) {
  const [queue, setQueue] = useS(cards);
  const [flipped, setFlipped] = useS(false);
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS(null);
  const [tally, setTally] = useS({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const card = queue[0];
  const shownAt = useR(Date.now());
  useE(() => { shownAt.current = Date.now(); }, [card?.entryId || card?.id]); // cronômetro do card

  async function rate(rating) {
    if (!card || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.trainingReview(saasId, card.entryId || card.id, rating, Date.now() - shownAt.current);
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
        <button onClick={onExit} style={{ ...btn, alignSelf: "flex-start", ...(focus ? { background: "transparent", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.2)" } : {}) }}>← voltar</button>
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
          <div className="mono" style={kicker}>{(roleLabels && roleLabels[card.role]) || label} · {bucket === "new" ? "card novo" : bucket === "review" ? "revisão" : "aprendendo"}{card.sub ? ` · ${card.sub}` : ""}</div>
          <CardFace card={card} flipped={flipped} focus={focus} />
        </div>

        {err && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{err}</div>}

        {!flipped ? (
          <button onClick={() => setFlipped(true)}
            style={{ ...btn, height: focus ? 48 : 40, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", border: "1px solid var(--btn-bg, var(--accent))", fontWeight: 600, fontSize: focus ? 14.5 : 13.5 }}>
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

// ── Prova de checkpoint ──────────────────────────────────────────────────────
// Questões geradas dos cards que a pessoa acabou de graduar; correção 100% no
// servidor (o gabarito nunca chega ao cliente antes de entregar).
function ExamScreen({ saasId, exam, onDone }) {
  const [data, setData] = useS(null);
  const [answers, setAnswers] = useS([]);
  const [result, setResult] = useS(null);
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS(null);

  useE(() => {
    let alive = true;
    api.trainingExamStart(saasId, exam.id)
      .then((d) => { if (alive) { setData(d); setAnswers(d.questions.map(() => ({}))); } })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [exam.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const complete = data && answers.every((a, i) => (data.questions[i].kind === "mc" ? Number.isInteger(a.choice) : (a.text || "").trim()));

  async function submit() {
    setBusy(true); setErr(null);
    try { setResult(await api.trainingExamSubmit(saasId, exam.id, answers)); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const qCard = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 };

  if (err) return <div style={{ maxWidth: 720 }}><div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div><button onClick={onDone} style={{ ...btn, marginTop: 10 }}>← voltar</button></div>;
  if (!data) return <div className="mono dim" style={{ fontSize: 12 }}>montando sua prova…</div>;

  if (result) {
    const tone = result.passed ? "var(--pos)" : "var(--neg)";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
        <div style={{ border: `1px solid ${tone}`, background: result.passed ? "var(--pos-soft)" : "var(--neg-soft)", borderRadius: "var(--r-3)", padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 700, color: tone }}>{result.score}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: tone }}>{result.passed ? "aprovado" : "reprovado"}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>· nota mínima {result.passScore}</span>
          </div>
          {!result.passed && <div style={{ fontSize: 12.5, color: "var(--fg-1)", marginTop: 6 }}>{result.resetCount} card{result.resetCount === 1 ? "" : "s"} voltaram pra sua fila — reaprende e a próxima prova vem melhor.</div>}
        </div>
        {result.questions.map((q, i) => (
          <div key={i} style={{ ...qCard, borderLeft: `3px solid ${q.correct ? "var(--pos)" : "var(--neg)"}` }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "pre-wrap" }}>{i + 1}. {q.prompt}</div>
            {q.kind === "mc" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {q.options.map((op, j) => (
                  <div key={j} style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: "var(--r-2)", lineHeight: 1.45,
                    border: `1px solid ${j === q.answerIdx ? "var(--pos)" : j === q.choice ? "var(--neg)" : "var(--line-1)"}`,
                    background: j === q.answerIdx ? "var(--pos-soft)" : j === q.choice ? "var(--neg-soft)" : "transparent",
                    color: "var(--fg-1)" }}>
                    {op}{j === q.answerIdx ? " ✓" : j === q.choice ? " ✗ (sua escolha)" : ""}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}><b>Sua resposta:</b> {q.text || "—"}</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}><b>Gabarito:</b> {q.ideal}</div>
                {q.feedback && <div style={{ fontSize: 12, color: q.correct ? "var(--pos)" : "var(--neg)" }}>{q.feedback}</div>}
              </>
            )}
          </div>
        ))}
        <button onClick={onDone} style={{ ...btn, alignSelf: "flex-start", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", border: "1px solid var(--btn-bg, var(--accent))", fontWeight: 600 }}>← voltar aos baralhos</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div className="mono dim" style={{ fontSize: 11 }}>prova sobre {data.count} cards que você aprendeu · nota mínima {data.passScore} · sem consulta 😉</div>
      {data.questions.map((q, i) => (
        <div key={i} style={qCard}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "pre-wrap" }}>{i + 1}. {q.prompt}</div>
          {q.kind === "mc" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {q.options.map((op, j) => {
                const on = answers[i]?.choice === j;
                return (
                  <button key={j} onClick={() => setAnswers((p) => p.map((a, k) => (k === i ? { choice: j } : a)))}
                    style={{ textAlign: "left", fontSize: 12.5, padding: "7px 10px", borderRadius: "var(--r-2)", cursor: "pointer", lineHeight: 1.45,
                      border: `1px solid ${on ? "var(--accent)" : "var(--line-2)"}`,
                      background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-1)", fontWeight: on ? 600 : 400 }}>
                    {op}
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea rows={3} value={answers[i]?.text || ""} placeholder="responda com suas palavras — a IA corrige o conceito, não as palavras exatas"
              onChange={(e) => setAnswers((p) => p.map((a, k) => (k === i ? { text: e.target.value } : a)))}
              style={{ width: "100%", padding: "9px 11px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={onDone} className="mono dim" style={{ fontSize: 12 }}>deixar pra depois</button>
        <span style={{ flex: 1 }} />
        <button onClick={submit} disabled={!complete || busy}
          style={{ ...btn, height: 38, background: complete ? "var(--btn-bg, var(--accent))" : "var(--bg-2)", color: complete ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-4)", border: `1px solid ${complete ? "var(--btn-bg, var(--accent))" : "var(--line-2)"}`, fontWeight: 600 }}>
          {busy ? "corrigindo…" : "entregar prova"}
        </button>
      </div>
    </div>
  );
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
// Ordem das abas: baralhos de conhecimentos gerais primeiro (todo mundo passa
// por eles), depois as vagas do funil. Role desconhecido cai no fim.
const ROLE_ORDER = ["geral_negocio", "geral_marketplace", "sdr", "closer", "integrator", "social"];
const roleOrderIdx = (r) => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? ROLE_ORDER.length : i; };

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
  // Toda vaga com card na base vira aba (inclusive as gerais e roles novos).
  const rolesPresent = [...new Set((cards || []).map((c) => c.role))];
  const roleTabs = [...new Set([...rolesPresent, "sdr", "closer"])].sort((a, b) => roleOrderIdx(a) - roleOrderIdx(b));
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
  function addCard() {
    const id = uid();
    setCards((p) => [{ id, role, type: "basic", front: "", back: "" }, ...(p || [])]); // entra no topo
    return id;
  }
  function removeCard(id) { setCards((p) => p.filter((c) => c.id !== id)); }

  return (
    <div style={page}>
      <Head mode={mode} setMode={setMode}>
        {dirty && (
          <>
            <button onClick={reset} disabled={saving} className="mono dim" style={{ fontSize: 11.5 }}>descartar</button>
            <button onClick={save} disabled={saving}
              style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "salvando…" : "salvar"}
            </button>
          </>
        )}
      </Head>
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
          <ExamSettings settings={settings} setSettings={setSettings} />
          <EditCards cards={roleCards} saasId={saasId} onPatch={patchCard} onAdd={addCard} onRemove={removeCard} roleLabel={labels[role] || role} />
        </>
      )}
    </div>
  );
}

const capStyle = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 3 };
const areaStyle = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.4, resize: "vertical", fontFamily: "inherit" };
const CARD_TYPES = [
  { id: "basic", label: "básico" },
  { id: "cloze", label: "cloze" },
  { id: "occlusion", label: "oclusão" },
];

// Configuração da prova de checkpoint — do gestor, salva junto com a base.
function ExamSettings({ settings, setSettings }) {
  const on = (settings.examEvery ?? 30) > 0;
  const num = (key, min, max, w = 50) => (
    <input type="number" min={min} max={max} value={settings[key]}
      onChange={(e) => setSettings((s) => ({ ...s, [key]: Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))) }))}
      style={{ width: w, height: 24, padding: "0 7px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12 }} />
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "8px 12px", maxWidth: 920 }}>
      <label className="mono" style={{ fontSize: 11, color: "var(--fg-2)", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={on}
          onChange={(e) => setSettings((s) => ({ ...s, examEvery: e.target.checked ? 30 : 0 }))}
          style={{ accentColor: "var(--accent)" }} />
        <b>Prova de checkpoint</b>
      </label>
      {on ? (
        <span className="mono dim" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          a cada {num("examEvery", 1, 200)} cards aprendidos · {num("examQuestions", 3, 12, 44)} questões · nota mínima {num("examPass", 50, 100, 50)}%
          <span title="múltipla escolha com distratores tirados dos gabaritos de outros cards; com IA configurada, 2 questões são digitadas e corrigidas semanticamente. Reprovou: os cards errados voltam pra fila.">ⓘ</span>
        </span>
      ) : (
        <span className="mono dim" style={{ fontSize: 11 }}>desligada — ninguém recebe prova</span>
      )}
    </div>
  );
}

// número de sub-cards e texto "limpo" (sem a sintaxe {{cN::}}) pra linha da lista
const clozeIdxs = (text) => [...new Set([...String(text || "").matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const stripCloze = (text) => String(text || "").replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/gs, "$1");
const subCountOf = (c) => (c.type === "cloze" ? clozeIdxs(c.front).length : c.type === "occlusion" ? (c.masks || []).length : 0);
const TYPE_LABEL = { basic: "básico", cloze: "cloze", occlusion: "oclusão" };

function EditCards({ cards, saasId, onPatch, onAdd, onRemove, roleLabel }) {
  const [open, setOpen] = useS(null);
  const [q, setQ] = useS("");
  const norm = (s) => String(s || "").toLowerCase();
  const shown = q.trim() ? cards.filter((c) => norm(`${c.front} ${c.back}`).includes(norm(q))) : cards;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 920 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setOpen(onAdd())}
          style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--btn-bg, var(--accent))", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12, fontWeight: 600 }}>
          ＋ novo card em {roleLabel}
        </button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`buscar nos ${cards.length} cards…`}
          style={{ flex: 1, minWidth: 180, maxWidth: 320, height: 30, padding: "0 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 }} />
        <span className="mono dim" style={{ fontSize: 10.5 }}>{q.trim() ? `${shown.length} de ${cards.length}` : `${cards.length} card${cards.length === 1 ? "" : "s"}`}</span>
      </div>

      {shown.length === 0 && <div className="mono dim" style={{ fontSize: 11.5, padding: "14px 0" }}>{q.trim() ? "nada com esse texto nesta vaga" : "nenhum card ainda — crie o primeiro"}</div>}
      {shown.map((c, i) => {
        const isOpen = open === c.id;
        const subs = subCountOf(c);
        const line = stripCloze(c.front).trim() || c.back?.trim() || "card vazio";
        return (
          <div key={c.id} style={{ border: `1px solid ${isOpen ? "var(--accent-line)" : "var(--line-1)"}`, borderRadius: "var(--r-3)", background: "var(--bg-1)", overflow: "hidden" }}>
            <div onClick={() => setOpen(isOpen ? null : c.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", cursor: "pointer", background: isOpen ? "var(--accent-soft)" : "transparent" }}>
              <span className="mono tnum" style={{ fontSize: 10.5, color: "var(--fg-4)", minWidth: 22 }}>#{i + 1}</span>
              <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-3)", border: "1px solid var(--line-2)", borderRadius: 9, padding: "1px 7px", whiteSpace: "nowrap" }}>{TYPE_LABEL[c.type] || "básico"}</span>
              <span style={{ flex: 1, fontSize: 13, color: line === "card vazio" ? "var(--fg-4)" : "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{line}</span>
              {subs > 0 && <span className="mono dim" style={{ fontSize: 10 }}>{subs} sub</span>}
              {c.image && <span style={{ fontSize: 12 }} title="tem imagem">🖼</span>}
              <span className="mono dim" style={{ fontSize: 11 }}>{isOpen ? "▾" : "▸"}</span>
              <button onClick={(e) => { e.stopPropagation(); onRemove(c.id); }} title="remover card" className="mono dim" style={{ fontSize: 13 }}>✕</button>
            </div>
            {isOpen && (
              <div style={{ borderTop: "1px solid var(--line-1)", padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                <CardEditor card={c} saasId={saasId} onPatch={onPatch} />
                <CardPreview card={c} />
              </div>
            )}
          </div>
        );
      })}
      <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>a base é do TIME: card novo entra como "novo" pra todo mundo; card removido some pra todo mundo. O RITMO de cada pessoa é individual. Cloze e oclusão viram vários sub-cards. Cole imagem com Ctrl+V dentro do card aberto.</div>
    </div>
  );
}

// Preview fiel: renderiza com o MESMO componente da sessão (CardFace).
function CardPreview({ card }) {
  const [flip, setFlip] = useS(false);
  const sub = card.type === "cloze" ? `c${clozeIdxs(card.front)[0] || 1}`
    : card.type === "occlusion" ? (card.masks?.[0]?.id || null) : null;
  return (
    <div onClick={() => setFlip((f) => !f)}
      style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", boxShadow: "var(--shadow-2)", padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10, alignSelf: "start" }}>
      <div className="mono" style={kicker}>preview · {flip ? "verso" : "frente"}{sub ? ` · ${sub}` : ""} · clique pra virar</div>
      <CardFace card={{ ...card, sub }} flipped={flip} />
    </div>
  );
}

function CardEditor({ card, saasId, onPatch }) {
  const frontRef = useR(null);
  const type = card.type || "basic";

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
    const n = Math.max(0, ...clozeIdxs(front)) + 1;
    const sel = front.slice(s, e) || "…";
    onPatch(card.id, "front", `${front.slice(0, s)}{{c${n}::${sel}}}${front.slice(e)}`);
  }

  return (
    <div onPaste={onPaste} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {CARD_TYPES.map((t) => (
          <button key={t.id} onClick={() => onPatch(card.id, "type", t.id)} className="mono"
            style={{ height: 22, padding: "0 9px", borderRadius: 11, fontSize: 10.5, cursor: "pointer",
              border: `1px solid ${type === t.id ? "var(--accent-line)" : "var(--line-2)"}`,
              background: type === t.id ? "var(--accent-soft)" : "transparent",
              color: type === t.id ? "var(--accent)" : "var(--fg-3)" }}>{t.label}</button>
        ))}
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
            <span className="mono code" style={{ fontSize: 9.5, color: "var(--accent-fg)", fontWeight: 700 }}>{m.id}</span>
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

// ── Equipe: o dash do gestor ─────────────────────────────────────────────────
// Tabela com o essencial + clique na pessoa abre o raio-x: true retention
// (memória real: acerto só em cards que JÁ estavam em revisão), aprendizado,
// maturidade do baralho, carga futura e constância.
const retColor = (pct) => (pct == null ? "var(--fg-4)" : pct >= 85 ? "var(--pos)" : pct >= 70 ? "var(--warn)" : "var(--neg)");

function Team({ saasId, mode, setMode }) {
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);
  const [sel, setSel] = useS(null);

  useE(() => {
    if (!saasId) return;
    let alive = true;
    api.trainingTeam(saasId).then((d) => alive && setData(d)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [saasId]);

  const users = (data?.users || []).filter((u) => u.deckSize > 0).sort((a, b) => (b.dueToday - a.dueToday) || (b.doneToday - a.doneToday));
  const selected = users.find((u) => u.id === sel);
  const th = { textAlign: "left", padding: "8px 10px", ...kicker, fontFamily: "var(--mono)", whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", fontSize: 12.5, color: "var(--fg-1)", borderTop: "1px solid var(--line-1)", whiteSpace: "nowrap" };

  return (
    <div style={page}>
      <Head mode={mode} setMode={setMode} />
      {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
      {!data && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando equipe…</div>}
      {data && (users.length === 0 ? <EmptyState title="Ninguém com baralho ainda" hint="Dê vagas (SDR/closer/…) pros usuários em Ajustes." /> : (
        <>
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", overflow: "auto", maxWidth: 980 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>
                <th style={th}>Pessoa</th><th style={th}>Pra hoje</th><th style={th}>Feitas hoje</th>
                <th style={th} title="acerto nos cards que já estavam em revisão — memória real">Retenção 30d</th>
                <th style={th} title="cards com intervalo ≥ 21 dias — conhecimento consolidado">Maduros</th>
                <th style={th}>Sequência</th><th style={th}>Viu do baralho</th><th style={th}>Último estudo</th>
              </tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} onClick={() => setSel(u.id === sel ? null : u.id)}
                    style={{ cursor: "pointer", background: u.id === sel ? "var(--accent-soft)" : "transparent" }}>
                    <td style={td}><b>{u.name}</b> <span className="mono dim" style={{ fontSize: 10.5 }}>{(u.roles || []).join(" · ")}</span></td>
                    <td style={{ ...td, color: u.dueToday ? "var(--warn)" : "var(--pos)", fontWeight: 600 }} className="tnum">
                      {u.dueToday ? `${u.dueToday}${u.overdue ? ` (${u.overdue} atrasados)` : ""}` : "em dia ✓"}
                    </td>
                    <td style={td} className="tnum">{u.doneToday}</td>
                    <td style={{ ...td, fontWeight: 700, color: retColor(u.retention30d?.pct) }} className="tnum">
                      {u.retention30d?.pct == null ? "—" : `${u.retention30d.pct}%`}
                      {u.retention30d?.n > 0 && <span className="mono dim" style={{ fontSize: 10, fontWeight: 400 }}> ({u.retention30d.n})</span>}
                    </td>
                    <td style={td} className="tnum">{u.mature}<span className="mono dim" style={{ fontSize: 10 }}>/{u.seen}</span></td>
                    <td style={td} className="tnum">{u.streak ? `${u.streak}d 🔥` : "—"}</td>
                    <td style={td} className="tnum">{u.seen}/{u.deckSize}</td>
                    <td style={{ ...td, color: "var(--fg-3)" }} className="mono">{u.lastReviewAt ? new Date(u.lastReviewAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "nunca"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? <PersonDetail user={selected} today={data.today} /> :
            <div className="mono dim" style={{ fontSize: 10.5 }}>clique numa pessoa pra abrir o raio-x · retenção 30d = acerto SÓ em cards que já estavam em revisão (true retention) · maduros = intervalo ≥ 21 dias</div>}
        </>
      ))}
    </div>
  );
}

// Barras minúsculas com escala explícita (eixo 0..max) e tooltip nativo.
function MiniBars({ bars, max, height = 56, width = 22 }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: height + 16 }}>
      {bars.map((b, i) => (
        <div key={i} title={b.title} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ width, height, display: "flex", alignItems: "flex-end", borderBottom: "1px solid var(--line-2)" }}>
            {b.v == null
              ? <div style={{ width: "100%", height: 1, background: "var(--line-2)" }} />
              : <div style={{ width: "100%", height: `${Math.max(3, (b.v / max) * 100)}%`, background: "var(--accent)", borderRadius: "3px 3px 0 0" }} />}
          </div>
          <span className="mono" style={{ fontSize: 8.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{b.label || ""}</span>
        </div>
      ))}
    </div>
  );
}

function PersonDetail({ user: u, today }) {
  const tile = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "10px 12px", minWidth: 118 };
  const big = (v, color) => <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: color || "var(--fg-1)" }}>{v}</div>;
  const pct = (x) => (x == null ? "—" : `${x}%`);
  const dow = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  const dm = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const weekly = u.weekly || [], forecast = u.forecast || [];
  const forecastMax = Math.max(1, ...forecast.map((f) => f.n));
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "16px 18px", maxWidth: 980, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="mono" style={kicker}>Raio-x · {u.name}</div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={tile} title="acerto em cards que já estavam em revisão — memória real">
          {big(pct(u.retention30d?.pct), retColor(u.retention30d?.pct))}
          <div className="mono dim" style={{ fontSize: 9.5 }}>retenção 30d · {u.retention30d?.n || 0} rev.</div>
        </div>
        <div style={tile}>
          {big(pct(u.retention7d?.pct), retColor(u.retention7d?.pct))}
          <div className="mono dim" style={{ fontSize: 9.5 }}>retenção 7d · {u.retention7d?.n || 0} rev.</div>
        </div>
        <div style={tile} title="cards novos que acertou logo de primeira (Bom/Fácil)">
          {big(pct(u.firstTryPct))}
          <div className="mono dim" style={{ fontSize: 9.5 }}>acerto de primeira 30d</div>
        </div>
        <div style={tile} title="cards com intervalo ≥ 21 dias — conhecimento consolidado">
          {big(`${u.mature}`)}
          <div className="mono dim" style={{ fontSize: 9.5 }}>maduros · {u.young} jovens</div>
        </div>
        <div style={tile}>
          {big(u.reviewsPerDay30d)}
          <div className="mono dim" style={{ fontSize: 9.5 }}>revisões/dia 30d</div>
        </div>
        <div style={tile}>
          {big(`${u.activeDays30d}/30`)}
          <div className="mono dim" style={{ fontSize: 9.5 }}>dias ativos</div>
        </div>
        {u.medianMs != null && (
          <div style={tile} title="tempo entre ver a frente e responder (mediana 30d) · relâmpago = respostas em menos de 1,5s, sinal de clique sem ler">
            {big(`${(u.medianMs / 1000).toFixed(1)}s`, u.rushPct > 20 ? "var(--neg)" : undefined)}
            <div className="mono dim" style={{ fontSize: 9.5 }}>
              tempo/card · <span style={{ color: u.rushPct > 20 ? "var(--neg)" : undefined }}>{u.rushPct}% relâmpago</span>
            </div>
          </div>
        )}
        {(u.examsDone > 0 || u.examPending) && (
          <div style={tile} title="provas de checkpoint (a cada N cards aprendidos, configurável em Editar)">
            {big(u.lastExam ? `${u.lastExam.score}%` : "—", u.lastExam ? (u.lastExam.status === "passed" ? "var(--pos)" : "var(--neg)") : undefined)}
            <div className="mono dim" style={{ fontSize: 9.5 }}>
              última prova · {u.examsDone} feita{u.examsDone === 1 ? "" : "s"}
              {u.examsFailed ? ` · ${u.examsFailed} reprova${u.examsFailed === 1 ? "" : "s"}` : ""}
              {u.examPending ? " · 1 pendente" : ""}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div className="mono" style={{ ...kicker, marginBottom: 8 }}>True retention por semana <span style={{ textTransform: "none" }}>(escala 0–100%)</span></div>
          <MiniBars max={100} bars={weekly.map((w, i) => ({
            v: w.pct, label: i === 0 || i === 7 ? dm(w.start) : "",
            title: w.pct == null ? `sem revisões · semana de ${dm(w.start)}` : `${w.pct}% · ${w.n} revisões · semana de ${dm(w.start)}`,
          }))} />
        </div>
        <div>
          <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Vencendo nos próximos 7 dias</div>
          <MiniBars max={forecastMax} bars={forecast.map((f) => ({
            v: f.n, label: dow(f.day), title: `${f.n} card${f.n === 1 ? "" : "s"} · ${dm(f.day)}`,
          }))} />
        </div>
        {u.retentionByRole?.length > 0 && (
          <div>
            <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Retenção por baralho (30d)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {u.retentionByRole.map((r) => (
                <div key={r.role} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ minWidth: 110, color: "var(--fg-2)" }}>{r.label}</span>
                  <b className="tnum" style={{ color: retColor(r.pct) }}>{pct(r.pct)}</b>
                  <span className="mono dim" style={{ fontSize: 10 }}>{r.n} rev.</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Constância</div>
        <Heatmap days={u.days || {}} today={today} />
      </div>
    </div>
  );
}


// ── As vagas e seus processos ────────────────────────────────────────────────
// Resumo fixo do que cada vaga é responsável e do processo dela dentro da
// empresa: o mapa que o treinamento aprofunda card a card. Todo mundo vê as 4
// (entender o vizinho é parte do jogo).
const ROLE_GUIDES = [
  {
    role: "sdr", title: "SDR", tagline: "Topo do funil: transformar cadastro em call agendada",
    respons: "Responde pela velocidade do 1º toque, pela qualificação completa e por entregar ao closer uma call confirmada, com login em mãos e decisor presente.",
    processo: [
      "Fila do Meu dia na ordem: lead novo é prioridade máxima (2 ligações + WhatsApp de apresentação)",
      "Qualifica os 6 dados na ordem (nicho, loja, contas, anúncios, expansão, time) e marca a call com 2 opções de horário; e-mail por último",
      "3 abordagens no total; sem sucesso, Nutrição: 3 ganchos de 7 em 7 dias (prova → teste sem risco → porta aberta)",
      "Confirmação da call: 1h antes no WhatsApp (cobra logins ML/Shopee + decisor); sem resposta, LIGA 10 min antes",
      "No-show: 2 remarcações (1h depois e no dia útil seguinte); sem retorno, Desqualificado",
    ],
  },
  {
    role: "closer", title: "Closer", tagline: "Da call ao dinheiro: fechar com pagamento na call",
    respons: "Responde pela conversão das calls em receita: demo ao vivo, objeções resolvidas na hora, pagamento ainda na call e integração agendada pro dia seguinte.",
    processo: [
      "Raio-X (5 min): contas, anúncios, quem sobe anúncio, faturamento; pergunta da suspensão define a narrativa (proteção × crescimento)",
      "Espelho da dor nas palavras do lead → tese das 3 etapas + vacina da canibalização antes que perguntem",
      "Demo AO VIVO nas contas dele (o coração: quem clona de verdade, fecha) · prova com cases (Unique +105%, Dyno 60 mil/20 dias)",
      "Oferta âncora única (anual 12x 599; à vista com desconto no Pix); a escada só entra travando em caixa, com validade nesta call",
      "Fechamento = agendar a integração (13h ou 17h) com pagamento na linha; não fechou: tarefa + data + decisor, e follow-ups 1/2/3 a partir do resumo da call",
    ],
  },
  {
    role: "integrator", title: "Integrador · CS", tagline: "Entrega e retenção: rodando no dia seguinte, renovando no fim",
    respons: "Responde pela ativação (cliente clonando em 24h), pela saúde da carteira na régua de retenção e por transformar resultado em case e indicação.",
    processo: [
      "Confirmação 2h antes (computador + logins em mãos); sem resposta, liga 30 min antes",
      "Call de vídeo (~20 min): conecta as contas, define a conta-mãe e roda a PRIMEIRA clonagem na tela do cliente",
      "Registra tudo no card (contas, conta-mãe, pendências, próximo contato) pra ligar sempre com dado na mão",
      "Régua: onboarding (semana 1) · check-in (mês 1) · revisão (mês 3) · upsell (mês 6) · renovação (2 meses antes do fim)",
      "Sinal amarelo de churn (sem uso, sem resposta) = ligação hoje; resultado bom vira case autorizado + pedido de indicação",
    ],
  },
  {
    role: "social", title: "Mídia social", tagline: "Alimentar o topo: criativo por dor e presença que sustenta o funil",
    respons: "Responde pelo fluxo de leads qualificados no topo: criativos por dor na convenção certa, leitura por CPL real/ABC/ROAS e presença orgânica consistente.",
    processo: [
      "Criativo por dor com código [X] no nome e UTMs da convenção (é o que liga lead → anúncio → receita)",
      "Anúncio novo nasce PAUSADO: revisão no Gerenciador antes de ativar",
      "Leitura semanal: CPL real, CTR de link, 3s play, clientes A/B/C e ROAS por dor (relatório Por dor); julga com amostra, não com dia isolado",
      "Orçamento gradual (+20% no conjunto que prova resultado); pausa criativo cansado (frequência alta, CTR caindo)",
      "Orgânico no ritmo das metas: cases com print, bastidores e demonstrações, publicados e medidos pela tela Redes sociais",
    ],
  },
];

function RoleGuides() {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>As vagas e seus processos</h2>
        <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>quem responde pelo quê · o mapa que os cards aprofundam</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
        {ROLE_GUIDES.map((g) => (
          <div key={g.role} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "20px 22px" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{g.title}</div>
            <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, marginTop: 2 }}>{g.tagline}</div>
            <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.55, marginTop: 10 }}>{g.respons}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.07em", textTransform: "uppercase", margin: "12px 0 6px" }}>Processo</div>
            <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              {g.processo.map((s, i) => (
                <li key={i} style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>{s}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Portão do treino diário ──────────────────────────────────────────────────
// Quem tem vaga operacional (etiqueta sdr/closer/integrator/social) só começa a
// trabalhar depois de zerar a fila do dia: qualquer tela fora dos Treinamentos
// fica atrás deste overlay enquanto houver card pendente. A cada revisão o SSE
// atualiza a contagem; zerou, o cockpit libera sozinho. Admin sem etiqueta não
// é travado, e falha da API nunca tranca a tela (fail-open).
const GATE_ROLES = ["sdr", "closer", "integrator", "social"];

function TrainingGate({ saasId, active }) {
  const { version } = useData();
  const [pending, setPending] = useS(null); // null = sem dado (não trava)
  const me = currentUser();
  const gated = !!me && (me.roles || []).some((r) => GATE_ROLES.includes(r));
  useE(() => {
    if (!saasId || !gated) { setPending(null); return; }
    let alive = true;
    api.trainingQueue(saasId)
      .then((q) => { if (alive) setPending((q.decks || []).reduce((a, d) => a + d.counts.new + d.counts.learning + d.counts.review, 0)); })
      .catch(() => alive && setPending(null));
    return () => { alive = false; };
  }, [saasId, gated, version]);

  if (!active || !gated || !pending) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "color-mix(in srgb, var(--bg-0) 88%, transparent)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "min(440px, 100%)", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 26, textAlign: "center" }}>
        <div style={{ fontSize: 34 }}>🧠</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700, marginTop: 8 }}>Treino do dia primeiro</div>
        <div style={{ fontSize: 13.5, color: "var(--fg-2)", lineHeight: 1.55, marginTop: 8 }}>
          Você tem <b>{pending} {pending === 1 ? "card" : "cards"}</b> na sua fila de hoje.
          Zerou a fila, o cockpit libera sozinho.
        </div>
        <div style={{ marginTop: 16 }}>
          <PrimaryButton onClick={() => { try { location.hash = "#training"; } catch { /* ignore */ } }}>Começar o treino →</PrimaryButton>
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", marginTop: 12 }}>uns minutos por dia · repetição espaçada é o que fixa</div>
      </div>
    </div>
  );
}

export { TrainingScreen, TrainingGate };
