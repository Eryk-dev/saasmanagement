import React from "react";
import { Avatar, EmptyState } from "../atoms.jsx";
import { PageHead, Pill } from "../components/viz.jsx";
import { waLink, leadTier, leadScoreLabel } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { stageKind, phaseOf, workableStages, openStages, cadenceOf, rollToBusinessDay, stageByKind, firstStage, lossReasonsOf, nextKindsFor } from "../lib/funnel.js";
import { allUsers, currentUser, displayName, userById, usersByRole } from "../lib/users.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useAttribution, leadPain } from "../lib/pains.js";
import { resolveScript, scriptTokens, scriptSegments, scriptChecklist, isNoShowStage, confirmationScript } from "../lib/scripts.js";
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

// Ordem de atendimento dentro de cada dia (Leo, jul/2026): confirmar call (o
// mais time-sensitive) e horário marcado primeiro; novos e no-show (leads
// quentes) na sequência; depois retomadas, follow-ups, nutrição e sem agenda.
const GROUP_ORDER = ["confirm", "appt", "novo", "noshow", "qual", "closer", "nutri", "loose"];

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
    // Confirmação de call: call marcada pra HOJE + você é o DONO (SDR) e não é o
    // closer → a call vira uma tarefa de CONFIRMAÇÃO na SUA fila (o closer segue
    // vendo a call na dele). Só na fila do próprio SDR, não no "time todo".
    const callT = l.callAt ? new Date(l.callAt).getTime() : NaN;
    const callToday = Number.isFinite(callT) && callT >= startToday.getTime() && callT <= endToday.getTime();
    const isConfirm = kind === "call" && callToday && l.owner && l.owner !== l.closer && person && person === l.owner;
    // Responsável da vez: SDR (dono) na pré-venda; closer na fase de call/
    // follow-up (SÓ o campo closer: dono SDR antigo não puxa o card); e o
    // INTEGRADOR (campo próprio) na entrega — integração/CS são do Eryk.
    const who = isConfirm ? l.owner : phase === "sdr" ? (l.owner || "") : phase === "entrega" ? (l.integrator || "") : (l.closer || "");
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

    // Tarefa de confirmação: vence no horário da call, grupo "confirm" (topo).
    if (isConfirm) {
      g.hoje.push({ l, kind, phase, who, due: { t: callT, type: "call" }, done: false, stage, group: "confirm", confirm: true });
      continue;
    }

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
      : isNoShowStage(stage) ? "noshow"
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

  // Card sem responsável: quem clica assume (vira o responsável). Grava no
  // campo da fase — owner na pré-venda, integrator na entrega, closer no meio.
  function claim(item) {
    const whoId = me || person;
    if (!whoId) return;
    const field = item.phase === "sdr" ? "owner" : item.phase === "entrega" ? "integrator" : "closer";
    setLeads((prev) => prev.map((x) => x.id === item.l.id ? { ...x, [field]: whoId } : x));
    api.update("leads", item.l.id, { [field]: whoId }).catch((err) => console.warn("responsável não salvo:", err.message));
  }

  // Edição inline dos dados do lead (checklist do roteiro). Otimista.
  function patchLead(leadId, patch) {
    setLeads((prev) => prev.map((x) => x.id === leadId ? { ...x, ...patch } : x));
    api.update("leads", leadId, patch).catch((err) => console.warn("lead não salvo:", err.message));
  }

  // Mover o card pra próxima coluna a partir do roteiro (com o setup do destino
  // já resolvido: closer+call, integrador, valor, motivo). Otimista igual ao
  // board — o servidor recarimba stageSince, agenda o GPS e faz o resto
  // (applyStageMove). Depois avança pro próximo pendente da fila.
  function moveAndNext(patch) {
    const cur = scriptItem;
    if (!cur) return;
    const nx = nextAfter(cur);
    setLeads((prev) => prev.map((x) => x.id === cur.l.id
      ? { ...x, ...patch, stageSince: new Date().toISOString(), stageAttempts: 0 } : x));
    api.update("leads", cur.l.id, patch).catch((err) => console.warn("movimento não persistido:", err.message));
    setScriptItem(nx);
  }

  // Agenda a call E cria o Meet + convite numa tacada só: persiste o movimento
  // (aguardando, pra o callAt/e-mail já estarem salvos), cria o Meet no Google
  // (que manda o convite pro e-mail do lead sozinho) e devolve o resultado. NÃO
  // avança a fila — o painel mostra a confirmação e o link; "próximo" é à parte.
  async function moveAndMeet(patch, email) {
    const cur = scriptItem;
    if (!cur) throw new Error("sem item na fila");
    const full = email ? { ...patch, email } : patch;
    setLeads((prev) => prev.map((x) => x.id === cur.l.id
      ? { ...x, ...full, stageSince: new Date().toISOString(), stageAttempts: 0 } : x));
    await api.update("leads", cur.l.id, full);
    const res = await api.createMeet(cur.l.id, email ? { email } : undefined);
    setLeads((prev) => prev.map((x) => x.id === cur.l.id ? { ...x, callUrl: res.callUrl } : x));
    return res;
  }
  const advanceScript = () => setScriptItem(nextAfter(scriptItem));

  const users = allUsers().filter((u) => !u.saas || u.saas === saasCfg?.id);
  const stageMeta = Object.fromEntries((saasCfg?.funnel || []).map((f) => [f.stage, f]));
  const dateLabel = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const firstPending = q.hoje.find((i) => !i.done);
  const headCell = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" };
  const blockTone = { accent: "var(--accent)", warn: "var(--warn)", mut: "var(--fg-3)" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead
        title="Minhas atividades"
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
                      onScript={() => setScriptItem(item)}
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
          leads={leads}
          onPatch={patchLead}
          onMove={moveAndNext}
          onMoveMeet={moveAndMeet}
          onAfter={advanceScript}
          onClose={() => setScriptItem(null)}
          onTouch={() => { const nx = nextAfter(scriptItem); logTouch(scriptItem); setScriptItem(nx); }}
          onOpenLead={() => { setScriptItem(null); onOpenLead && onOpenLead(scriptItem.l); }}
        />
      )}
    </div>
  );
}

// Uma linha da fila: sequência, quando, etapa (coluna do funil), ação a fazer,
// lead com a qualificação compilada e as ações. Clique no corpo abre o ROTEIRO
// (o painel de execução), não o card de status; o drawer fica no "abrir lead".
function QueueRow({ item, seq, block, saasCfg, stageMeta, onScript, onClaim }) {
  const { l, kind, due, done, stage, who, phase, group } = item;
  const tier = leadTier(l);
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
  const unowned = !who; // assumir só quando o card não tem responsável
  const action = item.confirm ? "confirmar call" : group === "noshow" ? "remarcar" : group === "nutri" ? "reativação" : (ACTION_LABELS[kind] || "contato");
  const stageColor = stageMeta?.[stage]?.color || "var(--accent)";

  return (
    <div onClick={onScript} title="Abrir o roteiro desta atividade" style={{
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
          <button onClick={onClaim} title="Assumir esse card (você vira o responsável)"
            style={{ height: 24, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px dashed var(--line-2)", background: "var(--bg-2)", color: "var(--fg-3)", fontSize: 11 }}>
            assumir
          </button>
        )}
        <button onClick={onScript} title="Começar essa atividade: roteiro, dados e pra onde vai o card"
          style={{ height: 24, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 11.5, fontWeight: 600 }}>
          Começar
        </button>
      </span>
    </div>
  );
}

// Rótulo curto dos tipos de activity nos "últimos contatos" do resumo.
const ACT_LABELS = { whatsapp: "whatsapp", call: "ligação", email: "e-mail", meeting: "reunião", note: "nota", stage: "mudou de etapa", system: "sistema" };

// Resumo compilado do cliente pro roteiro: a dor do anúncio (gancho da
// conversa), os fatos relevantes (potencial, temperatura, ICP, prioridade,
// faixa, etapa, toques, valor, origem, responsáveis, nota) e a atribuição (de
// onde o lead veio). Só entra o que está preenchido. `cat` = catálogo de
// atribuição (id → nome de campanha/conjunto/anúncio) já resolvido no componente.
export function clientSummary(saasCfg, lead, stage, cat) {
  const tier = leadTier(lead);
  const daysInStage = lead.stageSince || lead.createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(lead.stageSince || lead.createdAt).getTime()) / DAY)) : null;
  const cad = cadenceOf(saasCfg, stage);
  const hasScore = lead.score != null && lead.score !== "";
  const icpPct = (lead.icp != null && lead.icp !== "") ? `${Math.round(Number(lead.icp) * 100)}%` : null;
  const utm = lead.utm || {};
  const money = (v) => (typeof window !== "undefined" && window.fmt?.money?.(v)) || v;
  const facts = [
    ["Potencial", tier.grade ? `${tier.grade} · ${tier.label}` : null],
    ["Temperatura", hasScore ? `${leadScoreLabel(lead.score)} · ${lead.score}` : null],
    ["ICP (fit)", icpPct],
    ["Prioridade", lead.priority],
    ["Faixa de faturamento", lead.value],
    ["Etapa", `${stage}${daysInStage != null ? ` · ${daysInStage}d nela` : ""}`],
    ["Toques na etapa", Number(cad.maxAttempts) ? `${Number(lead.stageAttempts) || 0} de ${cad.maxAttempts}` : (Number(lead.stageAttempts) || 0) || null],
    ["Valor", lead.amount ? money(lead.amount) : null],
    ["Origem", lead.source],
    ["SDR / closer", [lead.owner && displayName(lead.owner), lead.closer && displayName(lead.closer)].filter(Boolean).join(" / ") || null],
    ["Próximo passo (nota)", lead.nextActionNote],
  ].filter(([, v]) => v != null && v !== "");
  // De onde veio: só o anúncio basta. Com teste A/B no form, mostra também o
  // HEADLINE que o lead viu (denormalizado no submit; fallback pro id da versão).
  const headline = lead.formHeadline || (lead.formVariant ? `versão ${lead.formVariant}` : null);
  const attribution = [
    ["Anúncio", cat?.ads?.[utm.content]?.name || utm.content],
    ["Headline do formulário", headline],
  ].filter(([, v]) => v != null && v !== "");
  return { pain: leadPain(lead, cat, saasCfg?.painMap), facts, attribution };
}

// Painel do roteiro em DUAS COLUNAS lado a lado (sem abas): CLIENTE à esquerda
// (resumo da situação + últimos contatos + dados EDITÁVEIS na ordem da
// conversa) e ROTEIRO à direita (postura, objetivo e o passo a passo com a
// fala pronta). Em tela estreita as colunas empilham. "Toque e próximo"
// mantém o operador em fluxo: registra e já abre o cliente seguinte.
function ScriptPanel({ item, saasCfg, leads, onPatch, onMove, onMoveMeet, onAfter, onClose, onTouch, onOpenLead }) {
  // Cópia local do lead: a edição inline dos campos reflete na hora aqui (fala
  // interpolada + checklist) e persiste via onPatch (fila + API).
  const [l, setL] = useS(item.l);
  useE(() => { setL(item.l); }, [item.l.id]); // eslint-disable-line react-hooks/exhaustive-deps
  function patch(p) {
    setL((prev) => ({ ...prev, ...p }));
    onPatch && onPatch(item.l.id, p);
  }
  // Item de confirmação de call usa o roteiro de confirmação; o resto, o roteiro
  // do estágio (por tentativa). A confirmação não é movimento de etapa, então o
  // bloco "Depois da ação" (destino) some pra esse item.
  const script = item.confirm ? confirmationScript(l, saasCfg) : resolveScript(saasCfg, l);
  const tokens = scriptTokens(l, saasCfg);
  const checklist = scriptChecklist(saasCfg, l);
  const wa = waLink(l.phone);
  const tier = leadTier(l);
  // Atribuição + dor do criativo (mesmo catálogo do drawer): de onde o lead veio
  // e qual dor o anúncio prometeu resolver — o gancho pra conduzir a conversa.
  const cat = useAttribution(l.saas, !!l.utm);
  const { pain, facts, attribution } = clientSummary(saasCfg, l, item.stage, cat);

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
          <button onClick={onOpenLead} style={{ padding: "6px 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12, flexShrink: 0 }}>
            abrir lead
          </button>
          <button onClick={onClose} className="mono dim" style={{ fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>

        {/* Corpo rolável: duas colunas (CLIENTE | ROTEIRO) + o destino do card. */}
        <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div className="mono" style={{ ...kicker, color: "var(--fg-3)" }}>Cliente</div>
              <div style={box}>
                <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Resumo do cliente</div>
                {/* Dor do anúncio em destaque: o gancho pra conversa (o problema
                    que trouxe o lead até aqui). Só quando veio de criativo mapeado. */}
                {pain && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", marginBottom: 8, borderRadius: "var(--r-2)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
                    <span className="mono" style={{ fontSize: 9.5, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>dor do anúncio</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0 }}>[{pain.code}] {pain.label}</span>
                  </div>
                )}
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

            {attribution.length > 0 && (
              <div style={box}>
                <div className="mono" style={{ ...kicker, marginBottom: 6 }}>De onde veio · atribuição do anúncio</div>
                {attribution.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5, padding: "3px 0", borderBottom: "1px solid var(--line-1)" }}>
                    <span className="mono dim" style={{ flexShrink: 0, fontSize: 10.5 }}>{k}</span>
                    <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
                  </div>
                ))}
              </div>
            )}

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

            {/* Destino do card fica AQUI, embaixo dos dados do cliente, pra
                aproveitar o espaço vazio da coluna e encurtar o painel. Item de
                confirmação não move etapa, então não mostra destino. */}
            {!item.confirm && <DestinoSection saasCfg={saasCfg} lead={l} leads={leads} onMove={onMove} onMoveMeet={onMoveMeet} onAfter={onAfter} onTouch={onTouch} />}
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
        </div>

        {/* Rodapé: sem "registrar toque" — a atividade só se completa movendo o
            card pra próxima coluna (bloco "Depois da ação"). Aqui ficam só os
            atalhos: WhatsApp e o card completo. */}
        <div style={{ marginTop: "auto", padding: "10px 18px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* WhatsApp em linha própria, esticado (igual ao do drawer/pop de contato). */}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" title={`WhatsApp · ${l.phone}`}
              style={{ flex: "1 1 100%", textAlign: "center", padding: "10px 14px", borderRadius: "var(--r-2)", background: "#25D366", color: "#06120c", fontSize: 13.5, fontWeight: 700, textDecoration: "none" }}>
              WhatsApp ↗
            </a>
          )}
          {/* Confirmação: o SDR marca quando o cliente responde à mensagem de 1h;
              o roteiro troca o passo de 10 min (positiva) sozinho. */}
          {item.confirm && (
            <button onClick={() => patch({ callConfirmed: !l.callConfirmed })}
              title={l.callConfirmed ? "Cliente confirmou presença (clique pra desmarcar)" : "Marcar que o cliente confirmou a presença"}
              style={{ padding: "8px 14px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600,
                background: l.callConfirmed ? "var(--pos)" : "var(--bg-1)", color: l.callConfirmed ? "#06120c" : "var(--fg-2)",
                border: "1px solid " + (l.callConfirmed ? "var(--pos)" : "var(--line-2)") }}>
              {l.callConfirmed ? "✓ cliente confirmou" : "cliente confirmou"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── Destino do card (o próximo passo)
// Pra onde o card vai DEPOIS da ação, por KIND do estágio atual (resolvido pro
// nome real do funil via stageByKind). Cada destino abre o SETUP do seu tipo:
// call → closer + horário livre na agenda dele; entrega → integrador; ganho →
// valor; perda → motivo. O movimento é otimista e o servidor faz o resto.
// "retry" = não atendeu / não fechou hoje: registra a tentativa e retoma amanhã
// (fica na mesma coluna). Num lead NOVO a tentativa promove pra Qualificando
// sozinha (server) — por isso o chip de retry do novo mostra "Qualificando".
export function destinationsFor(saasCfg, lead) {
  const curStage = lead.stage || firstStage(saasCfg);
  const curKind = stageKind(saasCfg, curStage);
  const out = [];
  const seen = new Set([curStage]);
  // Quais destinos e em que ordem: default por situação (NEXT_KINDS), sobrescrito
  // por produto em Ajustes → Próximos passos (saasCfg.nextSteps[curKind]).
  for (const k of nextKindsFor(saasCfg, curKind)) {
    if (k === "retry") {
      const promote = curKind === "novo";
      const target = promote ? (stageByKind(saasCfg, "qualificacao") || curStage) : curStage;
      out.push({ retry: true, promote, stage: target, kind: promote ? "qualificacao" : curKind, nk: "retry" });
      continue;
    }
    if (k === "noshow") {
      // No-show é kind contato (colide com Nutrição no stageByKind) → resolve
      // pela etapa nomeada "No show" do funil, se existir.
      const st = (saasCfg?.funnel || []).find((f) => f && isNoShowStage(f.stage));
      if (st && !seen.has(st.stage)) { seen.add(st.stage); out.push({ stage: st.stage, kind: "noshow", nk: "noshow" }); }
      continue;
    }
    const stage = stageByKind(saasCfg, k);
    if (stage && !seen.has(stage)) { seen.add(stage); out.push({ stage, kind: stageKind(saasCfg, stage), nk: k }); }
  }
  // Prioridade configurável por produto (Ajustes → Próximos passos); vazio =
  // ordem canônica do NEXT_KINDS da etapa.
  return orderNextSteps(out, saasCfg?.nextStepOrder);
}

// Setup que cada destino pede antes de mover.
export function setupType(kind) {
  if (kind === "call") return "call";
  if (kind === "integracao" || kind === "posvenda") return "integrator";
  if (kind === "ganho") return "won";
  if (kind === "perdido" || kind === "desqualificado") return "loss";
  return "none";
}

// Agenda da call: das 07h às 20h em blocos de 1h; a call OCUPA a hora do
// closer (leads dele com callAt na mesma hora). Fim de semana fora (seg a sex).
const CALL_H0 = 7, CALL_H1 = 21; // slots 07:00…20:00 (bate com a agenda 7h-21h)
function nextBusinessDays(n) {
  const out = []; const d = new Date(); d.setHours(0, 0, 0, 0);
  while (out.length < n) { const w = d.getDay(); if (w !== 0 && w !== 6) out.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return out;
}
const cellKey = (d) => { const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}`; };
const slotVal = (day, hour) => { const p = (x) => String(x).padStart(2, "0"); return `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}T${p(hour)}:00`; };

// Horas já ocupadas na agenda de um closer: cada lead dele com callAt marca a
// hora daquele slot (a call ocupa 1h). Ignora o próprio lead (reagendamento) e
// os follow-ups — follow-up NÃO bloqueia horário: o SDR pode marcar a call de
// venda por cima. Só call de venda conta como ocupada, pra não dar divergência.
export function callBusyKeys(leads, closerId, selfId) {
  const busy = new Set();
  const saasList = (typeof window !== "undefined" && window.SEED?.SAAS) || [];
  for (const o of leads || []) {
    if (!closerId || o.id === selfId || o.closer !== closerId || !o.callAt) continue;
    const cfg = saasList.find((s) => s.id === o.saas);
    if (stageKind(cfg, o.stage) === "followup") continue; // follow-up não ocupa a agenda
    const d = new Date(o.callAt);
    if (Number.isFinite(d.getTime())) busy.add(cellKey(d));
  }
  return busy;
}

function DestinoSection({ saasCfg, lead, leads, onMove, onMoveMeet, onAfter, onTouch }) {
  const dests = destinationsFor(saasCfg, lead);
  const stageMeta = Object.fromEntries((saasCfg?.funnel || []).map((f) => [f.stage, f]));
  const closers = usersByRole("closer");
  const integrators = usersByRole("integrator");
  const reasons = lossReasonsOf(saasCfg);

  const [dest, setDest] = useS(null);       // { stage, kind }
  const [closer, setCloser] = useS(lead.closer || "");
  const [integrator, setIntegrator] = useS(lead.integrator || (integrators.length === 1 ? integrators[0].id : ""));
  const [amount, setAmount] = useS(lead.amount || "");
  const [reason, setReason] = useS("");
  const [note, setNote] = useS("");
  const [slot, setSlot] = useS(lead.callAt || "");
  const [dayIdx, setDayIdx] = useS(0);
  const [email, setEmail] = useS(lead.email || "");
  const [emailTouched, setEmailTouched] = useS(false); // SDR digitou um e-mail próprio pro convite
  const [meetBusy, setMeetBusy] = useS(false);   // criando o Meet
  const [meetRes, setMeetRes] = useS(null);      // { callUrl, attendees }
  const [meetErr, setMeetErr] = useS(null);
  useE(() => {
    setDest(null); setCloser(lead.closer || ""); setSlot(lead.callAt || ""); setDayIdx(0);
    setIntegrator(lead.integrator || (integrators.length === 1 ? integrators[0].id : ""));
    setAmount(lead.amount || ""); setReason(""); setNote("");
    setEmail(lead.email || ""); setEmailTouched(false); setMeetBusy(false); setMeetRes(null); setMeetErr(null);
  }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-preenche o e-mail do convite com o do lead SEMPRE que ele estiver
  // preenchido (ex.: o SDR acabou de preencher no checklist), até o SDR digitar
  // um e-mail próprio no campo do convite (aí respeita o que ele escreveu).
  useE(() => {
    if (!emailTouched && lead.email) setEmail(lead.email);
  }, [lead.email, emailTouched]);

  if (dests.length === 0) return null;
  const setup = dest ? setupType(dest.kind) : null;
  const days = nextBusinessDays(6);

  // Horas ocupadas na agenda do closer (cada call = 1h; ignora o próprio lead).
  const busy = setup === "call" && closer ? callBusyKeys(leads, closer, lead.id) : new Set();

  const ready = !dest ? false
    : setup === "call" ? !!(closer && slot)
    : setup === "integrator" ? !!integrator
    : setup === "won" ? Number(amount) > 0
    : setup === "loss" ? !!reason
    : true;

  function confirm() {
    if (!ready) return;
    const patch = { stage: dest.stage };
    if (setup === "call") { patch.closer = closer; patch.callAt = slot; if (email.trim()) patch.email = email.trim(); }
    else if (setup === "integrator") patch.integrator = integrator;
    else if (setup === "won") patch.amount = Number(amount);
    else if (setup === "loss") { patch.lostReason = reason; if (note.trim()) patch.lostNote = note.trim(); }
    onMove && onMove(patch);
  }

  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
  const meetReady = setup === "call" && !!closer && !!slot && validEmail(email) && !meetBusy;

  // Botão único: agenda a call (closer + horário), cria o Meet e manda o convite
  // pro e-mail do lead — tudo de uma vez. Fica pausado no sucesso pra mostrar o
  // link; "próximo" avança a fila.
  async function agendarComMeet() {
    if (!meetReady || !onMoveMeet) return;
    setMeetBusy(true); setMeetErr(null); setMeetRes(null);
    try {
      const res = await onMoveMeet({ stage: dest.stage, closer, callAt: slot }, email.trim());
      setMeetRes(res || { ok: true });
    } catch (e) {
      setMeetErr(e?.message || "falha ao criar o Meet");
    }
    setMeetBusy(false);
  }

  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const label = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const fieldStyle = { width: "100%", height: 30, padding: "0 8px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 };
  const slotFmt = (v) => { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; };

  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "12px 14px" }}>
      <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Depois da ação · pra onde vai esse card</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {dests.map((d, i) => {
          // Chip de retry: não atendeu / não fechou hoje → registra a tentativa e
          // retoma amanhã (num lead novo, promove pra Qualificando sozinho).
          if (d.retry) {
            const color = stageMeta[d.stage]?.color || "var(--fg-3)";
            return (
              <button key="retry" onClick={() => onTouch && onTouch()}
                title={d.promote
                  ? `Não atendeu ou ainda não fechou · registra a tentativa e vai pra ${d.stage} (tenta amanhã)`
                  : "Não atendeu · registra a tentativa e retoma amanhã"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: "var(--r-2)",
                  background: "var(--bg-1)", border: "1px dashed var(--line-strong)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 500,
                }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                {d.promote ? `${d.stage} · tenta amanhã` : "Retomar amanhã"}
              </button>
            );
          }
          const on = dest?.stage === d.stage;
          const color = stageMeta[d.stage]?.color || "var(--accent)";
          return (
            <button key={d.stage} onClick={() => setDest(on ? null : d)} style={{
              display: "inline-flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px", borderRadius: "var(--r-2)",
              background: on ? "var(--accent-soft)" : "var(--bg-1)",
              border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"),
              color: on ? "var(--accent)" : "var(--fg-2)", fontSize: 12.5, fontWeight: on ? 600 : 500,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
              {d.stage} {on ? "" : "→"}
            </button>
          );
        })}
      </div>

      {dest && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {setup === "call" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <div>
                  <label style={label}>Closer da call *</label>
                  <select value={closer} onChange={(e) => { setCloser(e.target.value); setSlot(""); }} style={fieldStyle}>
                    <option value="">— escolher closer —</option>
                    {closers.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                  </select>
                </div>
              </div>
              {closer ? (
                <div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginBottom: 6 }}>
                    Horários livres na agenda de {displayName(closer)} · a call ocupa 1h
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {days.map((d, i) => (
                      <button key={i} onClick={() => setDayIdx(i)} style={{
                        height: 30, padding: "0 10px", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)",
                        background: dayIdx === i ? "var(--accent)" : "var(--bg-1)",
                        color: dayIdx === i ? "var(--accent-fg)" : "var(--fg-3)",
                        border: "1px solid " + (dayIdx === i ? "var(--accent)" : "var(--line-2)"),
                      }}>{d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(/\./g, "")}</button>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>
                    {Array.from({ length: CALL_H1 - CALL_H0 }, (_, i) => CALL_H0 + i).map((h) => {
                      const cell = new Date(days[dayIdx]); cell.setHours(h, 0, 0, 0);
                      const occupied = busy.has(cellKey(cell));
                      const past = cell.getTime() < Date.now();
                      const val = slotVal(days[dayIdx], h);
                      const sel = slot === val;
                      const disabled = occupied || past;
                      return (
                        <button key={h} disabled={disabled} onClick={() => setSlot(val)} title={occupied ? "closer já tem call nesse horário" : past ? "horário já passou" : "marcar"}
                          style={{
                            height: 32, borderRadius: "var(--r-2)", fontSize: 11.5, fontFamily: "var(--mono)",
                            background: sel ? "var(--accent)" : occupied ? "var(--neg-soft)" : "var(--bg-1)",
                            color: sel ? "var(--accent-fg)" : occupied ? "var(--neg)" : past ? "var(--fg-4)" : "var(--fg-2)",
                            border: "1px solid " + (sel ? "var(--accent)" : occupied ? "color-mix(in srgb, var(--neg) 30%, var(--line-2))" : "var(--line-2)"),
                            opacity: past && !sel ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer",
                            textDecoration: occupied ? "line-through" : "none",
                          }}>{String(h).padStart(2, "0")}:00</button>
                      );
                    })}
                  </div>
                  {slot && <div className="mono" style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 8 }}>Call: {slotFmt(slot)} · {displayName(closer)}</div>}
                </div>
              ) : (
                <div className="mono dim" style={{ fontSize: 11 }}>escolha o closer pra ver os horários livres da agenda dele</div>
              )}
              {closer && slot && (
                <div style={{ maxWidth: 340 }}>
                  <label style={label}>E-mail do lead (pro convite da call)</label>
                  <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setEmailTouched(true); }} placeholder="nome@email.com" style={fieldStyle} />
                  {email && !validEmail(email) && <div className="mono" style={{ fontSize: 10, color: "var(--warn)", marginTop: 4 }}>e-mail inválido</div>}
                </div>
              )}
            </>
          )}

          {setup === "integrator" && (
            <div style={{ maxWidth: 280 }}>
              <label style={label}>Responsável pela {dest.kind === "integracao" ? "integração" : "entrega/CS"} *</label>
              <select value={integrator} onChange={(e) => setIntegrator(e.target.value)} style={fieldStyle}>
                <option value="">— escolher integrador —</option>
                {integrators.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
              </select>
              {lead.closer && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 5 }}>closer da venda: {displayName(lead.closer)} (fica registrado)</div>}
            </div>
          )}

          {setup === "won" && (
            <div style={{ maxWidth: 220 }}>
              <label style={label}>Valor do negócio (R$) *</label>
              <input type="number" min="0" step="0.01" value={amount} placeholder="ex.: 7188"
                onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} style={fieldStyle} />
              <div className="mono dim" style={{ fontSize: 10, marginTop: 5 }}>vira a receita no marketing e a conversão enviada pra Meta</div>
            </div>
          )}

          {setup === "loss" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <div>
                <label style={label}>Motivo *</label>
                <select value={reason} onChange={(e) => setReason(e.target.value)} style={fieldStyle}>
                  <option value="">— escolha o motivo —</option>
                  {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={label}>Detalhe (opcional)</label>
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: fechou com concorrente" style={fieldStyle} />
              </div>
            </div>
          )}

          {setup === "call" ? (
            meetRes ? (
              <div style={{ border: "1px solid var(--pos)", background: "var(--pos-soft)", borderRadius: "var(--r-2)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="mono" style={{ fontSize: 12, color: "var(--pos)", fontWeight: 600 }}>✓ call agendada · Meet criado · convite enviado{validEmail(email) ? ` pra ${email.trim()}` : ""}</div>
                {meetRes.callUrl && <a href={meetRes.callUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 11.5, color: "var(--accent)", wordBreak: "break-all" }}>{meetRes.callUrl}</a>}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                  <button onClick={() => onAfter && onAfter()} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12.5, fontWeight: 600 }}>próximo →</button>
                  <button onClick={() => setDest(null)} className="mono dim" style={{ fontSize: 11.5 }}>fechar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={agendarComMeet} disabled={!meetReady} style={{
                    height: 32, padding: "0 16px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600,
                    background: meetReady ? "var(--accent)" : "var(--bg-2)", color: meetReady ? "var(--accent-fg)" : "var(--fg-4)",
                    border: "1px solid " + (meetReady ? "var(--accent)" : "var(--line-2)"), cursor: meetReady ? "pointer" : "not-allowed",
                  }}>{meetBusy ? "criando Meet e enviando convite…" : "🎥 agendar + criar Meet + convite"}</button>
                  <button onClick={confirm} disabled={!ready || meetBusy} className="mono"
                    style={{ height: 32, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, opacity: ready && !meetBusy ? 1 : 0.5 }}>só agendar (sem convite)</button>
                  <button onClick={() => setDest(null)} className="mono dim" style={{ fontSize: 11.5 }}>cancelar</button>
                </div>
                {meetErr && <div className="mono" style={{ fontSize: 11, color: "var(--neg)" }}>{meetErr} · a call já foi agendada; crie o Meet pela ficha do lead se precisar.</div>}
                {closer && slot && !validEmail(email) && <div className="mono dim" style={{ fontSize: 10.5 }}>preencha o e-mail do lead pra mandar o convite (ou use "só agendar")</div>}
              </div>
            )
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={confirm} disabled={!ready} style={{
                height: 32, padding: "0 16px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600,
                background: ready ? "var(--accent)" : "var(--bg-2)", color: ready ? "var(--accent-fg)" : "var(--fg-4)",
                border: "1px solid " + (ready ? "var(--accent)" : "var(--line-2)"), cursor: ready ? "pointer" : "not-allowed",
              }}>mover pra {dest.stage} →</button>
              <button onClick={() => setDest(null)} className="mono dim" style={{ fontSize: 11.5 }}>cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { TodayScreen };
