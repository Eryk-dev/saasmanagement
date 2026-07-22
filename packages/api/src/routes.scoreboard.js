// Placar por pessoa e por papel (SDR / Closer / CS) — a base do cockpit de
// gestão da Visão geral. Agrupa os leads por `owner` (SDR) e `closer`, e os
// clientes por `owner` (CS), e devolve, no período, as métricas que interessam
// a cada função + a meta configurada (coleção `goals`).
//
// Só LEITURA/agregação sobre o que o CRM já grava (lead.owner/closer/stage/
// stageSince/callAt/amount, activities de stage/toque, customers, proposals).
// Sem histórico de churn confiável ainda, então retenção entra magra (contas
// novas + cancelamentos com data) — cresce quando o billing registrar o evento.

import { cadenceOf, firstStage, isLoss, TOUCH_TYPES } from "./stages.js";
import { TEAM_METRICS, META_CATALOG } from "./routes.metas.js";
import { RATE_BENCHMARKS } from "./routes.pipeline-pace.js";
import {
  DAY_MS as DAY, round2, dayKey, rangeFromQuery, isRealLead,
  bookedLeadsIn as coreBooked, callOutcome as coreCallOutcome,
  winsIn, customerStartMap, funnelCounts, waContactedLeadIds,
} from "./metrics-core.js";

const HOUR = 3_600_000;
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return round2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

export function registerScoreboardRoutes(app, repo) {
  app.get("/api/scoreboard/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { since, until } = rangeFromQuery(req.query || {});
    const inWin = (iso) => iso && dayKey(iso) >= since && dayKey(iso) <= until;
    // Janela ANTERIOR (semana/mês passado) — base da meta dinâmica de calls do
    // SDR: a meta da semana atual sai do volume de leads da semana passada
    // (completa), que é estável (a semana atual ainda não fechou).
    const prevSince = String(req.query?.prevSince || "");
    const prevUntil = String(req.query?.prevUntil || "");
    const hasPrev = /^\d{4}-\d{2}-\d{2}$/.test(prevSince) && /^\d{4}-\d{2}-\d{2}$/.test(prevUntil);
    const inPrev = (iso) => iso && dayKey(iso) >= prevSince && dayKey(iso) <= prevUntil;

    const [allLeads, allActs, allCustomers, proposals, subs, users, goalsAll, npsAll, waMessages] = await Promise.all([
      repo.list("leads"),
      repo.list("activities"),
      repo.list("customers"),
      repo.list("proposals"),
      repo.list("subscriptions"),
      repo.list("users").catch(() => []),
      repo.list("goals"),
      repo.list("nps").catch(() => []),
      repo.list("wa_messages").catch(() => []),
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
    const headcount = (role) => Math.max(1, users.filter((u) => (!u.saas || u.saas === product.id) && (u.roles || []).includes(role)).length);
    const goalFor = (userId, role, metric) => {
      const u = goals.find((g) => g.scope === "user" && g.key === userId && g.metric === metric);
      if (u) return { target: Number(u.target) || 0, period: u.period || "month", scope: "user" };
      const r = goals.find((g) => g.scope === "role" && g.key === role && g.metric === metric);
      if (!r) return null;
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
    const withRole = (role) => users.filter((u) => (u.roles || []).includes(role)).map((u) => u.id);
    const goalMap = (uid, role, metrics) => Object.fromEntries(metrics.map((m) => [m, goalFor(uid, role, m)]).filter(([, g]) => g));

    // ── Réguas do metrics-core amarradas ao dataset da requisição ─────────────
    // Safra de calls, resolução compareceu/furo/vendeu e fechamentos na janela
    // moram no metrics-core.js — regra nova entra LÁ. Fechamento segue a régua
    // oficial da venda como fato do lead (isWonLead + wonAt), com fallback pro
    // lead legado sem carimbo (startedAt do cliente vinculado).
    const actsOf = (id) => actsByLead.get(id) || [];
    const bookedLeadsIn = (list) => coreBooked(product, list, actsOf, inWin);
    const callOutcome = (list) => coreCallOutcome(product, list, actsOf);
    const customerStartByLead = customerStartMap(customers);
    const winTransitionsFor = (list) => winsIn(product, list, inWin, customerStartByLead);

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
      // Calls agendadas = leads DISTINTOS desse SDR que atingiram estágio de kind
      // `call` na janela (a moeda de handoff; a atribuição é sempre do owner,
      // mesmo que o closer tenha movido o card — decisão do processo).
      const booked = bookedLeadsIn(mine);
      const callsBooked = booked.length;

      // Show-rate e calls→ganho sobre o cohort de calls agendadas (callOutcome).
      const { shown, noShow, won: wonFromCalls } = callOutcome(booked);
      const resolved = shown + noShow;
      const leadsNew = cohort.length;
      const leadsPrev = hasPrev ? mine.filter((l) => inPrev(l.createdAt)).length : null;
      // Contatados = TRABALHO DO DIA: leads que o SDR trabalhou no Meu dia no
      // período — registrou um toque OU atualizou o status (mudou de etapa). Vale
      // pra QUALQUER lead dele (não só a safra que entrou hoje), porque o fluxo é
      // fila rolante. Só a ação DELE conta (author = uid), não o move do closer
      // num lead que por acaso é dele. Distinto por lead.
      // Remarcações = calls que o cliente pediu pra mudar de horário na confirmação
      // e o SDR remarcou (toque com meta.event="reschedule"). Conta EVENTOS (um lead
      // pode remarcar mais de uma vez), e o próprio toque já credita "contatado".
      const contactedIds = new Set();
      let reschedules = 0;
      // Mensagem que ELE enviou no WhatsApp do cockpit, na janela, conta como
      // contato (o inbox virou a ferramenta do SDR). Não vira toque de cadência.
      const waMine = waContactedLeadIds(waMessages, { saas: product.id, author: uid, inWin });
      for (const l of mine) {
        for (const a of actsByLead.get(l.id) || []) {
          if (!inWin(a.at) || a.author !== uid) continue;
          if (a.meta?.event === "reschedule") reschedules++;
          if (TOUCH_TYPES.has(a.type) || a.type === "stage") contactedIds.add(l.id);
        }
        if (waMine.has(l.id)) contactedIds.add(l.id);
      }
      const contacted = contactedIds.size;
      return {
        user: uid, name: nameOf(uid),
        leadsNew,
        leadsPrev, // leads da janela anterior (base da meta dinâmica de calls)
        contacted,
        reschedules,
        callsBooked,
        // Taxa de agendamento = conversão do dia: das pessoas que ele contatou,
        // quantas viraram call (calls agendadas ÷ contatados).
        bookingRate: contacted > 0 ? round2((callsBooked / contacted) * 100) : null,
        firstTouchMedianH: median(touchHours),
        withinSla: touchHours.filter((h) => h <= slaMs / HOUR).length,
        breached, // novos que estouraram o SLA e seguem sem toque
        showRate: resolved > 0 ? round2((shown / resolved) * 100) : null,
        shown, // compareceram (numerador do show-rate; den = shown + noShow)
        noShow,
        wonFromCalls,
        callWinRate: callsBooked > 0 ? round2((wonFromCalls / callsBooked) * 100) : null,
        // Metas por TAXA (o alvo absoluto de calls sai de leads × bookingRate na
        // UI); callsBooked absoluto fica de fallback se alguém preferir fixo.
        goals: { ...goalMap(uid, "sdr", ["contactRate", "bookingRate", "showRate", "callsBooked", "contacts"]), callWinRate: bookedWinGoal(uid, "sdr") },
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
      // avançou pra frente OU perdeu por outro motivo; no-show não conta.
      const callLeads = mine.filter((l) => inWin(l.callAt));
      const calls = callLeads.length;
      // Compareceu/furo pela MESMA régua da safra (callOutcome do metrics-core).
      const callsShown = callOutcome(callLeads).shown;
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
      return {
        user: uid, name: nameOf(uid),
        calls, callsShown,
        won: wonN, revenue: round2(revenue), lost: lost.length,
        // Conversão na call = ganhos ÷ calls que ACONTECERAM (habilidade de fechar,
        // limpa de no-show). Win rate = ganhos ÷ calls AGENDADAS (inclui no-show):
        // o gap entre as duas denuncia perda por não-comparecimento.
        conversaoCall: callsShown > 0 ? round2((wonN / callsShown) * 100) : null,
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
      return {
        user: uid, name: nameOf(uid),
        activeAccounts: mine.length,
        newAccounts,
        churned,
        retentionRate,
        nps, npsCount: scores.length,
        goals: goalMap(uid, "integrator", ["newAccounts", "activeAccounts", "retentionRate", "nps"]),
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
      goals: goalMap(uid, "social", ["postsPerMonth", "storiesPerMonth", "adsPerMonth"]),
    }));

    // ── Funil do TIME (produto inteiro, mesma janela) ─────────────────────────
    // A régua de conversão da Visão geral: contatados → agendaram call →
    // compareceram → ganho, sem recorte por pessoa. É a MESMA base (funnelCounts)
    // da Análise de Pace, então as duas telas mostram os mesmos números. Inclui
    // o ajuste de HISTÓRICO PRÉ-COCKPIT (product.paceAdjust). O funil ENCADEIA:
    // cada denominador é o passo anterior.
    // O ajuste PRÉ-COCKPIT só entra quando a JANELA alcança a época anterior ao
    // registro no cockpit. Os leads existem desde antes, mas o time só passou a
    // logar toque/call/etapa aqui a partir do 1º registro de atividade — então
    // somar o histórico (product.paceAdjust) numa janela recente (ex.: "ontem")
    // inflava o funil (contatados > leads). Época = 1º dia com atividade do
    // produto (ou product.paceAdjust.before, se fixado). Aplica se since < época.
    let activityEpoch = null;
    for (const a of allActs) {
      if (a.saas !== product.id) continue;
      const d = dayKey(a.at);
      if (d && (!activityEpoch || d < activityEpoch)) activityEpoch = d;
    }
    const adjCutoff = product.paceAdjust?.before || activityEpoch;
    const teamAdjust = product.paceAdjust && (!adjCutoff || since < adjCutoff) ? product.paceAdjust : null;

    const teamWonLeads = [...winTransitionsFor(leads).keys()].map((id) => leadById.get(id)).filter(Boolean);
    // Contato por WhatsApp do cockpit também conta no funil do time (mesma régua
    // do pipeline-pace: qualquer mensagem enviada pro lead).
    const waTeam = waContactedLeadIds(waMessages, { saas: product.id });
    const fc = funnelCounts(product, { leads, actsOf, inWin, winLeadsIn: () => teamWonLeads, adjust: teamAdjust, waContactedIds: waTeam });
    const team = {
      leadsNew: fc.leads,
      contacted: fc.contacted,
      callsBooked: fc.booked,
      // Taxa de contato = dos leads novos, quantos o time alcançou.
      contactRate: fc.leads > 0 ? round2((fc.contacted / fc.leads) * 100) : null,
      // Taxa de agendamento = calls agendadas ÷ leads contatados.
      bookingRate: fc.contacted > 0 ? round2((fc.booked / fc.contacted) * 100) : null,
      shown: fc.shown,
      noShow: fc.noShow,
      // Comparecimento sobre as AGENDADAS (funil encadeado): dos que marcaram, quantos apareceram.
      showRate: fc.booked > 0 ? round2((fc.shown / fc.booked) * 100) : null,
      wonFromCalls: fc.won, // ganhos da safra de calls (+ pré-cockpit) — o que encadeia
      // Call agendada → ganho (sobre agendadas) e call REALIZADA → ganho (sobre
      // compareceram): o gap denuncia perda por não-comparecimento.
      callWinRate: fc.booked > 0 ? round2((fc.won / fc.booked) * 100) : null,
      closeRate: fc.shown > 0 ? round2((fc.won / fc.shown) * 100) : null,
      won: fc.wonTotal,      // ganhos TOTAIS no período (todos, por transição)
      revenue: fc.revenue,
      // Lead → ganho: ganhos do funil ÷ leads (ambos com o histórico pré-cockpit).
      leadToWin: fc.leads > 0 ? round2((fc.won / fc.leads) * 100) : null,
      paceAdjust: fc.adjust, // histórico pré-cockpit somado (null quando não há)
      // Metas de TAXA por papel (role-scope) pra colorir a régua na UI.
      goals: {
        bookingRate: goalFor("", "sdr", "bookingRate"),
        showRate: goalFor("", "sdr", "showRate"),
        callWinRate: bookedWinGoal("", "sdr"),
        closeRate: goalFor("", "closer", "conversaoCall"),
      },
    };

    // ── Metas × realizado do TIME ─────────────────────────────────────────────
    // A tela Metas define, a Visão geral cobra. Sai daqui (e não de uma soma no
    // front) porque o realizado tem que ser o MESMO número que os cartões por
    // pessoa mostram — duas contagens do mesmo trabalho é como a Visão geral
    // acabava divergindo da Metas. Só entra meta CONFIGURADA (target > 0): campo
    // em branco na tela não vira linha aqui.
    const sumOf = (rows, field) => rows.reduce((a, r) => a + (Number(r[field]) || 0), 0);
    const avgOf = (rows, field) => {
      const xs = rows.map((r) => Number(r[field])).filter((n) => Number.isFinite(n));
      return xs.length ? round2(xs.reduce((a, n) => a + n, 0) / xs.length) : null;
    };
    // Retenção e NPS do time saem da base INTEIRA do produto, não da média das
    // médias por pessoa (quem cuida de 1 conta pesaria igual a quem cuida de 20).
    const churnedTeam = subs.filter((s) => s.status === "canceled" && inWin(s.canceledAt)
      && customers.some((c) => c.id === s.customer)).length;
    const baseTeam = customers.length + churnedTeam;
    const npsTeam = npsSaas.filter((n) => Number.isFinite(Number(n.score))).map((n) => Number(n.score));
    const teamValue = {
      sdr: {
        contactRate: team.contactRate, bookingRate: team.bookingRate, showRate: team.showRate,
        contacts: team.contacted, callsBooked: team.callsBooked,
      },
      closer: {
        conversaoCall: team.closeRate, won: team.won, revenue: team.revenue,
        ticket: team.won > 0 ? round2(team.revenue / team.won) : null,
      },
      integrator: {
        retentionRate: baseTeam > 0 ? round2(((baseTeam - churnedTeam) / baseTeam) * 100) : null,
        nps: npsTeam.length ? round2(npsTeam.reduce((a, n) => a + n, 0) / npsTeam.length) : null,
        newAccounts: sumOf(cs, "newAccounts"), activeAccounts: customers.length,
      },
      social: {
        postsPerMonth: sumOf(social, "postsPerMonth"), storiesPerMonth: sumOf(social, "storiesPerMonth"),
        adsPerMonth: sumOf(social, "adsPerMonth"), followerGrowth: sumOf(social, "followerGrowth"),
        reachMonth: sumOf(social, "reachMonth"), engagementRate: avgOf(social, "engagementRate"),
      },
    };
    const targets = META_CATALOG.flatMap((cat) => cat.metrics.flatMap((m) => {
      const goal = goals.find((g) => g.scope === "role" && g.key === cat.role && g.metric === m.metric);
      const target = Number(goal?.target);
      if (!(target > 0)) return [];
      return [{
        role: cat.role, roleLabel: cat.label, metric: m.metric,
        label: m.label, hint: m.hint || "", unit: m.unit,
        // `kind` diz se a meta do MÊS pode ser reescalada pra janela (só `flow`);
        // `people` é o rateio que cada um persegue.
        kind: m.kind, team: !!m.team,
        target, period: goal.period || "month",
        people: m.team ? headcount(cat.role) : 1,
        value: teamValue[cat.role]?.[m.metric] ?? null,
      }];
    }));

    return { saas: product.id, since, until, sdr, closer, cs, social, team, targets };
  });
}
