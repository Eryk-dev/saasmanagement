// Placar por pessoa e por papel (SDR / Closer / CS) — a base do cockpit de
// gestão da Visão geral. Agrupa os leads por `owner` (SDR) e `closer`, e os
// clientes por `owner` (CS), e devolve, no período, as métricas que interessam
// a cada função + a meta configurada (coleção `goals`).
//
// Só LEITURA/agregação sobre o que o CRM já grava (lead.owner/closer/stage/
// stageSince/callAt/amount, activities de stage/toque, customers, proposals).
// Sem histórico de churn confiável ainda, então retenção entra magra (contas
// novas + cancelamentos com data) — cresce quando o billing registrar o evento.

import { cadenceOf, firstStage, isLoss, kindOf, TOUCH_TYPES } from "./stages.js";
import { compGoalFor, compLevelOf } from "./comp-plan.js";
import { TEAM_METRICS, META_CATALOG, deriveGoalsFromPace } from "./routes.metas.js";
import { RATE_BENCHMARKS, computePipelinePace } from "./routes.pipeline-pace.js";
import {
  DAY_MS as DAY, round2, dayKey, rangeFromQuery, isRealLead,
  callOutcome as coreCallOutcome, callCohortIn,
  winsIn, customerStartMap, contactAttribution, isReferralLead,
  classCounts, cashBucketsIn,
} from "./metrics-core.js";

const HOUR = 3_600_000;
// Meta de indicação do CS: cada cliente da carteira precisa render N indicações
// (regra do Leo). O alvo escala com a BASE — 7 × clientes que o CS atende — em
// vez de um número fixo, então cresce sozinho conforme a carteira aumenta.
const REFERRALS_PER_CUSTOMER = 7;
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return round2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

export function registerScoreboardRoutes(app, repo, { now = () => new Date() } = {}) {
  app.get("/api/scoreboard/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { since, until } = rangeFromQuery(req.query || {});
    // Hoje (dia do negócio): separa call já VENCIDA (não veio) de call marcada
    // pro FUTURO (ainda vai acontecer) no comparecimento — ver callOutcome.
    const today = dayKey(now());
    const inWin = (iso) => iso && dayKey(iso) >= since && dayKey(iso) <= until;
    // Janela ANTERIOR (semana/mês passado) — base da meta dinâmica de calls do
    // SDR: a meta da semana atual sai do volume de leads da semana passada
    // (completa), que é estável (a semana atual ainda não fechou).
    const prevSince = String(req.query?.prevSince || "");
    const prevUntil = String(req.query?.prevUntil || "");
    const hasPrev = /^\d{4}-\d{2}-\d{2}$/.test(prevSince) && /^\d{4}-\d{2}-\d{2}$/.test(prevUntil);
    const inPrev = (iso) => iso && dayKey(iso) >= prevSince && dayKey(iso) <= prevUntil;

    const [allLeads, allActs, allCustomers, proposals, subs, users, goalsAll, npsAll, waMessages, invoicesAll, compPlansAll] = await Promise.all([
      repo.list("leads"),
      repo.list("activities"),
      repo.list("customers"),
      repo.list("proposals"),
      repo.list("subscriptions"),
      repo.list("users").catch(() => []),
      repo.list("goals"),
      repo.list("nps").catch(() => []),
      repo.list("wa_messages").catch(() => []),
      repo.list("invoices").catch(() => []),
      repo.list("comp_plans").catch(() => []), // plano de remuneração (metas por nível)
    ]);
    // Lead interno (teste) fora de tudo — régua oficial do metrics-core.
    const leads = allLeads.filter((l) => l.saas === product.id && isRealLead(l));
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const customers = allCustomers.filter((c) => c.saas === product.id);

    const actsByLead = new Map();
    for (const a of allActs) {
      if (a.saas !== product.id || !a.lead) continue;
      if (!actsByLead.has(a.lead)) actsByLead.set(a.lead, []);
      actsByLead.get(a.lead).push(a);
    }
    for (const arr of actsByLead.values()) arr.sort((x, y) => String(x.at || "").localeCompare(String(y.at || "")));

    // Meta por métrica: user-scope vence role-scope; período default "month".
    //
    // Meta de VAGA é o alvo do TIME (é assim que ela fecha com a meta da empresa:
    // a Metas deriva "24 ganhos no mês" da meta de venda ÷ ticket). O placar cobra
    // a PARTE de cada um, então divide pelas pessoas da vaga: 2 closers = 12 pra
    // cada, somando os 24. Só as métricas de volume (TEAM_METRICS) se repartem —
    // taxa é a mesma pra todo mundo e ticket/NPS são média/índice. Meta por PESSOA
    // já é individual: passa inteira.
    const goals = goalsAll.filter((g) => !g.saas || g.saas === product.id);
    // Escopo de produto no headcount: quem atende só outro produto (ex.: Ana na
    // UniqueKids) não pode diluir a meta do time daqui.
    const inProduct = (u) => !u.saas || u.saas === product.id;
    const headcount = (role) => Math.max(1, users.filter((u) => inProduct(u) && (u.roles || []).includes(role)).length);
    // Clientes por dono (pro alvo de indicação = 7 × carteira do CS).
    const custByOwner = new Map();
    for (const c of customers) if (c.owner) custByOwner.set(c.owner, (custByOwner.get(c.owner) || 0) + 1);
    // Meta DERIVADA da meta de venda do mês: o que a empresa precisa desdobrado
    // pela mesma cadeia da tela Metas (venda ÷ ticket = ganhos, ÷ fechamento =
    // calls, e por aí). Vale como fallback do campo em branco, então trocar a
    // meta do mês reajusta a régua de todo mundo sozinho — inclusive quando o
    // mês vira e entra o alvo agendado pro mês novo.
    let derivado = {};
    try {
      const d = deriveGoalsFromPace(await computePipelinePace(repo, product), { contractsTarget: product.monthlyContractsTarget });
      derivado = Object.fromEntries((d?.goals || []).map((g) => [`${g.role}.${g.metric}`, Number(g.target)]));
    } catch { derivado = {}; }

    const goalFor = (userId, role, metric) => {
      const u = goals.find((g) => g.scope === "user" && g.key === userId && g.metric === metric);
      if (u) return { target: Number(u.target) || 0, period: u.period || "month", scope: "user" };
      // O plano de REMUNERAÇÃO manda em contratos (won) e receita de SDR/closer
      // (Leo, 06/08): meta POR PESSOA pelo nível dela (user.compLevel, 1 sem
      // campo), sem repartir por headcount — vence a meta de vaga digitada e a
      // derivada do pace; só o ajuste por PESSOA (acima) fica na frente.
      const comp = compGoalFor(compPlansAll, role, metric, compLevelOf(users.find((x) => x.id === userId)));
      if (comp) return comp;
      const r = goals.find((g) => g.scope === "role" && g.key === role && g.metric === metric);
      if (!r) {
        // Indicação: alvo derivado da BASE — cada cliente precisa render N
        // indicações (regra do Leo), então o alvo do CS = N × a carteira DELE, e
        // escala sozinho conforme a base cresce. Manual (user/role) ainda vence.
        if (metric === "referrals") {
          const custs = custByOwner.get(userId) || 0;
          const t = REFERRALS_PER_CUSTOMER * custs;
          return t > 0 ? { target: t, period: "month", scope: "derived", perCustomer: REFERRALS_PER_CUSTOMER, customers: custs } : null;
        }
        // Só VOLUME de time se deriva. Ticket e taxa entram na cadeia como
        // premissa (vêm do histórico), então virar meta seria dizer "seu alvo é
        // o que você já faz" — alvo que ninguém persegue.
        const auto = derivado[`${role}.${metric}`];
        if (!(Number(auto) > 0) || !TEAM_METRICS.has(metric)) return null;
        const people = headcount(role);
        return { target: round2(auto / people), period: "month", scope: "derived", teamTarget: auto, people };
      }
      const total = Number(r.target) || 0;
      const period = r.period || "month";
      if (!TEAM_METRICS.has(metric)) return { target: total, period, scope: "role" };
      const people = headcount(role);
      // teamTarget/people ficam no payload pra UI poder dizer "12 dos 24 do time".
      return { target: round2(total / people), period, scope: "role", teamTarget: total, people };
    };
    // Conversão sobre as calls AGENDADAS (o placar chama de callWinRate no SDR e
    // winRateCall no closer) NÃO é meta digitada: é CONTA — comparecimento ×
    // fechamento. Ter as três editáveis é o que deixava o card do closer se
    // contradizendo: 25% das agendadas com 75% de comparecimento são 33% das que
    // aconteceram, nunca 25%. Meta por PESSOA legada nesse campo ainda vence.
    const rateGoal = (role, metric, fallback) => {
      const g = goalFor("", role, metric);
      return Number(g?.target) > 0 ? Number(g.target) / 100 : fallback;
    };
    const bookedWinGoal = (uid, role) => goalFor(uid, role, role === "sdr" ? "callWinRate" : "winRateCall") || {
      target: round2(rateGoal("sdr", "showRate", RATE_BENCHMARKS.showRate) * rateGoal("closer", "conversaoCall", RATE_BENCHMARKS.closeRate) * 100),
      period: "month", scope: "derived", from: ["showRate", "conversaoCall"],
    };
    const nameOf = (id) => users.find((u) => u.id === id)?.name || id;
    // Escopo de PRODUTO: quem atende só outro workspace (a Ana é só UniqueKids)
    // não entra no placar daqui. Quem tem lead/cliente deste produto entra de
    // qualquer jeito — as listas abaixo somam owner/closer dos registros.
    const withRole = (role) => users.filter((u) => inProduct(u) && (u.roles || []).includes(role)).map((u) => u.id);
    const goalMap = (uid, role, metrics) => Object.fromEntries(metrics.map((m) => [m, goalFor(uid, role, m)]).filter(([, g]) => g));

    // Metas da vaga com o realizado DA PESSOA — é o que o cartão dela mostra na
    // Visão geral. Sai daqui (e não de um mapa no front) pra o valor ser o MESMO
    // que o resto do placar já calculou pra ela. Entra a métrica que tem meta OU
    // valor medido: meta em branco e sem medição não vira linha vazia no cartão.
    const personTargets = (uid, role, values) => (META_CATALOG.find((c) => c.role === role)?.metrics || []).flatMap((m) => {
      const goal = goalFor(uid, role, m.metric);
      const target = Number(goal?.target) > 0 ? Number(goal.target) : null;
      const value = values[m.metric] ?? null;
      if (target == null && value == null) return [];
      return [{
        metric: m.metric, label: m.label, unit: m.unit, kind: m.kind, hint: m.hint || "",
        // `target` já é a PARTE desta pessoa (goalFor reparte a meta do time);
        // `kind` diz se a tela pode reescalar a meta do mês pra janela.
        target, period: goal?.period || "month",
        teamTarget: goal?.teamTarget ?? null, people: goal?.people ?? 1,
        value,
      }];
    });

    // ── Réguas do metrics-core amarradas ao dataset da requisição ─────────────
    // Safra de calls, resolução compareceu/furo/vendeu e fechamentos na janela
    // moram no metrics-core.js — regra nova entra LÁ. Fechamento segue a régua
    // oficial da venda como fato do lead (isWonLead + wonAt), com fallback pro
    // lead legado sem carimbo (startedAt do cliente vinculado).
    const actsOf = (id) => actsByLead.get(id) || [];
    // `inWin` vai junto: a testemunha (resumo de call) só decide compareceu/
    // furou quando o resumo é DESTA janela (ver callOutcome no metrics-core).
    const callOutcome = (list) => coreCallOutcome(product, list, actsOf, today, inWin);
    const customerStartByLead = customerStartMap(customers);
    const winTransitionsFor = (list) => winsIn(product, list, inWin, customerStartByLead);

    // ── Histórico pré-cockpit e atribuição de contato (régua única) ───────────
    // O ajuste (product.paceAdjust) só entra quando a JANELA alcança a época
    // anterior ao 1º registro de atividade (senão "ontem" inflava). Época = 1º
    // dia com atividade do produto (ou product.paceAdjust.before, se fixado).
    let activityEpoch = null;
    for (const a of allActs) {
      if (a.saas !== product.id) continue;
      const d = dayKey(a.at);
      if (d && (!activityEpoch || d < activityEpoch)) activityEpoch = d;
    }
    const adjCutoff = product.paceAdjust?.before || activityEpoch;
    const teamAdjust = product.paceAdjust && (!adjCutoff || since < adjCutoff) ? product.paceAdjust : null;
    const adjN = (k) => (teamAdjust && Number(teamAdjust[k]) > 0 ? Math.round(Number(teamAdjust[k])) : 0);
    // GANHO nunca usa ajuste (decisão do Leo, 24/07: "o ganho segue pelo que
    // foi preenchido no cliente") — as vendas pré-cockpit foram registradas com
    // wonAt real (#293), então somar um "+won" contaria em dobro. O campo fica
    // fora da lista mesmo que exista no product.paceAdjust.
    const adjApplied = teamAdjust
      ? ["leads", "contacted", "booked", "shown"].reduce((o, k) => (adjN(k) ? { ...o, [k]: adjN(k) } : o), null)
      : null;
    // O histórico mora nas PESSOAS (decisão do Leo, 24/07): os contatos antigos
    // foram trabalho do SDR e as calls dos closers, então o ajuste soma nos
    // VOLUMES dos cards deles (e nos buckets do funil) — o funil segue sendo a
    // soma dos cards também no histórico. Taxa nenhuma usa o histórico (não há
    // registro do resultado daquelas calls). Ganhos antigos ficam FORA dos
    // cards: seguem o que está preenchido nos registros (lead.closer/cliente).
    const histShare = (total, ids) => {
      const map = new Map();
      if (!(total > 0) || !ids.length) return map;
      const base = Math.floor(total / ids.length);
      let rest = total - base * ids.length;
      for (const id of [...ids].sort()) map.set(id, base + (rest-- > 0 ? 1 : 0));
      return map;
    };
    // Histórico da AGENDA: contato e agendadas somam no SDR (o card dele = topo
    // do funil). As REALIZADAS históricas voltam pros closers (Leo, 25/07:
    // "mantém as calls realizadas e ajusta só a %") — o número exibido no card
    // fica cheio e a Call→ganho passa a dividir por ELE (won ÷ realizadas
    // mostradas), então o card fecha e o funil = soma dos closers.
    const contactedHist = histShare(adjN("contacted"), withRole("sdr"));
    const bookedHist = histShare(adjN("booked"), withRole("sdr"));
    const shownHist = histShare(adjN("shown"), withRole("closer"));
    // O histórico de REALIZADAS (shown) NÃO entra nos cards dos closers: aquelas
    // calls pré-cockpit não têm ganho registrado, então inflariam "Calls
    // realizadas" sem inflar "Ganhos" e a Call→ganho do card não bateria
    // (Leo, 25/07: "25/8 não é 40"). Fica só no TILE do funil (com o aviso),
    // que é team-level. O card do closer conta as calls REAIS dele.
    // Contato = ação HUMANA — régua única do metrics-core (a automação fica de
    // fora do total, em automationReached). Com um ÚNICO SDR na vaga, TODO
    // contato humano credita NELE (decisão do Leo, 25/07): o funil de
    // prospecção é dele, mesmo quando um closer respondeu o lead. Com mais de
    // um SDR volta a atribuição pelo autor do 1º contato.
    const sdrRoleIds = withRole("sdr");
    const soloSdr = sdrRoleIds.length === 1 ? sdrRoleIds[0] : null;
    const humanIds = new Set(users.map((u) => u.id));
    const contact = contactAttribution({ leads, actsOf, waMessages, saas: product.id, inWin, humanIds, creditAllTo: soloSdr || undefined });
    const contactsOf = (uid) => contact.byAuthor.get(uid) || 0;
    // Safra de calls do TIME — callAt na janela OU call com transcrição na
    // janela (callCohortIn): a testemunha resgata a call feita cujo callAt foi
    // remarcado/limpo depois (Leo, 03/08). O funil e o card do SDR único leem
    // DESTA safra (call sem dono também credita no SDR).
    const teamBooked = callCohortIn(leads, actsOf, inWin);
    const teamOutcome = callOutcome(teamBooked);
    // COBERTURA da safra (a "taxa de contato" honesta): dos leads que ENTRARAM
    // na janela, quantos tiveram contato humano — é o que o rótulo promete
    // ("dos leads novos, quantos você alcança"). Restrita à COORTE, então nunca
    // passa de 100%. O tile "Contatados" é WORKLOAD (inclui lead antigo
    // trabalhado agora + histórico pré-cockpit), a TAXA não — daí a divergência
    // que o Leo viu (347 contatados vs 302 que entraram = "126%" sem sentido).
    const cohortRate = (list) => {
      const entered = list.filter((l) => inWin(l.createdAt));
      const reached = entered.filter((l) => contact.leadIds.has(l.id)).length;
      return entered.length > 0 ? round2((reached / entered.length) * 100) : null;
    };
    const teamContactRate = cohortRate(leads);

    // ── SDR (agrupado por owner) ──────────────────────────────────────────────
    const slaMs = (Number(cadenceOf(product, firstStage(product)).firstTouchHours) || 48) * HOUR;
    const sdrRole = new Set(withRole("sdr")); // membro do papel SDR sempre aparece (pra ver a meta)
    const sdrIds = [...new Set([...sdrRole, ...leads.map((l) => l.owner).filter(Boolean)])];
    const sdr = sdrIds.map((uid) => {
      const mine = leads.filter((l) => l.owner === uid);
      const cohort = mine.filter((l) => inWin(l.createdAt));
      const touchHours = [];
      let breached = 0;
      for (const l of cohort) {
        const t = (actsByLead.get(l.id) || []).find((a) => TOUCH_TYPES.has(a.type));
        if (t) {
          const h = (new Date(t.at) - new Date(l.createdAt)) / HOUR;
          if (Number.isFinite(h) && h >= 0) touchHours.push(h);
        } else if (Date.now() - new Date(l.createdAt).getTime() > slaMs) {
          breached++;
        }
      }
      // Calls agendadas = calls dos leads DELE (owner) pela DATA DA CALL — a
      // MESMA régua do funil (callAt na janela; régua única, Leo 24/07), com o
      // resgate da testemunha (callCohortIn: call transcrita na janela conta
      // mesmo com callAt remarcado/limpo — Leo, 03/08). Call SEM dono credita
      // no SDR único (Leo, 25/07). O COUNT mostrado soma a parte histórica
      // (booked pré-cockpit) pra bater com o tile do funil; as TAXAS usam só o
      // orgânico (histórico não tem resultado registrado).
      const booked = callCohortIn(leads.filter((l) => l.owner === uid || (!l.owner && uid === soloSdr)), actsOf, inWin);
      const callsBookedOrganic = booked.length;
      const callsBooked = callsBookedOrganic + (bookedHist.get(uid) || 0);

      // Show-rate e calls→ganho sobre o cohort de calls agendadas (callOutcome).
      const { shown, noShow, pending, won: wonFromCalls } = callOutcome(booked);
      const leadsNew = cohort.length;
      const leadsPrev = hasPrev ? mine.filter((l) => inPrev(l.createdAt)).length : null;
      // Contatados = a MESMA régua do funil (24/07): leads cujo 1º contato
      // humano da janela foi DELE (contactAttribution — vale qualquer lead, não
      // só os que têm ele de owner) + a parte dele do histórico pré-cockpit.
      // Mover etapa deixou de contar como contato; as TAXAS usam só o orgânico.
      const contactedOrganic = contactsOf(uid);
      const contacted = contactedOrganic + (contactedHist.get(uid) || 0);
      // Remarcações = calls que o cliente pediu pra mudar de horário na confirmação
      // e o SDR remarcou (toque com meta.event="reschedule"). Conta EVENTOS (um lead
      // pode remarcar mais de uma vez).
      let reschedules = 0;
      for (const l of mine) {
        for (const a of actsByLead.get(l.id) || []) {
          if (inWin(a.at) && a.author === uid && a.meta?.event === "reschedule") reschedules++;
        }
      }
      // Taxa de contato = COBERTURA da safra (dos leads que ENTRARAM, quantos
      // alcançou) — nunca passa de 100% (o rótulo diz "dos leads novos, quantos
      // você alcança"). Pro SDR único é a mesma do funil.
      const contactRate = uid === soloSdr ? teamContactRate : cohortRate(mine);
      // Contratos e receita DAS OPORTUNIDADES DELE (owner) na janela — as duas
      // pernas do plano de remuneração do SDR (a receita dele é a fechada das
      // oportunidades que ELE gerou, regra 3 do plano de 04/08).
      const winMineAt = winTransitionsFor(mine);
      const wonMineLeads = [...winMineAt.keys()].map((id) => leadById.get(id)).filter(Boolean);
      const wonMine = wonMineLeads.length;
      const revenueMine = round2(wonMineLeads.reduce((a, l) => a + (Number(l.amount) || 0), 0));
      // Taxa de agendamento = das pessoas que ele contatou, quantas viraram call
      // (orgânico ÷ orgânico — o histórico só entra no COUNT, não na taxa).
      const bookingRate = contactedOrganic > 0 ? round2((callsBookedOrganic / contactedOrganic) * 100) : null;
      // Comparecimento = das que JÁ deveriam ter acontecido (realizadas + não
      // compareceram), quantas aconteceram — exclui as calls FUTURAS (Leo,
      // 25/07). Pro SDR único é o MESMO número do funil (safra do time +
      // histórico, sem as futuras).
      const showNum = uid === soloSdr ? teamOutcome.shown + adjN("shown") : shown;
      const showDen = uid === soloSdr
        ? teamOutcome.shown + adjN("shown") + teamOutcome.noShow
        : shown + noShow;
      const showRate = showDen > 0 ? round2((showNum / showDen) * 100) : null;
      return {
        user: uid, name: nameOf(uid),
        contactRate,
        targets: personTargets(uid, "sdr", { contactRate, bookingRate, showRate, contacts: contacted, callsBooked, won: wonMine, revenue: revenueMine }),
        won: wonMine, revenue: revenueMine, // as duas pernas do plano (oportunidades DELE)
        leadsNew,
        leadsPrev, // leads da janela anterior (base da meta dinâmica de calls)
        contacted,
        reschedules,
        callsBooked,
        bookingRate,
        firstTouchMedianH: median(touchHours),
        withinSla: touchHours.filter((h) => h <= slaMs / HOUR).length,
        breached, // novos que estouraram o SLA e seguem sem toque
        showRate,
        shown, // compareceram (dos leads dele; o % do SDR único usa a safra do time)
        noShow, // não compareceram (call vencida sem acontecer)
        pending, // agendadas pro futuro (ainda vão acontecer)
        wonFromCalls,
        callWinRate: callsBookedOrganic > 0 ? round2((wonFromCalls / callsBookedOrganic) * 100) : null,
        // Metas por TAXA (o alvo absoluto de calls sai de leads × bookingRate na
        // UI); callsBooked absoluto fica de fallback se alguém preferir fixo.
        goals: { ...goalMap(uid, "sdr", ["contactRate", "bookingRate", "showRate", "callsBooked", "contacts", "won", "revenue"]), callWinRate: bookedWinGoal(uid, "sdr") },
      };
    }).filter((p) => sdrRole.has(p.user) || p.leadsNew > 0 || p.callsBooked > 0 || p.contacted > 0) // ghost/owner legado só com atividade; SDR real sempre
      .sort((a, b) => b.callsBooked - a.callsBooked);

    // ── Closer (agrupado por closer) ──────────────────────────────────────────
    // Quem está no campo `closer` de um lead conta — inclusive o CS/integrador
    // que fechou um negócio (o papel não censura o placar; o fechamento dele
    // aparece aqui E as contas dele seguem no painel de CS). O filtro final
    // (calls > 0 || won > 0) já esconde quem não tem movimento.
    const closerRole = new Set(withRole("closer")); // membro do papel closer sempre aparece (pra ver a meta)
    const closerIds = [...new Set([...closerRole, ...leads.map((l) => l.closer).filter(Boolean)])];
    const closer = closerIds.map((uid) => {
      const mine = leads.filter((l) => l.closer === uid);
      // Calls agendadas (pela data da call) e quantas ACONTECERAM (compareceram):
      // avançou pra frente OU perdeu por outro motivo; no-show não conta. As
      // AGENDADAS (agenda) são do SDR — o closer conta só as que aconteceram com
      // ele (`calls` = orgânico dele). "Calls realizadas" MOSTRA o real + a parte
      // dele do histórico (o número que o Leo quer manter), e a Call→ganho
      // divide por ESSE mesmo número, então o card fecha.
      const callLeads = callCohortIn(mine, actsOf, inWin);
      const calls = callLeads.length;
      // Compareceu/furo pela MESMA régua da safra (callOutcome do metrics-core).
      const callsShown = callOutcome(callLeads).shown + (shownHist.get(uid) || 0);
      // GANHO do closer = venda na janela pela régua oficial (isWonLead +
      // wonAt, metrics-core). O valor do negócio é lançado no fechamento
      // (ver stage-move/DestinoSection).
      const winAt = winTransitionsFor(mine);
      const wonLeads = [...winAt.keys()].map((id) => leadById.get(id)).filter(Boolean);
      const wonN = wonLeads.length;
      const revenue = wonLeads.reduce((a, l) => a + (Number(l.amount) || 0), 0);
      // Ciclo CALL → GANHO: dias da call marcada até o fechamento (integração).
      const cycle = wonLeads.map((l) => (l.callAt ? (new Date(winAt.get(l.id)) - new Date(l.callAt)) / DAY : null))
        .filter((d) => Number.isFinite(d) && d >= 0);
      const lost = mine.filter((l) => isLoss(product, l.stage) && inWin(l.stageSince));
      const reasonCount = {};
      for (const l of lost) { const r = l.lostReason || "nao_informado"; reasonCount[r] = (reasonCount[r] || 0) + 1; }
      const lossReasons = Object.entries(reasonCount).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
      // Conversão na call = ganhos ÷ calls REALIZADAS mostradas no card (Leo,
      // 25/07: a % tem que bater com won ÷ realizadas do próprio card). Divide
      // pelo MESMO callsShown que aparece — inclui o histórico, que não tem
      // ganho, então a taxa reflete o recorde real sobre TODAS as calls feitas.
      const conversao = callsShown > 0 ? round2((wonN / callsShown) * 100) : null;
      return {
        user: uid, name: nameOf(uid),
        targets: personTargets(uid, "closer", {
          conversaoCall: conversao,
          callsShown,
          won: wonN, revenue: round2(revenue), ticket: wonN > 0 ? round2(revenue / wonN) : null,
        }),
        calls, callsShown,
        won: wonN, revenue: round2(revenue), lost: lost.length,
        conversaoCall: conversao,
        winRateCall: calls > 0 ? round2((wonN / calls) * 100) : null,
        revenuePerCall: calls > 0 ? round2(revenue / calls) : null,
        ticket: wonN > 0 ? round2(revenue / wonN) : null,
        cycleDays: median(cycle),
        lossReasons,
        goals: { ...goalMap(uid, "closer", ["won", "revenue", "conversaoCall", "ticket"]), winRateCall: bookedWinGoal(uid, "closer") },
      };
    }).filter((p) => closerRole.has(p.user) || p.calls > 0 || p.won > 0) // closer legado (ex.: CS que fechou) só com movimento; closer real sempre
      .sort((a, b) => b.revenue - a.revenue);

    // ── CS / retenção (agrupado por customer.owner) ───────────────────────────
    const csRole = new Set(withRole("integrator")); // membros do papel CS sempre aparecem (pra ver a meta)
    const csIds = [...new Set([...csRole, ...customers.map((c) => c.owner).filter(Boolean)])];
    const npsSaas = npsAll.filter((n) => !n.saas || n.saas === product.id);
    // Upsells do produto: fatura kind:"upsell" (o botão do card do cliente cria uma
    // fatura PAGA, então já entra no caixa pela régua existente). Atribuídos ao CS
    // pelo DONO do cliente, igual ao resto do bloco.
    const upsellInvoices = invoicesAll.filter((i) => i.saas === product.id && i.kind === "upsell");
    // Indicações recebidas na janela: nº do TIME (sem atribuição fina por pessoa,
    // decisão do Leo). Mesmo número em cada card de CS — a régua isReferralLead.
    const teamReferrals = leads.filter((l) => isReferralLead(l) && inWin(l.createdAt)).length;
    const cs = csIds.map((uid) => {
      const mine = customers.filter((c) => c.owner === uid);
      const mineIds = new Set(mine.map((c) => c.id));
      const newAccounts = mine.filter((c) => inWin(c.startedAt)).length;
      // Churn magro: assinatura cancelada COM data na janela (billing ainda não
      // grava evento de churn dedicado — cresce quando gravar). Retenção = 100 −
      // churn% sobre a base (ativas + churnadas); sem churn = 100% (honesto).
      const churned = subs.filter((s) => mineIds.has(s.customer) && s.status === "canceled" && inWin(s.canceledAt)).length;
      const base = mine.length + churned;
      const retentionRate = base > 0 ? round2(((base - churned) / base) * 100) : null;
      // NPS médio das contas dele (coleção nps: { customer, score }). Sem dado → null.
      const scores = npsSaas.filter((n) => mineIds.has(n.customer) && Number.isFinite(Number(n.score))).map((n) => Number(n.score));
      const nps = scores.length ? round2(scores.reduce((a, s) => a + s, 0) / scores.length) : null;
      // Upsells dele = faturas de upsell dos clientes dele na janela (pela data de
      // pagamento, que é quando entrou no caixa). Conta e soma de R$.
      const myUpsells = upsellInvoices.filter((i) => mineIds.has(i.customer) && inWin(i.paidAt || i.createdAt || i.dueDate));
      const upsells = myUpsells.length;
      const upsellRevenue = round2(myUpsells.reduce((a, i) => a + (Number(i.amount) || 0), 0));
      return {
        user: uid, name: nameOf(uid),
        targets: personTargets(uid, "integrator", { retentionRate, nps, newAccounts, activeAccounts: mine.length, upsells, referrals: teamReferrals }),
        activeAccounts: mine.length,
        newAccounts,
        churned,
        retentionRate,
        nps, npsCount: scores.length,
        upsells, upsellRevenue, referrals: teamReferrals,
        goals: goalMap(uid, "integrator", ["newAccounts", "activeAccounts", "retentionRate", "nps", "upsells", "referrals"]),
      };
    }).filter((p) => p.activeAccounts > 0 || p.newAccounts > 0 || csRole.has(p.user)) // responsável aparece mesmo sem conta (pra ver a meta)
      .sort((a, b) => b.activeAccounts - a.activeAccounts);

    // ── Mídia social (agregado por papel) ─────────────────────────────────────
    // A DEMANDA de conteúdo (posts/stories/ads) já está nas metas; a PRODUÇÃO
    // ainda não tem fonte de dados (posts/stories = tela de Mídia social; ads =
    // fluxo de criar-anúncio), então produzido = 0 por ora — o painel mostra o
    // alvo pra ele perseguir. Sempre exibe quem tem o papel social.
    const social = withRole("social").map((uid) => ({
      user: uid, name: nameOf(uid),
      postsPerMonth: 0, storiesPerMonth: 0, adsPerMonth: 0, // produção não conectada ainda
      targets: personTargets(uid, "social", { postsPerMonth: 0, storiesPerMonth: 0, adsPerMonth: 0 }),
      goals: goalMap(uid, "social", ["postsPerMonth", "storiesPerMonth", "adsPerMonth"]),
    }));

    // ── Funil do TIME (produto inteiro, mesma janela) ─────────────────────────
    // A régua de conversão da Visão geral: contatados → agendaram call →
    // compareceram → ganho, sem recorte por pessoa. Leo (24/07): é o TOTAL DE
    // ATIVIDADE do período — TODA call agendada/realizada e TODO lead tocado na
    // janela, NÃO só a "safra" que ENTROU no período. Antes o funil filtrava por
    // createdAt na janela (coorte), então uma call desta semana de um lead de
    // semanas atrás não entrava e o topo ficava MENOR que a soma dos cards por
    // pessoa (que contam a atividade toda). A coorte de aquisição (dos que
    // entraram → converteram) mora na tela de Aquisição, onde casa com ROAS/CAC.
    // O funil ENCADEIA: cada denominador é o passo anterior.
    const teamWonLeads = [...winTransitionsFor(leads).keys()].map((id) => leadById.get(id)).filter(Boolean);
    // Contatados = a régua única (contactAttribution, lá em cima): leads
    // DISTINTOS com contato HUMANO na janela, cada um no autor do 1º contato.
    // O histórico pré-cockpit mora nos buckets das pessoas (80 no SDR etc.),
    // então a soma do "quem contatou" fecha EXATA com o total do tile.
    const contactedBy = [...contact.byAuthor.entries()]
      .map(([user, n]) => ({ user, name: nameOf(user), leads: n + (contactedHist.get(user) || 0) }));
    for (const [user, n] of contactedHist) {
      if (!contact.byAuthor.has(user)) contactedBy.push({ user, name: nameOf(user), leads: n });
    }
    contactedBy.sort((a, b) => b.leads - a.leads);
    // Quem agendou: as calls pelo DONO do lead (o SDR que prospecta) — o card
    // do SDR conta a MESMA fatia + o histórico das agendadas (também no SDR),
    // então o card = o tile. Call sem dono credita no SDR único (Leo, 25/07). A
    // safra (teamBooked/teamOutcome, callAt) está definida lá em cima — "Calls
    // realizadas" do funil bate com a soma dos cards dos closers (shown).
    const bookedByOwner = new Map();
    for (const l of teamBooked) {
      const dono = l.owner || soloSdr || "";
      bookedByOwner.set(dono, (bookedByOwner.get(dono) || 0) + 1);
    }
    const bookedBy = [...bookedByOwner.entries()]
      .map(([user, n]) => ({ user, name: user ? nameOf(user) : "sem dono", leads: n }))
      .sort((a, b) => b.leads - a.leads);
    const leadsNewN = leads.filter((l) => inWin(l.createdAt)).length + adjN("leads");
    const contactedN = contact.leadIds.size + adjN("contacted");
    const bookedN = teamBooked.length + adjN("booked");
    const shownN = teamOutcome.shown + adjN("shown");
    // Não compareceram (call vencida sem virar call real) e a realizar (call
    // marcada pro futuro) — o histórico pré-cockpit não tem furo nem futuro
    // (10 agendadas = 10 realizadas), então só o orgânico entra aqui. Fecha:
    // agendadas (bookedN) = realizadas (shownN) + não-vieram (noShowN) + futuro.
    const noShowN = teamOutcome.noShow;
    const pendingN = teamOutcome.pending;
    // Base do comparecimento = só o que JÁ deveria ter acontecido (exclui as
    // calls futuras): realizadas + não compareceram.
    const dueN = shownN + noShowN;
    const wonFromCallsN = teamOutcome.won; // SEM ajuste: ganho segue os registros
    const wonN = teamWonLeads.length;
    const team = {
      leadsNew: leadsNewN,
      contacted: contactedN,               // WORKLOAD: leads trabalhados no período + histórico
      contactedInPeriod: contact.leadIds.size, // só o orgânico (sem histórico) — pro subtítulo do tile
      callsBooked: bookedN,
      // Taxa de contato = COBERTURA da safra (dos leads que ENTRARAM, quantos
      // foram alcançados) — nunca passa de 100%. NÃO é contacted÷leadsNew, que
      // misturava workload (lead antigo + histórico) com coorte e dava 126%.
      contactRate: teamContactRate,
      // Taxa de agendamento = calls agendadas ÷ leads contatados (workload).
      bookingRate: contactedN > 0 ? round2((bookedN / contactedN) * 100) : null,
      shown: shownN,
      noShow: noShowN,       // não compareceram (call vencida sem acontecer) — o gap real
      pending: pendingN,     // agendadas pro futuro (ainda vão acontecer)
      // Comparecimento = das que JÁ deveriam ter acontecido, quantas aconteceram
      // (exclui as futuras): realizadas ÷ (realizadas + não compareceram).
      showRate: dueN > 0 ? round2((shownN / dueN) * 100) : null,
      wonFromCalls: wonFromCallsN, // ganhos DA SAFRA (das calls deste período, quantas já viraram venda)
      // Call agendada → ganho (safra sobre agendadas) e FECHAMENTO DO PERÍODO
      // (ganhos do período ÷ calls realizadas no período — os DOIS lados são a
      // soma dos cards, então o % da régua bate com os tiles ao redor).
      callWinRate: bookedN > 0 ? round2((wonFromCallsN / bookedN) * 100) : null,
      closeRate: shownN > 0 ? round2((wonFromCallsN / shownN) * 100) : null, // safra (informativo)
      closeRatePeriod: shownN > 0 ? round2((wonN / shownN) * 100) : null,
      won: wonN,             // ganhos TOTAIS no período (por transição) = soma dos closers
      revenue: round2(teamWonLeads.reduce((a, l) => a + (Number(l.amount) || 0), 0)),
      // Lead → ganho: ganhos no período ÷ leads que entraram no período.
      leadToWin: leadsNewN > 0 ? round2((wonN / leadsNewN) * 100) : null,
      paceAdjust: adjApplied, // histórico pré-cockpit somado (null quando não há; nunca tem won)
      contactedBy,            // quem fez o 1º contato humano de cada lead (soma = total do tile)
      automationReached: contact.automationReached, // leads que a automação alcançou (fora do total)
      bookedBy,               // calls do período pelo DONO do lead (o card do SDR mostra a fatia dele)
      // Metas de TAXA por papel (role-scope) pra colorir a régua na UI.
      goals: {
        bookingRate: goalFor("", "sdr", "bookingRate"),
        showRate: goalFor("", "sdr", "showRate"),
        callWinRate: bookedWinGoal("", "sdr"),
        closeRate: goalFor("", "closer", "conversaoCall"),
      },
    };

    // ── Réguas do Receita Previsível (card "5 métricas" da Visão geral) ───────
    // 1. Leads por CLASSE (Semente/Rede/Alvo): classes nunca entram na mesma
    //    projeção (ciclo e taxa próprios). Soma das classes = leads que entraram
    //    e ganhos do período (a MESMA winTransitionsFor do resto do placar).
    team.classes = classCounts(leads, inWin, winTransitionsFor(leads));
    // 2. Caixa do período em 3 baldes (novos · upsell · renovação) — mesma
    //    régua de fatura paga da faixa de meta, só que repartida.
    team.cash = cashBucketsIn(invoicesAll.filter((i) => i.saas === product.id), customers, inWin);
    // 3. Pipeline CRIADO no período ("o indicador mais importante para
    //    sinalizar a receita", p.218): oportunidade = call agendada na janela
    //    (quando o bastão passa pro closer). R$ = valor conhecido (amount) +
    //    ticket mediano dos ganhos de 90d pras oportunidades ainda sem valor.
    const since90 = dayKey(new Date(now().getTime() - 89 * DAY));
    const in90 = (iso) => iso && dayKey(iso) >= since90 && dayKey(iso) <= today;
    const wins90 = winsIn(product, leads, in90, customerStartByLead);
    const ticket90 = median([...wins90.keys()].map((id) => Number(leadById.get(id)?.amount) || 0).filter((v) => v > 0));
    const pipeKnown = teamBooked.reduce((a, l) => a + (Number(l.amount) || 0), 0);
    const pipeNoVal = teamBooked.filter((l) => !(Number(l.amount) > 0)).length;
    team.pipelineCreated = {
      count: teamBooked.length,
      // Requalificadas: das oportunidades da janela, quantas o closer já ACEITOU
      // (lead.oppAccepted, o aceite do drawer) — a régua do livro pro crédito.
      accepted: teamBooked.filter((l) => l.oppAccepted).length,
      valueKnown: round2(pipeKnown),
      ticketMedian90: ticket90,
      estimated: round2(pipeKnown + (ticket90 || 0) * pipeNoVal),
    };
    // 4. SLA de 1º TOQUE: minutos do cadastro até o 1º contato humano (mesma
    //    régua do contactAttribution) nos leads que ENTRARAM na janela. Meta de
    //    resposta: 5 minutos em horário comercial (lead de madrugada/fim de
    //    semana entra na mediana com a espera real — a fila abre 8h).
    const touchMins = [];
    let within5 = 0;
    const slaCohort = leads.filter((l) => inWin(l.createdAt));
    for (const l of slaCohort) {
      const at = contact.firstAt?.get(l.id);
      if (!at) continue;
      const m = (new Date(at) - new Date(l.createdAt)) / 60_000;
      if (!Number.isFinite(m) || m < 0) continue;
      touchMins.push(m);
      if (m <= 5) within5++;
    }
    team.firstTouch = {
      medianMin: touchMins.length ? round2(median(touchMins)) : null,
      within5m: within5,
      touched: touchMins.length,
      cohort: slaCohort.length,
      pct5m: touchMins.length ? round2((within5 / touchMins.length) * 100) : null,
    };
    // 5. ESTAGNADAS (faxina mensal, p.191): oportunidade em etapa ATIVA de
    //    venda parada há 14+ dias sem mudar de etapa — candidata a reativar,
    //    reciclar pra nutrição ou desqualificar. Independe da janela do topo.
    const STALL_KINDS = new Set(["qualificacao", "call", "proposta", "followup"]);
    const nowMs = now().getTime();
    const stalledLeads = leads
      .filter((l) => STALL_KINDS.has(kindOf(product, l.stage)) && l.stageSince && (nowMs - new Date(l.stageSince).getTime()) / DAY > 14)
      .map((l) => ({ id: l.id, name: l.name || l.nome || l.id, stage: l.stage, days: Math.floor((nowMs - new Date(l.stageSince).getTime()) / DAY) }))
      .sort((a, b) => b.days - a.days);
    team.stalled = { count: stalledLeads.length, items: stalledLeads.slice(0, 20) };

    return { saas: product.id, since, until, sdr, closer, cs, social, team };
  });
}
