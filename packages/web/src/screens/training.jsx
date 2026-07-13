import React from "react";
import { PageHead, Segmented } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";

// Treinamentos — flashcards estilo Anki com repetição espaçada (FSRS) POR
// PESSOA. Três modos: ESTUDAR (baralhos da sua vaga com contadores novo/
// aprendendo/revisar → sessão de virar o card e se avaliar em 4 botões),
// EDITAR (a base oficial do time, por vaga) e EQUIPE (quem está em dia).

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

// ── Estudar: baralhos → sessão ────────────────────────────────────────────────
function Study({ saasId, mode, setMode }) {
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);
  const [session, setSession] = useS(null); // role em sessão

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
        cards={data.queue[session] || []} onExit={() => { setSession(null); load(); }} />;
    }
    if (!data.decks.length) return <EmptyState title="Nenhum baralho pra você" hint="Peça pro gestor te dar uma vaga (SDR/closer/…) em Ajustes → Usuários." />;
    return <DeckList decks={data.decks} newPerDay={data.newPerDay} onStudy={setSession} />;
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
              <button onClick={() => onStudy(d.role)}
                style={{ ...btn, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600 }}>
                Estudar →
              </button>
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
function Session({ saasId, label, cards, dayEnd, onExit }) {
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
      const r = await api.trainingReview(saasId, card.id, rating);
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

  // Atalhos do Anki: espaço/enter vira; 1-4 avalia.
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

  // Fim da sessão — resumo.
  if (!card) {
    const good = tally[3] + tally[4];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "20px 22px" }}>
          <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Sessão concluída · {label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 700, color: "var(--pos)" }}>{done}</span>
            <span style={{ fontSize: 15, color: "var(--fg-2)" }}>revisões · {done ? Math.round((good / done) * 100) : 0}% bem lembradas</span>
          </div>
          <div className="mono dim" style={{ fontSize: 11.5, marginTop: 8 }}>
            {RATINGS.map((r) => <span key={r.rating} style={{ marginRight: 12, color: tally[r.rating] ? r.color : "var(--fg-4)" }}>{tally[r.rating]} {r.label.toLowerCase()}</span>)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 10, lineHeight: 1.5 }}>Fila de hoje zerada — o FSRS traz cada card de volta na hora certa. Volte amanhã. 🎉</div>
        </div>
        <button onClick={onExit} style={{ ...btn, alignSelf: "flex-start" }}>← voltar aos baralhos</button>
      </div>
    );
  }

  const bucket = !card.srs || card.srs.state === 0 ? "new" : card.srs.state === 2 ? "review" : "learning";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onExit} className="mono dim" style={{ fontSize: 12 }}>← baralhos</button>
        <span style={{ flex: 1 }} />
        {COUNT.map((c) => (
          <span key={c.key} className="mono tnum" title={c.label}
            style={{ fontSize: 12, color: c.color, textDecoration: bucket === c.key ? "underline" : "none", opacity: counts[c.key] ? 1 : 0.35 }}>
            {counts[c.key]}
          </span>
        ))}
        <span className="mono dim tnum" style={{ fontSize: 11.5 }}>· {done} feitas</span>
      </div>

      {/* O card */}
      <div onClick={() => !flipped && setFlipped(true)}
        style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", boxShadow: "var(--shadow-2)", padding: "26px 26px 22px", minHeight: 180, display: "flex", flexDirection: "column", gap: 14, cursor: flipped ? "default" : "pointer" }}>
        <div className="mono" style={kicker}>{label} · {bucket === "new" ? "card novo" : bucket === "review" ? "revisão" : "aprendendo"}</div>
        <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.4, fontFamily: "var(--display)", color: "var(--fg-1)", whiteSpace: "pre-wrap" }}>{card.front}</div>
        {flipped && (
          <>
            <div style={{ borderTop: "1px solid var(--line-1)" }} />
            <div style={{ fontSize: 15, color: "var(--fg-1)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{card.back}</div>
          </>
        )}
      </div>

      {err && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{err}</div>}

      {!flipped ? (
        <button onClick={() => setFlipped(true)}
          style={{ ...btn, height: 40, background: "var(--accent)", color: "var(--accent-fg)", border: "1px solid var(--accent)", fontWeight: 600, fontSize: 13.5 }}>
          Mostrar resposta <span style={{ opacity: 0.7, fontWeight: 400 }}>(espaço)</span>
        </button>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {RATINGS.map((r) => (
            <button key={r.rating} onClick={() => rate(r.rating)} disabled={busy}
              style={{ height: 52, borderRadius: "var(--r-2)", border: `1px solid ${r.color}`, background: r.bg, color: r.color, fontWeight: 700, fontSize: 13.5, cursor: "pointer", opacity: busy ? 0.6 : 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
              <span>{r.label} <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 10.5 }}>({r.rating})</span></span>
              <span className="mono" style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.8 }}>{card.preview?.[r.rating] || ""}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mono dim" style={{ fontSize: 10.5 }}>seja honesto com você: o algoritmo só funciona se o clique refletir o que você lembrou de verdade</div>
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
            <EditCards cards={roleCards} onPatch={patchCard} onAdd={addCard} onRemove={removeCard} roleLabel={labels[role] || role} />
          </>
        )}
      </div>
    </>
  );
}

function EditCards({ cards, onPatch, onAdd, onRemove, roleLabel }) {
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
      <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>a base é do TIME: card novo entra como "novo" pra todo mundo; card removido some pra todo mundo. O RITMO de cada pessoa (quando o card volta) é individual.</div>
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
