import React from "react";
import { Avatar, EmptyState } from "../atoms.jsx";
import { PageHead, Pill } from "../components/viz.jsx";
import { waLink, leadTier } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { stageKind, phaseOf, workableStages, openStages, cadenceOf, rollToBusinessDay } from "../lib/funnel.js";
import { allUsers, currentUser, displayName, userById } from "../lib/users.js";
import { useActiveSaas } from "../lib/workspace.js";
import { resolveScript, scriptTokens, scriptSegments, scriptChecklist } from "../lib/scripts.js";
// Meu dia — a fila de execução de quem opera o funil, agrupada POR DIA:
// "Hoje" (a fila de trabalho, numerada na ordem de prioridade do processo),
// "Amanhã" e "Próximos dias" (o que já está agendado, à vista), e "Sem data".
// Dentro de cada dia vale a mesma prioridade: horário marcado → novos →
// qualificando → follow-ups → nutrição. Formato de tabela (Quando · Etapa ·
// Ação · Lead). "Começar a fila" abre o roteiro do 1º pendente de HOJE e
// "toque e próximo" segue em sequência até zerar o dia.

const { useState: useS, useMemo: useM, useEffect: useE } = React;

const TOUCH_TYPES = new Set(["whatsapp", "call", "email", "meeting"]);
const DAY = 86400000;

// Rótulo da ação por kind — o "o que fazer" do item, não o nome do estágio.
const ACTION_LABELS = {
  novo: "1º contato",
  contato: "tentativa",
  qualificacao: "retomada",
  call: "call",
  proposta: "cobrar proposta",
  followup: "follow-up",
  integracao: "integração",
  posvenda: "pós-venda",
  outro: "contato",
};

const TIER_ORDER = { alto: 3, medio: 2, baixo: 1, sem: 0 };

// Ordem de atendimento dentro de cada dia (Leo, jul/2026): horário marcado é
// inadiável; novos são prioridade máxima; depois retomadas de qualificação,
// follow-ups, nutrição e o que ficou sem agenda.
const GROUP_ORDER = ["appt", "novo", "qual", "closer", "nutri", "loose"];

// Fase do processo → papel que trabalha nela. Card SEM responsável só entra na
// fila de quem tem o papel da fase: SDR não vê follow-up/integração soltos
// (exclusivos de closer/integrador) e closer não herda a fila de novos.
const PHASE_ROLE = { sdr: "sdr", closer: "closer", entrega: "integrator" };

// Blocos por dia. "Hoje" SEMPRE aparece (vazio ganha a mensagem de descanso);
// os demais só quando têm itens.
const DAY_BLOCKS = [
  ["hoje", "Hoje", "accent"],
  ["amanha", "Amanhã", "warn"],
  ["proximos", "Próximos dias", "mut"],
  ["semdata", "Sem data · agendar ou descartar", "mut"],
];

// Grade compartilhada entre cabeçalho e linhas — é o que mantém as colunas
// alinhadas (dentro de .tbl-x, com rolagem horizontal no mobile).
const GRID = { display: "grid", gridTemplateColumns: "30px 100px 140px 110px minmax(240px, 1fr) max-content", gap: 10, alignItems: "center" };

// Monta a fila: um item por lead trabalhável, no bloco do dia certo e
// classificado no grupo de prioridade (que define a ordem dentro do bloco).
function buildQueue(leads, saasCfg, person) {
  const workable = new Set(workableStages(saasCfg));
  const open = new Set(openStages(saasCfg));
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const endTomorrow = new Date(endToday); endTomorrow.setDate(endTomorrow.getDate() + 1);

  const g = { hoje: [], amanha: [], proximos: [], semdata: [] };
  let doneToday = 0;
  // Papéis de quem é a fila (sdr/closer/integrator) — decide quais cards sem
  // dono aparecem. Fila "time todo" (person vazio) mostra tudo.
  const personRoles = person ? new Set(userById(person)?.roles || []) : null;

  for (const l of leads) {
    if (saasCfg && l.saas !== saasCfg.id) continue;
    const stage = l.stage || saasCfg?.funnel?.[0]?.stage || "";
    if (l.stage && !workable.has(l.stage)) continue;
    const kind = stageKind(saasCfg, stage);
    const phase = phaseOf(kind);
    // Responsável da vez: SDR (dono) na pré-venda; closer/integrador dali em
    // diante (SÓ o campo closer: quem chegou em Follow-up passou pela call, e o
    // dono da conversa é o closer que a fez — dono SDR antigo não puxa o card).
    const who = phase === "sdr" ? (l.owner || "") : (l.closer || "");
    // Filtro de pessoa: card atribuído à pessoa sempre entra; card SEM dono só
    // entra pra quem tem o papel da fase (SDR não vê follow-up/integração).
    if (person) {
      if (who) { if (who !== person) continue; }
      else {
        const need = PHASE_ROLE[phase];
        if (!need || !personRoles.has(need)) continue;
      }
    }

    // Progresso do dia: todo lead trabalhável tocado hoje conta, mesmo que o
    // toque já tenha re-agendado o GPS (o item muda de bloco, o feito fica).
    if (TOUCH_TYPES.has(l.lastActivityType) && l.lastActivityAt &&
      new Date(l.lastActivityAt).toDateString() === new Date().toDateString()) doneToday++;

    // Compromisso mais próximo do lead. Call/integração SÓ contam de hoje em
    // diante: data velha esquecida no card não é compromisso, é histórico — o
    // agendamento vivo é o do GPS (nextActionAt).
    const cands = [];
    const push = (v, type, min = 0) => {
      const t = v ? new Date(v).getTime() : NaN;
      if (Number.isFinite(t) && t >= min) cands.push({ t, type });
    };
    push(l.nextActionAt, "toque");
    push(l.callAt, "call", startToday.getTime());
    if (kind === "integracao") push(l.integrationAt, "integração", startToday.getTime());
    cands.sort((a, b) => a.t - b.t);
    const due = cands[0] || null;

    // Toque já registrado hoje = item cumprido (fica na fila, riscado).
    const done = due?.type !== "call" && TOUCH_TYPES.has(l.lastActivityType) &&
      l.lastActivityAt && new Date(l.lastActivityAt).toDateString() === new Date().toDateString();

    // Grupo de prioridade (define a ordem e o rótulo da ação).
    const group = !due
      ? (kind === "novo" ? "novo" : "loose")
      : due.type !== "toque" ? "appt"
      : kind === "novo" ? "novo"
      : !open.has(stage) ? "nutri"
      : phase === "sdr" ? "qual"
      : "closer";

    const item = { l, kind, phase, who, due, done, stage, group };

    // Bloco do dia: novo sem agendamento é trabalho de HOJE (SLA corre).
    if (!due) g[kind === "novo" ? "hoje" : "semdata"].push(item);
    else if (due.t <= endToday.getTime()) g.hoje.push(item);
    else if (due.t <= endTomorrow.getTime()) g.amanha.push(item);
    else g.proximos.push(item);
  }

  // Ordem dentro do bloco: prioridade do processo; no empate, novos por chegada
  // (SLA), agendados pelo horário e os sem data pelo potencial.
  const rank = (i) => GROUP_ORDER.indexOf(i.group);
  const tiebreak = (a, b) => {
    // Novos sempre por ordem de chegada (SLA): quem espera há mais tempo primeiro.
    if (a.group === "novo") return new Date(a.l.createdAt || 0) - new Date(b.l.createdAt || 0);
    if (a.due && b.due) return a.due.t - b.due.t;
    if (a.due || b.due) return a.due ? -1 : 1;
    return (TIER_ORDER[leadTier(b.l).key] - TIER_ORDER[leadTier(a.l).key]) || (Number(b.l.score) || 0) - (Number(a.l.score) || 0);
  };
  for (const k of Object.keys(g)) g[k].sort((a, b) => rank(a) - rank(b) || tiebreak(a, b));
  return { ...g, doneToday };
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
  const total = q.hoje.length + q.amanha.length + q.proximos.length + q.semdata.length;

  // Próximo item pendente DEPOIS deste na fila de HOJE — o "toque e próximo".
  function nextAfter(item) {
    const idx = q.hoje.findIndex((i) => i.l.id === item.l.id);
    return q.hoje.find((i, j) => j > idx && !i.done && i.l.id !== item.l.id) || null;
  }

  // Toque direto da fila: vira activity, o servidor conta a tentativa, re-agenda
  // o GPS (pulando fim de semana) e, em estágio "novo", move o lead sozinho pra
  // Qualificando. Espelho local pra resposta imediata; o SSE ressincroniza.
  function logTouch(item) {
    const l = item.l;
    const cad = cadenceOf(saasCfg, item.stage);
    const now = Date.now();
    setLeads((prev) => prev.map((x) => x.id === l.id ? {
      ...x,
      stageAttempts: (Number(x.stageAttempts) || 0) + 1,
      lastActivityAt: new Date(now).toISOString(),
      lastActivityType: "call",
      ...(cad.retryDays ? { nextActionAt: rollToBusinessDay(new Date(now + cad.retryDays * DAY)).toISOString() } : {}),
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

  // Edição inline dos dados do lead (checklist do roteiro). Otimista.
  function patchLead(leadId, patch) {
    setLeads((prev) => prev.map((x) => x.id === leadId ? { ...x, ...patch } : x));
    api.update("leads", leadId, patch).catch((err) => console.warn("lead não salvo:", err.message));
  }

  const users = allUsers().filter((u) => !u.saas || u.saas === saasCfg?.id);
  const stageMeta = Object.fromEntries((saasCfg?.funnel || []).map((f) => [f.stage, f]));
  const dateLabel = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const firstPending = q.hoje.find((i) => !i.done);
  const headCell = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" };
  const blockTone = { accent: "var(--accent)", warn: "var(--warn)", mut: "var(--fg-3)" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Meu dia"
        sub={`${dateLabel} · ${q.hoje.length} pra hoje · ${q.amanha.length} pra amanhã`}>
        {q.doneToday > 0 && (
          <Pill tone={q.hoje.every((i) => i.done) ? "pos" : "mut"} title="leads tocados hoje nesta fila">
            {q.doneToday} {q.doneToday === 1 ? "feita hoje" : "feitas hoje"}
          </Pill>
        )}
        {firstPending && (
          <button onClick={() => setScriptItem(firstPending)}
            title="Abrir o roteiro do 1º item pendente de hoje e seguir a fila em sequência"
            style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600 }}>
            ▶ começar a fila
          </button>
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
        {total === 0 ? (
          <EmptyState
            title="Fila limpa"
            hint={person ? "Nenhuma ação pendente nessa fila. Confira o pipeline ou puxe leads novos." : "Nenhuma ação pendente."}
          />
        ) : (
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
            <div className="mono" style={{ ...GRID, padding: "9px 14px", background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }}>
              <span style={headCell}>#</span>
              <span style={headCell}>Quando</span>
              <span style={headCell}>Etapa</span>
              <span style={headCell}>Ação</span>
              <span style={headCell}>Lead · qualificação</span>
              <span />
            </div>
            {DAY_BLOCKS.map(([key, label, tone]) => {
              const rows = q[key];
              if (key !== "hoje" && rows.length === 0) return null;
              return (
                <React.Fragment key={key}>
                  <div className="mono" style={{
                    padding: "8px 14px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                    color: blockTone[tone], background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)",
                  }}>
                    {label} · {rows.length}
                  </div>
                  {rows.length === 0 && (
                    <div className="mono dim" style={{ padding: "14px", fontSize: 12, borderBottom: "1px solid var(--line-1)" }}>
                      {q.amanha.length > 0
                        ? "não tem atividade pra hoje · a fila de amanhã já está montada logo abaixo"
                        : "não tem atividade pra hoje"}
                    </div>
                  )}
                  {rows.map((item, i) => (
                    <QueueRow key={item.l.id} item={item} seq={i + 1} block={key} saasCfg={saasCfg} stageMeta={stageMeta}
                      onOpen={() => onOpenLead && onOpenLead(item.l)}
                      onScript={() => setScriptItem(item)}
                      onTouch={() => logTouch(item)}
                      onClaim={() => claim(item)}
                    />
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {scriptItem && (
        <ScriptPanel
          item={scriptItem}
          saasCfg={saasCfg}
          hasNext={!!nextAfter(scriptItem)}
          onPatch={patchLead}
          onClose={() => setScriptItem(null)}
          onTouch={() => { const nx = nextAfter(scriptItem); logTouch(scriptItem); setScriptItem(nx); }}
          onSkip={() => setScriptItem(nextAfter(scriptItem))}
          onOpenLead={() => { setScriptItem(null); onOpenLead && onOpenLead(scriptItem.l); }}
        />
      )}
    </div>
  );
}

// Uma linha da fila: sequência, quando, etapa (coluna do funil), ação a fazer,
// lead com a qualificação compilada e as ações. Clique no corpo abre o drawer.
function QueueRow({ item, seq, block, saasCfg, stageMeta, onOpen, onScript, onTouch, onClaim }) {
  const { l, kind, due, done, stage, who, phase, group } = item;
  const tier = leadTier(l);
  const wa = waLink(l.phone);
  const now = Date.now();

  // Pill de horário. Hoje: atrasado (dias) · agora · HH:mm · novo (idade).
  // Amanhã: só a hora. Próximos dias: a data.
  const startToday = new Date().setHours(0, 0, 0, 0);
  let when;
  if (due && block === "amanha") {
    when = { text: new Date(due.t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), tone: "mut" };
  } else if (due && block === "proximos") {
    when = { text: new Date(due.t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), tone: "mut" };
  } else if (due && due.t < startToday) {
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
  const action = group === "nutri" ? "reativação" : (ACTION_LABELS[kind] || "contato");
  const stageColor = stageMeta?.[stage]?.color || "var(--accent)";

  return (
    <div onClick={onOpen} style={{
      ...GRID,
      padding: "9px 14px", borderBottom: "1px solid var(--line-1)", cursor: "pointer",
      opacity: done ? 0.55 : 1, background: "transparent",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      <span className="mono tnum" style={{
        width: 26, height: 26, borderRadius: "var(--r-1)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: done ? "var(--pos-soft)" : "var(--bg-inset)", border: "1px solid var(--line-1)",
        color: done ? "var(--pos)" : "var(--fg-3)", fontSize: 11.5, fontWeight: 700,
      }}>{done ? "✓" : seq}</span>

      <span><Pill tone={when.tone}>{when.text}</Pill></span>

      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: stageColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stage}</span>
      </span>

      <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {action}
      </span>

      <span style={{ minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {tier.grade && (
            <span className="tnum" title={`${tier.label} (contas + anúncios)`} style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: tier.tone, color: tier.badgeFg, fontFamily: "var(--display)", fontSize: 11, fontWeight: 700,
            }}>{tier.grade}</span>
          )}
          <span style={{ fontSize: 13.5, fontWeight: 600, textDecoration: done ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
          {l.company && <span className="dim" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company}</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
          {chips.slice(0, 3).map((c, i) => <Pill key={i} tone="mut">{c}</Pill>)}
          {attempts && <Pill tone="mut" title="toques feitos nesta etapa">{attempts} toques</Pill>}
          {due?.type === "toque" && l.nextActionNote && <span className="dim" style={{ fontSize: 11 }}>{l.nextActionNote}</span>}
        </span>
      </span>

      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
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
        <button onClick={onScript} title="Abrir o roteiro desta etapa com o resumo e os dados do lead"
          style={{ height: 24, padding: "0 10px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 11.5, fontWeight: 600 }}>
          Roteiro
        </button>
      </span>
    </div>
  );
}

// Rótulo curto dos tipos de activity nos "últimos contatos" do resumo.
const ACT_LABELS = { whatsapp: "whatsapp", call: "ligação", email: "e-mail", meeting: "reunião", note: "nota", stage: "mudou de etapa", system: "sistema" };

// Painel do roteiro em DUAS COLUNAS lado a lado (sem abas): CLIENTE à esquerda
// (resumo da situação + últimos contatos + dados EDITÁVEIS na ordem da
// conversa) e ROTEIRO à direita (postura, objetivo e o passo a passo com a
// fala pronta). Em tela estreita as colunas empilham. "Toque e próximo"
// mantém o operador em fluxo: registra e já abre o cliente seguinte.
function ScriptPanel({ item, saasCfg, hasNext, onPatch, onClose, onTouch, onSkip, onOpenLead }) {
  // Cópia local do lead: a edição inline dos campos reflete na hora aqui (fala
  // interpolada + checklist) e persiste via onPatch (fila + API).
  const [l, setL] = useS(item.l);
  useE(() => { setL(item.l); }, [item.l.id]); // eslint-disable-line react-hooks/exhaustive-deps
  function patch(p) {
    setL((prev) => ({ ...prev, ...p }));
    onPatch && onPatch(item.l.id, p);
  }
  const script = resolveScript(saasCfg, l);
  const tokens = scriptTokens(l, saasCfg);
  const checklist = scriptChecklist(saasCfg, l);
  const wa = waLink(l.phone);
  const tier = leadTier(l);

  // Últimos contatos da timeline — contexto de quem já falou com esse lead.
  const [acts, setActs] = useS(null);
  useE(() => {
    let alive = true;
    setActs(null);
    api.listActivities(l.id)
      .then((a) => alive && setActs(
        (a || []).filter((x) => x.type !== "system")
          .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))
          .slice(0, 4)
      ))
      .catch(() => alive && setActs([]));
    return () => { alive = false; };
  }, [l.id]);

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

  // Situação compilada do cliente — só fatos preenchidos.
  const daysInStage = l.stageSince || l.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(l.stageSince || l.createdAt).getTime()) / DAY)) : null;
  const cad = cadenceOf(saasCfg, item.stage);
  const facts = [
    ["Potencial", tier.grade ? `${tier.grade} · ${tier.label}` : null],
    ["Etapa", `${item.stage}${daysInStage != null ? ` · ${daysInStage}d nela` : ""}`],
    ["Toques na etapa", Number(cad.maxAttempts) ? `${Number(l.stageAttempts) || 0} de ${cad.maxAttempts}` : (Number(l.stageAttempts) || 0) || null],
    ["Valor", l.amount ? window.fmt?.money?.(l.amount) || l.amount : null],
    ["Origem", l.source],
    ["SDR / closer", [l.owner && displayName(l.owner), l.closer && displayName(l.closer)].filter(Boolean).join(" / ") || null],
    ["Próximo passo (nota)", l.nextActionNote],
  ].filter(([, v]) => v != null && v !== "");

  const fmtWhen = (iso) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    const days = Math.floor((Date.now() - d.getTime()) / DAY);
    return days <= 0 ? `hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : days === 1 ? "ontem" : `há ${days}d`;
  };

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "10px 12px", background: "var(--bg-inset)" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(1100px, 100%)", maxHeight: "min(92vh, 100%)",
        background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)",
        boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {script.titulo}{script.custom ? " · personalizado" : ""}
            </div>
            <div style={{ fontSize: 16.5, fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {l.name}
              {tier.grade && (
                <span className="tnum" style={{ width: 18, height: 18, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tier.tone, color: tier.badgeFg, fontFamily: "var(--display)", fontSize: 11, fontWeight: 700 }}>{tier.grade}</span>
              )}
              <span className="chip">{item.stage}</span>
              {(l.company || l.phone) && (
                <span className="mono dim" style={{ fontSize: 11 }}>{[l.company, l.phone].filter(Boolean).join(" · ")}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="mono dim" style={{ fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>

        {/* Duas colunas lado a lado: CLIENTE | ROTEIRO (empilham no mobile). */}
        <div style={{ padding: "12px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: 16, overflowY: "auto", minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div className="mono" style={{ ...kicker, color: "var(--fg-3)" }}>Cliente</div>
              <div style={box}>
                <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Resumo do cliente</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "4px 14px" }}>
                  {facts.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--line-1)" }}>
                      <span className="mono dim" style={{ flexShrink: 0, fontSize: 10.5 }}>{k}</span>
                      <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8 }}>
                  <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Últimos contatos</div>
                  {acts === null && <div className="mono dim" style={{ fontSize: 11 }}>carregando…</div>}
                  {acts !== null && acts.length === 0 && <div className="mono dim" style={{ fontSize: 11 }}>nenhum contato registrado ainda · você abre a conversa</div>}
                  {(acts || []).map((a) => (
                    <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 11.5, padding: "2px 0", minWidth: 0 }}>
                      <span className="mono" style={{ flexShrink: 0, color: "var(--fg-3)", fontSize: 10.5 }}>{fmtWhen(a.at)}</span>
                      <span className="mono" style={{ flexShrink: 0, color: "var(--accent)", fontSize: 10.5 }}>{ACT_LABELS[a.type] || a.type}</span>
                      <span className="dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.type === "stage" ? `${a.meta?.from || "?"} → ${a.meta?.to || "?"}` : (a.text || "")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            <div>
              <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Dados do lead · na ordem da conversa · edite ao confirmar</div>
              {/* Empilhado (1 por linha), CAMPO EDITÁVEL à direita: select com as
                  opções do formulário; texto livre pra empresa/e-mail. Grava na hora. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {checklist.map((c) => (
                  <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 9px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: c.value ? "var(--bg-1)" : "var(--warn-soft)" }}>
                    <span style={{ color: c.value ? "var(--pos)" : "var(--warn)", flexShrink: 0, fontSize: 12 }}>{c.value ? "✓" : "○"}</span>
                    <span className="dim" style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.35 }}>{c.label}</span>
                    {c.type === "select" ? (
                      <select value={c.raw || ""} onChange={(e) => patch({ [c.key]: e.target.value })}
                        style={{ flexShrink: 0, maxWidth: "48%", height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: c.raw ? "var(--fg-1)" : "var(--fg-4)", fontSize: 12, fontWeight: 500 }}>
                        <option value="">selecionar…</option>
                        {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        {c.raw && !c.options.some((o) => o.value === c.raw) && <option value={c.raw}>{c.raw}</option>}
                      </select>
                    ) : (
                      <input key={l.id + c.key} type="text" defaultValue={c.raw || ""} placeholder="preencher…"
                        onBlur={(e) => { if (e.target.value !== (c.raw || "")) patch({ [c.key]: e.target.value }); }}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        style={{ flexShrink: 0, width: "48%", height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontWeight: 500 }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div className="mono" style={{ ...kicker, color: "var(--fg-3)" }}>Roteiro</div>
            <div style={{ ...box, background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
              <div className="mono" style={{ ...kicker, color: "var(--accent)", marginBottom: 4 }}>Como se comportar</div>
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>{script.resumo}</div>
            </div>
            <div style={box}>
              <div className="mono" style={{ ...kicker, marginBottom: 4 }}>Objetivo do contato</div>
              <div style={{ fontSize: 12, lineHeight: 1.45, fontWeight: 500 }}>{script.objetivo}</div>
            </div>

            <div>
              <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Passo a passo</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {script.passos.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 10 }}>
                    <span className="mono tnum" style={{
                      width: 20, height: 20, borderRadius: 999, flexShrink: 0, marginTop: 1,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: "var(--bg-inset)", border: "1px solid var(--line-2)", fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)",
                    }}>{i + 1}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {p.t && <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 1 }}>{p.t}</div>}
                      {/* Passo sem fala é ação pura (ex.: "ligar 2 vezes"): só a dica. */}
                      {p.fala && (
                        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-1)", borderLeft: "3px solid var(--accent-line)", paddingLeft: 10, whiteSpace: "pre-wrap" }}>
                          {renderFala(p.fala)}
                        </div>
                      )}
                      {p.dica && <div className="dim" style={{ fontSize: 10.5, marginTop: 2, paddingLeft: 13 }}>{renderFala(p.dica)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "10px 18px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={onTouch} style={{ padding: "8px 14px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600 }}
            title="Registra a tentativa na timeline; o GPS re-agenda sozinho (e lead novo segue pra Qualificando)">
            {hasNext ? "✓ toque e próximo" : "✓ registrar toque"}
          </button>
          {hasNext && (
            <button onClick={onSkip} title="Ir pro próximo da fila sem registrar toque neste"
              style={{ padding: "8px 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5 }}>
              pular →
            </button>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer"
              style={{ padding: "8px 14px", borderRadius: "var(--r-2)", border: "1px solid #25D36655", color: "#128c4b", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>
              WhatsApp ↗
            </a>
          )}
          <button onClick={onOpenLead} style={{ padding: "8px 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12.5 }}>
            abrir lead
          </button>
          <button onClick={onClose} className="mono dim" style={{ marginLeft: "auto", fontSize: 12 }}>fechar</button>
        </div>
      </div>
    </div>
  );
}

export { TodayScreen };
