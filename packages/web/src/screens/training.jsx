import React from "react";
import { Segmented, FilterTab } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, SecondaryButton, Avatar } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useData } from "../data.jsx";
import { currentUser, isAdminUser } from "../lib/users.js";
import { FocusShell } from "./training-focus.jsx";
import { IcpCard } from "../components/icp-card.jsx";

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

const btn ={ height: 32, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, cursor: "pointer" };
const page = { flex: 1, overflow: "auto", padding: "28px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16, minHeight: 0 };

function TrainingScreen() {
  const [product] = useActiveSaas();
  const [mode, setMode] = useS("study"); // study | edit | team
  // Editar é do DONO da operação: a base de cards é material oficial (a prova de
  // checkpoint sai do mesmo texto), então quem treina só estuda. A API tem o
  // guard de verdade (403 no PUT); aqui é a montagem da tela.
  const admin = isAdminUser();
  const view = mode === "edit" && !admin ? "study" : mode;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {view === "study" && <Study key={product?.id} saasId={product?.id} mode={view} setMode={setMode} />}
      {view === "edit" && <Edit key={product?.id} saasId={product?.id} mode={view} setMode={setMode} />}
      {view === "team" && <Team key={product?.id} saasId={product?.id} mode={view} setMode={setMode} />}
    </div>
  );
}

const MODES = [{ value: "study", label: "Estudar" }, { value: "edit", label: "Editar", adminOnly: true }, { value: "team", label: "Equipe" }];

function Head({ mode, setMode, children }) {
  const options = MODES.filter((m) => !m.adminOnly || isAdminUser());
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <h1 className="page-title">Treinamentos</h1>
        <div className="page-sub" style={{ marginTop: 4 }}>flashcards com repetição espaçada (FSRS) · sua fila é só sua</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6, flexWrap: "wrap" }}>
        {children}
        <Segmented value={mode} onChange={setMode} options={options} />
      </div>
    </div>
  );
}

// ── Estudar: baralhos → sessão (normal ou em foco) ───────────────────────────
function Study({ saasId, mode, setMode }) {
  const [data, setData] = useS(null);
  // O /stats alimenta os TRÊS cards do trilho (consistência, memória, próxima
  // prova): uma chamada só, carregada aqui, em vez de cada card buscar a sua.
  const [stats, setStats] = useS(null);
  const [err, setErr] = useS(null);
  const [session, setSession] = useS(null); // role em sessão
  const [focus, setFocus] = useS(false);
  const [exam, setExam] = useS(null); // prova aberta
  const [fun, setFun] = useS(null);   // sessão 4fun (cards fora da cota)
  const [funBusy, setFunBusy] = useS(false);
  const [funErr, setFunErr] = useS(null);

  function load() {
    if (!saasId) return;
    setErr(null);
    api.trainingQueue(saasId).then(setData).catch((e) => setErr(e.message));
    // trilho é opcional: falha dele não pode derrubar o treino
    api.trainingStats(saasId).then(setStats).catch(() => { /* widget opcional */ });
  }
  useE(load, [saasId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4fun: sorteia cards da base da pessoa. Cada rodada é um sorteio novo — a
  // ordem não importa aqui, porque nada disso agenda revisão.
  async function startFun() {
    if (funBusy) return;
    setFunBusy(true); setFunErr(null);
    try {
      const d = await api.trainingFun(saasId, FUN_ROUND);
      if (!d.cards?.length) setFunErr("seu baralho ainda está vazio");
      else setFun(d.cards);
    } catch (e) { setFunErr(e.message || "não deu pra montar a rodada"); }
    setFunBusy(false);
  }

  const body = () => {
    if (err) return <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>;
    if (!data) return <div className="mono dim" style={{ fontSize: 12 }}>montando sua fila…</div>;
    if (exam) return <ExamScreen saasId={saasId} exam={exam} onDone={() => { setExam(null); load(); }} />;
    if (fun) {
      return <Session saasId={saasId} label="4fun" fun cards={fun} dayEnd={data.dayEnd}
        roleLabels={Object.fromEntries(data.decks.map((d) => [d.role, d.label]))}
        focus={focus} onToggleFocus={() => setFocus((f) => !f)} onMore={startFun}
        onExit={() => { setFun(null); setFocus(false); }} />;
    }
    if (session) {
      return <Session saasId={saasId} label="Treino do dia" dayEnd={data.dayEnd}
        roleLabels={Object.fromEntries(data.decks.map((d) => [d.role, d.label]))}
        cards={mixQueues(data.decks, data.queue)} focus={focus} onToggleFocus={() => setFocus((f) => !f)}
        onExit={() => { setSession(null); setFocus(false); load(); }} />;
    }
    if (!data.decks.length) return <EmptyState title="Nenhum baralho pra você" hint="Peça pro gestor te dar uma vaga (SDR/closer/…) em Ajustes → Usuários." />;
    // Duas colunas: à esquerda o que fazer AGORA (a fila manda), à direita como
    // você está indo. Antes eram seis blocos de peso igual empilhados e a
    // pessoa abria a tela sem saber qual era a próxima ação.
    return (
      <div className="resp-cols" style={{ "--cols": "minmax(0,1fr) 372px", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <StartCard decks={data.decks} exam={data.exam} onExam={() => setExam(data.exam)}
            onStudy={(foco) => { setSession(true); setFocus(!!foco); }}
            onFun={startFun} funBusy={funBusy} funErr={funErr} />
          <DeckList decks={data.decks} />
          {/* Consulta, não rotina: ICP, vagas e empresa/cultura passam a abrir
              quando a pessoa precisa, em vez de ocupar a dobra todo dia. */}
          <RefList />
        </div>
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <ConsistencyCard stats={stats} />
          <MemoryCard stats={stats} />
          <NextExamCard stats={stats} />
        </div>
      </div>
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

// ── O hero "Da vez": a única coisa com tratamento forte na tela ────────────
// A próxima ação, uma por vez: prova de checkpoint pendente vem antes; senão o
// treino do dia com a quebra novos/aprendendo/revisar como três micro-números
// (antes era uma frase corrida). O 4fun desceu pro rodapé do próprio hero: era
// um card tracejado do mesmo peso competindo com o treino do dia.
const FUN_ROUND = 20;

// Ponto de 6px + palavra + número. Status no cockpit não é pílula colorida.
function CountDot({ color, label, value, dim = false, size = 15 }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 12.5, color: dim ? "rgba(255,255,255,0.5)" : "var(--fg-2)", opacity: value ? 1 : 0.45 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color, alignSelf: "center", flexShrink: 0 }} />
      <b className="tnum" style={{ fontSize: size, fontWeight: 700, color: dim ? "#fff" : "var(--fg-1)" }}>{value}</b>
      {label}
    </span>
  );
}

// ── Barra de progresso da sessão ────────────────────────────────────────────
// Não existia noção de progresso: a pessoa não sabia se estava no card 3 ou no
// 20. O denominador é o tamanho da fila NO INÍCIO (recalcular no meio faria o
// número pular); card que volta pra fixar (learning step do Anki) aparece como
// acréscimo em vez de inflar o total, que seria mentir sobre o que falta.
function SessionProgress({ done, total, dark = false }) {
  if (!total) return null;
  const pct = Math.min(100, Math.round((done / total) * 100));
  const extra = Math.max(0, done - total);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 5, borderRadius: 999, background: dark ? "rgba(255,255,255,0.12)" : "var(--bg-3)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: dark ? "#3eccbf" : "var(--accent)", transition: "width 220ms ease" }} />
      </div>
      <span className="mono tnum" style={{ fontSize: 11, color: dark ? "rgba(255,255,255,0.5)" : "var(--fg-4)", whiteSpace: "nowrap" }}>
        {`${Math.min(done, total)} de ${total}${extra ? ` · +${extra} que voltaram` : ""}`}
      </span>
    </div>
  );
}

function StartCard({ decks, exam, onExam, onStudy, onFun, funBusy, funErr }) {
  const sum = (k) => decks.reduce((a, d) => a + d.counts[k], 0);
  const novos = sum("new"), aprendendo = sum("learning"), revisar = sum("review");
  const total = novos + aprendendo + revisar;
  const shell = { border: "1px solid var(--accent-line)", background: "var(--accent-soft)", borderRadius: "var(--r-4)", padding: "22px 24px" };
  const funRow = (primary) => (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--accent-line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
          {primary ? "Quer estudar mesmo assim?" : "Acabou a fila e quer continuar?"}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>
          não conta no compromisso do dia nem mexe na sua agenda de revisões · fica registrado no seu raio-x
        </div>
        {funErr && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)", marginTop: 5 }}>{funErr}</div>}
      </div>
      {primary ? (
        <PrimaryButton onClick={onFun} disabled={funBusy}>{funBusy ? "sorteando…" : `Sortear ${FUN_ROUND} cards · 4fun →`}</PrimaryButton>
      ) : (
        <button onClick={onFun} disabled={funBusy} className="mono"
          style={{ background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: funBusy ? "default" : "pointer", opacity: funBusy ? 0.6 : 1 }}>
          {funBusy ? "sorteando…" : `Sortear ${FUN_ROUND} cards · 4fun →`}
        </button>
      )}
    </div>
  );

  // Prova pendente vence a fila: é o compromisso da vez.
  if (exam) {
    return (
      <div style={shell}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="kicker accent">Da vez</div>
            <div className="card-title" style={{ marginTop: 6 }}>Prova de checkpoint</div>
            <div className="card-sub" style={{ marginTop: 3 }}>você aprendeu {exam.count} cards desde a última · mostra que ficou de verdade</div>
          </div>
          <PrimaryButton onClick={onExam}>Fazer prova →</PrimaryButton>
        </div>
      </div>
    );
  }
  return (
    <div style={shell}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="kicker accent">Da vez</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: total ? "var(--fg-1)" : "var(--fg-4)" }}>{total}</span>
            <span style={{ fontSize: 15, color: "var(--fg-3)" }}>
              {total ? `card${total === 1 ? "" : "s"} no treino de hoje` : "cards no treino de hoje · fila zerada, o FSRS traz cada um na hora certa"}
            </span>
          </div>
          {total > 0 && (
            <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
              <CountDot color="var(--accent)" label="novos" value={novos} />
              <CountDot color="var(--warn)" label="aprendendo" value={aprendendo} />
              <CountDot color="var(--pos)" label="revisar" value={revisar} />
            </div>
          )}
        </div>
        {total > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <PrimaryButton onClick={() => onStudy(false)}>Estudar →</PrimaryButton>
            <SecondaryButton onClick={() => onStudy(true)} title="modo foco: tela cheia + áudio ambiente">◐ foco</SecondaryButton>
          </div>
        )}
      </div>
      {funRow(total === 0)}
    </div>
  );
}

// ── Seus baralhos: uma linha por tema, comparáveis entre si ─────────────────
// PONTUAÇÃO = % do baralho dominado (cards que graduaram pra revisão no FSRS).
// Eram tiles largos que não se comparavam; viraram linhas com a mesma barra na
// mesma posição. A fila do dia mora no hero; aqui é placar.
function DeckList({ decks }) {
  const tone = (pct) => (pct >= 70 ? "var(--pos)" : pct >= 40 ? "var(--warn)" : "var(--neg)");
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "18px 20px" }}>
      <div className="card-title">Seus baralhos</div>
      <div className="card-sub" style={{ marginTop: 3 }}>pontuação = cards que você já domina · a fila do dia mistura os temas sozinha</div>
      <div style={{ marginTop: 12 }}>
        {decks.map((d, i) => {
          const learned = d.learned || 0;
          const pct = d.total > 0 ? Math.round((learned / d.total) * 100) : 0;
          const c = tone(pct);
          const pend = d.counts.new + d.counts.learning + d.counts.review;
          const geral = d.role.startsWith("geral");
          return (
            <div key={d.role} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) 88px minmax(0,1fr) 150px", gap: 16, alignItems: "center", padding: "12px 0", borderBottom: i === decks.length - 1 ? "none" : "1px solid var(--line-1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
                <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: "var(--r-1)", background: geral ? "var(--bg-2)" : "var(--accent-soft)", color: geral ? "var(--fg-3)" : "var(--accent)", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  {geral ? "todo o time" : "sua vaga"}
                </span>
              </div>
              <div className="tnum" style={{ fontSize: 17, fontWeight: 700, color: c }} title={`${learned} de ${d.total} cards dominados`}>{pct}%</div>
              <div style={{ height: 7, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: c, transition: "width 200ms ease" }} />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg-4)", textAlign: "right" }}>
                {pend > 0 ? `${pend} no treino de hoje` : "nada pendente hoje"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Referências: abrem quando você precisa ──────────────────────────────────
// ICP, vagas e empresa/cultura são consulta, não rotina: cada um ocupava uma
// dobra inteira todo dia. Mesmo conteúdo, agora recolhido.
function RefRow({ title, hint, children, last }) {
  const [open, setOpen] = useS(false);
  return (
    <div style={{ padding: "12px 0", borderBottom: last ? "none" : "1px solid var(--line-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>{hint}</div>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="mono"
          style={{ background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
          {open ? "fechar ▴" : "abrir ▾"}
        </button>
      </div>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

function RefList() {
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "18px 20px" }}>
      <div className="kicker">Referências · abrem quando você precisa</div>
      <div style={{ marginTop: 8 }}>
        <RefRow title="ICP · quem a gente caça" hint="o perfil que fecha e a matriz da nota (contas × anúncios)">
          <IcpCard compact grade />
        </RefRow>
        <RefRow title="O papel de cada vaga" hint="mídia social → SDR → closer → CS · entender o vizinho é parte do jogo">
          <RolesGuide />
        </RefRow>
        <RefRow title="A empresa · missão, números e cultura" hint="o mapa que os cards aprofundam" last>
          <CompanyGuide />
        </RefRow>
      </div>
    </div>
  );
}

// ── Sua memória: você está lembrando? ───────────────────────────────────────
// A MESMA agregação da aba Equipe, recortada na pessoa (routes.flashcards.js):
// aluno e gestor nunca veem números diferentes do mesmo dado. Sem base ainda,
// mostra "—" em vez de 0% (zero por cento é uma afirmação; falta de dado não).
function MemoryCard({ stats }) {
  const m = stats?.memory;
  if (!m) return null;
  const pct = (v) => (v == null ? "—" : `${v}%`);
  const retTone = m.retention30d == null ? "var(--fg-4)" : m.retention30d >= 85 ? "var(--pos)" : m.retention30d >= 70 ? "var(--warn)" : "var(--neg)";
  const rows = [
    ["Retenção 30d", pct(m.retention30d), m.reviews30d ? `· ${m.reviews30d} rev.` : "", retTone],
    ["Cards maduros", m.mature != null ? String(m.mature) : "—", m.deckSize ? `· de ${m.deckSize}` : "", "var(--fg-1)"],
    ["Acerto de primeira", pct(m.firstTryPct), "", "var(--fg-1)"],
    ["Última prova", m.lastExam ? `${m.lastExam.score}%` : "—", m.examsDone ? `· ${m.examsDone} feita${m.examsDone === 1 ? "" : "s"}` : "", m.lastExam ? (m.lastExam.status === "failed" ? "var(--neg)" : "var(--pos)") : "var(--fg-4)"],
  ];
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "18px 20px" }}>
      <div className="kicker accent">Sua memória</div>
      <div style={{ marginTop: 10 }}>
        {rows.map(([label, value, extra, color], i) => (
          <div key={label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--line-1)" }}>
            <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{label}</span>
            <span style={{ textAlign: "right" }}>
              <b className="tnum" style={{ fontSize: 15, fontWeight: 700, color }}>{value}</b>
              {extra && <span className="mono dim" style={{ fontSize: 10.5, marginLeft: 5 }}>{extra}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Próxima prova: quanto falta pro checkpoint ──────────────────────────────
// Lê o gatilho REAL (a pilha de graduados que dispara a prova), então a barra
// nunca mente sobre quando cai. Prova desligada nas configurações = sem card.
function NextExamCard({ stats }) {
  const e = stats?.nextExam;
  if (!e) return null;
  const pct = e.every > 0 ? Math.min(100, Math.round((e.pool / e.every) * 100)) : 0;
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-2)", padding: "16px 18px" }}>
      <div className="kicker">Próxima prova</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
        <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700 }}>{e.remaining}</span>
        <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>card{e.remaining === 1 ? "" : "s"} aprendido{e.remaining === 1 ? "" : "s"} pra ela cair</span>
      </div>
      <div style={{ height: 7, marginTop: 10, borderRadius: 999, background: "var(--bg-1)", border: "1px solid var(--line-1)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: "var(--accent)", transition: "width 200ms ease" }} />
      </div>
      <div className="mono dim" style={{ fontSize: 10.5, marginTop: 8 }}>
        {`a prova de checkpoint cai a cada ${e.every} cards · nota mínima ${e.pass}%`}
      </div>
    </div>
  );
}

// ── Sessão (o coração do Anki): frente → virar → 1-4 ─────────────────────────
// Com focus=true a MESMA sessão (mesma fila, mesmo estado) veste a FocusShell:
// tela cheia escura, card maior, textos fora do card em branco translúcido —
// vars de tema só DENTRO de superfícies (--bg-1), que funcionam nos 2 temas.
function Session({ saasId, label, cards, dayEnd, onExit, focus, onToggleFocus, roleLabels, fun = false, onMore }) {
  const [queue, setQueue] = useS(cards);
  const [flipped, setFlipped] = useS(false);
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS(null);
  const [tally, setTally] = useS({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const total0 = useR(cards.length); // fila no início: denominador da barra
  const card = queue[0];
  const shownAt = useR(Date.now());
  useE(() => { shownAt.current = Date.now(); }, [card?.entryId || card?.id]); // cronômetro do card

  async function rate(rating) {
    if (!card || busy) return;
    setBusy(true); setErr(null);
    try {
      const id = card.entryId || card.id;
      const ms = Date.now() - shownAt.current;
      if (fun) {
        // 4fun: só registra. Sem estado FSRS, o card não volta nesta rodada.
        await api.trainingFunReview(saasId, id, rating, ms);
        setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
        setQueue((q) => q.slice(1));
      } else {
        const r = await api.trainingReview(saasId, id, rating, ms);
        setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
        setQueue((q) => {
          const rest = q.slice(1);
          // aprendendo com due ainda hoje volta NESTA sessão (learning steps do Anki)
          if (new Date(r.srs.due) <= new Date(dayEnd)) rest.push({ ...card, srs: r.srs, preview: r.preview });
          return rest;
        });
      }
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
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "20px 22px" }}>
          <div className="kicker accent" style={{ marginBottom: 8 }}>Sessão concluída · {label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 700, color: "var(--pos)" }}>{done}</span>
            <span style={{ fontSize: 15, color: "var(--fg-2)" }}>{fun ? "cards" : "revisões"} · {done ? Math.round((good / done) * 100) : 0}% bem lembradas</span>
          </div>
          <div className="mono dim" style={{ fontSize: 11.5, marginTop: 8 }}>
            {RATINGS.map((r) => <span key={r.rating} style={{ marginRight: 12, color: tally[r.rating] ? r.color : "var(--fg-4)" }}>{tally[r.rating]} {r.label.toLowerCase()}</span>)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 10, lineHeight: 1.5 }}>
            {fun
              ? "Rodada 4fun registrada. Não mexeu na sua agenda de revisões nem no compromisso do dia — foi estudo a mais, e ele aparece no seu raio-x."
              : "Fila de hoje zerada — o FSRS traz cada card de volta na hora certa. Volte amanhã."}
          </div>
        </div>
        {!fun && <ConsistencyCardLive saasId={saasId} />}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {fun && onMore && (
            <button onClick={onMore} style={{ ...btn, ...(focus ? { background: "transparent", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.2)" } : {}) }}>mais {FUN_ROUND} cards →</button>
          )}
          <button onClick={onExit} style={{ ...btn, ...(focus ? { background: "transparent", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.2)" } : {}) }}>← voltar</button>
        </div>
      </div>
    );
  } else {
    const bucket = !card.srs || card.srs.state === 0 ? "new" : card.srs.state === 2 ? "review" : "learning";
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: focus ? 16 : 12, width: "100%", maxWidth: focus ? 760 : 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: focus ? "center" : "flex-start" }}>
          {!focus && <button onClick={onExit} className="mono dim" style={{ fontSize: 12 }}>{fun ? "← sair do 4fun" : "← baralhos"}</button>}
          {!focus && <span style={{ flex: 1 }} />}
          {/* Os contadores ganharam RÓTULO: três números soltos não diziam o
              que cada um era, e a pessoa lia "6 4 12" sem saber o que somar. */}
          {fun
            ? <span className="mono tnum" style={{ fontSize: 12, color: focus ? inkDim : "var(--fg-3)" }}>{queue.length} na rodada</span>
            : COUNT.map((c) => (
              <CountDot key={c.key} color={c.color} label={c.label} value={counts[c.key]} dim={focus} size={13.5} />
            ))}
          {!focus && <button onClick={onToggleFocus} title="modo foco: tela cheia + áudio ambiente" className="mono dim" style={{ fontSize: 12, cursor: "pointer" }}>◐ foco</button>}
        </div>

        {!fun && <SessionProgress done={done} total={total0.current} dark={focus} />}

        {/* O card */}
        <div onClick={() => !flipped && setFlipped(true)}
          style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)",
            boxShadow: focus ? "0 24px 90px rgba(0,0,0,0.55)" : "var(--shadow-2)",
            padding: focus ? "34px 34px 28px" : "26px 26px 22px", minHeight: focus ? 220 : 190,
            display: "flex", flexDirection: "column", gap: 14, cursor: flipped ? "default" : "pointer" }}>
          <div className="kicker">{(roleLabels && roleLabels[card.role]) || label} · {fun ? "4fun" : bucket === "new" ? "card novo" : bucket === "review" ? "revisão" : "aprendendo"}{card.sub ? ` · ${card.sub}` : ""}</div>
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
                style={{ height: 58, borderRadius: "var(--r-2)", border: `1px solid ${r.color}`, background: r.bg, color: r.color, fontWeight: 700, fontSize: focus ? 14.5 : 13.5, cursor: "pointer", opacity: busy ? 0.6 : 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
                <span>{r.label} <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 11 }}>({r.rating})</span></span>
                {/* o intervalo é o que o FSRS agendaria pra ESTE card agora
                    (card.preview vem do previewIntervals) — nunca tabela fixa */}
                <span className="mono" style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>{card.preview?.[r.rating] || ""}</span>
              </button>
            ))}
          </div>
        )}
        {!focus && <div className="mono dim" style={{ fontSize: 10.5 }}>{fun
          ? "rodada livre: o clique aqui não agenda revisão nem entra na sua retenção — é treino a mais"
          : "seja honesto com você: o algoritmo só funciona se o clique refletir o que você lembrou de verdade"}</div>}
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
// ── Prova de checkpoint ─────────────────────────────────────────────────────
// UMA QUESTÃO POR VEZ (antes eram as oito numa rolagem única, o que convidava
// a responder no piloto automático e a comparar enunciados entre si).
//
// RECARREGAR NO MEIO: a prova CONTINUA de onde parou. As respostas e o índice
// ficam no sessionStorage da aba; perder sete respostas por um F5 acidental
// seria punição desproporcional, e a prova não é cronometrada. Fechar a aba
// reinicia (o servidor mantém a prova pendente, então nada se perde de fato),
// e as questões são as MESMAS porque o servidor congela a lista na abertura.
const examDraftKey = (id) => `cockpit_exam_${id}`;

function ExamScreen({ saasId, exam, onDone }) {
  const [data, setData] = useS(null);
  const [answers, setAnswers] = useS([]);
  const [idx, setIdx] = useS(0);
  const [result, setResult] = useS(null);
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS(null);
  const [showAll, setShowAll] = useS(false);

  useE(() => {
    let alive = true;
    api.trainingExamStart(saasId, exam.id)
      .then((d) => {
        if (!alive) return;
        setData(d);
        // retoma o rascunho da aba, se o tamanho ainda casar com a prova
        let draft = null;
        try { draft = JSON.parse(sessionStorage.getItem(examDraftKey(exam.id)) || "null"); } catch { /* ignore */ }
        const ok = draft && Array.isArray(draft.answers) && draft.answers.length === d.questions.length;
        setAnswers(ok ? draft.answers : d.questions.map(() => ({})));
        setIdx(ok ? Math.min(Number(draft.idx) || 0, d.questions.length - 1) : 0);
      })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [exam.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // guarda o rascunho a cada resposta/navegação (a aba sobrevive ao F5)
  useE(() => {
    if (!data || result) return;
    try { sessionStorage.setItem(examDraftKey(exam.id), JSON.stringify({ answers, idx })); } catch { /* cota cheia: segue sem rascunho */ }
  }, [answers, idx, data, result, exam.id]);

  const answered = (a, q) => (q.kind === "mc" ? Number.isInteger(a?.choice) : !!(a?.text || "").trim());
  const complete = data && answers.every((a, i) => answered(a, data.questions[i]));
  const doneCount = data ? answers.filter((a, i) => answered(a, data.questions[i])).length : 0;

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await api.trainingExamSubmit(saasId, exam.id, answers);
      setResult(r);
      try { sessionStorage.removeItem(examDraftKey(exam.id)); } catch { /* ignore */ }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const qCard = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 };

  if (err) return <div style={{ maxWidth: 720 }}><div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div><button onClick={onDone} style={{ ...btn, marginTop: 10 }}>← voltar</button></div>;
  if (!data) return <div className="mono dim" style={{ fontSize: 12 }}>montando sua prova…</div>;

  // ── Resultado: os erros primeiro ──────────────────────────────────────────
  if (result) {
    const tone = result.passed ? "var(--pos)" : "var(--neg)";
    const qs = result.questions || [];
    const wrong = qs.filter((q) => !q.correct);
    const right = qs.length - wrong.length;
    // o que a pessoa marcou, em texto (MC mostra a opção, não o índice)
    const mine = (q) => (q.kind === "mc" ? (Number.isInteger(q.choice) ? q.options[q.choice] : "—") : (q.text || "—"));
    const gabarito = (q) => (q.kind === "mc" ? q.options[q.answerIdx] : q.ideal);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
        <div style={{ border: `1px solid ${tone}`, background: result.passed ? "var(--pos-soft)" : "var(--neg-soft)", borderRadius: "var(--r-3)", padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 700, lineHeight: 1, color: tone }}>{result.score}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: tone }}>{result.passed ? "aprovado" : "reprovado"}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>· nota mínima {result.passScore}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--fg-1)", marginTop: 8, lineHeight: 1.5 }}>
            Acertou {right} de {qs.length}.
            {result.resetCount ? ` Os ${result.resetCount} card${result.resetCount === 1 ? "" : "s"} das questões erradas voltaram para a sua fila.` : ""}
          </div>
        </div>

        {wrong.length > 0 && (
          <div>
            <div className="kicker" style={{ marginBottom: 8 }}>O que você errou</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {wrong.map((q, i) => (
                <div key={i} style={{ ...qCard, borderLeft: "3px solid var(--neg)", gap: 7 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "pre-wrap" }}>{q.prompt}</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}><b>Sua resposta:</b> {mine(q)}</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}><b>Gabarito:</b> {gabarito(q)}</div>
                  {q.feedback && <div style={{ fontSize: 12, color: "var(--neg)", lineHeight: 1.45 }}>{q.feedback}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{right} acerto{right === 1 ? "" : "s"} conferido{right === 1 ? "" : "s"}</span>
          <button onClick={() => setShowAll((v) => !v)} className="mono"
            style={{ background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
            {showAll ? "esconder as questões ▴" : "ver todas as questões ▾"}
          </button>
        </div>
        {showAll && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {qs.map((q, i) => (
              <div key={i} style={{ ...qCard, borderLeft: `3px solid ${q.correct ? "var(--pos)" : "var(--neg)"}`, gap: 7 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "pre-wrap" }}>{i + 1}. {q.prompt}</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}><b>Sua resposta:</b> {mine(q)}</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}><b>Gabarito:</b> {gabarito(q)}</div>
                {q.feedback && <div style={{ fontSize: 12, color: q.correct ? "var(--pos)" : "var(--neg)", lineHeight: 1.45 }}>{q.feedback}</div>}
              </div>
            ))}
          </div>
        )}
        <PrimaryButton onClick={onDone}>← voltar aos baralhos</PrimaryButton>
      </div>
    );
  }

  // ── Durante: uma questão por vez ──────────────────────────────────────────
  const q = data.questions[idx];
  const last = idx === data.questions.length - 1;
  const a = answers[idx] || {};
  const set = (patch) => setAnswers((p) => p.map((x, k) => (k === idx ? patch : x)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
      <div>
        <div className="sec-title">Prova de checkpoint</div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
          {data.count} cards aprendidos · nota mínima {data.passScore} · sem consulta 😉
        </div>
      </div>
      <SessionProgress done={doneCount} total={data.questions.length} />

      <div style={qCard}>
        <div className="kicker">Questão {idx + 1} · {q.kind === "mc" ? "múltipla escolha" : "resposta escrita"}</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{q.prompt}</div>
        {q.kind === "mc" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {q.options.map((op, j) => {
              const on = a.choice === j;
              return (
                <button key={j} onClick={() => set({ choice: j })}
                  style={{ textAlign: "left", width: "100%", fontSize: 13, padding: "11px 13px", borderRadius: "var(--r-2)", cursor: "pointer", lineHeight: 1.45,
                    border: `1px solid ${on ? "var(--accent)" : "var(--line-2)"}`,
                    background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-1)", fontWeight: on ? 600 : 400 }}>
                  {op}
                </button>
              );
            })}
          </div>
        ) : (
          <textarea rows={4} value={a.text || ""} placeholder="responda com suas palavras — a IA corrige o conceito, não as palavras exatas"
            onChange={(e) => set({ text: e.target.value })}
            style={{ width: "100%", padding: "10px 12px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
        )}
      </div>

      {err && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{err}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SecondaryButton size="sm" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>← anterior</SecondaryButton>
        <button onClick={onDone} className="mono dim" style={{ fontSize: 12, cursor: "pointer" }}>deixar pra depois</button>
        <span style={{ flex: 1 }} />
        {last ? (
          <PrimaryButton onClick={submit} disabled={!complete || busy}>
            {busy ? "corrigindo…" : "entregar prova"}
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => setIdx((i) => Math.min(data.questions.length - 1, i + 1))}>próxima →</PrimaryButton>
        )}
      </div>
      {last && !complete && (
        <div className="mono dim" style={{ fontSize: 10.5 }}>
          faltam {data.questions.length - doneCount} questão(ões) sem resposta · volte com "← anterior"
        </div>
      )}
    </div>
  );
}

// ── Consistência: streak + heatmap de revisões (estilo GitHub) ───────────────
// Busca o stats e delega: é como a tela de fim de sessão mostra a consistência
// JÁ com a revisão de agora contada (o Study passa o dele, que é de antes).
function ConsistencyCardLive({ saasId }) {
  const [s, setS] = useS(null);
  useE(() => {
    let alive = true;
    api.trainingStats(saasId).then((d) => alive && setS(d)).catch(() => { /* widget é opcional */ });
    return () => { alive = false; };
  }, [saasId]);
  return <ConsistencyCard stats={s} />;
}

// O stats vem do Study (uma chamada alimenta os três cards do trilho).
function ConsistencyCard({ stats: s }) {
  if (!s) return <div className="mono dim" style={{ fontSize: 12 }}>carregando seu histórico…</div>;
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: 20 }}>
      <div className="kicker accent">Consistência</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
        <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 34, fontWeight: 700, lineHeight: 1, color: s.streak ? "var(--accent)" : "var(--fg-4)" }}>{s.streak}</span>
        <span style={{ fontSize: 13, color: "var(--fg-2)" }}>dia{s.streak === 1 ? "" : "s"} seguido{s.streak === 1 ? "" : "s"}</span>
      </div>
      <div className="mono dim" style={{ fontSize: 11.5, marginTop: 6, marginBottom: 12 }}>
        melhor {s.bestStreak}d · {s.doneToday} feitas hoje
        {s.fun?.total ? ` · 4fun ${s.fun.total} no total` : ""}
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

function Heatmap({ days, today, cell: cellPx = 11 }) {
  // 18 colunas de semanas (dom–sáb) terminando hoje. As chaves já são "dias
  // de estudo" (fuso SP, virada 4h) — a aritmética aqui é toda em UTC puro.
  // 18 e não 26 porque o trilho tem 372px: mais semanas obrigaria a célula a
  // cair abaixo de 9px, e aí o quadrado deixa de ser legível.
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 17 * 7);
  const max = Math.max(1, ...Object.values(days || {}));
  const weeks = [];
  let prevMonth = -1;
  for (let w = 0; w < 18; w++) {
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
  const cell = { width: cellPx, height: cellPx, borderRadius: 3 };
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

// ── Editar: mestre-detalhe ──────────────────────────────────────────────────
// A lista e o editor disputavam a mesma coluna: abrir um card empurrava a lista
// inteira pra baixo, e as configurações do baralho ficavam no meio da tela,
// entre a lista e o conteúdo. Agora a lista fica à esquerda, o editor à
// direita, e os ajustes viraram um recolhível no topo.
function Edit({ saasId, mode, setMode }) {
  const [cards, setCards] = useS(null);
  const [labels, setLabels] = useS({});
  const [settings, setSettings] = useS({ newPerDay: 10 });
  const [orig, setOrig] = useS(null);
  const [role, setRole] = useS("sdr");
  const [err, setErr] = useS(null);
  const [saving, setSaving] = useS(false);
  const [note, setNote] = useS(null);
  const [sel, setSel] = useS(null);       // card aberto no editor
  const [q, setQ] = useS("");
  const [cfg, setCfg] = useS(false);      // ajustes do baralho recolhidos

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
  // Quantas mudanças o botão vai gravar: card novo, removido ou editado conta
  // uma; mexer nos ajustes conta uma. É o número que o botão promete salvar.
  const changeCount = (() => {
    if (!cards || !orig) return 0;
    const o = JSON.parse(orig);
    const before = new Map((o.cards || []).map((c) => [c.id, JSON.stringify(c)]));
    let n = 0;
    for (const c of cards) {
      const b = before.get(c.id);
      if (b === undefined || b !== JSON.stringify(c)) n++;
      before.delete(c.id);
    }
    n += before.size; // removidos
    if (JSON.stringify(o.settings || {}) !== JSON.stringify(settings || {})) n++;
    return n;
  })();

  // Toda vaga com card na base vira aba (inclusive as gerais e roles novos).
  const rolesPresent = [...new Set((cards || []).map((c) => c.role))];
  const roleTabs = [...new Set([...rolesPresent, "sdr", "closer"])].sort((a, b) => roleOrderIdx(a) - roleOrderIdx(b));
  const roleCards = (cards || []).filter((c) => c.role === role);
  const norm = (x) => String(x || "").toLowerCase();
  const shown = q.trim() ? roleCards.filter((c) => norm(`${c.front} ${c.back}`).includes(norm(q))) : roleCards;
  const current = roleCards.find((c) => c.id === sel) || null;

  async function save() {
    setSaving(true); setNote(null);
    try {
      const r = await api.saveFlashcards(saasId, cards, settings);
      setCards(r.cards); setSettings(r.settings); setOrig(JSON.stringify({ cards: r.cards, settings: r.settings }));
      setNote({ ok: true, text: "base salva pro time — cards novos entram como 'novo' pra cada um" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setSaving(false);
  }
  function reset() { if (orig) { const o = JSON.parse(orig); setCards(o.cards); setSettings(o.settings || { newPerDay: 10 }); setSel(null); } }
  function patchCard(id, field, value) { setCards((p) => p.map((c) => (c.id === id ? { ...c, [field]: value } : c))); }
  function addCard() {
    const id = uid();
    setCards((p) => [{ id, role, type: "basic", front: "", back: "" }, ...(p || [])]); // entra no topo
    setSel(id);
    setQ("");
  }
  function removeCard(id) {
    setCards((p) => p.filter((c) => c.id !== id));
    if (sel === id) setSel(null);
  }

  return (
    <div style={page}>
      <Head mode={mode} setMode={setMode}>
        {dirty && <button onClick={reset} disabled={saving} className="mono dim" style={{ fontSize: 11.5, cursor: "pointer" }}>descartar</button>}
        <SecondaryButton size="sm" onClick={save} disabled={!dirty || saving}
          style={dirty ? { background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", border: "1px solid var(--btn-bg, var(--accent))", fontWeight: 600 } : undefined}>
          {saving ? "salvando…" : dirty ? `Salvar ${changeCount} mudança${changeCount === 1 ? "" : "s"}` : "Salvar"}
        </SecondaryButton>
      </Head>
      {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
      {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
      {!cards && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando flashcards…</div>}
      {cards && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {roleTabs.map((r) => (
              <FilterTab key={r} active={r === role} count={cards.filter((c) => c.role === r).length}
                onClick={() => { setRole(r); setSel(null); }}>
                {labels[r] || r}
              </FilterTab>
            ))}
            <span style={{ flex: 1 }} />
            <span className="mono dim" style={{ fontSize: 11 }}>
              Ajustes do baralho · {settings.newPerDay} novos/dia · {settings.examEvery > 0 ? `prova a cada ${settings.examEvery}` : "prova desligada"}
            </span>
            <button onClick={() => setCfg((v) => !v)} className="mono"
              style={{ background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
              {cfg ? "fechar ▴" : "abrir ▾"}
            </button>
          </div>

          {cfg && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-inset)", padding: "12px 14px" }}>
              <label className="mono dim" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}>
                novos/dia
                <input type="number" min={0} max={200} value={settings.newPerDay}
                  onChange={(e) => setSettings((s) => ({ ...s, newPerDay: Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0))) }))}
                  style={{ width: 58, height: 26, padding: "0 8px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12 }} />
              </label>
              <ExamSettings settings={settings} setSettings={setSettings} />
            </div>
          )}

          <div className="editor-split" style={{ "--cols": "minmax(min(100%, 420px), 420px) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
            <CardList cards={shown} total={roleCards.length} q={q} setQ={setQ} sel={sel} onSelect={setSel}
              onAdd={addCard} roleLabel={labels[role] || role} />
            {current
              ? <CardEditor key={current.id} card={current} saasId={saasId} onPatch={patchCard} onRemove={removeCard} />
              : (
                <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "28px 24px" }}>
                  <EmptyState title="Escolha um card pra editar" hint="ou crie um novo na lista ao lado. A base é do TIME: card novo entra como 'novo' pra todo mundo e card removido some pra todo mundo. O ritmo de cada pessoa continua individual." />
                </div>
              )}
          </div>
          <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
            cloze e oclusão viram vários sub-cards · cole imagem com Ctrl+V dentro do editor
          </div>
        </>
      )}
    </div>
  );
}

// ── A lista (mestre) ────────────────────────────────────────────────────────
function CardList({ cards, total, q, setQ, sel, onSelect, onAdd, roleLabel }) {
  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", overflow: "hidden", position: "sticky", top: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--line-1)" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar na frente ou no verso…"
          style={{ flex: 1, minWidth: 0, height: 30, padding: "0 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 }} />
        <SecondaryButton size="sm" onClick={onAdd}>+ card</SecondaryButton>
      </div>
      <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
        {cards.length === 0 && (
          <div className="mono dim" style={{ fontSize: 11.5, padding: "16px 14px" }}>
            {q.trim() ? "nada com esse texto neste baralho" : "nenhum card ainda — crie o primeiro"}
          </div>
        )}
        {cards.map((c) => {
          const on = c.id === sel;
          const subs = subCountOf(c);
          const front = stripCloze(c.front).trim();
          const back = String(c.back || "").trim();
          const vazio = !front;
          return (
            <div key={c.id} onClick={() => onSelect(c.id)}
              style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", cursor: "pointer", background: on ? "var(--accent-soft)" : "transparent" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: vazio ? "var(--warn)" : "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {vazio ? "card novo · sem frente" : front}
                </div>
                {back && !vazio && (
                  <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{back}</div>
                )}
              </div>
              <span className="mono" style={{ fontSize: 9.5, color: vazio ? "var(--warn)" : "var(--fg-3)", border: `1px solid ${vazio ? "var(--warn-line)" : "var(--line-2)"}`, borderRadius: 9, padding: "1px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>
                {vazio ? "rascunho" : `${TYPE_LABEL[c.type] || "básico"}${subs > 0 ? ` · ${subs}` : ""}`}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mono dim" style={{ fontSize: 10.5, padding: "10px 14px", borderTop: "1px solid var(--line-1)" }}>
        {`${total} card${total === 1 ? "" : "s"} em ${roleLabel}${q.trim() ? ` · mostrando ${cards.length}` : ""}`}
      </div>
    </div>
  );
}

const capStyle = { display: "block", marginBottom: 3 };
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
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "8px 12px" }}>
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

// Preview fiel: renderiza com o MESMO componente da sessão (CardFace), então o
// que o gestor vê aqui é exatamente o que o time vai ver estudando.
function CardPreview({ card }) {
  const [flip, setFlip] = useS(false);
  const sub = card.type === "cloze" ? `c${clozeIdxs(card.front)[0] || 1}`
    : card.type === "occlusion" ? (card.masks?.[0]?.id || null) : null;
  return (
    <div style={{ minWidth: 0 }}>
      <div className="kicker">Como o time vai ver</div>
      <div onClick={() => setFlip((f) => !f)}
        style={{ marginTop: 8, border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", boxShadow: "var(--shadow-2)", padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10, minHeight: 150 }}>
        <div className="kicker">{flip ? "verso" : "frente"}{sub ? ` · ${sub}` : ""}</div>
        <CardFace card={{ ...card, sub }} flipped={flip} />
      </div>
      <button onClick={() => setFlip((f) => !f)} className="mono"
        style={{ marginTop: 8, background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
        virar o card
      </button>
    </div>
  );
}

function CardEditor({ card, saasId, onPatch, onRemove }) {
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

  // Excluir é destrutivo e a base é do TIME: confirma nomeando o card e a
  // consequência (régua do cockpit pra toda ação destrutiva).
  function remove() {
    const nome = stripCloze(card.front).trim() || "este card sem frente";
    const ok = window.confirm(`Excluir "${nome.slice(0, 80)}"?\n\nO card sai do baralho de TODO o time na próxima gravação.`);
    if (ok) onRemove(card.id);
  }

  return (
    <div onPaste={onPaste} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="card-title" style={{ flex: 1, minWidth: 120 }}>Editar card</div>
        <div style={{ display: "flex", gap: 4 }}>
          {CARD_TYPES.map((t) => (
            <button key={t.id} onClick={() => onPatch(card.id, "type", t.id)} className="mono"
              style={{ height: 24, padding: "0 10px", borderRadius: "var(--r-2)", fontSize: 11, cursor: "pointer",
                border: `1px solid ${type === t.id ? "var(--accent-line)" : "var(--line-2)"}`,
                background: type === t.id ? "var(--accent-soft)" : "transparent",
                color: type === t.id ? "var(--accent)" : "var(--fg-3)", fontWeight: type === t.id ? 600 : 400 }}>{t.label}</button>
          ))}
        </div>
        {onRemove && (
          <SecondaryButton size="sm" onClick={remove}
            style={{ color: "var(--neg)", borderColor: "var(--neg)", background: "var(--neg-soft)" }}>
            excluir card
          </SecondaryButton>
        )}
      </div>
      <div className="editor-split" style={{ "--cols": "minmax(0,1fr) minmax(min(100%, 320px), 320px)", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>

      {type === "occlusion" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label><span className="kicker" style={capStyle}>Pergunta (opcional) · aparece acima da imagem</span>
            <textarea rows={1} value={card.front || ""} onChange={(e) => onPatch(card.id, "front", e.target.value)} placeholder="ex.: O que fica neste campo do CRM?" style={areaStyle} /></label>
          {card.image
            ? <OcclusionEditor card={card} onPatch={onPatch} />
            : <ImageAttach saasId={saasId} value={card.image} onChange={(id) => onPatch(card.id, "image", id)} hint="a oclusão precisa de uma imagem — cole (Ctrl+V) ou escolha o arquivo" />}
          <label><span className="kicker" style={capStyle}>Verso (opcional) · explicação extra ao virar</span>
            <textarea rows={1} value={card.back || ""} onChange={(e) => onPatch(card.id, "back", e.target.value)} style={areaStyle} /></label>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label><span className="kicker" style={capStyle}>{type === "cloze" ? <>Texto · marque deleções com {"{{c1::…}}"}</> : "Frente · a pergunta"}</span>
              <textarea ref={frontRef} rows={3} value={card.front || ""} onChange={(e) => onPatch(card.id, "front", e.target.value)}
                placeholder={type === "cloze" ? "ex.: A escada é {{c1::anual}} → {{c2::semestral}} → {{c3::serviço único}}" : "ex.: Objeção: 'tá caro'"}
                style={{ ...areaStyle, minHeight: 76 }} /></label>
            <label><span className="kicker" style={capStyle}>{type === "cloze" ? "Verso (opcional) · contexto extra" : "Verso · a resposta"}</span>
              <textarea rows={4} value={card.back || ""} onChange={(e) => onPatch(card.id, "back", e.target.value)} placeholder={type === "cloze" ? "" : "a técnica / resposta ideal"}
                style={{ ...areaStyle, minHeight: 110 }} /></label>
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
      <CardPreview card={card} />
      </div>
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

// ── Equipe: de quem cuidar hoje ─────────────────────────────────────────────
// A tabela tinha dez colunas de peso igual e o gestor lia tudo pra descobrir
// quem precisa dele. Agora são sete, a ordem é por URGÊNCIA e a faixa de cima
// responde "como está o time" antes de qualquer linha. As colunas que saíram
// não se perderam: viraram o raio-x, que abre clicando na pessoa.
//
// Pede atenção quem tem card atrasado, prova pendente ou reprovada, ou memória
// abaixo do piso (retenção < 70% com base pra afirmar isso).
const needsAttention = (u) =>
  u.overdue > 0 || u.examPending || u.examsFailed > 0 || (u.retention30d?.n > 0 && u.retention30d.pct < 70);
// Urgência: prova pendente domina, porque ela BLOQUEIA o treino da pessoa (o
// hero dela mostra a prova no lugar da fila, então nada mais anda até fazer);
// depois atrasado, que pesa mais que fila do dia; reprovada entra na escala
// contínua, porque não trava nada, só sinaliza.
const urgencyOf = (u) =>
  (u.examPending ? 1000 : 0) + (u.overdue || 0) * 10 + (u.dueToday || 0) + (u.examsFailed || 0) * 8;

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

  const users = (data?.users || []).filter((u) => u.deckSize > 0)
    .sort((a, b) => urgencyOf(b) - urgencyOf(a) || String(a.name).localeCompare(String(b.name)));
  const selected = users.find((u) => u.id === sel);

  // Resumo do time, tudo derivado do que a tela já carregou.
  const emDia = users.filter((u) => !u.dueToday).length;
  const atrasados = users.reduce((a, u) => a + (u.overdue || 0), 0);
  const rets = users.map((u) => u.retention30d).filter((r) => r?.n > 0).map((r) => r.pct);
  const retMedia = rets.length ? Math.round(rets.reduce((a, b) => a + b, 0) / rets.length) : null;
  const reprovas = users.reduce((a, u) => a + (u.examsFailed || 0), 0);
  const pendentes = users.filter((u) => u.examPending).length;
  const atencao = users.filter(needsAttention).length;

  const GRID = "230px 150px minmax(180px,1fr) 130px 110px 150px 200px";
  const HEAD = { display: "grid", gridTemplateColumns: GRID, gap: 16, padding: "8px 16px", background: "var(--bg-2)", borderBottom: "1px solid var(--line-1)" };
  const ROW = { display: "grid", gridTemplateColumns: GRID, gap: 16, padding: "10px 16px", alignItems: "center", borderTop: "1px solid var(--line-1)", cursor: "pointer" };

  function Resumo() {
    const item = (label, value, color) => (
      <div style={{ minWidth: 120 }}>
        <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{label}</div>
        <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700, marginTop: 2, color: color || "var(--fg-1)" }}>{value}</div>
      </div>
    );
    return (
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "20px 24px", display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
        {item("Em dia hoje", `${emDia} de ${users.length}`, emDia === users.length ? "var(--pos)" : undefined)}
        {item("Retenção média 30d", retMedia == null ? "—" : `${retMedia}%`, retColor(retMedia))}
        {item("Cards atrasados", atrasados, atrasados ? "var(--neg)" : "var(--pos)")}
        {item("Provas", `${reprovas} reprova${reprovas === 1 ? "" : "s"}`, reprovas ? "var(--neg)" : undefined)}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: atencao ? "var(--neg)" : "var(--pos)", flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
            {atencao ? `${atencao} ${atencao === 1 ? "pessoa pede" : "pessoas pedem"} atenção` : "ninguém pedindo atenção"}
            {pendentes ? ` · ${pendentes} prova${pendentes === 1 ? "" : "s"} pendente${pendentes === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      </div>
    );
  }

  function Linha({ u }) {
    const on = u.id === sel;
    const ret = u.retention30d?.pct;
    const retC = retColor(ret);
    // Hoje: ponto + palavra (nunca pílula). Atrasado é o que dói, então vem
    // com a contagem na frente.
    const hoje = u.overdue > 0
      ? { tone: "var(--neg)", text: `${u.dueToday} · ${u.overdue} atrasados` }
      : u.dueToday > 0
        ? { tone: "var(--warn)", text: `${u.dueToday} pra hoje` }
        : { tone: "var(--pos)", text: "em dia" };
    // A ação nomeia o que fazer e abre o raio-x, que é onde o gestor entende o
    // problema antes de falar com a pessoa. Sem gênero: o cadastro não diz.
    const acao = u.examPending ? "Cobrar prova →"
      : u.overdue > 0 ? "Cobrar o treino →"
      : (ret != null && ret < 70) ? "Ver o raio-x →" : null;
    return (
      <div onClick={() => setSel(on ? null : u.id)} style={{ ...ROW, background: on ? "var(--accent-soft)" : "transparent" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <Avatar id={u.id} name={u.name} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
            <div className="kicker" style={{ marginTop: 1 }}>{(u.roles || []).join(" · ") || "sem vaga"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--fg-2)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: hoje.tone, flexShrink: 0 }} />
          <span className="tnum">{hoje.text}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }} title={`${u.retention30d?.n || 0} revisões de card maduro nos últimos 30 dias`}>
          <b className="tnum" style={{ fontSize: 14, fontWeight: 700, color: retC, width: 40, flexShrink: 0 }}>{ret == null ? "—" : `${ret}%`}</b>
          <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden", minWidth: 40 }}>
            <div style={{ width: `${ret || 0}%`, height: "100%", borderRadius: 999, background: retC }} />
          </div>
        </div>
        <div className="tnum" style={{ fontSize: 12.5, color: "var(--fg-2)" }}>{u.mature} / {u.seen}</div>
        <div className="tnum" style={{ fontSize: 12.5, color: u.streak ? "var(--fg-1)" : "var(--fg-4)" }}>{u.streak ? `${u.streak}d` : "—"}</div>
        <div style={{ fontSize: 12.5 }}>
          {u.examsDone ? (
            <>
              <b className="tnum" style={{ color: retColor(u.examAvg) }}>{u.examAvg}%</b>
              <span className="mono dim" style={{ fontSize: 10.5 }}>
                {u.examsFailed ? ` · ${u.examsFailed} reprova${u.examsFailed === 1 ? "" : "s"}` : ` · ${u.examsDone} feita${u.examsDone === 1 ? "" : "s"}`}
              </span>
            </>
          ) : <span style={{ color: "var(--fg-4)" }}>{u.examPending ? "1 pendente" : "—"}</span>}
        </div>
        <div style={{ textAlign: "right" }}>
          {acao
            ? <SecondaryButton size="sm" onClick={() => setSel(u.id)}>{acao}</SecondaryButton>
            : <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{needsAttention(u) ? "acompanhar" : "—"}</span>}
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <Head mode={mode} setMode={setMode} />
      {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
      {!data && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando equipe…</div>}
      {data && (users.length === 0 ? <EmptyState title="Ninguém com baralho ainda" hint="Dê vagas (SDR/closer/…) pros usuários em Ajustes." /> : (
        <>
          <Resumo />
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
            <div className="tbl-x">
              <div>
                <div style={HEAD}>
                  <span className="kicker">Pessoa</span>
                  <span className="kicker">Hoje</span>
                  <span className="kicker" title="acerto nos cards que já estavam em revisão — memória real">Retenção 30d</span>
                  <span className="kicker" title="cards com intervalo ≥ 21 dias — conhecimento consolidado">Maduros</span>
                  <span className="kicker">Sequência</span>
                  <span className="kicker" title="provas de checkpoint: média das notas · clique na pessoa pra ver as questões">Provas</span>
                  <span className="kicker" style={{ textAlign: "right" }}>Ação</span>
                </div>
                {users.map((u) => <Linha key={u.id} u={u} />)}
              </div>
            </div>
          </div>
          {selected ? <PersonDetail user={selected} today={data.today} saasId={saasId} /> :
            <div className="mono dim" style={{ fontSize: 10.5 }}>clique numa pessoa pra abrir o raio-x · ordem por urgência: atrasado e prova travada primeiro</div>}
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

// ── Provas de checkpoint: a nota E o que caiu ────────────────────────────────
// A prova sempre gravou tudo (questões, o que a pessoa marcou ou escreveu, o
// gabarito e o feedback da IA), mas na tela só saía "83%". Aqui o gestor abre
// cada prova e lê pergunta por pergunta — é o que separa "não estudou" de
// "o card está confuso". Abrir é do admin ou do dono da prova (a API repete o
// guard); pra prova pendente o gabarito NUNCA é servido.
function ExamHistory({ user: u, saasId }) {
  const [open, setOpen] = useS(null);
  const [detail, setDetail] = useS(null);
  const [err, setErr] = useS(null);
  const exams = u.exams || [];
  const me = currentUser();
  const canSee = isAdminUser() || me?.id === u.id;
  const dt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

  async function toggle(id) {
    if (open === id) { setOpen(null); setDetail(null); return; }
    setOpen(id); setDetail(null); setErr(null);
    try { setDetail(await api.trainingExamDetail(saasId, id)); }
    catch (e) { setErr(e.message || "não deu pra abrir a prova"); }
  }

  return (
    <div>
      <div className="kicker" style={{ marginBottom: 8 }}>
        Provas de checkpoint{u.examsDone ? ` · média ${u.examAvg}% · ${u.examsDone} feita${u.examsDone === 1 ? "" : "s"}` : ""}
        {u.examsFailed ? ` · ${u.examsFailed} reprova${u.examsFailed === 1 ? "" : "s"}` : ""}
        {u.examPending ? " · 1 pendente" : ""}
      </div>
      {!exams.length ? (
        <div className="mono dim" style={{ fontSize: 11.5 }}>
          {u.examPending ? "prova pendente, ainda não respondida — ela cai sozinha a cada N cards aprendidos (o N está em Editar)" : "nenhuma prova respondida ainda"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {exams.map((e) => (
            <div key={e.id} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", overflow: "hidden" }}>
              <div onClick={() => canSee && toggle(e.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", flexWrap: "wrap", cursor: canSee ? "pointer" : "default" }}>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-3)", minWidth: 96 }}>{dt(e.finishedAt)}</span>
                <b className="tnum" style={{ fontSize: 14, color: e.status === "passed" ? "var(--pos)" : "var(--neg)" }}>{e.score}%</b>
                <span style={{ fontSize: 12, color: e.status === "passed" ? "var(--pos)" : "var(--neg)" }}>{e.status === "passed" ? "aprovado" : "reprovado"}</span>
                <span className="mono dim" style={{ fontSize: 11 }}>{e.questions} questões</span>
                <span style={{ flex: 1 }} />
                {canSee && <span className="mono dim" style={{ fontSize: 11 }}>{open === e.id ? "fechar ▲" : "ver questões ▼"}</span>}
              </div>
              {open === e.id && (
                <div style={{ borderTop: "1px solid var(--line-1)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {err && <div className="mono" style={{ fontSize: 11.5, color: "var(--neg)" }}>{err}</div>}
                  {!detail && !err && <div className="mono dim" style={{ fontSize: 11.5 }}>abrindo…</div>}
                  {detail?.questions?.map((q, i) => (
                    <div key={i}>
                      <div className="kicker">
                        Questão {i + 1} · {q.kind === "mc" ? "múltipla escolha" : "digitada (corrigida por IA)"} ·{" "}
                        <span style={{ color: q.correct ? "var(--pos)" : "var(--neg)" }}>{q.correct ? "acertou" : "errou"}</span>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--fg-1)", marginTop: 4, whiteSpace: "pre-wrap" }}>{q.prompt}</div>
                      {q.kind === "mc" ? (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                          {(q.options || []).map((opt, j) => {
                            const chosen = j === q.choice, right = j === q.answerIdx;
                            return (
                              <div key={j} style={{ fontSize: 12.5, color: right ? "var(--pos)" : chosen ? "var(--neg)" : "var(--fg-3)" }}>
                                {right ? "✓" : chosen ? "✗" : "·"} {opt}{chosen ? <span className="mono dim" style={{ fontSize: 10.5 }}> (marcou)</span> : null}
                              </div>
                            );
                          })}
                          {q.choice == null || q.choice < 0 ? <div className="mono dim" style={{ fontSize: 10.5 }}>deixou em branco</div> : null}
                        </div>
                      ) : (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
                          <div><span className="kicker">respondeu </span><span style={{ color: q.correct ? "var(--pos)" : "var(--neg)" }}>{q.text || "(em branco)"}</span></div>
                          <div><span className="kicker">esperado </span><span style={{ color: "var(--fg-2)" }}>{q.ideal}</span></div>
                          {q.feedback && <div className="mono dim" style={{ fontSize: 11 }}>IA: {q.feedback}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!canSee && <div className="mono dim" style={{ fontSize: 10.5 }}>as questões de outra pessoa só o admin abre</div>}
        </div>
      )}
    </div>
  );
}

// ── Raio-x da pessoa: agrupado, não nove tiles soltos ───────────────────────
// Eram nove números lado a lado sem hierarquia. Agora três blocos que respondem
// perguntas diferentes: MEMÓRIA (ela está lembrando?), RITMO (ela está
// estudando?) e PROVAS (ela provou?). Os gráficos ficam embaixo, cada um com a
// unidade no próprio rótulo pra dispensar eixo.
function PersonDetail({ user: u, today, saasId }) {
  const sub = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-2)", padding: "14px 16px" };
  const pct = (x) => (x == null ? "—" : `${x}%`);
  const big = (v, color) => <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: color || "var(--fg-1)" }}>{v}</span>;
  const mid = (v, color) => <span className="tnum" style={{ fontSize: 16, fontWeight: 650, color: color || "var(--fg-1)" }}>{v}</span>;
  const line = (node, hint) => (
    <div style={{ marginTop: 10 }}>
      {node}
      <div className="mono dim" style={{ fontSize: 9.5, marginTop: 1 }}>{hint}</div>
    </div>
  );
  const dow = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  const dm = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const weekly = u.weekly || [], forecast = u.forecast || [];
  const forecastMax = Math.max(1, ...forecast.map((f) => f.n));
  const lastTone = u.lastExam ? (u.lastExam.status === "passed" ? "var(--pos)" : "var(--neg)") : undefined;

  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="kicker accent">Raio-x · {u.name}</div>

      <div className="resp-cols" style={{ "--cols": "repeat(3, minmax(0,1fr))", gap: 14 }}>
        {/* Ela está LEMBRANDO? */}
        <div style={sub}>
          <div className="kicker">Memória</div>
          {line(big(pct(u.retention30d?.pct), retColor(u.retention30d?.pct)), `retenção 30d · ${u.retention30d?.n || 0} rev.`)}
          {line(big(pct(u.retention7d?.pct), retColor(u.retention7d?.pct)), `retenção 7d · ${u.retention7d?.n || 0} rev.`)}
          {line(mid(pct(u.firstTryPct)), "acerto de primeira 30d")}
          {line(mid(`${u.mature} · ${u.young}`), "maduros · jovens")}
          {u.retentionByRole?.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 5 }}>
              <div className="kicker">Por baralho (30d)</div>
              {u.retentionByRole.map((r) => (
                <div key={r.role} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5 }}>
                  <span style={{ flex: 1, minWidth: 0, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
                  <b className="tnum" style={{ color: retColor(r.pct) }}>{pct(r.pct)}</b>
                  <span className="mono dim" style={{ fontSize: 9.5 }}>{r.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ela está ESTUDANDO? */}
        <div style={sub}>
          <div className="kicker">Ritmo</div>
          {line(big(u.reviewsPerDay30d), "revisões/dia 30d")}
          {line(big(`${u.activeDays30d}/30`), "dias ativos")}
          {u.medianMs != null
            ? line(
                mid(`${(u.medianMs / 1000).toFixed(1)}s`, u.rushPct > 20 ? "var(--neg)" : undefined),
                <>tempo/card · <span style={{ color: u.rushPct > 20 ? "var(--neg)" : undefined }}>{u.rushPct}% relâmpago</span></>,
              )
            : line(mid("—"), "tempo/card · sem base ainda")}
          {line(mid(u.fun?.total ? `${u.fun.last30}` : "—", u.fun?.total ? "var(--accent)" : undefined),
            u.fun?.total ? `4fun 30d · ${u.fun.total} no total${u.fun.hitPct != null ? ` · ${u.fun.hitPct}% bem` : ""}` : "4fun 30d · nunca estudou a mais")}
        </div>

        {/* Ela PROVOU? */}
        <div style={sub}>
          <div className="kicker">Provas</div>
          {line(big(u.lastExam ? `${u.lastExam.score}%` : "—", lastTone),
            u.lastExam ? `última prova · ${u.lastExam.status === "passed" ? "aprovada" : "reprovada"}` : "última prova · nenhuma ainda")}
          {line(big(u.examsDone || 0),
            `feitas${u.examsFailed ? ` · ${u.examsFailed} reprova${u.examsFailed === 1 ? "" : "s"}` : ""}${u.examPending ? " · 1 pendente" : ""}`)}
          <div style={{ marginTop: 12 }}>
            <ExamHistory user={u} saasId={saasId} />
          </div>
        </div>
      </div>

      <div className="resp-cols" style={{ "--cols": "minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr)", gap: 20, paddingTop: 14, borderTop: "1px solid var(--line-1)" }}>
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>Retenção por semana <span style={{ textTransform: "none" }}>(0–100%)</span></div>
          <MiniBars max={100} bars={weekly.map((w, i) => ({
            v: w.pct, label: i === 0 || i === 7 ? dm(w.start) : "",
            title: w.pct == null ? `sem revisões · semana de ${dm(w.start)}` : `${w.pct}% · ${w.n} revisões · semana de ${dm(w.start)}`,
          }))} />
        </div>
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>Vencendo nos próximos 7 dias <span style={{ textTransform: "none" }}>(cards)</span></div>
          <MiniBars max={forecastMax} bars={forecast.map((f) => ({
            v: f.n, label: dow(f.day), title: `${f.n} card${f.n === 1 ? "" : "s"} · ${dm(f.day)}`,
          }))} />
        </div>
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>Constância <span style={{ textTransform: "none" }}>(revisões por dia)</span></div>
          <Heatmap days={u.days || {}} today={today} cell={9} />
        </div>
      </div>
    </div>
  );
}

// ── A empresa, as vagas e seus processos ─────────────────────────────────────
// Manual vivo: o que a LeverAds faz, missão/visão, os 5 pilares de cultura e o
// papel de cada vaga NA ORDEM DO FUNIL (mídia social → SDR → closer → CS), em
// linguagem simples pra qualquer pessoa do time entender o todo.
// ESPELHO em packages/api/src/company.leverads.js (LEVERADS_COMPANY): a API não
// importa daqui; alterou o texto, altera lá (teste blog-knowledge compara o `what`).
const COMPANY = {
  what: "Somos uma empresa de tecnologia que escala operações de venda em marketplace. Construímos uma plataforma própria que publica e mantém anúncios sincronizados entre várias contas de Mercado Livre e Shopee, com estoque integrado e ficha técnica completada por IA. Vendemos por assinatura, com preço fixo e sem taxa por pedido, e entregamos a operação do cliente rodando já na primeira semana. Somos um time enxuto que opera tudo dentro do nosso próprio cockpit: da primeira ligação ao acompanhamento pós-venda, cada etapa tem processo, dado e responsável.",
  mission: "Ser o motor tecnológico que faz uma operação de marketplace crescer sem crescer o time: o que levaria meses de trabalho manual, a gente entrega em minutos.",
  vision: "Ser a plataforma padrão de operação de marketplace no Brasil, o sistema que roda por trás de quem vende em escala.",
  facts: [
    { k: "Produto", v: "Plataforma SaaS de operação em marketplace (Mercado Livre e Shopee): publicação em várias contas, sincronização, estoque integrado e IA na ficha técnica." },
    { k: "Modelo", v: "Assinatura anual com preço fixo, sem percentual por pedido. Tudo que lançamos durante o contrato entra sem custo extra." },
    { k: "Mercado", v: "Lojistas que já vendem em marketplace e querem crescer operando mais contas sem inchar o time." },
    { k: "Como operamos", v: "Time enxuto em 4 frentes (mídia social, pré-venda, vendas e sucesso do cliente), com processo e métrica de ponta a ponta no cockpit." },
  ],
  pillars: [
    { t: "Velocidade", d: "Lead novo se atende em minutos, cliente novo roda no dia seguinte. Quem chega primeiro e entrega rápido, ganha." },
    { t: "Mostrar rodando, não prometer", d: "A gente prova ao vivo: demo na conta do cliente, case com print real. Falar é fácil; nós mostramos." },
    { t: "Honestidade sempre", d: "O que não temos, a gente diz que não tem. Expectativa certa na venda é cliente satisfeito na entrega." },
    { t: "Dono do processo", d: "Cada um segue e registra o seu processo: toque registrado, card atualizado, dado na mão. O sistema só ajuda quem alimenta ele." },
    { t: "Cliente vira fã", d: "Entrega bem feita vira resultado, resultado vira case, case vira indicação. É assim que a gente cresce." },
  ],
};

const ROLE_GUIDES = [
  {
    role: "social", title: "Mídia social", tagline: "Traz gente pra dentro: anúncios e redes sociais",
    respons: "É quem enche o topo do funil e mantém a marca viva. Cria os anúncios que atraem lojistas com a dor certa e cuida das redes sociais (Instagram/Facebook) com cases, bastidores e demonstrações da plataforma.",
    processo: [
      "Cria anúncios em vídeo falando das dores reais do lojista (perdeu uma conta, não tem braço pra operar, quer vender mais)",
      "Publica, acompanha o que funciona e desliga o que cansou",
      "Coloca mais verba no que traz cliente bom, não só lead barato",
      "Mantém as redes sociais ativas: resultados de clientes, bastidores e a ferramenta em ação",
    ],
  },
  {
    role: "sdr", title: "SDR", tagline: "O primeiro contato: transformar cadastro em call marcada",
    respons: "É quem fala primeiro com o lead que se cadastrou. Liga rápido, entende o tamanho da operação e marca a conversa com o especialista.",
    processo: [
      "Liga pra quem se cadastrou o mais rápido possível (lead novo é sempre a prioridade)",
      "Confirma as informações básicas: o que vende, quantas contas tem, quantos anúncios",
      "Marca a call com o especialista oferecendo 2 opções de horário",
      "Antes da call, confirma a presença e lembra o cliente de entrar logado nas contas",
      "Se o lead some, insiste um pouco, descansa e tenta de novo depois; furou a call, remarca",
    ],
  },
  {
    role: "closer", title: "Closer", tagline: "A call de venda: mostrar funcionando e fechar",
    respons: "É quem conduz a call e transforma interesse em cliente. Mostra a plataforma funcionando ao vivo na operação do próprio lead e fecha o negócio ainda na conversa.",
    processo: [
      "Começa entendendo a operação do cliente: o que vende, quantas contas, qual a maior dor",
      "Mostra a plataforma AO VIVO publicando anúncios de verdade nas contas dele",
      "Usa resultados reais de clientes pra dar segurança (a Unique cresceu 105% no 1º mês)",
      "Apresenta o plano e fecha com pagamento ainda na call",
      "Sai da call com a integração agendada pro dia seguinte; não fechou, combina o próximo passo com data",
    ],
  },
  {
    role: "integrator", title: "Integrador · CS", tagline: "Entrega e cuidado: cliente rodando e renovando",
    respons: "É quem recebe o cliente que acabou de fechar e cuida dele pelo contrato inteiro. Deixa a operação rodando no dia seguinte e acompanha pra garantir resultado.",
    processo: [
      "Faz a call de integração: conecta as contas e deixa a operação rodando na tela do cliente",
      "Acompanha de perto a primeira semana pra garantir que está tudo funcionando",
      "Faz contatos regulares ao longo do contrato: 1º mês, 3º mês, 6º mês e antes da renovação",
      "Fica de olho em sinal de abandono (cliente sumido, sem usar) e age no mesmo dia",
      "Cliente com resultado vira case da empresa e fonte de indicação de novos clientes",
    ],
  },
];

// A empresa: o que fazemos, os números, missão/visão e os 5 pilares. Mesmo
// conteúdo de antes; só deixou de ocupar a dobra todo dia (vive numa linha das
// Referências, no Estudar).
function CompanyGuide() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* O que a empresa faz + missão/visão */}
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-inset)", padding: "18px 20px" }}>
        <div className="kicker">Quem somos</div>
        <div style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.6, marginTop: 6, maxWidth: 900 }}>{COMPANY.what}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px 20px", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line-faint)" }}>
          {COMPANY.facts.map((f) => (
            <div key={f.k}>
              <div className="kicker">{f.k}</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5, marginTop: 4 }}>{f.v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line-faint)" }}>
          <div>
            <div className="kicker">Missão</div>
            <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.55, marginTop: 4 }}>{COMPANY.mission}</div>
          </div>
          <div>
            <div className="kicker">Visão</div>
            <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.55, marginTop: 4 }}>{COMPANY.vision}</div>
          </div>
        </div>
      </div>

      {/* Os 5 pilares de cultura */}
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-inset)", padding: "18px 20px" }}>
        <div className="kicker">Os 5 pilares da nossa cultura</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 12 }}>
          {COMPANY.pillars.map((pl, i) => (
            <div key={i} style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 12 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{i + 1}. {pl.t}</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5, marginTop: 3 }}>{pl.d}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// As vagas na ordem do funil (a segunda linha das Referências).
function RolesGuide() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 14, alignItems: "start" }}>
        {ROLE_GUIDES.map((g, gi) => (
          <div key={g.role} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-inset)", padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono tnum" style={{ fontSize: 11, color: "var(--fg-4)" }}>{gi + 1}</span>
              <div className="card-title">{g.title}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, marginTop: 2 }}>{g.tagline}</div>
            <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.55, marginTop: 10 }}>{g.respons}</div>
            <div className="kicker" style={{ margin: "12px 0 6px" }}>Como funciona no dia a dia</div>
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
// atualiza a contagem; zerou, o cockpit libera sozinho. Falha da API nunca
// tranca a tela (fail-open).
// ADMIN NUNCA É TRAVADO, mesmo tendo vaga: Leo e Jonathan fecham venda e o Eryk
// integra, mas o treinamento é opcional pra quem toca o negócio. Sem esta
// exceção o portão prendia justamente quem precisa entrar no cockpit pra
// trabalhar.
const GATE_ROLES = ["sdr", "closer", "integrator", "social"];

function TrainingGate({ saasId, active }) {
  const { version } = useData();
  const [pending, setPending] = useS(null); // null = sem dado (não trava)
  const me = currentUser();
  const gated = !!me && !isAdminUser(me) && (me.roles || []).some((r) => GATE_ROLES.includes(r));
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

// TrainingScreen/TrainingGate são o que o app monta. Os outros saem daqui pro
// smoke de render (scripts/smoke-ssr.mjs) poder exercitar os estados que o SSR
// não alcança pela tela inteira (fila vazia, raio-x, card sem frente): os
// dados chegam por efeito, que não roda no SSR.
export { TrainingScreen, TrainingGate, StartCard, DeckList, MemoryCard, NextExamCard, SessionProgress, PersonDetail, CardList, urgencyOf, needsAttention };
