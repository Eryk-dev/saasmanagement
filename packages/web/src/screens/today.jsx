import React from "react";
import { EmptyState } from "../atoms.jsx";
import { ErrorBoundary } from "../components/error-boundary.jsx";
import { Pill } from "../components/viz.jsx";
import { ActivityComposer } from "../components/timeline.jsx";
import { waLink, leadTier, leadScoreLabel, cockpitProposalUrl } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { stageKind, phaseOf, workableStages, openStages, cadenceOf, rollToBusinessDay, stageByKind, firstStage, lossReasonsOf, nextKindsFor } from "../lib/funnel.js";
import { allUsers, currentUser, displayName, userById, usersByRole } from "../lib/users.js";
import { useActiveSaas } from "../lib/workspace.js";
import { useAttribution, leadPain } from "../lib/pains.js";
import { resolveScript, scriptTokens, scriptSegments, scriptChecklist, isNoShowStage, confirmationScript, integrationConfirmationScript, scriptKeyFor } from "../lib/scripts.js";
import { PAYMENT_METHODS, CLOSED_PLANS, paymentLabel, closedPlanLabel } from "../lib/payments.js";
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

// Etapas em que mandar a proposta faz sentido no roteiro (a call tem bloco
// próprio, com os atalhos da chamada junto).
const PROPOSAL_KINDS = new Set(["proposta", "followup"]);

const TIER_ORDER = { alto: 3, medio: 2, baixo: 1, sem: 0 };

// Ordem de atendimento dentro de cada dia (Leo, jul/2026): confirmar call (o
// mais time-sensitive) e horário marcado primeiro; novos e no-show (leads
// quentes) na sequência; depois retomadas, follow-ups, nutrição e sem agenda.
const GROUP_ORDER = ["confirm", "appt", "novo", "noshow", "qual", "closer", "nutri", "loose"];

// Fase do processo → papel que trabalha nela. Card SEM responsável só entra na
// fila de quem tem o papel da fase: SDR não vê follow-up/integração soltos
// (exclusivos de closer/integrador) e closer não herda a fila de novos.
const PHASE_ROLE = { sdr: "sdr", closer: "closer", entrega: "integrator" };

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
    // Confirmação de call: call marcada pra HOJE conduzida pelo closer (dono !=
    // closer) → vira uma tarefa de CONFIRMAÇÃO na fila do SDR (o closer segue
    // vendo a call na dele). Vai pro DONO quando há dono; SEM dono cai pra quem
    // tiver o papel de SDR (mesmo fallback do resto da fila) — senão uma call de
    // lead antigo/importado sem owner some sem NINGUÉM pra confirmar. Só na fila
    // de um SDR, não no "time todo".
    const callT = l.callAt ? new Date(l.callAt).getTime() : NaN;
    const callToday = Number.isFinite(callT) && callT >= startToday.getTime() && callT <= endToday.getTime();
    const isConfirm = kind === "call" && callToday && l.owner !== l.closer && person &&
      (l.owner ? person === l.owner : personRoles.has(PHASE_ROLE.sdr));
    // Responsável da vez: SDR (dono) na pré-venda; closer na fase de call/
    // follow-up (SÓ o campo closer: dono SDR antigo não puxa o card); e o
    // INTEGRADOR (campo próprio) na entrega — integração/CS são do Eryk.
    const who = isConfirm ? l.owner : phase === "sdr" ? (l.owner || "") : phase === "entrega" ? (l.integrator || "") : (l.closer || "");
    // Filtro de pessoa: card atribuído à pessoa sempre entra; card SEM dono só
    // entra pra quem tem o papel da fase (SDR não vê follow-up/integração). A
    // confirmação já foi filtrada por pessoa acima (isConfirm), então não passa
    // por aqui — senão a call sem dono cairia no papel de closer e sumiria.
    if (person && !isConfirm) {
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

    // Tarefa de confirmação: NÃO vence no horário da call. Vira DUAS tarefas com
    // o horário já descontado — 1h antes (manda a confirmação) e 10min antes
    // (positiva ou liga). Assim o SDR sabe a hora exata de executar cada uma.
    if (isConfirm) {
      const M = 60 * 1000;
      g.hoje.push({ l, kind, phase, who, due: { t: callT - 60 * M, type: "confirm" }, done: false, stage, group: "confirm", confirm: true, confirmWindow: "1h" });
      g.hoje.push({ l, kind, phase, who, due: { t: callT - 10 * M, type: "confirm" }, done: false, stage, group: "confirm", confirm: true, confirmWindow: "10min" });
      continue;
    }

    // Confirmação da INTEGRAÇÃO: 2h antes da call de vídeo, na fila de quem vai
    // conduzir (o integrador). Diferente da confirmação de call, aqui é a MESMA
    // pessoa que confirma e faz, então o item de confirmação SOMA com o
    // compromisso da integração (não substitui): ele confirma às 8h e conduz às
    // 10h. Marcado como feito quando ele registra que o cliente confirmou. Só na
    // fila de UMA pessoa (igual à confirmação de call): no "time todo" o
    // compromisso da integração já aparece, e a linha extra viraria ruído.
    const integT = l.integrationAt ? new Date(l.integrationAt).getTime() : NaN;
    if (person && kind === "integracao" && Number.isFinite(integT) &&
      integT >= startToday.getTime() && integT <= endToday.getTime()) {
      g.hoje.push({
        l, kind, phase, who, stage, group: "confirm",
        due: { t: integT - 120 * 60 * 1000, type: "confirm" },
        done: !!l.integrationConfirmed, confirm: true, confirmKind: "integracao", confirmWindow: "2h",
      });
    }

    // "Quando" do card. Duas regras que se combinam:
    //  (1) Compromisso (call/integração) só vale de HOJE em diante e SÓ NA ETAPA
    //      correspondente: uma call marcada num card que já AVANÇOU de etapa
    //      (ex.: foi pra Proposta) é histórico, não compromisso — o servidor
    //      re-agenda o GPS mas nunca limpa o callAt, então sem o filtro por etapa
    //      a call antiga ancorava o card na fila de hoje pra sempre.
    //  (2) Havendo compromisso vivo NA etapa, é ele que conduz o card (mesmo pra
    //      frente). O toque do GPS (nextActionAt) é confirmação/retry e NÃO
    //      compete: senão um card com call daqui a 2 dias aparece "atrasado" hoje
    //      por um toque vencido. O nextActionAt só entra quando não há call/
    //      integração agendada nesta etapa.
    const cands = [];
    const push = (v, type, min = 0) => {
      const t = v ? new Date(v).getTime() : NaN;
      if (Number.isFinite(t) && t >= min) cands.push({ t, type });
    };
    if (kind === "call") push(l.callAt, "call", startToday.getTime());
    else if (kind === "integracao") push(l.integrationAt, "integração", startToday.getTime());
    if (!cands.length) push(l.nextActionAt, "toque");
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

// Aviso de social selling: aparece quando o SDR zera a fila de HOJE. Manda ir
// pro Instagram chamar os novos seguidores. Mostra a CONTAGEM de novos
// seguidores (~24h); o @ de cada um o Instagram NÃO entrega por API (privacidade
// da plataforma), então o botão abre o app pra a pessoa ver os @ e chamar.
function SocialSellingNotice({ ig }) {
  const username = ig?.username || "";
  const count = ig?.count;
  const igUrl = username ? `https://instagram.com/${username}` : "https://instagram.com";
  return (
    <div style={{ marginBottom: 12, border: "1px solid var(--accent-line)", background: "var(--accent-soft)", borderRadius: "var(--r-3)", padding: "14px 16px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0 }}>📸</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--fg-1)" }}>Zerou a fila de hoje! Bora fazer social selling.</div>
        <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 3, lineHeight: 1.45 }}>
          {count == null
            ? "Passa no Instagram e chama os novos seguidores no direct."
            : count > 0
              ? <>Você teve <strong style={{ color: "var(--accent)" }}>{count} novo{count === 1 ? "" : "s"} seguidor{count === 1 ? "" : "es"}</strong> nas últimas ~24h. Chama cada um no direct.</>
              : "Sem novos seguidores nas últimas 24h, mas vale reativar quem já te segue."}
          {" "}<span className="dim">O Instagram não lista quem seguiu por aqui, abra o app pra ver os @ e chamar.</span>
        </div>
      </div>
      <a href={igUrl} target="_blank" rel="noopener noreferrer"
        style={{ flexShrink: 0, height: 34, display: "inline-flex", alignItems: "center", padding: "0 16px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
        abrir Instagram ↗
      </a>
    </div>
  );
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
  const [igStats, setIgStats] = useS(null); // { configured, count, username } — aviso de social selling

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
  const firstPending = q.hoje.find((i) => !i.done);
  const pendingToday = q.hoje.filter((i) => !i.done);
  const doneTodayRows = q.hoje.filter((i) => i.done);
  const futureRows = [...q.proximos, ...q.semdata];
  const queueCounts = Object.fromEntries(users.map((u) => [u.id, buildQueue(leads, saasCfg, u.id).hoje.filter((i) => !i.done).length]));
  const contactedGoal = Math.max(q.doneToday + pendingToday.length, q.doneToday, 1);
  const callsToday = q.hoje.filter((i) => i.kind === "call" && !i.confirm);
  const callsDone = callsToday.filter((i) => i.done).length;

  // Aviso de social selling: quando o SDR zera a fila de HOJE (nada pendente),
  // manda ir pro Instagram chamar os novos seguidores. Só na fila de um SDR.
  const viewedIsSdr = !!person && (userById(person)?.roles || []).includes("sdr");
  const daySocialDone = viewedIsSdr && !firstPending;
  useE(() => {
    if (!daySocialDone || !saasCfg?.id) return;
    let alive = true;
    api.newFollowers(saasCfg.id).then((r) => alive && setIgStats(r)).catch(() => alive && setIgStats(null));
    return () => { alive = false; };
  }, [daySocialDone, saasCfg?.id]);

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "28px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>Minhas atividades</h1>
            <div style={{ marginTop: 4, fontSize: 14.5, color: "var(--fg-3)" }}>hoje em ordem de execução · amanhã e próximos dias à vista</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6, flexWrap: "wrap" }}>
            {users.map((u) => {
              const active = person === u.id;
              return (
                <button key={u.id} onClick={() => setPerson(u.id)} style={{
                  height: 34, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 13px", borderRadius: 999,
                  border: `1px solid ${active ? "var(--line-2)" : "var(--line-1)"}`, background: active ? "var(--bg-1)" : "transparent",
                  color: active ? "var(--fg-1)" : "var(--fg-3)", boxShadow: active ? "var(--shadow-1)" : "none", fontSize: 13, fontWeight: active ? 600 : 500,
                }}>
                  {u.name || u.id}<span className="tnum" style={{ fontSize: 12, color: "var(--fg-4)" }}>{queueCounts[u.id] || 0}</span>
                </button>
              );
            })}
          </div>
        </div>

        {daySocialDone && <SocialSellingNotice ig={igStats} />}
        {total === 0 ? (
          <EmptyState
            title="Fila limpa"
            hint={person ? "Nenhuma ação pendente nessa fila. Confira o pipeline ou puxe leads novos." : "Nenhuma ação pendente."}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 380px)", gap: 16, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "20px 24px 14px" }}>
                  <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em" }}>Hoje</h3>
                  <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>{pendingToday.length} pendentes · em ordem de execução</span>
                </div>
                {pendingToday.length === 0 && <div style={{ padding: "16px 24px", borderTop: "1px solid var(--line-faint)", fontSize: 13, color: "var(--fg-3)" }}>Fila de hoje concluída.</div>}
                {pendingToday.map((item, index) => (
                  <QueueRow key={item.confirmWindow ? `${item.l.id}-${item.confirmWindow}` : item.l.id} item={item} block="hoje" featured={index === 0}
                    onScript={() => setScriptItem(item)} onClaim={() => claim(item)} />
                ))}
              </section>

              {doneTodayRows.length > 0 && (
                <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "20px 24px 14px" }}>
                    <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em" }}>Feitas hoje</h3>
                    <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>{doneTodayRows.length} concluídas</span>
                  </div>
                  {doneTodayRows.map((item) => <DoneActivityRow key={item.l.id} item={item} onClick={() => setScriptItem(item)} />)}
                </section>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <DayScore contacted={q.doneToday} contactedGoal={contactedGoal} calls={callsDone} callsGoal={Math.max(callsToday.length, 1)} />
              <CompactSchedule title="Amanhã" rows={q.amanha} onOpen={setScriptItem} />
              {futureRows.length > 0 && <CompactSchedule title="Próximos dias" rows={futureRows} onOpen={setScriptItem} />}
            </div>
          </div>
        )}
      </div>

      {scriptItem && (
        <ErrorBoundary variant="modal" label="roteiro" resetKey={scriptItem.l?.id} onReset={() => setScriptItem(null)}>
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
        </ErrorBoundary>
      )}
    </div>
  );
}

// Uma linha da fila: sequência, quando, etapa (coluna do funil), ação a fazer,
// lead com a qualificação compilada e as ações. Clique no corpo abre o ROTEIRO
// (o painel de execução), não o card de status; o drawer fica no "abrir lead".
function QueueRow({ item, block, featured, onScript, onClaim }) {
  const { l, kind, due, stage, who, group } = item;
  const now = Date.now();

  // Pill de horário. Hoje: atrasado (dias) · agora · HH:mm · novo (idade).
  // Amanhã: só a hora. Próximos dias: a data. Quando vira "agora", a hora
  // agendada continua visível em cima do rótulo (when.above).
  const hhmm = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const startToday = new Date().setHours(0, 0, 0, 0);
  let when;
  if (item.confirm && due) {
    // Confirmação: mostra a hora JÁ descontada (1h/10min antes da call). Passou
    // da hora = "agora" em vermelho pra virar prioridade.
    when = due.t <= now
      ? { above: hhmm(due.t), text: "agora", tone: "neg" }
      : { text: hhmm(due.t), tone: "pos" };
  } else if (due && block === "amanha") {
    when = { text: hhmm(due.t), tone: "mut" };
  } else if (due && block === "proximos") {
    when = { text: new Date(due.t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), tone: "mut" };
  } else if (due && due.t < startToday) {
    const daysLate = Math.max(1, Math.ceil((startToday - due.t) / DAY));
    when = { text: `atrasado ${daysLate}d`, tone: "neg" };
  } else if (due && due.t <= now) {
    when = { above: hhmm(due.t), text: due.type === "call" ? "call agora" : "agora", tone: "neg" };
  } else if (due) {
    when = { text: hhmm(due.t), tone: due.type === "call" ? "pos" : "mut" };
  } else if (kind === "novo") {
    const ageH = l.createdAt ? Math.max(0, Math.floor((now - new Date(l.createdAt).getTime()) / 3600000)) : null;
    when = { text: ageH == null ? "novo" : ageH < 24 ? `há ${ageH}h` : `há ${Math.floor(ageH / 24)}d`, tone: "warn" };
  } else when = { text: "sem data", tone: "mut" };

  const unowned = !who; // assumir só quando o card não tem responsável
  const action = item.confirm
    ? (item.confirmKind === "integracao" ? "confirmar integração · 2h antes"
      : item.confirmWindow === "1h" ? "confirmar · 1h antes" : "confirmar · 10 min antes")
    : group === "noshow" ? "remarcar" : group === "nutri" ? "reativação" : (ACTION_LABELS[kind] || "contato");
  const whatsapp = waLink(l.phone);
  const meet = (kind === "call" || kind === "integracao") && l.callUrl;
  const attemptNumber = Number(l.stageAttempts) || 0;
  const hhmmOf = (v) => new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const actionDetail = l.nextActionNote || (item.confirmKind === "integracao" && l.integrationAt
    ? `integração às ${hhmmOf(l.integrationAt)}`
    : item.confirm && l.callAt ? `call às ${hhmmOf(l.callAt)}`
    : due?.type === "call" ? "call confirmada · Meet criado pela agenda"
    : kind === "novo" ? `1º toque${l.source ? ` · ${l.source}` : ""}`
    : action);

  return (
    <div onClick={onScript} title="Abrir o roteiro desta atividade" style={{
      display: "flex", alignItems: "center", gap: 14, padding: featured ? "16px 24px" : "14px 24px",
      borderTop: "1px solid var(--line-faint)", background: featured ? "var(--accent-soft)" : "transparent", cursor: "pointer", flexWrap: "wrap",
    }}>
      <span className="mono tnum" style={{ fontSize: 12.5, width: 44, flexShrink: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        {when.above && <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{when.above}</span>}
        <span style={{ color: when.tone === "neg" ? "var(--neg)" : when.tone === "warn" ? "var(--warn)" : when.tone === "pos" ? "var(--pos)" : "var(--fg-4)" }}>{when.text}</span>
      </span>
      {/* Status do lead como coluna própria (alinhada, igual o horário); a
          tentativa vai numa linha menor embaixo da pill. */}
      <span style={{ width: 118, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
        <span title={stage} style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: "20px", padding: "0 8px", borderRadius: "var(--r-1)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 500 }}>{stage}</span>
        {attemptNumber > 0 && <span className="mono tnum" style={{ fontSize: 10.5, color: "var(--fg-4)", paddingLeft: 2 }}>{attemptNumber}ª tentativa</span>}
      </span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</span>
          {l.company && <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{l.company}</span>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 3 }}>{actionDetail}</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {unowned && <button onClick={onClaim} style={{ height: 32, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px dashed var(--line-2)", color: "var(--fg-3)", fontSize: 12 }}>assumir</button>}
        {meet ? (
          <a href={meet} target="_blank" rel="noopener noreferrer" style={{ height: 32, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", color: "var(--fg-2)", fontSize: 12.5, textDecoration: "none" }}>Abrir Meet</a>
        ) : whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" style={{ height: 32, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: "var(--r-2)", border: `1px solid ${featured ? "var(--btn-bg)" : "var(--line-2)"}`, background: featured ? "var(--btn-bg)" : "var(--bg-1)", color: featured ? "var(--btn-fg)" : "var(--fg-2)", fontSize: 12.5, fontWeight: featured ? 600 : 500, textDecoration: "none" }}>WhatsApp</a>
        ) : null}
        {(featured || (!meet && !whatsapp)) && <button onClick={onScript} style={{ height: 32, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5 }}>Roteiro</button>}
      </div>
    </div>
  );
}

function DoneActivityRow({ item, onClick }) {
  const { l } = item;
  const time = l.lastActivityAt ? new Date(l.lastActivityAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 24px", borderTop: "1px solid var(--line-faint)", textAlign: "left" }}>
      <span style={{ color: "var(--pos)", fontSize: 13, width: 44, flexShrink: 0 }}>✓</span>
      <span style={{ fontSize: 13.5, color: "var(--fg-3)", textDecoration: "line-through", flex: 1 }}>{l.name}{l.company ? ` · ${l.company}` : ""} — {ACTION_LABELS[item.kind] || "atividade concluída"}</span>
      <span className="mono tnum" style={{ fontSize: 12, color: "var(--fg-4)" }}>{time}</span>
    </button>
  );
}

function CompactSchedule({ title, rows, onOpen }) {
  const timeOf = (item) => {
    if (!item.due) return "sem data";
    return title === "Amanhã"
      ? new Date(item.due.t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : new Date(item.due.t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };
  return (
    <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
      <div style={{ padding: "20px 24px 12px" }}><h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h3></div>
      <div style={{ padding: "0 24px 8px" }}>
        {rows.length === 0 && <div style={{ borderTop: "1px solid var(--line-faint)", padding: "12px 0 14px", fontSize: 12.5, color: "var(--fg-4)" }}>nenhuma atividade</div>}
        {rows.slice(0, 5).map((item) => (
          <button key={item.confirmWindow ? `${item.l.id}-${item.confirmWindow}` : item.l.id} onClick={() => onOpen(item)} style={{ width: "100%", display: "flex", gap: 10, alignItems: "baseline", padding: "10px 0", borderTop: "1px solid var(--line-faint)", textAlign: "left" }}>
            <span className="mono tnum" style={{ fontSize: 12, color: "var(--fg-4)", flexShrink: 0 }}>{timeOf(item)}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{item.l.name}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--fg-3)" }}>{ACTION_LABELS[item.kind] || "contato"}{item.l.company ? ` · ${item.l.company}` : ""}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DayScore({ contacted, contactedGoal, calls, callsGoal }) {
  const progress = (label, value, goal) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 13.5, color: "var(--fg-2)" }}>{label}</span>
        <span className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{value} <span style={{ fontWeight: 400, fontSize: 12, color: "var(--fg-4)" }}>/ {goal}</span></span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, Math.round((value / Math.max(goal, 1)) * 100))}%`, background: "var(--accent)", borderRadius: 999 }} /></div>
    </div>
  );
  return (
    <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: "20px 24px" }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-4)" }}>Placar do dia</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
        {progress("Contatados", contacted, contactedGoal)}
        {progress("Calls agendadas", calls, callsGoal)}
      </div>
    </section>
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
    // Registrada no movimento Call → Follow-up: é a oferta que o follow-up cobra.
    ["Proposta na mesa", lead.proposalOffer ? (lead.proposalOffer === "nenhuma" ? "não chegou na proposta" : closedPlanLabel(lead.proposalOffer) || lead.proposalOffer) : null],
    ["Pagamento", lead.paymentMethod ? paymentLabel(lead.paymentMethod) : null],
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

// Resumo da última call por IA (activity call_summary, gerado da transcrição do
// Meet) mostrado no roteiro pra o closer trabalhar o follow-up com contexto: o
// que rolou, objeções (tratadas/em aberto), combinados, próximo passo e a
// mensagem de WhatsApp pronta pra enviar. Some quando não há resumo ainda.
export function CallSummaryCard({ summary, phone }) {
  const [copied, setCopied] = useS(false);
  if (!summary) return null;
  const box = { border: "1px solid var(--accent-line)", borderRadius: "var(--r-2)", padding: "10px 12px", background: "var(--accent-soft)" };
  const kick = { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" };
  // Integração (onboarding) tem estrutura própria: sentimento no lugar da
  // temperatura, configurado/pendências/próximos passos no lugar de objeções.
  const integ = summary.kind === "integracao" || !!summary.sentimento;
  const badge = integ ? summary.sentimento : summary.temperatura;
  const tone = integ
    ? (summary.sentimento === "satisfeito" ? "pos" : summary.sentimento === "em risco" ? "neg" : "warn")
    : (summary.temperatura === "quente" ? "neg" : summary.temperatura === "morno" ? "warn" : "mut");
  const wa = phone ? waLink(phone) : null;
  const msg = summary.followup?.whatsapp || "";
  const waHref = wa ? (msg ? `${wa}?text=${encodeURIComponent(msg)}` : wa) : null;
  const copy = async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem clipboard */ } };
  const line = { fontSize: 12, lineHeight: 1.5, color: "var(--fg-1)" };
  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span className="mono" style={{ ...kick, color: "var(--accent)" }}>{integ ? "Resumo da integração · IA" : "Resumo da última call · IA"}</span>
        {badge && <Pill tone={tone}>{badge}</Pill>}
        {summary.recordingUrl && <a href={summary.recordingUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>🎥 gravação</a>}
      </div>
      {summary.resumo && <div style={{ ...line, marginBottom: 6 }}>{summary.resumo}</div>}
      {integ ? (
        <>
          {summary.configurado?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="mono dim" style={{ ...kick, fontSize: 10, marginBottom: 3 }}>Configurado</div>
              {summary.configurado.map((c, i) => <div key={i} style={line}>• {c}</div>)}
            </div>
          )}
          {summary.pendencias?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="mono dim" style={{ ...kick, fontSize: 10, marginBottom: 3 }}>Pendências</div>
              {summary.pendencias.map((p, i) => (
                <div key={i} style={{ ...line, display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span className="mono" style={{ color: "var(--warn)", flexShrink: 0, fontSize: 10 }}>{p.responsavel || "?"}</span>
                  <span style={{ minWidth: 0 }}>{p.item}</span>
                </div>
              ))}
            </div>
          )}
          {summary.proximosPassos?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="mono dim" style={{ ...kick, fontSize: 10, marginBottom: 3 }}>Próximos passos</div>
              {summary.proximosPassos.map((p, i) => <div key={i} style={line}>• {p}</div>)}
            </div>
          )}
        </>
      ) : (
        <>
          {summary.objecoes?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="mono dim" style={{ ...kick, fontSize: 10, marginBottom: 3 }}>Objeções</div>
              {summary.objecoes.map((o, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <div style={{ ...line, display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span className="mono" style={{ color: o.resolvida ? "var(--pos)" : "var(--neg)", flexShrink: 0, fontSize: 10 }}>{o.resolvida ? "tratada" : "em aberto"}</span>
                    <span style={{ fontWeight: 500, minWidth: 0 }}>{o.objecao}</span>
                  </div>
                  {o.comoFoiTratada && <div className="dim" style={{ fontSize: 11, lineHeight: 1.4, paddingLeft: 2 }}>{o.comoFoiTratada}</div>}
                </div>
              ))}
            </div>
          )}
          {summary.compromissos?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div className="mono dim" style={{ ...kick, fontSize: 10, marginBottom: 3 }}>Combinados</div>
              {summary.compromissos.map((c, i) => <div key={i} style={line}>• {c}</div>)}
            </div>
          )}
        </>
      )}
      {summary.followup?.nota && (
        <div style={{ ...line, marginBottom: msg ? 6 : 0 }}><span className="mono dim" style={{ ...kick, fontSize: 10 }}>{integ ? "Acompanhamento" : "Próximo passo"}</span> · {summary.followup.nota}</div>
      )}
      {msg && (
        <div style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: "7px 9px" }}>
          <div className="mono dim" style={{ ...kick, fontSize: 9.5, marginBottom: 3 }}>WhatsApp sugerido</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 6 }}>{msg}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {waHref && <a href={waHref} target="_blank" rel="noopener noreferrer" style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: "var(--r-2)", background: "#25D366", color: "#06120c", fontSize: 11.5, fontWeight: 700, textDecoration: "none" }}>enviar no WhatsApp ↗</a>}
            <button onClick={copy} style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5 }}>{copied ? "copiado ✓" : "copiar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Briefing de passagem pro INTEGRADOR (activity integration_brief, gerado da
// transcrição da call de VENDA quando o card entra em Integração). O integrador
// não estava na call: aqui ele se localiza (quem é o cliente, o que foi
// prometido) e vê o que fazer (confirmar, checklist, primeira mensagem).
export function IntegrationBriefCard({ brief, phone, deal }) {
  const [copied, setCopied] = useS(false);
  const [open, setOpen] = useS(true);
  if (!brief) return null;
  // O negócio JÁ ESTÁ FECHADO: a linha do que foi contratado abre o card pra
  // ninguém tratar quem já comprou como lead em negociação.
  // O que foi contratado (escopo), NÃO como foi pago: forma de pagamento é
  // assunto do financeiro, o integrador não fala de dinheiro com o cliente.
  const closed = [
    Number(deal?.amount) > 0 ? window.fmt.money(deal.amount) : "",
    closedPlanLabel(deal?.planClosed),
  ].filter(Boolean).join(" · ");
  const box = { border: "1px solid var(--accent-line)", borderRadius: "var(--r-2)", padding: "10px 12px", background: "var(--accent-soft)" };
  const kick = { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" };
  const line = { fontSize: 12, lineHeight: 1.5, color: "var(--fg-1)" };
  const sub = (label) => <div className="mono dim" style={{ ...kick, fontSize: 10, marginBottom: 3 }}>{label}</div>;
  // O passo a passo da call fica no roteiro da etapa (card Passo a passo, logo
  // abaixo): aqui é só o contexto. `vendido` é o shape antigo do briefing.
  const entregas = brief.entregas || brief.vendido;
  // A integração é feita numa CALL DE VÍDEO: a mensagem que a IA escreve PROPÕE
  // a call (ela não conhece link nem agenda). Quando o horário já está marcado
  // e o Meet criado, a mensagem fecha o combinado com dia e link de verdade —
  // é a diferença entre "vamos marcar" e "está marcado, entra por aqui".
  const meetUrl = deal?.integrationCallUrl || "";
  const when = (() => {
    const d = deal?.integrationAt ? new Date(deal.integrationAt) : null;
    if (!d || !Number.isFinite(d.getTime())) return "";
    return `${d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  })();
  const callLine = meetUrl
    ? (when
      ? `Fica ${when}. É por vídeo, entra por este link no horário: ${meetUrl}`
      : `Nossa call de integração é por vídeo, entra por este link: ${meetUrl}`)
    : when
      ? `Fica ${when}, é uma call de vídeo. Te mando o link antes.`
      : "A integração é numa call de vídeo comigo, qual o melhor dia e horário pra você?";
  const msg = [brief.primeiraMensagem || "", callLine].filter(Boolean).join("\n\n");
  const wa = phone ? waLink(phone) : null;
  const waHref = wa ? (msg ? `${wa}?text=${encodeURIComponent(msg)}` : wa) : null;
  const copy = async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem clipboard */ } };
  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span className="mono" style={{ ...kick, color: "var(--accent)" }}>Briefing da integração · IA</span>
        <Pill tone="pos">negócio fechado</Pill>
        {brief.source === "resumo" && <Pill tone="warn">sem transcrição</Pill>}
        {brief.recordingUrl && <a href={brief.recordingUrl} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 10.5, color: "var(--accent)" }}>🎥 gravação da venda</a>}
        <button onClick={() => setOpen((v) => !v)} className="mono dim" style={{ fontSize: 10.5, marginLeft: "auto" }}>{open ? "recolher" : "abrir"}</button>
      </div>
      <div className="mono dim" style={{ ...kick, fontSize: 10, marginBottom: 5 }}>
        {closed ? `Já contratou: ${closed} · agora é entrega, não venda` : "O cliente já comprou, agora é entrega, não venda"}
      </div>
      {/* Estado da call de vídeo: é por ela que a integração acontece, então o
          card cobra o que falta (marcar a data, criar o Meet) antes do resto. */}
      <div className="mono" style={{ ...kick, fontSize: 10, marginBottom: 6, color: meetUrl ? "var(--pos)" : "var(--warn)" }}>
        {meetUrl
          ? `Call de vídeo ${when ? `marcada: ${when}` : "com link criado"}`
          : when ? `Call de vídeo ${when}, falta criar o Meet (logo abaixo, em Integração)` : "Sem call de vídeo marcada: combine o horário e crie o Meet em Integração"}
      </div>
      {brief.resumo && <div style={{ ...line, marginBottom: open ? 6 : 0 }}>{brief.resumo}</div>}
      {open && (
        <>
          <div style={{ marginBottom: 6 }}>
            {sub("Objetivos da entrega")}
            {entregas?.length > 0
              ? entregas.map((v, i) => <div key={i} style={line}>• {v}</div>)
              : <div className="mono dim" style={{ fontSize: 11 }}>briefing antigo sem objetivos, use "refazer briefing" no card de Integração</div>}
          </div>
          {brief.atencao?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {sub("Pontos de atenção")}
              {brief.atencao.map((a, i) => (
                <div key={i} style={{ ...line, color: "var(--neg)" }}>• {typeof a === "string" ? a : `${a.ponto}: ${a.porque}`}</div>
              ))}
            </div>
          )}
          {msg && (
            <div style={{ border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", padding: "7px 9px" }}>
              <div className="mono dim" style={{ ...kick, fontSize: 9.5, marginBottom: 3 }}>{meetUrl ? "Mensagem com o link da call" : "Mensagem pra marcar a call de vídeo"}</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 6 }}>{msg}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {waHref && <a href={waHref} target="_blank" rel="noopener noreferrer" style={{ height: 26, display: "inline-flex", alignItems: "center", padding: "0 10px", borderRadius: "var(--r-2)", background: "#25D366", color: "#06120c", fontSize: 11.5, fontWeight: 700, textDecoration: "none" }}>enviar no WhatsApp ↗</a>}
                <button onClick={copy} style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5 }}>{copied ? "copiado ✓" : "copiar"}</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Atalhos da call — pro operador que abre o roteiro de uma call agendada: reúne
// num lugar só o LINK da chamada (entrar · copiar · mandar pro cliente no
// WhatsApp já com o link no texto) e a PROPOSTA (abrir/editar a existente ou
// gerar na hora). Sem link ainda? cria o Meet (Google) ou a sala Jitsi, na
// mesma regra do drawer. `wa` = base do WhatsApp do lead (waLink(l.phone));
// `onPatch` grava no lead (sincroniza a fila e persiste). Proposta é só do
// closer na call — na tarefa de confirmação do SDR ela some.
function CallShortcuts({ l, item, wa, onPatch }) {
  const [busy, setBusy] = useS("");   // "meet" | ""
  const [err, setErr] = useS("");
  const firstName = l.name ? " " + String(l.name).trim().split(/\s+/)[0] : "";
  const waForward = wa && l.callUrl
    ? `${wa}?text=${encodeURIComponent(`Oi${firstName}! Aqui é da LeverAds. Nossa call vai ser por este link: ${l.callUrl}`)}`
    : null;
  const googleOn = !!window.SEED?.CONFIG?.google?.connected;

  async function makeLink() {
    setBusy("meet"); setErr("");
    try {
      // O servidor já grava o callUrl no lead; o patch só espelha aqui e na fila.
      if (googleOn) { const r = await api.createMeet(l.id); onPatch({ callUrl: r.callUrl, meetEventId: r.eventId }); }
      else onPatch({ callUrl: `https://meet.jit.si/LeverAds-${Math.random().toString(36).slice(2, 10)}` });
    } catch (e) { setErr(e?.message || "falha ao criar o link da call"); }
    setBusy("");
  }

  const chip = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 600, textDecoration: "none", cursor: "pointer" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const rowLabel = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.04em", textTransform: "uppercase" };

  return (
    <div style={{ border: "1px solid var(--line-2)", background: "var(--bg-inset)", borderRadius: "var(--r-2)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div className="mono" style={{ ...kicker, color: "var(--accent)" }}>Atalhos da call</div>

      {/* Link da chamada: entrar · copiar · mandar pro cliente no Whats. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={rowLabel}>Link da chamada</span>
        {l.callUrl ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <a href={l.callUrl} target="_blank" rel="noopener noreferrer" style={chip} title={l.callUrl}>entrar na call ↗</a>
            <button style={chip} title="Copiar o link da call"
              onClick={() => { try { navigator.clipboard.writeText(l.callUrl); } catch { window.prompt("Link da call:", l.callUrl); } }}>copiar</button>
            {waForward && (
              <a href={waForward} target="_blank" rel="noopener noreferrer" style={{ ...chip, borderColor: "#25D366", color: "#128c4b" }}
                title={`Mandar o link da call pro ${l.name || "cliente"} no WhatsApp`}>mandar link no Whats ↗</a>
            )}
            {!wa && <span className="mono dim" style={{ fontSize: 10 }}>sem telefone pra mandar no Whats</span>}
          </div>
        ) : (
          <button onClick={makeLink} disabled={busy === "meet"} style={{ ...chip, alignSelf: "flex-start" }}
            title={googleOn ? "Cria o evento com Meet na agenda e o link da call" : "Cria uma sala Jitsi instantânea pra call"}>
            {busy === "meet" ? "criando…" : googleOn ? "🎥 criar link (Meet)" : "🎥 criar link da call"}
          </button>
        )}
      </div>

      <ProposalBlock l={l} wa={wa} item={item} onPatch={onPatch} />

      {err && <div className="mono" style={{ fontSize: 10.5, color: "var(--neg)" }}>{err}</div>}
    </div>
  );
}

// Proposta dentro do roteiro: APRESENTAR ao vivo (link com edição inline) e
// MANDAR pro cliente no WhatsApp. O deck é de apresentação — o preço só entra
// no comando do closer e as ofertas 2/3 são secretas —, então cada oferta tem
// um link PRÓPRIO pro cliente (proposta separada, já visível e sem edição): o
// botão gera/atualiza esse link e abre o Whats com a mensagem pronta.
function ProposalBlock({ l, wa, item, onPatch }) {
  const [offers, setOffers] = useS([]);
  const [busy, setBusy] = useS("");
  const [err, setErr] = useS("");
  const [sent, setSent] = useS(null); // { offer, url } da última enviada

  const cfg = window.SEED?.CONFIG?.levercopy;
  const eligible = !item?.confirm && (
    (window.SEED?.CONFIG?.proposals?.nativeSaas || []).includes(l.saas)
    || (!!cfg?.enabled && l.saas === cfg.saas)
  );
  const brand = (window.SEED?.SAAS || []).find((s) => s.id === l.saas)?.name || "LeverAds";
  const firstName = l.name ? " " + String(l.name).trim().split(/\s+/)[0] : "";

  // Ofertas do deck (a principal + a escada secreta) — só existem depois que a
  // proposta foi gerada; deck sem escada devolve uma opção só.
  useE(() => {
    setOffers([]); setSent(null); setErr("");
    if (!l.proposta_id) return;
    let alive = true;
    api.proposalOffers(l.id)
      .then((r) => { if (alive) setOffers(r?.offers || []); })
      .catch(() => { /* sem ofertas: cai no link único de sempre */ });
    return () => { alive = false; };
  }, [l.id, l.proposta_id]);

  async function genProposal() {
    setBusy("gen"); setErr("");
    try {
      const r = await api.generateProposal(l.id, {});
      if (!r || r.ok === false) setErr("não deu pra gerar a proposta");
      else if (r.lead) onPatch({ proposalUrl: r.lead.proposalUrl, proposal_edit_url: r.lead.proposal_edit_url, proposta_id: r.lead.proposta_id });
    } catch { setErr("não deu pra gerar a proposta"); }
    setBusy("");
  }

  async function share(o) {
    setBusy(`o${o.offer}`); setErr("");
    // A aba do Whats abre ANTES do await: aberta depois da resposta, o
    // navegador trata como popup e bloqueia. Sem telefone (ou se o bloqueio
    // vier assim mesmo), o link fica no bloco pra copiar/abrir na mão.
    const win = wa ? window.open("", "_blank") : null;
    try {
      const r = await api.shareProposal(l.id, o.offer);
      setSent({ offer: o.offer, url: r.url });
      const text = `Oi${firstName}! Aqui é da ${brand}. Segue a sua proposta com tudo o que a gente conversou: ${r.url}`;
      if (win) win.location.replace(`${wa}?text=${encodeURIComponent(text)}`);
    } catch {
      if (win) win.close();
      setErr("não deu pra preparar o link da proposta");
    }
    setBusy("");
  }

  if (!l.proposalUrl && !eligible) return null;

  const chip = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 600, textDecoration: "none", cursor: "pointer" };
  const rowLabel = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.04em", textTransform: "uppercase" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={rowLabel}>Proposta</span>
      {!l.proposalUrl ? (
        <button onClick={genProposal} disabled={busy === "gen"} style={{ ...chip, alignSelf: "flex-start", borderColor: "var(--accent-line)", color: "var(--accent)" }}>
          {busy === "gen" ? "gerando…" : "gerar proposta"}
        </button>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {/* Só o link ?k (setup + edição inline) fica aqui: o deck de
                apresentação sem chave esconde o preço atrás do comando, então
                não serve de prévia do cliente. O que o cliente recebe é o link
                da oferta, conferível no "conferir" depois de mandar. */}
            <a href={l.proposal_edit_url || cockpitProposalUrl(l.proposalUrl)} target="_blank" rel="noopener noreferrer" style={{ ...chip, borderColor: "var(--accent-line)", color: "var(--accent)" }}>apresentar ao vivo ↗</a>
          </div>
          {offers.length > 0 && (
            <>
              <span style={{ ...rowLabel, marginTop: 3 }}>Mandar no Whats · escolha a oferta</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {offers.map((o) => (
                  <button key={o.offer} onClick={() => share(o)} disabled={!!busy}
                    title={`Gera o link do cliente (preço visível, sem edição) da oferta ${o.label} e abre o WhatsApp`}
                    style={{ ...chip, borderColor: sent?.offer === o.offer ? "#25D366" : "var(--line-2)", color: sent?.offer === o.offer ? "#128c4b" : "var(--fg-2)" }}>
                    {busy === `o${o.offer}` ? "preparando…" : `${o.label}${o.price ? ` · ${o.price}` : ""}`}
                  </button>
                ))}
                {!wa && <span className="mono dim" style={{ fontSize: 10 }}>sem telefone: o link fica aqui pra copiar</span>}
              </div>
            </>
          )}
          {sent && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--pos)" }}>✓ link do cliente pronto</span>
              <button style={{ ...chip, height: 24 }} title="Copiar o link da proposta do cliente"
                onClick={() => { try { navigator.clipboard.writeText(sent.url); } catch { window.prompt("Link da proposta:", sent.url); } }}>copiar</button>
              <a href={cockpitProposalUrl(sent.url)} target="_blank" rel="noopener noreferrer" style={{ ...chip, height: 24 }}>conferir ↗</a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Painel do roteiro em DUAS COLUNAS lado a lado (sem abas): CLIENTE à esquerda
// (resumo da situação + últimos contatos + dados EDITÁVEIS na ordem da
// conversa) e ROTEIRO à direita (postura, objetivo e o passo a passo com a
// fala pronta). Em tela estreita as colunas empilham. "Toque e próximo"
// mantém o operador em fluxo: registra e já abre o cliente seguinte.
function ScriptPanel({ item, saasCfg, leads, onPatch, onMove, onMoveMeet, onAfter, onClose, onTouch, onOpenLead, preview = false, previewScript = null }) {
  // Cópia local do lead: a edição inline dos campos reflete na hora aqui (fala
  // interpolada + checklist) e persiste via onPatch (fila + API).
  const [l, setL] = useS(item.l);
  useE(() => { setL(item.l); }, [item.l.id]); // eslint-disable-line react-hooks/exhaustive-deps
  function patch(p) {
    setL((prev) => ({ ...prev, ...p }));
    onPatch && onPatch(item.l.id, p);
  }
  // Remarcação na confirmação: o cliente pediu pra mudar de horário. O SDR escolhe
  // um novo slot na agenda do closer; salvamos o novo callAt E registramos um TOQUE
  // (meta.event="reschedule") — assim conta como "contatado" no placar do SDR e
  // entra na timeline. Não é no-show e não muda de etapa: o card segue em Call
  // agendada, só com horário novo (reschedule:false → não bumpa tentativa nem GPS).
  const [resched, setResched] = useS(false);
  const [rDay, setRDay] = useS(() => nextBusinessDays(1)[0]);
  const [rSlot, setRSlot] = useS("");
  useE(() => { setResched(false); setRSlot(""); }, [item.l.id]);
  function doReschedule() {
    if (!rSlot) return;
    // Na confirmação da INTEGRAÇÃO o horário que muda é o da entrega, não o da
    // call de venda (que já aconteceu e virou histórico do card).
    const isInteg = item.confirmKind === "integracao";
    patch(isInteg ? { integrationAt: rSlot, integrationConfirmed: false } : { callAt: rSlot, callConfirmed: false });
    api.logActivity({
      saas: l.saas, lead: l.id, type: "call",
      text: isInteg ? "remarcou a integração na confirmação" : "remarcou a call na confirmação",
      author: currentUser()?.id || "", meta: { reschedule: false, event: "reschedule" },
    }).catch((err) => console.warn("remarcação não registrada:", err.message));
    setResched(false);
    onClose && onClose();
  }
  // Item de confirmação de call usa o roteiro de confirmação; o resto, o roteiro
  // do estágio (por tentativa). A confirmação não é movimento de etapa, então o
  // bloco "Depois da ação" (destino) some pra esse item. Em pré-visualização
  // (Ajustes → Scripts) o roteiro já vem pronto (previewScript) — mostra o
  // rascunho que está sendo editado, sem depender de resolver por lead.
  const script = previewScript || (item.confirm
    ? (item.confirmKind === "integracao" ? integrationConfirmationScript(l, saasCfg) : confirmationScript(l, saasCfg, item.confirmWindow))
    : resolveScript(saasCfg, l));
  const checklist = scriptChecklist(saasCfg, l);
  const wa = waLink(l.phone);
  const tier = leadTier(l);
  // Atribuição + dor do criativo (mesmo catálogo do drawer): de onde o lead veio
  // e qual dor o anúncio prometeu resolver — o gancho pra conduzir a conversa.
  const cat = useAttribution(l.saas, !!l.utm);
  const { pain, facts, attribution } = clientSummary(saasCfg, l, item.stage, cat);

  // Últimos contatos da timeline + o último resumo de call por IA (activity
  // system call_summary) — contexto de quem já falou com esse lead e o que
  // saiu da última call, pra o closer conduzir o follow-up.
  const [acts, setActs] = useS(null);
  const [callSummary, setCallSummary] = useS(null);
  const [salesSummary, setSalesSummary] = useS(null); // última call de VENDA resumida (alimenta os tokens do roteiro)
  const [actsReload, setActsReload] = useS(0); // bump refaz o fetch após anotar
  useE(() => {
    // Pré-visualização usa um lead fictício: não busca timeline (nem bate na API).
    if (preview) { setActs([]); return; }
    let alive = true;
    setActs(null); setCallSummary(null); setSalesSummary(null);
    api.listActivities(l.id)
      .then((a) => {
        if (!alive) return;
        const all = a || [];
        setActs(all.filter((x) => x.type !== "system")
          .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))
          .slice(0, 4));
        const sums = all.filter((x) => x.meta?.event === "call_summary" && x.meta?.summary)
          .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));
        const cs = sums[0];
        setCallSummary(cs ? { ...cs.meta.summary, recordingUrl: cs.meta.recordingUrl || "", kind: cs.meta.kind || "call" } : null);
        // Pros tokens do roteiro só serve a call de VENDA (a de integração tem
        // outra estrutura: sentimento/pendências, nada de objeção/combinado).
        setSalesSummary(sums.find((x) => (x.meta.kind || "call") === "call")?.meta.summary || null);
      })
      .catch(() => { if (alive) { setActs([]); setCallSummary(null); setSalesSummary(null); } });
    return () => { alive = false; };
  }, [l.id, actsReload]);
  // Tokens depois do fetch: o roteiro do follow-up usa o que saiu da call
  // transcrita (combinado, objeção em aberto, dor, temperatura).
  const tokens = scriptTokens(l, saasCfg, salesSummary);

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
  // Texto puro da fala (tokens já resolvidos) pra copiar e colar no WhatsApp.
  const falaText = (text) => scriptSegments(text, tokens).map((s) => (s.text != null ? s.text : s.value != null ? s.value : s.gap || "")).join("");
  const [copiedStep, setCopiedStep] = useS(null);
  const copyFala = async (text, i) => {
    const t = falaText(text);
    try { await navigator.clipboard.writeText(t); setCopiedStep(i); setTimeout(() => setCopiedStep((c) => (c === i ? null : c)), 1500); }
    catch { window.prompt("Copie a mensagem:", t); }
  };

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
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8 }}>
              <span>{script.titulo}{script.custom ? " · personalizado" : ""}</span>
              {preview && (
                <span className="mono" style={{ fontSize: 9.5, color: "var(--accent)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 999, padding: "1px 7px", letterSpacing: "0.04em" }}>
                  pré-visualização · dados de exemplo
                </span>
              )}
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
          {!preview && (
            <button onClick={onOpenLead} style={{ padding: "6px 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12, flexShrink: 0 }}>
              abrir lead
            </button>
          )}
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
                {/* Observações · registrar contato: mesmo composer do drawer do
                    pipeline (grava na coleção activities). Como é o MESMO dado, a
                    anotação feita aqui aparece lá e vice-versa. Some no preview. */}
                {!preview && (
                  <div style={{ marginTop: 10 }}>
                    <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Observações · registrar contato</div>
                    <ActivityComposer lead={l} onLogged={() => setActsReload((n) => n + 1)} />
                  </div>
                )}
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
                confirmação não move etapa, então não mostra destino. Em
                pré-visualização o bloco vira só uma nota (as ações mexem em
                lead/agenda de verdade, não fazem sentido numa simulação). */}
            {!item.confirm && !preview && <DestinoSection saasCfg={saasCfg} lead={l} leads={leads} callSummary={callSummary} onMove={onMove} onMoveMeet={onMoveMeet} onAfter={onAfter} onTouch={onTouch} />}
            {!item.confirm && preview && (
              <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5, border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", padding: "9px 11px", background: "var(--bg-inset)" }}>
                na fila real, aqui aparece o bloco <b>“Depois da ação”</b> (pra onde vai o card: próxima etapa, agenda da call, ganho/perda).
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div className="mono" style={{ ...kicker, color: "var(--fg-3)" }}>Roteiro</div>
            {/* Resumo da última call por IA em cima do roteiro do estágio. */}
            <CallSummaryCard summary={callSummary} phone={l.phone} />
            {/* Call agendada: atalhos do closer no topo (link da call + mandar pro
                cliente no Whats + proposta), antes do passo a passo. */}
            {item.kind === "call" && !preview && <CallShortcuts l={l} item={item} wa={wa} onPatch={patch} />}
            {/* Fora da call, quem cobra proposta/follow-up também precisa do
                atalho de mandar a proposta no Whats (sem os atalhos da call). */}
            {item.kind !== "call" && !preview && PROPOSAL_KINDS.has(item.kind) && (
              <div style={{ border: "1px solid var(--line-2)", background: "var(--bg-inset)", borderRadius: "var(--r-2)", padding: "10px 12px" }}>
                <ProposalBlock l={l} wa={wa} item={item} onPatch={patch} />
              </div>
            )}
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
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-1)", borderLeft: "3px solid var(--accent-line)", paddingLeft: 10, whiteSpace: "pre-wrap" }}>
                            {renderFala(p.fala)}
                          </div>
                          <button onClick={() => copyFala(p.fala, i)} title="Copiar a mensagem (com os dados preenchidos) pra colar no WhatsApp"
                            style={{ flexShrink: 0, height: 24, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid " + (copiedStep === i ? "var(--pos)" : "var(--line-2)"),
                              background: "var(--bg-2)", color: copiedStep === i ? "var(--pos)" : "var(--fg-3)", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                            {copiedStep === i ? "copiado ✓" : "⧉ copiar"}
                          </button>
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
          {item.confirm && (() => {
            // Na integração o flag é próprio (integrationConfirmed): confirmar a
            // entrega não pode marcar a call de venda como confirmada.
            const isInteg = item.confirmKind === "integracao";
            const on = isInteg ? !!l.integrationConfirmed : !!l.callConfirmed;
            return (
              <button onClick={() => patch(isInteg ? { integrationConfirmed: !on } : { callConfirmed: !on })}
                title={on ? "Cliente confirmou presença (clique pra desmarcar)" : "Marcar que o cliente confirmou a presença"}
                style={{ padding: "8px 14px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600,
                  background: on ? "var(--pos)" : "var(--bg-1)", color: on ? "#06120c" : "var(--fg-2)",
                  border: "1px solid " + (on ? "var(--pos)" : "var(--line-2)") }}>
                {on ? "✓ cliente confirmou" : "cliente confirmou"}
              </button>
            );
          })()}
          {/* Cliente pediu pra remarcar na confirmação: escolhe novo horário na
              agenda do closer. Salva o novo callAt E vira um toque (credita o SDR). */}
          {item.confirm && !preview && (
            <button onClick={() => setResched((v) => !v)}
              title="Cliente pediu pra remarcar: escolher novo horário (conta como contato no seu placar)"
              style={{ padding: "8px 14px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600,
                background: resched ? "var(--accent-soft)" : "var(--bg-1)", color: resched ? "var(--accent)" : "var(--fg-2)",
                border: "1px solid " + (resched ? "var(--accent-line)" : "var(--line-2)") }}>
              ↻ remarcar
            </button>
          )}
          {item.confirm && !preview && resched && (
            <div style={{ flex: "1 1 100%", marginTop: 4, padding: 12, borderRadius: "var(--r-2)", background: "var(--bg-1)", border: "1px solid var(--line-2)" }}>
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 8 }}>
                {item.confirmKind === "integracao"
                  ? "Novo horário da integração · o Meet criado antes continua valendo, reenvie o link no novo horário."
                  : `Novo horário da call${l.closer ? "" : " · defina o closer no card antes"} — vira um toque no lead (conta no placar do SDR).`}
              </div>
              <SlotGrid days={nextBusinessDays(6)} day={rDay} setDay={setRDay} slot={rSlot} setSlot={setRSlot}
                busy={callBusyKeys(leads, item.confirmKind === "integracao" ? l.integrator : l.closer, l.id)} />
              <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setResched(false)}
                  style={{ padding: "8px 12px", borderRadius: "var(--r-2)", fontSize: 12.5, background: "transparent", color: "var(--fg-3)", border: "1px solid var(--line-2)" }}>
                  cancelar
                </button>
                <button onClick={doReschedule} disabled={!rSlot}
                  style={{ padding: "8px 14px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 700,
                    background: rSlot ? "var(--btn-bg, var(--accent))" : "var(--bg-2)", color: rSlot ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-4)",
                    border: "1px solid " + (rSlot ? "var(--btn-bg, var(--accent))" : "var(--line-2)"), cursor: rSlot ? "pointer" : "not-allowed" }}>
                  salvar novo horário
                </button>
              </div>
            </div>
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
  // Quais destinos e em que ordem: default do kind (NEXT_KINDS), sobrescrito por
  // produto em Ajustes → Próximos passos PELA CHAVE DE ROTEIRO (scriptKeyFor) —
  // assim 2ª tentativa, 3ª tentativa, 1º/2º/3º contato têm passos independentes.
  for (const k of nextKindsFor(saasCfg, scriptKeyFor(saasCfg, lead), curKind)) {
    if (k === "retry") {
      const promote = curKind === "novo";
      const target = promote ? (stageByKind(saasCfg, "qualificacao") || curStage) : curStage;
      out.push({ retry: true, promote, stage: target, kind: promote ? "qualificacao" : curKind });
      continue;
    }
    if (k === "noshow") {
      // No-show é kind contato (colide com Nutrição no stageByKind) → resolve
      // pela etapa nomeada "No show" do funil, se existir.
      const st = (saasCfg?.funnel || []).find((f) => f && isNoShowStage(f.stage));
      if (st && !seen.has(st.stage)) { seen.add(st.stage); out.push({ stage: st.stage, kind: "noshow" }); }
      continue;
    }
    const stage = stageByKind(saasCfg, k);
    if (stage && !seen.has(stage)) { seen.add(stage); out.push({ stage, kind: stageKind(saasCfg, stage) }); }
  }
  // A ordem já vem de nextKindsFor (default do kind ou override por roteiro).
  return out;
}

// Setup que cada destino pede antes de mover.
export function setupType(kind) {
  if (kind === "call") return "call";
  if (kind === "followup") return "followup"; // follow-up também escolhe horário na agenda
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
// YYYY-MM-DD local (pro <input type="date"> e comparação de dia); parseYMD volta
// pra Date em hora LOCAL (new Date("YYYY-MM-DD") seria UTC → dia anterior no BRT).
const ymd = (d) => { const p = (x) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const sameYMD = (a, b) => ymd(a) === ymd(b);
const parseYMD = (s) => { const [y, m, dd] = String(s).split("-").map(Number); const d = new Date(); d.setFullYear(y, (m || 1) - 1, dd || 1); d.setHours(0, 0, 0, 0); return d; };

// Um bloqueio de agenda (agenda_blocks) casa com o slot (cellKey "YYYY-MM-DD-HH")
// do dono? recur "weekly" bate pelo dia da semana; "once" pela data. allDay pega o
// dia todo; senão vale SOBREPOSIÇÃO: o slot de call [h, h+1) fica ocupado se o
// bloqueio toca qualquer pedaço dele (fromHour/toHour aceitam fração, ex. 7.5 =
// 07:30 — bloqueio de meia hora ocupa o slot inteiro que ele invade).
function matchBlock(blocks, key) {
  const dateStr = key.slice(0, 10);        // YYYY-MM-DD
  const hour = Number(key.slice(11, 13));  // HH
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return blocks.find((b) => {
    const hourHit = b.allDay || (Number(b.fromHour) < hour + 1 && Number(b.toHour) > hour);
    if (!hourHit) return false;
    return b.recur === "weekly" ? Number(b.weekday) === weekday : b.date === dateStr;
  });
}
// "Agenda ocupada" do dono: calls/integrações já marcadas (keys concretas) MAIS os
// bloqueios manuais da tela Agenda. Devolve o mesmo contrato que a SlotGrid usa
// (.has), com .info(key) extra pro tooltip (motivo do bloqueio).
export function busyView(concreteKeys, userId) {
  // Item conta pra pessoa quando ela é a dona (user) OU participante (users[],
  // compromisso com mais de uma pessoa ocupa a agenda de todas).
  const blocks = ((typeof window !== "undefined" && window.SEED?.AGENDA_BLOCKS) || [])
    .filter((b) => b.user === userId || (Array.isArray(b.users) && b.users.includes(userId)));
  return {
    has: (key) => concreteKeys.has(key) || !!matchBlock(blocks, key),
    info: (key) => {
      if (concreteKeys.has(key)) return { kind: "call" };
      const b = matchBlock(blocks, key);
      // Compromisso (kind "event") ocupa igual; o tooltip mostra o título dele.
      return b ? { kind: "block", reason: b.title || b.reason || "" } : null;
    },
  };
}

// Horas já ocupadas na agenda de um closer: cada lead dele com callAt marca a
// hora daquele slot (a call ocupa 1h). Ignora o próprio lead (reagendamento) e
// os follow-ups — follow-up NÃO bloqueia horário: o SDR pode marcar a call de
// venda por cima. Só call de venda conta como ocupada, pra não dar divergência.
// Soma os bloqueios manuais do closer (busyView).
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
  return busyView(busy, closerId);
}

// Horas ocupadas na agenda de um integrador: cada lead dele com integrationAt
// marca a hora (a integração ocupa 1h). Ignora o próprio lead (reagendamento).
// Soma os bloqueios manuais do integrador (busyView).
export function integBusyKeys(leads, integratorId, selfId) {
  const busy = new Set();
  for (const o of leads || []) {
    if (!integratorId || o.id === selfId || o.integrator !== integratorId || !o.integrationAt) continue;
    const d = new Date(o.integrationAt);
    if (Number.isFinite(d.getTime())) busy.add(cellKey(d));
  }
  return busyView(busy, integratorId);
}

// Grade de agenda reutilizável: abas de dia (dias úteis) + slots de 1h. Marca
// como ocupado (e desabilita) o que já está no `busy` do dono. Usada tanto pela
// call quanto pelo follow-up — o valor escolhido volta em `slotVal` (YYYY-MM-DDTHH:00).
function SlotGrid({ days, day, setDay, slot, setSlot, busy }) {
  const custom = !days.some((d) => sameYMD(d, day)); // dia escolhido no calendário (fora dos chips)
  // Trocar de dia limpa o horário se ele era de OUTRO dia (senão o resumo mostraria
  // um slot que não bate com a grade visível).
  const pickDay = (d) => { setDay(d); if (slot && slot.slice(0, 10) !== ymd(d)) setSlot(""); };
  return (
    <>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        {days.map((d, i) => {
          const on = sameYMD(d, day);
          return (
            <button key={i} onClick={() => pickDay(d)} style={{
              height: 30, padding: "0 10px", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)",
              background: on ? "var(--accent)" : "var(--bg-1)",
              color: on ? "var(--accent-fg)" : "var(--fg-3)",
              border: "1px solid " + (on ? "var(--accent)" : "var(--line-2)"),
            }}>{d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(/\./g, "")}</button>
          );
        })}
        {/* Calendário aberto: escolher qualquer dia/mês (não trava em dia útil). */}
        <label title="escolher qualquer dia no calendário" style={{
          display: "inline-flex", alignItems: "center", height: 30, padding: "0 8px", borderRadius: "var(--r-2)", cursor: "pointer",
          background: custom ? "var(--accent)" : "var(--bg-1)",
          color: custom ? "var(--accent-fg)" : "var(--fg-3)",
          border: "1px " + (custom ? "solid var(--accent)" : "dashed var(--line-2)"),
        }}>
          <input type="date" min={ymd(new Date())} value={ymd(day)} onChange={(e) => { if (e.target.value) pickDay(parseYMD(e.target.value)); }}
            style={{ border: 0, background: "transparent", fontSize: 11, fontFamily: "var(--mono)", color: "inherit", padding: 0, outline: "none", colorScheme: "light dark" }} />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>
        {Array.from({ length: CALL_H1 - CALL_H0 }, (_, i) => CALL_H0 + i).map((h) => {
          const cell = new Date(day); cell.setHours(h, 0, 0, 0);
          const key = cellKey(cell);
          const occupied = busy.has(key);
          const bInfo = occupied && busy.info ? busy.info(key) : null;
          const blocked = bInfo?.kind === "block"; // bloqueio manual (agenda) ≠ call já marcada
          const past = cell.getTime() < Date.now();
          const val = slotVal(day, h);
          const sel = slot === val;
          const disabled = occupied || past;
          const title = blocked ? ("agenda bloqueada" + (bInfo.reason ? `: ${bInfo.reason}` : "")) : occupied ? "closer já tem call nesse horário" : past ? "horário já passou" : "marcar";
          return (
            <button key={h} disabled={disabled} onClick={() => setSlot(val)} title={title}
              style={{
                height: 32, borderRadius: "var(--r-2)", fontSize: 11.5, fontFamily: "var(--mono)",
                background: sel ? "var(--accent)" : occupied ? "var(--neg-soft)" : "var(--bg-1)",
                color: sel ? "var(--accent-fg)" : occupied ? "var(--neg)" : past ? "var(--fg-4)" : "var(--fg-2)",
                border: "1px solid " + (sel ? "var(--accent)" : occupied ? "color-mix(in srgb, var(--neg) 30%, var(--line-2))" : "var(--line-2)"),
                opacity: past && !sel ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer",
                textDecoration: occupied && !blocked ? "line-through" : "none",
              }}>{blocked ? "🔒 " : ""}{String(h).padStart(2, "0")}:00</button>
          );
        })}
      </div>
    </>
  );
}

function DestinoSection({ saasCfg, lead, leads, callSummary, onMove, onMoveMeet, onAfter, onTouch }) {
  const dests = destinationsFor(saasCfg, lead);
  const stageMeta = Object.fromEntries((saasCfg?.funnel || []).map((f) => [f.stage, f]));
  const closers = usersByRole("closer");
  const integrators = usersByRole("integrator");
  const reasons = lossReasonsOf(saasCfg);

  const [dest, setDest] = useS(null);       // { stage, kind }
  const [closer, setCloser] = useS(lead.closer || "");
  const [integrator, setIntegrator] = useS(lead.integrator || (integrators.length === 1 ? integrators[0].id : ""));
  const [amount, setAmount] = useS(lead.amount || "");
  const [payment, setPayment] = useS(lead.paymentMethod || "");
  const [reason, setReason] = useS("");
  const [note, setNote] = useS("");
  const [slot, setSlot] = useS(lead.callAt || "");
  const [day, setDay] = useS(() => nextBusinessDays(1)[0]); // dia da grade (qualquer dia via calendário)
  // Call → Follow-up: qual proposta ficou na mesa (obrigatória nesse movimento).
  const fromCall = stageKind(saasCfg, lead.stage || saasCfg?.funnel?.[0]?.stage) === "call";
  const [offer, setOffer] = useS(lead.proposalOffer || "");
  const [email, setEmail] = useS(lead.email || "");
  const [emailTouched, setEmailTouched] = useS(false); // SDR digitou um e-mail próprio pro convite
  const [meetBusy, setMeetBusy] = useS(false);   // criando o Meet
  const [meetRes, setMeetRes] = useS(null);      // { callUrl, attendees }
  const [meetErr, setMeetErr] = useS(null);
  useE(() => {
    setDest(null); setCloser(lead.closer || ""); setSlot(lead.callAt || ""); setDay(nextBusinessDays(1)[0]);
    setIntegrator(lead.integrator || (integrators.length === 1 ? integrators[0].id : ""));
    setAmount(lead.amount || ""); setPayment(lead.paymentMethod || ""); setReason(""); setNote("");
    setOffer(lead.proposalOffer || "");
    setEmail(lead.email || ""); setEmailTouched(false); setMeetBusy(false); setMeetRes(null); setMeetErr(null);
  }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-preenche o e-mail do convite com o do lead SEMPRE que ele estiver
  // preenchido (ex.: o SDR acabou de preencher no checklist), até o SDR digitar
  // um e-mail próprio no campo do convite (aí respeita o que ele escreveu).
  useE(() => {
    if (!emailTouched && lead.email) setEmail(lead.email);
  }, [lead.email, emailTouched]);

  // Follow-up: pré-seleciona o horário que a IA sugeriu na última call
  // (callSummary.followup.quando, hora de Brasília), quando cai num slot válido
  // (dia útil à vista, dentro do expediente, no futuro e livre na agenda).
  useE(() => {
    if (!dest || setupType(dest.kind) !== "followup" || slot) return;
    const m = String(callSummary?.followup?.quando || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):/);
    if (!m) return;
    const hh = Number(m[2]);
    if (hh < CALL_H0 || hh >= CALL_H1) return;
    const dd = nextBusinessDays(6);
    const idx = dd.findIndex((d) => cellKey(d).slice(0, 10) === m[1]);
    if (idx < 0) return;
    const cell = new Date(dd[idx]); cell.setHours(hh, 0, 0, 0);
    if (cell.getTime() <= Date.now()) return;
    if (closer && callBusyKeys(leads, closer, lead.id).has(cellKey(cell))) return;
    setDay(dd[idx]); setSlot(`${m[1]}T${m[2]}:00`);
  }, [dest, callSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dests.length === 0) return null;
  const setup = dest ? setupType(dest.kind) : null;
  const days = nextBusinessDays(6);

  // Horas ocupadas na agenda do closer (cada call = 1h; ignora o próprio lead).
  // Vale pra call e pro follow-up: ambos marcam horário na agenda do closer.
  const busy = (setup === "call" || setup === "followup") && closer ? callBusyKeys(leads, closer, lead.id)
    : setup === "integrator" && integrator ? integBusyKeys(leads, integrator, lead.id)
    : new Set();

  // Escolher um destino inicializa a agenda com o horário que já existe no lead
  // (call/follow-up = callAt; integração = integrationAt), pra permitir reagendar.
  const chooseDest = (d) => {
    const next = dest?.stage === d.stage ? null : d;
    setDest(next);
    if (!next) return;
    const st = setupType(next.kind);
    const at = st === "integrator" ? (lead.integrationAt || "") : (st === "call" || st === "followup") ? (lead.callAt || "") : "";
    setSlot(at);
    setDay(at ? parseYMD(at.slice(0, 10)) : nextBusinessDays(1)[0]);
  };

  const ready = !dest ? false
    : setup === "call" ? !!(closer && slot)
    : setup === "followup" ? !!closer && (!fromCall || !!offer) // horário é opcional; saindo da call, a proposta na mesa é obrigatória
    : setup === "integrator" ? !!(integrator && (dest.kind !== "integracao" || (Number(amount) > 0 && !!payment)))
    : setup === "won" ? (Number(amount) > 0 && !!payment)
    : setup === "loss" ? !!reason
    : true;

  function confirm() {
    if (!ready) return;
    const patch = { stage: dest.stage };
    if (setup === "call") { patch.closer = closer; patch.callAt = slot; if (email.trim()) patch.email = email.trim(); }
    // Follow-up: mantém o closer e, se um horário foi escolhido, agenda nele —
    // callAt (aparece na agenda, sem travar slots de venda) + nextActionAt (a
    // fila do "meu dia" vence exatamente nesse horário, não na cadência padrão).
    else if (setup === "followup") { patch.closer = closer; if (fromCall && offer) patch.proposalOffer = offer; if (slot) { patch.callAt = slot; patch.nextActionAt = slot; } }
    // Integração: define o integrador e, se um horário foi escolhido na agenda,
    // agenda a integração nele (integrationAt aparece na Agenda e replica na
    // agenda pessoal do integrador que conectou o Google).
    else if (setup === "integrator") { patch.integrator = integrator; if (slot) patch.integrationAt = slot; if (dest.kind === "integracao" && Number(amount) > 0) { patch.amount = Number(amount); patch.paymentMethod = payment; } }
    else if (setup === "won") { patch.amount = Number(amount); patch.paymentMethod = payment; }
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
            <button key={d.stage} onClick={() => chooseDest(d)} style={{
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
                  <SlotGrid days={days} day={day} setDay={setDay} slot={slot} setSlot={setSlot} busy={busy} />
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

          {setup === "followup" && (
            closer ? (
              <div>
                {/* Saindo da CALL: registra qual proposta ficou na mesa — é ela
                    que o follow-up cobra (aparece no Resumo do cliente). */}
                {fromCall && (
                  <div style={{ maxWidth: 280, marginBottom: 10 }}>
                    <label style={label}>Qual proposta ficou na mesa? *</label>
                    <select value={offer} onChange={(e) => setOffer(e.target.value)} style={fieldStyle}>
                      <option value="">— a oferta que o cliente levou pra pensar —</option>
                      {CLOSED_PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      <option value="nenhuma">não chegou na proposta</option>
                    </select>
                  </div>
                )}
                <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginBottom: 6 }}>
                  Quando fazer o follow-up · agenda de {displayName(closer)}
                </div>
                {callSummary?.followup?.nota && <div className="mono" style={{ fontSize: 10.5, color: "var(--accent)", marginBottom: 6 }}>✨ IA (última call): {callSummary.followup.nota}</div>}
                <SlotGrid days={days} day={day} setDay={setDay} slot={slot} setSlot={setSlot} busy={busy} />
                {slot && <div className="mono" style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 8 }}>Follow-up: {slotFmt(slot)} · {displayName(closer)}</div>}
                <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>entra na agenda nesse horário · não trava o slot pra novas calls de venda. Sem horário, retoma pela cadência.</div>
              </div>
            ) : (
              <div style={{ maxWidth: 280 }}>
                <label style={label}>Responsável pelo follow-up *</label>
                <select value={closer} onChange={(e) => { setCloser(e.target.value); setSlot(""); }} style={fieldStyle}>
                  <option value="">— escolher —</option>
                  {closers.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                </select>
              </div>
            )
          )}

          {setup === "integrator" && (() => {
            const integLabel = dest.kind === "integracao" ? "integração" : "entrega/CS";
            return (
              <div>
                <div style={{ maxWidth: 280 }}>
                  <label style={label}>Responsável pela {integLabel} *</label>
                  <select value={integrator} onChange={(e) => { setIntegrator(e.target.value); setSlot(""); }} style={fieldStyle}>
                    <option value="">— escolher integrador —</option>
                    {integrators.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                  </select>
                  {lead.closer && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 5 }}>closer da venda: {displayName(lead.closer)} (fica registrado)</div>}
                </div>
                {dest.kind === "integracao" && (
                  <div style={{ maxWidth: 220, marginTop: 12 }}>
                    <label style={label}>Valor do negócio (R$) *</label>
                    <input type="number" min="0" step="0.01" value={amount} placeholder="ex.: 7188"
                      onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} style={fieldStyle} />
                    <div className="mono dim" style={{ fontSize: 10, marginTop: 5 }}>fechou! esse é o valor do negócio (vira a receita do closer)</div>
                    <div style={{ marginTop: 12 }}>
                      <label style={label}>Modo de pagamento *</label>
                      <select value={payment} onChange={(e) => setPayment(e.target.value)} style={fieldStyle}>
                        <option value="">— como o cliente fechou —</option>
                        {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                {integrator && (
                  <div style={{ marginTop: 14 }}>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>
                      Quando fazer a {integLabel} · agenda de {displayName(integrator)}
                    </div>
                    <SlotGrid days={days} day={day} setDay={setDay} slot={slot} setSlot={setSlot} busy={busy} />
                    {slot && <div className="mono" style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 8 }}>{integLabel[0].toUpperCase() + integLabel.slice(1)}: {slotFmt(slot)} · {displayName(integrator)}</div>}
                    <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>entra na agenda nesse horário e replica na agenda pessoal do integrador (se ele conectou o Google). Sem horário, só move pra {integLabel}.</div>
                  </div>
                )}
              </div>
            );
          })()}

          {setup === "won" && (
            <div style={{ maxWidth: 220 }}>
              <label style={label}>Valor do negócio (R$) *</label>
              <input type="number" min="0" step="0.01" value={amount} placeholder="ex.: 7188"
                onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} style={fieldStyle} />
              <div className="mono dim" style={{ fontSize: 10, marginTop: 5 }}>vira a receita no marketing e a conversão enviada pra Meta</div>
              <div style={{ marginTop: 12 }}>
                <label style={label}>Modo de pagamento *</label>
                <select value={payment} onChange={(e) => setPayment(e.target.value)} style={fieldStyle}>
                  <option value="">— como o cliente fechou —</option>
                  {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
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
                  <button onClick={() => onAfter && onAfter()} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12.5, fontWeight: 600 }}>próximo →</button>
                  <button onClick={() => setDest(null)} className="mono dim" style={{ fontSize: 11.5 }}>fechar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={agendarComMeet} disabled={!meetReady} style={{
                    height: 32, padding: "0 16px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600,
                    background: meetReady ? "var(--btn-bg, var(--accent))" : "var(--bg-2)", color: meetReady ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-4)",
                    border: "1px solid " + (meetReady ? "var(--btn-bg, var(--accent))" : "var(--line-2)"), cursor: meetReady ? "pointer" : "not-allowed",
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
                background: ready ? "var(--btn-bg, var(--accent))" : "var(--bg-2)", color: ready ? "var(--btn-fg, var(--accent-fg))" : "var(--fg-4)",
                border: "1px solid " + (ready ? "var(--btn-bg, var(--accent))" : "var(--line-2)"), cursor: ready ? "pointer" : "not-allowed",
              }}>{setup === "followup" && slot ? "agendar follow-up →" : `mover pra ${dest.stage} →`}</button>
              <button onClick={() => setDest(null)} className="mono dim" style={{ fontSize: 11.5 }}>cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { TodayScreen, ScriptPanel };
