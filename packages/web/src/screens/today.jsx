import React from "react";
import { Avatar, EmptyState } from "../atoms.jsx";
import { PageHead, Pill } from "../components/viz.jsx";
import { waLink, leadTier } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { stageKind, phaseOf, workableStages, cadenceOf } from "../lib/funnel.js";
import { allUsers, currentUser, displayName } from "../lib/users.js";
import { useActiveSaas } from "../lib/workspace.js";
import { resolveScript, scriptTokens, scriptSegments, scriptChecklist } from "../lib/scripts.js";
// Meu dia — a fila de execução de quem opera o funil. Sequencia, em ordem
// cronológica, tudo que o usuário precisa fazer HOJE com os leads do produto
// ativo: atrasados primeiro (recuperar), depois os compromissos com horário
// (toques do GPS, calls, integrações), os leads novos sem horário (SLA de 1º
// contato) e por fim o que está sem próximo passo. Cada item carrega a
// situação compilada do lead (potencial, qualificação, tentativas) e o botão
// Roteiro: o script daquela etapa com os dados do lead já encaixados na fala.

const { useState: useS, useMemo: useM, useEffect: useE } = React;

const TOUCH_TYPES = new Set(["whatsapp", "call", "email", "meeting"]);
const DAY = 86400000;

// Rótulo da ação por kind — o "o que fazer" do item, não o nome do estágio.
const ACTION_LABELS = {
  novo: "1º contato",
  contato: "tentativa",
  qualificacao: "qualificar",
  call: "call",
  proposta: "cobrar proposta",
  followup: "follow-up",
  integracao: "integração",
  posvenda: "pós-venda",
  outro: "contato",
};

const TIER_ORDER = { alto: 3, medio: 2, baixo: 1, sem: 0 };

// Monta a fila do dia: um item por lead trabalhável que exige ação até hoje.
function buildQueue(leads, saasCfg, person) {
  const workable = new Set(workableStages(saasCfg));
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const endTomorrow = new Date(endToday); endTomorrow.setDate(endTomorrow.getDate() + 1);

  const g = { late: [], today: [], fresh: [], loose: [] };
  let tomorrow = 0;

  for (const l of leads) {
    if (saasCfg && l.saas !== saasCfg.id) continue;
    const stage = l.stage || saasCfg?.funnel?.[0]?.stage || "";
    if (l.stage && !workable.has(l.stage)) continue;
    const kind = stageKind(saasCfg, stage);
    const phase = phaseOf(kind);
    // Responsável da vez: SDR (dono) na pré-venda; closer/integrador dali em diante.
    const who = phase === "sdr" ? (l.owner || "") : (l.closer || l.owner || "");
    // Filtro de pessoa: itens do responsável + fila sem dono (qualquer um pega).
    if (person && who && who !== person) continue;

    // Compromisso mais próximo do lead: toque do GPS, call marcada ou integração.
    const cands = [];
    const push = (v, type) => { const t = v ? new Date(v).getTime() : NaN; if (Number.isFinite(t)) cands.push({ t, type }); };
    push(l.nextActionAt, "toque");
    push(l.callAt, "call");
    if (kind === "integracao") push(l.integrationAt, "integração");
    cands.sort((a, b) => a.t - b.t);
    const due = cands[0] || null;

    // Toque já registrado hoje = item cumprido (fica na fila, riscado).
    const done = due?.type !== "call" && TOUCH_TYPES.has(l.lastActivityType) &&
      l.lastActivityAt && new Date(l.lastActivityAt).toDateString() === new Date().toDateString();

    const item = { l, kind, phase, who, due, done, stage };
    if (due && due.t < startToday.getTime()) g.late.push(item);
    else if (due && due.t <= endToday.getTime()) g.today.push(item);
    else if (due && due.t <= endTomorrow.getTime()) tomorrow++;
    else if (!due && kind === "novo") g.fresh.push(item);
    else if (!due) g.loose.push(item);
  }

  g.late.sort((a, b) => a.due.t - b.due.t);
  g.today.sort((a, b) => a.due.t - b.due.t);
  g.fresh.sort((a, b) => new Date(a.l.createdAt || 0) - new Date(b.l.createdAt || 0)); // mais antigo primeiro (SLA)
  g.loose.sort((a, b) => (TIER_ORDER[leadTier(b.l).key] - TIER_ORDER[leadTier(a.l).key]) || (Number(b.l.score) || 0) - (Number(a.l.score) || 0));
  return { ...g, tomorrow };
}

function TodayScreen({ onOpenLead }) {
  const { version } = useData();
  const [activeProduct] = useActiveSaas();
  const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === activeProduct?.id) || activeProduct;
  const me = currentUser()?.id || "";

  const [leads, setLeads] = useS(() => (window.SEED?.LEADS || []).map((l) => ({ ...l })));
  useE(() => { setLeads((window.SEED?.LEADS || []).map((l) => ({ ...l }))); }, [version]);

  // Fila de quem: padrão o usuário logado; admin pode inspecionar a de qualquer um.
  const [person, setPersonState] = useS(() => {
    try { const v = localStorage.getItem("cockpit_today_person"); if (v != null) return v; } catch { /* ignore */ }
    return me;
  });
  const setPerson = (p) => {
    setPersonState(p);
    try { localStorage.setItem("cockpit_today_person", p); } catch { /* ignore */ }
  };
  const [scriptItem, setScriptItem] = useS(null); // item com o painel de roteiro aberto

  const q = useM(() => buildQueue(leads, saasCfg, person), [leads, saasCfg, person]);
  const sections = [
    ["Atrasado · recuperar primeiro", q.late, "neg"],
    ["Hoje", q.today, "accent"],
    ["Novos leads · ligar assim que possível", q.fresh, "warn"],
    ["Sem próximo passo · agendar ou descartar", q.loose, "mut"],
  ].filter(([, rows]) => rows.length > 0);
  const all = [...q.late, ...q.today, ...q.fresh, ...q.loose];
  const doneCount = all.filter((i) => i.done).length;

  // Toque direto da fila: vira activity, o servidor conta a tentativa e re-agenda
  // o GPS (onActivityCreated). Espelho local pra resposta imediata.
  function logTouch(item) {
    const l = item.l;
    const cad = cadenceOf(saasCfg, item.stage);
    const now = Date.now();
    setLeads((prev) => prev.map((x) => x.id === l.id ? {
      ...x,
      stageAttempts: (Number(x.stageAttempts) || 0) + 1,
      lastActivityAt: new Date(now).toISOString(),
      lastActivityType: "call",
      ...(cad.retryDays ? { nextActionAt: new Date(now + cad.retryDays * DAY).toISOString() } : {}),
    } : x));
    api.logActivity({ saas: l.saas, lead: l.id, type: "call", text: "tentativa de contato (meu dia)", author: me })
      .catch((err) => console.warn("toque não registrado:", err.message));
  }

  // Lead novo sem dono: quem clica assume (vira o SDR do lead).
  function claim(item) {
    const ownerId = person || me;
    if (!ownerId) return;
    setLeads((prev) => prev.map((x) => x.id === item.l.id ? { ...x, owner: ownerId } : x));
    api.update("leads", item.l.id, { owner: ownerId }).catch((err) => console.warn("dono não salvo:", err.message));
  }

  const users = allUsers().filter((u) => !u.saas || u.saas === saasCfg?.id);
  const dateLabel = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  let seq = 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Meu dia"
        sub={`${dateLabel} · ${all.length} ${all.length === 1 ? "ação na fila" : "ações na fila"}${q.late.length ? ` · ${q.late.length} em atraso` : ""}`}>
        {all.length > 0 && (
          <Pill tone={doneCount >= all.length ? "pos" : "mut"} title="toques registrados hoje nos itens da fila">
            {doneCount}/{all.length} feitas
          </Pill>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>fila de</span>
          <select value={person} onChange={(e) => setPerson(e.target.value)}
            style={{ height: 26, padding: "0 8px", borderRadius: "var(--r-2)", fontSize: 12, background: "var(--bg-2)", border: "1px solid var(--line-1)", color: "var(--fg-1)" }}>
            <option value="">time todo</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.id === me ? `${u.name || u.id} (eu)` : (u.name || u.id)}</option>)}
          </select>
        </span>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)" }}>
        {all.length === 0 ? (
          <EmptyState
            title="Fila limpa"
            hint={person ? "Nenhuma ação pendente pra hoje nessa fila. Confira o pipeline ou puxe leads novos." : "Nenhuma ação pendente pra hoje."}
          />
        ) : (
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
            {sections.map(([label, rows, tone]) => (
              <React.Fragment key={label}>
                <div className="mono" style={{
                  padding: "8px 14px", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: tone === "neg" ? "var(--neg)" : tone === "accent" ? "var(--accent)" : tone === "warn" ? "var(--warn)" : "var(--fg-3)",
                  background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)",
                }}>
                  {label} · {rows.length}
                </div>
                {rows.map((item) => {
                  seq += 1;
                  return (
                    <QueueRow key={item.l.id} item={item} seq={seq} saasCfg={saasCfg}
                      onOpen={() => onOpenLead && onOpenLead(item.l)}
                      onScript={() => setScriptItem(item)}
                      onTouch={() => logTouch(item)}
                      onClaim={() => claim(item)}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        )}
        {q.tomorrow > 0 && (
          <div className="mono dim" style={{ fontSize: 11, padding: "10px 2px" }}>
            amanhã: {q.tomorrow} {q.tomorrow === 1 ? "contato já agendado" : "contatos já agendados"}
          </div>
        )}
      </div>

      {scriptItem && (
        <ScriptPanel
          item={scriptItem}
          saasCfg={saasCfg}
          onClose={() => setScriptItem(null)}
          onTouch={() => { logTouch(scriptItem); setScriptItem(null); }}
          onOpenLead={() => { setScriptItem(null); onOpenLead && onOpenLead(scriptItem.l); }}
        />
      )}
    </div>
  );
}

// Uma linha da fila: sequência, quando, o que fazer, quem é o lead (com a
// qualificação compilada) e as ações. Clique no corpo abre o drawer do lead.
function QueueRow({ item, seq, saasCfg, onOpen, onScript, onTouch, onClaim }) {
  const { l, kind, due, done, stage, who, phase } = item;
  const tier = leadTier(l);
  const wa = waLink(l.phone);
  const now = Date.now();

  // Pill de horário: atrasado (dias) · agora · hoje HH:mm · novo (idade).
  const startToday = new Date().setHours(0, 0, 0, 0);
  let when;
  if (due && due.t < startToday) {
    const daysLate = Math.max(1, Math.ceil((startToday - due.t) / DAY));
    when = { text: `atrasado ${daysLate}d`, tone: "neg" };
  } else if (due && due.t <= now) {
    when = { text: due.type === "call" ? "call agora" : "agora", tone: "neg" };
  } else if (due) {
    when = { text: new Date(due.t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), tone: due.type === "call" ? "pos" : "mut" };
  } else if (kind === "novo") {
    const ageH = l.createdAt ? Math.max(0, Math.floor((now - new Date(l.createdAt).getTime()) / 3600000)) : null;
    when = { text: ageH == null ? "novo" : ageH < 24 ? `há ${ageH}h` : `há ${Math.floor(ageH / 24)}d`, tone: "warn" };
  } else when = { text: "sem data", tone: "mut" };

  // Qualificação compilada: nicho · contas · anúncios (o resumo da situação).
  const chips = scriptChecklist(saasCfg, l).filter((c) => c.value).map((c) => c.value);
  const cad = cadenceOf(saasCfg, stage);
  const attempts = Number(cad.maxAttempts) ? `${Math.min(Number(l.stageAttempts) || 0, Number(cad.maxAttempts))}/${cad.maxAttempts}` : null;
  const showTouch = due?.type !== "call";
  const unowned = phase === "sdr" && !l.owner;

  return (
    <div onClick={onOpen} style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      padding: "10px 14px", borderBottom: "1px solid var(--line-1)", cursor: "pointer",
      opacity: done ? 0.55 : 1, background: "transparent",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      <span className="mono tnum" style={{
        width: 26, height: 26, borderRadius: "var(--r-1)", flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: done ? "var(--pos-soft)" : "var(--bg-inset)", border: "1px solid var(--line-1)",
        color: done ? "var(--pos)" : "var(--fg-3)", fontSize: 11.5, fontWeight: 700,
      }}>{done ? "✓" : seq}</span>

      <span style={{ width: 76, flexShrink: 0, textAlign: "left" }}>
        <Pill tone={when.tone}>{when.text}</Pill>
      </span>

      <span className="mono" style={{ width: 96, flexShrink: 0, fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {ACTION_LABELS[kind] || "contato"}
      </span>

      <span style={{ flex: 1, minWidth: 180 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {tier.grade && (
            <span className="tnum" title={`${tier.label} (contas + anúncios)`} style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: tier.tone, color: tier.badgeFg, fontFamily: "var(--display)", fontSize: 11, fontWeight: 700,
            }}>{tier.grade}</span>
          )}
          <span style={{ fontSize: 13.5, fontWeight: 600, textDecoration: done ? "line-through" : "none" }}>{l.name}</span>
          {l.company && <span className="dim" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company}</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
          <span className="mono dim" style={{ fontSize: 10.5 }}>{stage}</span>
          {chips.slice(0, 3).map((c, i) => <Pill key={i} tone="mut">{c}</Pill>)}
          {attempts && <Pill tone="mut" title="toques feitos nesta etapa">{attempts} toques</Pill>}
          {due?.type === "toque" && l.nextActionNote && <span className="dim" style={{ fontSize: 11 }}>{l.nextActionNote}</span>}
        </span>
      </span>

      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
        {who && <span title={displayName(who)}><Avatar id={who} name={displayName(who)} size={20} /></span>}
        {unowned && (
          <button onClick={onClaim} title="Assumir esse lead (vira o SDR dono)"
            style={{ height: 24, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px dashed var(--line-2)", background: "var(--bg-2)", color: "var(--fg-3)", fontSize: 11 }}>
            assumir
          </button>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" title={`WhatsApp · ${l.phone}`}
            className="mono" style={{ fontSize: 11, color: "#128c4b", textDecoration: "none" }}>Wpp ↗</a>
        )}
        {showTouch && !done && (
          <button onClick={onTouch} title="Registrar tentativa de contato (vira toque na timeline; o GPS re-agenda sozinho)"
            style={{ height: 24, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11 }}>
            ✓ toque
          </button>
        )}
        <button onClick={onScript} title="Abrir o roteiro desta etapa com os dados do lead"
          style={{ height: 24, padding: "0 10px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 11.5, fontWeight: 600 }}>
          Roteiro
        </button>
      </span>
    </div>
  );
}

// Painel do roteiro: postura + objetivo + passos com a fala pronta (dados do
// lead encaixados; o que falta vira lacuna destacada) + checklist de dados.
function ScriptPanel({ item, saasCfg, onClose, onTouch, onOpenLead }) {
  const { l } = item;
  const script = resolveScript(saasCfg, l);
  const tokens = scriptTokens(l, saasCfg);
  const checklist = scriptChecklist(saasCfg, l);
  const wa = waLink(l.phone);
  const tier = leadTier(l);

  const renderFala = (text) => scriptSegments(text, tokens).map((s, i) => {
    if (s.text != null) return <React.Fragment key={i}>{s.text}</React.Fragment>;
    if (s.value != null) return <strong key={i} style={{ color: "var(--accent)", fontWeight: 600 }}>{s.value}</strong>;
    return (
      <span key={i} className="mono" title="dado não preenchido no lead: descubra nesta conversa"
        style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 4, padding: "0 5px", fontSize: "0.85em", whiteSpace: "nowrap" }}>
        {s.gap}
      </span>
    );
  });

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "10px 12px", background: "var(--bg-inset)" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(620px, 100%)", maxHeight: "min(86vh, 100%)", overflowY: "auto",
        background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)",
        boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "start", gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Roteiro · {script.titulo}{script.custom ? " · personalizado da etapa" : ""}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {l.name}
              {tier.grade && (
                <span className="tnum" style={{ width: 18, height: 18, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tier.tone, color: tier.badgeFg, fontFamily: "var(--display)", fontSize: 11, fontWeight: 700 }}>{tier.grade}</span>
              )}
              <span className="chip">{item.stage}</span>
            </div>
            {(l.company || l.phone) && (
              <div className="mono dim" style={{ fontSize: 11.5, marginTop: 2 }}>
                {[l.company, l.phone].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <button onClick={onClose} className="mono dim" style={{ fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...box, background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
            <div className="mono" style={{ ...kicker, color: "var(--accent)", marginBottom: 4 }}>Como se comportar</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{script.resumo}</div>
          </div>

          <div style={box}>
            <div className="mono" style={{ ...kicker, marginBottom: 4 }}>Objetivo do contato</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, fontWeight: 500 }}>{script.objetivo}</div>
          </div>

          <div>
            <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Dados do lead · confirme o que estiver faltando</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6 }}>
              {checklist.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, padding: "5px 8px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: c.value ? "var(--bg-1)" : "var(--warn-soft)" }}>
                  <span style={{ color: c.value ? "var(--pos)" : "var(--warn)", flexShrink: 0, fontSize: 12 }}>{c.value ? "✓" : "○"}</span>
                  <span className="dim" style={{ flexShrink: 0, fontSize: 11 }}>{c.label}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 500, textAlign: "right" }}>{c.value || "perguntar"}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Passo a passo</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {script.passos.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <span className="mono tnum" style={{
                    width: 20, height: 20, borderRadius: 999, flexShrink: 0, marginTop: 1,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: "var(--bg-inset)", border: "1px solid var(--line-2)", fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)",
                  }}>{i + 1}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {p.t && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{p.t}</div>}
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--fg-1)", borderLeft: "3px solid var(--accent-line)", paddingLeft: 10, whiteSpace: "pre-wrap" }}>
                      {renderFala(p.fala)}
                    </div>
                    {p.dica && <div className="dim" style={{ fontSize: 11, marginTop: 3, paddingLeft: 13 }}>{p.dica}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "12px 18px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", gap: 8, flexWrap: "wrap", position: "sticky", bottom: 0 }}>
          <button onClick={onTouch} style={{ padding: "8px 14px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600 }}
            title="Registra a tentativa na timeline do lead; o GPS agenda o próximo passo sozinho">
            ✓ registrar toque
          </button>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer"
              style={{ padding: "8px 14px", borderRadius: "var(--r-2)", border: "1px solid #25D36655", color: "#128c4b", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>
              WhatsApp ↗
            </a>
          )}
          <button onClick={onOpenLead} style={{ padding: "8px 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5 }}>
            abrir lead completo
          </button>
          <button onClick={onClose} className="mono dim" style={{ marginLeft: "auto", fontSize: 12 }}>fechar</button>
        </div>
      </div>
    </div>
  );
}

export { TodayScreen };
