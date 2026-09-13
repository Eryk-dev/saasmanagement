import React from "react";
import { FilterTab } from "../components/viz.jsx";
import { usersByRole, userColor, displayName, userById } from "../lib/users.js";
import { Avatar } from "../atoms.jsx";
import { stageKind } from "../lib/funnel.js";
import { isNoShowStage } from "../lib/scripts.js";

// A GRADE da agenda. Morava em screens/pipeline.jsx desde que a aba Agenda era
// do pipeline; a aba saiu de lá (VIEWS = kanban | list) e o código ficou, com
// um aviso de "não é código morto" em cima. Mudou de casa em 12/09/2026: a tela
// Agenda (screens/agenda.jsx) é a única consumidora, e as visões novas (Mês e
// Equipe) precisavam de espaço que um arquivo de 1.900 linhas de pipeline não
// dá. Nada de comportamento mudou na mudança.
//
// Visão de DIA (faixas por closer) ou SEMANA de 7 dias, estilo Google Agenda:
// calls (lead.callAt), integrações (integrationAt), follow-ups marcados,
// consultas 1:1 e — opcional — os toques do GPS. Cor do CARD = tipo; barrinha
// da esquerda = responsável. Clique abre o lead.
// `blocking` (opcional, tela Agenda): { blocksFor(d), onSlot(d, hora), onBlock(b) }
// desenha os bloqueios/compromissos e liga o clique em horário vazio.
// `person` (opcional): mostra só os eventos daquele responsável.

const { useState: useStP } = React;

// Instante de um horário de compromisso do lead. Os campos convivem em DUAS
// representações: o time digita hora local ("2026-08-28T16:00", sem fuso, é
// como callAt/followupAt são guardados) e o servidor grava ISO em UTC
// ("2026-08-28T18:00:00.000Z", como o nextActionAt do resumo por IA). O
// `new Date()` cru lê a string sem fuso na hora DO NAVEGADOR, então o mesmo
// compromisso virava dois instantes diferentes e a agenda desenhava duas
// pílulas. Aqui string sem fuso é sempre hora de BRASÍLIA, igual ao brtToIso do
// servidor (lead-flow.js) — é a régua que faz as duas representações se
// reconhecerem.
const atMs = (value) => {
  const v = String(value || "").trim();
  if (!v) return NaN;
  const withZone = /[Zz]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}-03:00`;
  return new Date(withZone).getTime();
};
// Mesmo compromisso, ainda que escrito em representações diferentes.
const sameMoment = (a, b) => {
  const x = atMs(a), y = atMs(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
};

// Distribui itens em faixas por CLUSTER de sobreposição: cada item recebe `lane`
// (posição) e `lanes` (nº de faixas do SEU cluster). A largura vem do cluster,
// não do dia — assim um horário lotado não espreme os itens dos outros horários.
function laneByCluster(items, startOf, endOf) {
  const sorted = [...items].sort((a, b) => startOf(a) - startOf(b));
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let clusterEnd = endOf(sorted[i]);
    let j = i + 1;
    while (j < sorted.length && startOf(sorted[j]) < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, endOf(sorted[j]));
      j++;
    }
    const laneEnds = [];
    const group = sorted.slice(i, j).map((it) => {
      let lane = laneEnds.findIndex((t) => t <= startOf(it));
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = endOf(it);
      return { ...it, lane };
    });
    const lanes = Math.max(1, laneEnds.length);
    group.forEach((it) => out.push({ ...it, lanes }));
    i = j;
  }
  return out;
}

// Cores dos TIPOS de evento da agenda (Leo, 23/08 v2: as escuras ficaram
// péssimas — "cores claras com letra preta, bem variado, bater o olho e saber").
// A COR diz o tipo; a PESSOA fica na barrinha grossa à esquerda, na mesma cor
// da legenda de nomes. Valores fixos (não seguem o tema): a letra escura por
// cima também é fixa, então o par sempre fecha contraste.
export const AGENDA_TYPE_COLORS = {
  call:         { bg: "oklch(0.91 0.09 165)", line: "oklch(0.62 0.12 165)", label: "call agendada" },   // verde-menta
  "follow-up":  { bg: "oklch(0.93 0.11 92)",  line: "oklch(0.65 0.12 92)",  label: "follow-up" },       // amarelo
  "integração": { bg: "oklch(0.91 0.07 268)", line: "oklch(0.62 0.10 268)", label: "integração" },      // lilás
  consulta:     { bg: "oklch(0.92 0.08 350)", line: "oklch(0.64 0.12 350)", label: "consulta 1:1" },    // rosa
};
// Call que o lead FUROU (Leo, 25/08): não é outro TIPO de compromisso, é outro
// DESFECHO — mantém o desenho da call e troca a cor pro vermelho suave. Na
// grade cheia, verde = aconteceu e vermelho = furou se lê de longe, sem abrir
// card nenhum.
const AGENDA_NOSHOW = { bg: "oklch(0.90 0.07 25)", line: "oklch(0.60 0.14 25)", label: "no-show" };
// Valor do card em um relance: 65k, R$1,2M, R$800. O número redondo basta
// (o exato mora no card do lead) e cabe na primeira linha mesmo na semana,
// onde a coluna do dia tem ~185px.
const valorCurto = (n) => {
  const v = Number(n) || 0;
  if (!v) return "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$${(abs / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${Math.round(abs / 1_000)}k`;
  return `R$${Math.round(abs)}`;
};
const WD_LONG = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const AGENDA_INK = "oklch(0.22 0.02 250)";      // letra "preta" sobre as cores claras
const AGENDA_INK_SOFT = "oklch(0.4 0.02 250)";  // linha secundária (hora, empresa)

// Entrar na sala sem abrir o card: o ▶ come o clique (o card inteiro abre o
// lead). Era um emoji de câmera; a régua da tela é sem emoji.
function PlayLink({ href }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title="Entrar na videochamada"
      onClick={(e) => e.stopPropagation()}
      style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 13, height: 13, borderRadius: 99, background: AGENDA_INK, color: "oklch(1 0 0)", fontSize: 7, textDecoration: "none", lineHeight: 1 }}>▶</a>
  );
}

function AgendaView({ leads, consultations = [], onOpenLead, blocking, person, people = [], onPerson, view: viewProp, onView }) {
  const [dayOff, setDayOff] = useStP(0); // offset em DIAS a partir de hoje
  const [showTouches, setShowTouchesState] = useStP(() => {
    try { return localStorage.getItem("cockpit_agenda_touches") === "1"; } catch { return false; }
  });
  const setShowTouches = (v) => {
    setShowTouchesState(v);
    try { localStorage.setItem("cockpit_agenda_touches", v ? "1" : "0"); } catch { /* ignore */ }
  };
  // Filtro por TIPO de evento: tudo · calls · follow-ups · integrações (Leo,
  // 23/08: "ver separadamente e juntos"; integrações em 08/09). Filtrado, a
  // grade isola só aquelas pílulas — compromissos/bloqueios e toques saem do
  // caminho pra leitura limpa. O valor do filtro é o próprio `kind` do evento.
  const [evKind, setEvKindState] = useStP(() => {
    try { return localStorage.getItem("cockpit_agenda_kind") || "all"; } catch { return "all"; }
  });
  const setEvKind = (v) => {
    setEvKindState(v);
    try { localStorage.setItem("cockpit_agenda_kind", v); } catch { /* ignore */ }
  };
  // VISÃO: 1 dia ou semana de 7 dias (Leo, 08/09). No dia cabe o time inteiro
  // em faixas lado a lado; na semana as faixas por pessoa não têm largura —
  // os eventos dividem a coluna do dia por sobreposição e a pessoa continua
  // na barrinha de cor à esquerda da pílula.
  // Desde 12/09 quem manda na visão é a TELA (o alternador mora no cabeçalho,
  // ao lado de "+ compromisso"); o estado interno fica de reserva pra quem
  // renderizar a grade sem passar a prop.
  const [viewInner, setViewInner] = useStP(() => {
    try { return localStorage.getItem("cockpit_agenda_view") || "day"; } catch { return "day"; }
  });
  const view = viewProp || viewInner;
  const setView = (v) => {
    if (onView) onView(v); else setViewInner(v);
    try { localStorage.setItem("cockpit_agenda_view", v); } catch { /* ignore */ }
  };
  const isWeek = view === "week";
  // EQUIPE (12/09): o mesmo dia, mas cada pessoa com a coluna dela de verdade
  // (cabeçalho com avatar, papel e contagem) e os VÃOS LIVRES clicáveis. A
  // visão Dia já divide o dia em faixas por closer; a de Equipe é a que serve
  // pra achar onde cabe mais uma call, e por isso entra todo mundo com agenda
  // (closer e integrador), não só os closers.
  const isTeam = view === "team";
  const H0 = 7, H1 = 21, hourH = 44;
  const saasCfgOf = (l) => (window.SEED?.SAAS || []).find((x) => x.id === l.saas);
  // PÁGINA da grade: no DIA (padrão desde 03/09) as setas andam de dia em dia,
  // fim de semana incluso; na SEMANA mostram os 7 dias de segunda a domingo e
  // as setas pulam de semana em semana. "hoje" volta pra data atual nos dois.
  // O offset continua em DIAS — trocar de visão preserva o ponto da navegação.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const anchor = new Date(today); anchor.setDate(today.getDate() + dayOff);
  const weekStart = new Date(anchor); weekStart.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
  const days = isWeek
    ? Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d; })
    : [anchor];
  const start = days[0];
  const end = new Date(days[days.length - 1]); end.setDate(end.getDate() + 1);
  const colTemplate = isWeek ? "52px repeat(7, minmax(0, 1fr))" : "52px 1fr";
  // Eventos: call agendada (callAt), integração (integrationAt) e — opcional —
  // toque do GPS (nextActionAt). O mesmo lead pode ter os três.
  // Consultas 1:1 (mentoria UniqueKids) entram na mesma grade como um "lead" de
  // fachada: nome do cliente + posição no pacote, cor da responsável (owner via
  // closer). O clique abre o lead de ORIGEM quando existir (_leadRef).
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const consultEvents = (consultations || [])
    .filter((c) => c.at && c.status !== "canceled")
    .map((c) => ({
      kind: "consulta",
      t: new Date(c.at),
      who: c.owner || "",
      l: {
        id: `consulta-${c.id}`,
        name: c.clientName || "cliente",
        company: `consulta ${c.n || "?"} de ${c.packageTotal || 8}`,
        closer: c.owner || "",
        callUrl: c.meetUrl || "",
        _pack: c.n && c.packageTotal ? `${c.n}/${c.packageTotal}` : "", // consulta não tem valor: mostra a posição no pacote
        saas: c.saas, stage: "",
        _leadRef: (c.leadId && leadById.get(c.leadId)) || null,
      },
    }));
  const events = leads
    .flatMap(l => {
      const k = stageKind(saasCfgOf(l), l.stage);
      const out = [];
      // Follow-up é COMPROMISSO agendado (a pessoa marcou "retomar dia X às Y",
      // com nota): o compromisso vive no nextActionAt e aparece SEMPRE na
      // agenda. Antes só entrava com "mostrar toques" ligado, e quando o
      // follow-up era marcado pelo drawer (só nextActionAt, sem callAt) sumia —
      // foi o caso da Laura. Toque de CADÊNCIA (novo/contato/qualificação) segue
      // opcional pelo toggle, senão a agenda vira lista de GPS.
      // Call que JÁ ACONTECEU é HISTÓRIA e nunca sai da agenda (Leo, 07/08:
      // "fiz as calls e sumiu tudo da minha agenda"): renderiza como call
      // FEITA (✓, cor lavada, do closer) mesmo que o card tenha ido pra
      // follow-up/no show/ganho — a supressão do naSame só vale pra call
      // FUTURA (não duplicar o compromisso remarcado por cima do horário).
      const callMs = atMs(l.callAt);
      const callT = Number.isFinite(callMs) ? new Date(callMs) : null;
      const callDone = !!(callT && callMs < Date.now());
      const naSame = sameMoment(l.callAt, l.nextActionAt);
      const callInstead = k === "followup" && naSame && callDone; // história vence a pílula duplicada
      const naMs = atMs(l.nextActionAt);
      if (Number.isFinite(naMs) && k === "followup" && !callInstead) {
        out.push({ l, t: new Date(naMs), kind: "follow-up", who: l.closer || l.owner });
      } else if (Number.isFinite(naMs) && showTouches && k !== "followup") {
        out.push({ l, t: new Date(naMs), kind: "toque", who: l.owner || l.closer });
      }
      // Follow-up MARCADO com hora (lead.followupAt): compromisso PRÓPRIO, com a
      // cara de follow-up hoje e depois de passar (lavado, como toda história).
      // Ele já morou no callAt e a agenda desenhava um "✓ call feita" que nunca
      // existiu — indistinguível de uma call de verdade (Leo, 13/08). Some do
      // caminho quando é o mesmo instante do próximo toque, senão a pílula sai
      // duplicada em cima dela mesma.
      const fupMs = atMs(l.followupAt);
      if (Number.isFinite(fupMs) && !sameMoment(l.followupAt, l.nextActionAt)) {
        out.push({ l, t: new Date(fupMs), kind: "follow-up", who: l.closer || l.owner, done: fupMs < Date.now() });
      }
      // Call marcada: futura respeita o naSame (follow-up cobre o horário);
      // passada entra SEMPRE, como histórico.
      if (callT && (callDone || !(k === "followup" && naSame))) {
        out.push({ l, t: callT, kind: "call", who: l.closer, done: callDone });
      }
      const intMs = atMs(l.integrationAt);
      if (l.integrationAt) {
        out.push({ l, t: new Date(intMs), kind: "integração", who: l.integrator || l.closer, done: Number.isFinite(intMs) && intMs < Date.now() });
      }
      // HISTÓRICO de calls remarcadas por cima (lead.callHistory, arquivado
      // pelo PATCH da API quando um callAt passado é sobrescrito): cada
      // entrada vira uma call FEITA no dia em que aconteceu.
      for (const h of (Array.isArray(l.callHistory) ? l.callHistory : [])) {
        const hMs = atMs(h?.at);
        if (Number.isFinite(hMs)) out.push({ l, t: new Date(hMs), kind: "call", who: h?.closer || l.closer, done: true });
      }
      return out;
    })
    .concat(consultEvents)
    .filter(e => e && Number.isFinite(e.t.getTime()) && e.t >= start && e.t < end)
    .filter(e => !person || e.who === person);
  // Contagem por tipo (já na semana/pessoa filtradas) alimenta as abas; a grade
  // desenha só o tipo escolhido.
  const callCount = events.filter((e) => e.kind === "call").length;
  const fupCount = events.filter((e) => e.kind === "follow-up").length;
  const intCount = events.filter((e) => e.kind === "integração").length;
  const shown = evKind === "all" ? events : events.filter((e) => e.kind === evKind);
  // Filtro ligado esconde integrações, consultas e compromissos em silêncio —
  // e aí "marquei a integração e não apareceu na agenda" (Leo, 25/08). O aviso
  // conta o que ficou de fora e devolve a visão inteira num clique.
  const hiddenCount = events.length - shown.length;
  const fmtDay = (d, opts) => d.toLocaleDateString("pt-BR", opts).replace(/\./g, "");
  const label = isWeek
    ? `${fmtDay(days[0], { day: "2-digit", month: "short" })} · ${fmtDay(days[6], { day: "2-digit", month: "short", year: "numeric" })}`
    : fmtDay(days[0], { weekday: "long", day: "2-digit", month: "short", year: "numeric" });
  const navBtn = {
    height: 26, padding: "0 10px", borderRadius: 5, fontSize: 12,
    background: "var(--bg-2)", border: "1px solid var(--line-1)", color: "var(--fg-2)", cursor: "pointer",
  };

  // O time com agenda: quem tem papel de closer/integrador (Ajustes → Equipe).
  // Serve à ordem das faixas por pessoa no dia (personRank).
  const team = [...usersByRole("closer"), ...usersByRole("integrator")]
    .filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i);
  const toneOf = (id) => (id ? userColor(id) : "var(--fg-4)");
  const papelDe = (id) => {
    const r = userById(id)?.roles || [];
    const closer = r.includes("closer"), integ = r.includes("integrator");
    return closer && integ ? "closer · integrador" : closer ? "closer" : integ ? "integrador" : r.includes("sdr") ? "SDR" : "";
  };

  // COLUNAS POR PESSOA dentro do dia (Leo, 24/08): cada closer tem a própria
  // faixa vertical, com o nome no cabeçalho — a agenda de cada um se lê de
  // cima a baixo. Ordem preferida do Leo: Leonardo · Jonathan · Vitor · Jonan;
  // demais entram depois (ordem do time) e "sem responsável" fecha a fila.
  // TODOS os closers viram faixa SEMPRE (Leo, 03/09): dia vazio de alguém
  // mostra a coluna em branco — bater o olho e ver quem está livre. Integrador
  // e "sem responsável" continuam entrando só quando têm evento/bloqueio no
  // dia. Sobreposição DENTRO da faixa divide em sub-lanes, então
  // double-booking da mesma pessoa continua gritando.
  const PERSON_ORDER = ["leonardo", "jonathan", "us_mrqkn2tm03", "jonan"];
  const personRank = (id) => {
    const i = PERSON_ORDER.indexOf(id);
    if (i >= 0) return i;
    if (!id) return 999;
    const t = team.findIndex((u) => u.id === id);
    return 100 + (t >= 0 ? t : 50);
  };
  // Bloqueio de UMA pessoa mora na faixa dela; de time (vários/ninguém) cobre
  // o dia inteiro, atrás das pílulas.
  const blockPerson = (b) => {
    const us = Array.isArray(b.users) && b.users.length ? b.users : (b.user ? [b.user] : []);
    return us.length === 1 ? us[0] : null;
  };
  // Faixas fixas: filtrado por pessoa, só a coluna dela; senão, todos os
  // closers do workspace — mesmo sem nada marcado no dia.
  const baseLanes = person ? [person]
    : isTeam ? [...new Set([...usersByRole("closer"), ...usersByRole("integrator")].map((u) => u.id))]
    : usersByRole("closer").map((u) => u.id);
  const layoutDay = (d) => {
    const dayEvents = shown.filter(e => e.t.toDateString() === d.toDateString());
    const rawBlocks = (blocking && evKind === "all" ? blocking.blocksFor(d) : [])
      .map((b) => ({ b, from: b.allDay ? H0 : Math.max(H0, Number(b.fromHour) || 0), to: b.allDay ? H1 : Math.min(H1, Number(b.toHour) || 0) }))
      .filter((x) => x.to > x.from);
    // SEMANA: sem faixas por pessoa (7 colunas não dão largura) — os eventos
    // do dia dividem a coluna por cluster de sobreposição, como era antes das
    // faixas, e todo bloqueio cobre o dia inteiro atrás das pílulas.
    if (isWeek) {
      const placed = laneByCluster(dayEvents, e => e.t.getTime(), e => e.t.getTime() + 3600000)
        .map((e) => ({ ...e, personLane: 0, personLanes: 1, sub: e.lane, subs: e.lanes }));
      const blocks = rawBlocks.map((x) => ({ ...x, personLane: null, personLanes: 0 }));
      return { placed, blocks, persons: [] };
    }
    const persons = [...new Set([
      ...baseLanes,
      ...dayEvents.map(e => e.who || ""),
      ...rawBlocks.map(x => blockPerson(x.b)).filter(Boolean),
    ])].sort((a, b) => personRank(a) - personRank(b) || String(a).localeCompare(String(b)));
    const laneOf = new Map(persons.map((p, i) => [p, i]));
    const placed = persons.flatMap((p) => laneByCluster(
      dayEvents.filter(e => (e.who || "") === p), e => e.t.getTime(), e => e.t.getTime() + 3600000,
    ).map((e) => ({ ...e, personLane: laneOf.get(p), personLanes: persons.length, sub: e.lane, subs: e.lanes })));
    const blocks = rawBlocks.map((x) => {
      const who = blockPerson(x.b);
      const lane = who != null && laneOf.has(who) ? laneOf.get(who) : null;
      return { ...x, personLane: lane, personLanes: persons.length };
    });
    return { placed, blocks, persons };
  };
  const dayLayouts = days.map(layoutDay);
  // Largura mínima da grade: 7 colunas na semana, 150px por pessoa na Equipe
  // (com oito pessoas a coluna ficaria com 90px e o card vira tarja). Abaixo
  // disso a grade rola de lado dentro do tbl-x, em vez de espremer os cards.
  const gradeMin = isWeek ? 960 : isTeam ? Math.max(600, 52 + (dayLayouts[0]?.persons.length || 1) * 150) : undefined;

  // ── Vãos livres (12/09) ───────────────────────────────────────────────
  // Ninguém faz essa conta olhando a grade: "onde cabe mais uma call?". Marca
  // as horas tomadas do dia (evento ocupa a hora cheia; bloqueio ocupa o
  // intervalo dele) e devolve os vãos de 1h ou mais. `who` = null olha tudo do
  // recorte atual; com pessoa, só a agenda dela.
  const busyHoursOf = (d, who) => {
    const set = new Set();
    for (const e of events) {
      if (e.t.toDateString() !== d.toDateString()) continue;
      if (who != null && (e.who || "") !== who) continue;
      const h = e.t.getHours();
      if (h >= H0 && h < H1) set.add(h);
    }
    for (const b of (blocking ? blocking.blocksFor(d) : [])) {
      const parts = [b.user, ...(Array.isArray(b.users) ? b.users : [])].filter(Boolean);
      if (who != null && parts.length && !parts.includes(who)) continue;
      const from = b.allDay ? H0 : Math.max(H0, Number(b.fromHour) || 0);
      const to = b.allDay ? H1 : Math.min(H1, Number(b.toHour) || 0);
      for (let h = Math.floor(from); h < Math.ceil(to); h++) set.add(h);
    }
    return set;
  };
  // `between: true` = só os BURACOS (vãos entre o primeiro e o último
  // compromisso do dia). A noite inteira livre não é buraco de agenda.
  const gapsOf = (d, who, { between = false } = {}) => {
    const busy = busyHoursOf(d, who);
    const horas = [...busy].sort((a, b) => a - b);
    const lo = between ? (horas.length ? horas[0] : H1) : H0;
    const hi = between ? (horas.length ? horas[horas.length - 1] + 1 : H1) : H1;
    const out = [];
    let run = null;
    for (let h = lo; h < hi; h++) {
      if (busy.has(h)) { if (run != null && h - run >= 1) out.push([run, h]); run = null; }
      else if (run == null) run = h;
    }
    if (run != null && hi - run >= 1) out.push([run, hi]);
    return out;
  };
  // O fato do período, à direita da legenda: o que a grade não diz sozinha.
  // Com pessoa escolhida dá pra falar de BURACO (a agenda é de alguém); sem
  // pessoa, o buraco do time não quer dizer nada, então o fato é qual dia está
  // mais vazio.
  const fatoPeriodo = (() => {
    const total = events.length;
    const base = `${total} ${total === 1 ? "compromisso" : "compromissos"} ${isWeek ? "nesta semana" : "no dia"}`;
    // Na Equipe o fato é sobre QUEM está livre: é a pergunta da visão.
    if (isTeam) {
      const d = days[0];
      const maior = (dayLayouts[0]?.persons || [])
        .map((p) => ({ p, gap: [...gapsOf(d, p)].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] }))
        .filter((x) => x.gap && x.gap[1] - x.gap[0] >= 3)
        .sort((a, b) => (b.gap[1] - b.gap[0]) - (a.gap[1] - a.gap[0]))[0];
      if (!maior) return base;
      const [g0, g1] = maior.gap;
      const quem = maior.p ? displayName(maior.p).split(" ")[0] : "quem está sem responsável";
      const quanto = g0 <= H0 && g1 >= H1 ? "está com o dia todo livre"
        : g0 <= 13 && g1 >= 18 ? "tem a tarde toda livre"
        : g0 <= H0 && g1 >= 12 ? "tem a manhã toda livre"
        : `tem ${g1 - g0}h livres (${g0}h às ${g1}h)`;
      return `${base} · ${quem} ${quanto}`;
    }
    if (person) {
      const alvo = isWeek
        ? days.map((d) => ({ d, g: gapsOf(d, person, { between: true }) })).sort((a, b) => b.g.length - a.g.length)[0]
        : { d: days[0], g: gapsOf(days[0], person, { between: true }) };
      const n = alvo?.g.length || 0;
      if (!n) return base;
      const quando = isWeek ? ` ${WD_LONG[alvo.d.getDay()]}` : "";
      return `${base} · ${n} ${n === 1 ? "buraco" : "buracos"} de 1h${quando}`;
    }
    if (!isWeek || !total) return base;
    const porDia = days
      .filter((d) => d.getDay() !== 0 && d.getDay() !== 6)
      .map((d) => ({ d, n: events.filter((e) => e.t.toDateString() === d.toDateString()).length }))
      .sort((a, b) => a.n - b.n)[0];
    return porDia ? `${base} · ${WD_LONG[porDia.d.getDay()]} é o dia mais livre (${porDia.n})` : base;
  })();


  // O texto inteiro da legenda que vivia IMPRESSA embaixo da grade (onze itens
  // numa linha que quebrava, mais alta que duas faixas de hora). Ninguém lê
  // isso duas vezes: as quatro cores ficam na faixa do topo da grade, o resto
  // vive no title de cada card e aqui, atrás do "legenda ⓘ".
  const LEGENDA = [
    "cor do card = tipo do compromisso",
    "barrinha da esquerda = responsável",
    "card lavado com ✓ = já aconteceu",
    "card vermelho com FUROU = o lead não compareceu",
    "✓ verde = o lead confirmou no lembrete",
    "compromisso aparece na cor da pessoa e abre pra editar no clique",
    "tracejado vermelho = bloqueio (↻ = toda semana)",
    "compromissos e bloqueios ocupam a agenda: nenhuma call cai em cima",
  ].join(" · ");

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* UMA barra de controles, na ordem em que se usa: quando · quem · o quê.
          O filtro de pessoa era um botão por usuário na tela (num time de oito
          ocupava a largura inteira) e vivia separado dos controles de período
          e tipo, que ficavam aqui dentro: duas barras pra mesma função. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap", padding: "12px 16px", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)" }}>
        <span style={{ display: "inline-flex", gap: 4 }}>
          <button style={navBtn} onClick={() => setDayOff(w => w - (isWeek ? 7 : 1))} title={isWeek ? "semana anterior" : "dia anterior"}>‹</button>
          <button style={navBtn} onClick={() => setDayOff(0)}>hoje</button>
          <button style={navBtn} onClick={() => setDayOff(w => w + (isWeek ? 7 : 1))} title={isWeek ? "próxima semana" : "próximo dia"}>›</button>
        </span>
        <span style={{ fontSize: 14, fontWeight: 650, fontFamily: "var(--display)" }}>{label}</span>

        {/* Pessoa: chip único no lugar de um botão por usuário. */}
        {(people.length > 0 && onPerson) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 4px 0 10px", borderRadius: 999, border: "1px solid " + (person ? "var(--accent-line)" : "var(--line-2)"), background: person ? "var(--accent-soft)" : "var(--bg-1)" }}>
            {person && <span style={{ width: 8, height: 11, borderRadius: 2, background: toneOf(person) }} />}
            <select value={person || ""} onChange={(e) => onPerson(e.target.value)} aria-label="Agenda de"
              style={{ height: 26, border: 0, background: "transparent", color: person ? "var(--accent)" : "var(--fg-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <option value="">agenda de: todos</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name || displayName(p.id)}</option>)}
            </select>
          </span>
        )}

        {/* Tipo de evento: tudo · calls · follow-ups · integrações, com a
            contagem do período e o pontinho na cor do tipo. */}
        <span style={{ display: "inline-flex", gap: 2 }}>
          {[["all", "tudo", null], ["call", "calls", callCount], ["follow-up", "follow-ups", fupCount], ["integração", "integrações", intCount]].map(([v, lbl, n]) => (
            <FilterTab key={v} active={evKind === v} count={n} onClick={() => setEvKind(v)} style={{ padding: "4px 10px", fontSize: 12 }}>
              {AGENDA_TYPE_COLORS[v] && (
                <span style={{ width: 9, height: 9, borderRadius: 3, background: AGENDA_TYPE_COLORS[v].bg, border: `1px solid ${AGENDA_TYPE_COLORS[v].line}` }} />
              )}
              {lbl}
            </FilterTab>
          ))}
        </span>
        {evKind !== "all" && hiddenCount > 0 && (
          <button onClick={() => setEvKind("all")} className="mono"
            title="Mostrar tudo de novo (todos os tipos de evento, consultas e compromissos)"
            style={{ height: 24, padding: "0 9px", borderRadius: 999, fontSize: 11, cursor: "pointer",
              background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid var(--warn-line, transparent)" }}>
            {hiddenCount} {hiddenCount === 1 ? "evento escondido" : "eventos escondidos"} pelo filtro · ver tudo
          </button>
        )}
        {evKind === "all" && (
          <label className="mono" style={{ fontSize: 11, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input type="checkbox" checked={showTouches} onChange={(e) => setShowTouches(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
            mostrar toques
          </label>
        )}
        <span className="mono" title={LEGENDA} style={{ marginLeft: "auto", fontSize: 11, color: "var(--fg-4)", cursor: "help", borderBottom: "1px dotted var(--line-2)" }}>legenda ⓘ</span>
      </div>

      <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)" }}>
        {/* A legenda que FICA: as quatro cores de tipo, no topo da grade e não
            embaixo dela, com o fato do período à direita. */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "8px 12px", borderBottom: "1px solid var(--line-1)" }}>
          {Object.entries(AGENDA_TYPE_COLORS).map(([k, c]) => (
            <span key={k} className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--fg-3)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: c.bg, border: `1px ${k === "follow-up" ? "dashed" : "solid"} ${c.line}` }} />
              {c.label}
            </span>
          ))}
          <span className="mono tnum" style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--fg-4)" }}>{fatoPeriodo}</span>
        </div>
        {/* Cabeçalho dos dias */}
        {/* Na semana, 7 colunas pedem largura mínima — em tela estreita a
            grade rola de lado dentro do tbl-x em vez de espremer as pílulas. */}
        <div style={{ display: "grid", gridTemplateColumns: colTemplate, minWidth: gradeMin, borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
          <span />
          {days.map((d, i) => {
            const isToday = d.toDateString() === new Date().toDateString();
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            // HOJE ganha cara de calendário: número no círculo cheio do accent
            // (+ kicker "hoje"); fim de semana fica acinzentado (Leo, 23/08).
            return (
              <div key={i} style={{ padding: "8px 6px", textAlign: "center", borderLeft: "1px solid var(--line-1)", background: isWeekend && !isToday ? "var(--bg-2)" : undefined }}>
                <div className="kicker" style={{ color: isToday ? "var(--accent)" : "var(--fg-4)" }}>
                  {isToday ? "hoje · " : ""}{fmtDay(d, { weekday: "short" })}
                </div>
                <div style={{ marginTop: 2 }}>
                  <span className="tnum" style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 26, height: 26, padding: "0 6px", borderRadius: 999,
                    fontSize: 14, fontWeight: 700, fontFamily: "var(--display)",
                    background: isToday ? "var(--accent)" : "transparent",
                    color: isToday ? "oklch(1 0 0)" : "var(--fg-1)",
                  }}>{d.getDate()}</span>
                </div>
                {/* Nomes das faixas: mesma largura das colunas de pessoa do
                    corpo. Na Equipe o cabeçalho é a ficha da coluna (barrinha,
                    avatar, nome, papel e a contagem do dia). */}
                {dayLayouts[i].persons.length > 0 && (
                  <div style={{ display: "flex", marginTop: 6, gap: 0 }}>
                    {dayLayouts[i].persons.map((p) => {
                      const nDia = dayLayouts[i].placed.filter((e) => (e.who || "") === p).length;
                      if (!isTeam) return (
                        <div key={p || "none"} className="mono" title={p ? displayName(p) : "sem responsável"}
                          style={{ flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "var(--fg-3)", overflow: "hidden" }}>
                          <span style={{ width: 8, height: 10, borderRadius: 2, background: toneOf(p), flexShrink: 0 }} />
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p ? displayName(p).split(" ")[0] : "—"}</span>
                        </div>
                      );
                      return (
                        <div key={p || "none"} style={{ flex: 1, minWidth: 0, padding: "6px 6px 2px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, borderLeft: "1px solid var(--line-1)" }}>
                          <span style={{ width: 26, height: 3, borderRadius: 2, background: toneOf(p) }} />
                          <Avatar id={p || undefined} name={p ? displayName(p) : "—"} size={22} />
                          <span style={{ maxWidth: "100%", fontSize: 12, fontWeight: 650, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {p ? displayName(p) : "sem responsável"}
                          </span>
                          <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                            {`${papelDe(p) ? papelDe(p) + " · " : ""}${nDia === 0 ? "dia livre" : `${nDia} ${nDia === 1 ? "compromisso" : "compromissos"}`}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Corpo: gutter de horas + colunas de dia com linhas por hora */}
        <div style={{ display: "grid", gridTemplateColumns: colTemplate, minWidth: gradeMin }}>
          <div style={{ position: "relative", height: (H1 - H0) * hourH }}>
            {/* "7h" (i=0) fica logo abaixo do cabeçalho — a linha dele É a borda
                do topo; centrar no risco jogava o rótulo pra cima do cabeçalho
                e ele vivia suprimido, parecendo que o dia começava às 8h. */}
            {Array.from({ length: H1 - H0 }, (_, i) => (
              <span key={i} className="mono tnum" style={{ position: "absolute", top: i === 0 ? 2 : i * hourH - 6, right: 6, fontSize: 10, color: "var(--fg-4)" }}>
                {`${H0 + i}h`}
              </span>
            ))}
          </div>
          {days.map((d, i) => {
            const { placed, blocks: dayBlocks, persons } = dayLayouts[i];
            const isToday = d.toDateString() === new Date().toDateString();
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div key={i}
                onClick={blocking?.onSlot ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const hour = H0 + Math.floor((e.clientY - rect.top) / hourH);
                  if (hour >= H0 && hour < H1) blocking.onSlot(d, hour);
                } : undefined}
                style={{
                  position: "relative", height: (H1 - H0) * hourH,
                  borderLeft: "1px solid var(--line-1)",
                  // Hoje = tinta do accent (vence o cinza quando cai no fim de
                  // semana); sáb/dom = cinza de "fora do expediente".
                  backgroundColor: isToday ? "color-mix(in srgb, var(--accent) 7%, transparent)"
                    : isWeekend ? "color-mix(in srgb, var(--bg-3) 55%, transparent)" : "transparent",
                  cursor: blocking?.onSlot ? "pointer" : undefined,
                }}>
                {/* Linhas de hora como ELEMENTOS, não repeating-linear-gradient:
                    o gradient de 1px em zoom fracionado do navegador caía entre
                    pixels físicos e o anti-aliasing engolia uma linha a cada
                    cinco (8h/13h/18h sumidas em 90% — Leo, 03/09). Borda por
                    elemento arredonda pro pixel sozinha e aparece em qualquer
                    zoom. */}
                {Array.from({ length: H1 - H0 - 1 }, (_, hi) => (
                  <div key={`hr-${hi}`} style={{ position: "absolute", left: 0, right: 0, top: (hi + 1) * hourH, borderTop: "1px solid var(--line-1)", pointerEvents: "none" }} />
                ))}
                {/* Linha do AGORA: só na coluna de hoje, na altura da hora atual. */}
                {isToday && (() => {
                  const now = new Date();
                  const nh = now.getHours() + now.getMinutes() / 60;
                  if (nh < H0 || nh > H1) return null;
                  return (
                    <div style={{ position: "absolute", left: 0, right: 0, top: (nh - H0) * hourH, borderTop: "2px solid var(--accent)", zIndex: 3, pointerEvents: "none" }}>
                      <span style={{ position: "absolute", left: -1, top: -4, width: 8, height: 8, borderRadius: 999, background: "var(--accent)" }} />
                    </div>
                  );
                })()}
                {/* Divisórias das faixas de pessoa: a coluna de cada closer se
                    enxerga de cima a baixo. */}
                {persons.length > 1 && persons.slice(1).map((_, si) => (
                  <div key={`sep-${si}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${(si + 1) * (100 / persons.length)}%`, borderLeft: "1px dashed var(--line-1)", pointerEvents: "none" }} />
                ))}
                {/* VÃOS LIVRES (só na Equipe): todo buraco de 1h ou mais vira
                    botão. É a razão de existir desta visão — achar onde cabe
                    mais uma call sem varrer a grade com o olho. O clique já
                    abre o modal com a pessoa da coluna e a hora do vão. */}
                {isTeam && persons.map((p, pi) => {
                  const pw = 100 / Math.max(1, persons.length);
                  return gapsOf(d, p).map(([g0, g1]) => (
                    <button key={`free-${p || "none"}-${g0}`}
                      onClick={(e) => { e.stopPropagation(); blocking?.onSlot && blocking.onSlot(d, g0, p || ""); }}
                      title={`${p ? displayName(p) : "Sem responsável"} está livre das ${g0}h às ${g1}h · clique pra marcar`}
                      style={{
                        position: "absolute", top: (g0 - H0) * hourH + 2,
                        left: `calc(${pi * pw}% + 3px)`, width: `calc(${pw}% - 6px)`,
                        height: (g1 - g0) * hourH - 4,
                        border: "1px dashed var(--line-2)", borderRadius: 6, background: "transparent",
                        color: "var(--fg-4)", fontSize: 10.5, cursor: "pointer", padding: "0 6px",
                        display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                      }}>
                      {`+ livre das ${g0}h às ${g1}h`}
                    </button>
                  ));
                })}
                {(() => {
                  // Bloqueios/compromissos: o de UMA pessoa mora na faixa dela;
                  // o de time (vários participantes) cobre o dia inteiro, atrás
                  // das pílulas. Filtro de tipo ligado tira tudo do caminho.
                  return dayBlocks.map(({ b, from, to, personLane, personLanes }) => {
                    const pw = personLanes > 0 ? 100 / personLanes : 100;
                    const left = personLane != null ? personLane * pw : 0;
                    const bw = personLane != null ? pw : 100;
                    const tone = b._tone || null; // com tom = compromisso; sem = bloqueio vermelho
                    const label = b._label || `bloqueado${b.recur === "weekly" ? " ↻" : ""}${b.reason ? ` · ${b.reason}` : ""}`;
                    return (
                      <div key={`blk-${b.id}`}
                        onClick={(e) => { e.stopPropagation(); blocking.onBlock && blocking.onBlock(b); }}
                        title={`${b._who ? b._who + " · " : ""}${label}${b.recur === "weekly" ? " · toda semana" : ""}${blocking.onBlock ? " · clique pra editar" : ""}`}
                        style={{
                          position: "absolute", top: (from - H0) * hourH + 1,
                          left: `calc(${left}% + 2px)`, width: `calc(${bw}% - 4px)`,
                          height: Math.max(16, (to - from) * hourH - 3),
                          background: tone ? `color-mix(in srgb, ${tone} 14%, var(--bg-1))` : "color-mix(in srgb, var(--neg) 8%, var(--bg-1))",
                          border: tone ? `1px solid color-mix(in srgb, ${tone} 45%, var(--line-1))` : "1px dashed color-mix(in srgb, var(--neg) 45%, var(--line-1))",
                          borderLeft: `3px solid ${tone || "var(--neg)"}`,
                          borderRadius: 5, padding: "2px 6px", cursor: blocking.onBlock ? "pointer" : "default", overflow: "hidden",
                        }}>
                        <div className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: tone ? "var(--fg-2)" : "var(--neg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {label}
                        </div>
                      </div>
                    );
                  });
                })()}
                {placed.map(({ l, t, kind, who, done, personLane, personLanes, sub, subs }) => {
                  const tone = toneOf(who);
                  const isTouch = kind === "toque";
                  const isFollowup = kind === "follow-up";
                  // Lead CONFIRMOU no lembrete (callConfirmed, marcado pelo robô
                  // quando a resposta é "sim" — ou pelo botão do Meu dia): check
                  // verde no card, o closer sabe de longe quem vai aparecer.
                  const confirmed = !done && (kind === "call" ? !!l.callConfirmed : kind === "integração" ? !!l.integrationConfirmed : false);
                  // Furou: card sinalizado como No show (ou perdido por "não
                  // compareceu") E este evento é a call ATUAL do card — entrada
                  // antiga de callHistory é remarcação, não carrega desfecho.
                  // Só a call que JÁ PASSOU pode ter furado. Card em No show com
                  // call FUTURA é remarcação em pé, e pintar de vermelho fazia
                  // parecer furo que ainda nem aconteceu (Leo, 25/08).
                  const noShow = kind === "call" && done && !!l.callAt
                    && new Date(l.callAt).getTime() === t.getTime()
                    && (isNoShowStage(l.stage) || l.lostReason === "nao_compareceu");
                  // A COR DE FUNDO diz o TIPO (paleta clara + letra preta,
                  // AGENDA_TYPE_COLORS); follow-up reforça com contorno
                  // tracejado (vale pra daltonismo). A barrinha à esquerda é a
                  // PESSOA. História (done) continua lavada com ✓.
                  const tc = noShow ? AGENDA_NOSHOW : (AGENDA_TYPE_COLORS[kind] || AGENDA_TYPE_COLORS.call);
                  const hour = Math.min(H1 - 1, Math.max(H0, t.getHours() + t.getMinutes() / 60));
                  const pw = 100 / personLanes;
                  const w = pw / subs;
                  const timeStr = t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                  // Sala da reunião: call e consulta 1:1 usam callUrl; a
                  // integração tem a própria (integrationCallUrl, criada pelo
                  // Google Meet). O ▶ abre a sala SEM abrir o card.
                  const sala = kind === "integração" ? l.integrationCallUrl : l.callUrl;
                  // O valor do negócio não aparecia em lugar nenhum da agenda:
                  // duas calls às 14h e 15h podem ser R$ 800 e R$ 65 mil, e a
                  // grade mostrava as duas iguais. Consulta 1:1 não tem valor,
                  // mostra a posição no pacote (3/8).
                  const valor = l._pack || valorCurto(l.amount);
                  return (
                    <div key={l.id + kind + t.getTime()}
                      onClick={(e) => { e.stopPropagation(); const target = kind === "consulta" ? l._leadRef : l; if (target && onOpenLead) onOpenLead(target); }}
                      title={`${timeStr} · ${isFollowup ? "follow-up" : kind}${noShow ? " · NO-SHOW, o lead não compareceu" : done ? (isFollowup ? " · já passou" : " · realizada · histórico") : ""}${confirmed ? " · CONFIRMADA pelo lead" : ""} · ${l.name}${l.company ? " · " + l.company : ""}${who ? " · " + displayName(who) : " · sem responsável"}`}
                      style={{
                        position: "absolute", top: (hour - H0) * hourH + 1,
                        left: `calc(${personLane * pw + sub * w}% + 2px)`, width: `calc(${w}% - 4px)`,
                        height: isTouch ? 22 : isFollowup ? Math.max(19, Math.round(hourH * 20 / 60)) : hourH - 3, // follow-up = 20 min
                        overflow: "hidden", cursor: "pointer",
                        background: isTouch ? "transparent" : tc.bg,
                        border: isTouch ? `1px dashed color-mix(in srgb, ${tone} 55%, var(--line-2))`
                          : `1px ${isFollowup ? "dashed" : "solid"} ${tc.line}`,
                        // Faixa da PESSOA. Era 20px no dia (Leo, 23/08: "pelo
                        // menos 5x mais grossa") e 6px na semana; o handoff de
                        // 12/09 pede 3px, e o espaço vai pro valor e pro nome +
                        // empresa na mesma linha. No dia e na Equipe o nome da
                        // pessoa já está no cabeçalho da faixa; na semana o
                        // primeiro nome continua na linha da hora.
                        borderLeft: isTouch ? `2px dashed ${tone}` : `3px solid ${tone}`,
                        borderRadius: 5, padding: isFollowup ? "0 6px" : isTouch ? "1px 6px" : "3px 6px",
                        // Feita (histórico): mesma cor do closer, só lavada — dá
                        // pra ler a semana inteira do que aconteceu sem confundir
                        // com o que ainda vai acontecer.
                        opacity: isTouch ? 0.85 : noShow ? 0.95 : done ? 0.62 : 1,
                        display: isFollowup ? "flex" : undefined, alignItems: isFollowup ? "center" : undefined,
                      }}>
                      {isFollowup ? (
                        <div className="mono" style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", fontSize: 10, fontWeight: 700, color: AGENDA_INK, minWidth: 0 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↩ {timeStr} · {l.name}</span>
                          {sala && <PlayLink href={sala} />}
                          {valor && <span className="tnum" style={{ marginLeft: "auto", flexShrink: 0, fontWeight: 700 }}>{valor}</span>}
                        </div>
                      ) : isTouch ? (
                        <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{`○ ${l.name}`}</div>
                      ) : (
                        <>
                          {/* Linha 1: quando, os sinais e quanto vale. O valor
                              fica na direita porque é o que se compara entre
                              dois horários do mesmo dia. */}
                          <div className="mono tnum" style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0, fontSize: isWeek ? 9.5 : 10, color: AGENDA_INK_SOFT }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {`${noShow ? "✕ " : done ? "✓ " : ""}${timeStr}${isWeek && who ? ` · ${displayName(who).split(" ")[0]}` : ""}${kind === "integração" ? " · int" : kind === "consulta" ? " · 1:1" : ""}`}
                            </span>
                            {noShow && (
                              <span title="O lead não compareceu"
                                style={{ flexShrink: 0, padding: "0 5px", borderRadius: 4, background: AGENDA_NOSHOW.line, color: "#fff", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.04em" }}>FUROU</span>
                            )}
                            {confirmed && (
                              <span title="Lead confirmou no lembrete"
                                style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 11, height: 11, borderRadius: 99, background: "var(--pos)", color: "#fff", fontSize: 8, fontWeight: 800 }}>✓</span>
                            )}
                            {sala && <PlayLink href={sala} />}
                            {valor && <span style={{ marginLeft: "auto", flexShrink: 0, fontWeight: 700, color: AGENDA_INK }}>{valor}</span>}
                          </div>
                          {/* Linha 2: quem. Na semana o card tem duas linhas e
                              a empresa fica só no title (a coluna do dia é 1/7
                              da largura); no dia e na Equipe a empresa vem ao
                              lado do nome, no lugar da terceira linha que o
                              card de 41px cortava. */}
                          <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0, fontSize: 11, fontWeight: 650, color: AGENDA_INK }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                            {!isWeek && l.company && (
                              <span style={{ fontSize: 10, fontWeight: 500, color: AGENDA_INK_SOFT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{l.company}</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { AgendaView, laneByCluster };
