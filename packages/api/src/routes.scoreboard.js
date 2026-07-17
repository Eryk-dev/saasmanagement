// Placar por pessoa e por papel (SDR / Closer / CS) — a base do cockpit de
// gestão da Visão geral. Agrupa os leads por `owner` (SDR) e `closer`, e os
// clientes por `owner` (CS), e devolve, no período, as métricas que interessam
// a cada função + a meta configurada (coleção `goals`).
//
// Só LEITURA/agregação sobre o que o CRM já grava (lead.owner/closer/stage/
// stageSince/callAt/amount, activities de stage/toque, customers, proposals).
// Sem histórico de churn confiável ainda, então retenção entra magra (contas
// novas + cancelamentos com data) — cresce quando o billing registrar o evento.

import { kindOf, isWon, isLoss, cadenceOf, firstStage, TOUCH_TYPES } from "./stages.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
// Dia no fuso do negócio (UTC-3), igual ao marketing/funil — a janela casa com
// a das outras telas.
const dayStr = (d) => new Date(new Date(d).getTime() - 3 * HOUR).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return round2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

function rangeFromQuery(q, now = new Date()) {
  const until = q.until || dayStr(now);
  const since = q.since || dayStr(new Date(now.getTime() - 29 * DAY));
  return { since, until };
}

export function registerScoreboardRoutes(app, repo) {
  app.get("/api/scoreboard/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { since, until } = rangeFromQuery(req.query || {});
    const inWin = (iso) => iso && dayStr(iso) >= since && dayStr(iso) <= until;
    // Janela ANTERIOR (semana/mês passado) — base da meta dinâmica de calls do
    // SDR: a meta da semana atual sai do volume de leads da semana passada
    // (completa), que é estável (a semana atual ainda não fechou).
    const prevSince = String(req.query?.prevSince || "");
    const prevUntil = String(req.query?.prevUntil || "");
    const hasPrev = /^\d{4}-\d{2}-\d{2}$/.test(prevSince) && /^\d{4}-\d{2}-\d{2}$/.test(prevUntil);
    const inPrev = (iso) => iso && dayStr(iso) >= prevSince && dayStr(iso) <= prevUntil;

    const [allLeads, allActs, allCustomers, proposals, subs, users, goalsAll, npsAll] = await Promise.all([
      repo.list("leads"),
      repo.list("activities"),
      repo.list("customers"),
      repo.list("proposals"),
      repo.list("subscriptions"),
      repo.list("users").catch(() => []),
      repo.list("goals"),
      repo.list("nps").catch(() => []),
    ]);
    const leads = allLeads.filter((l) => l.saas === product.id);
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
    const goals = goalsAll.filter((g) => !g.saas || g.saas === product.id);
    const goalFor = (userId, role, metric) => {
      const u = goals.find((g) => g.scope === "user" && g.key === userId && g.metric === metric);
      if (u) return { target: Number(u.target) || 0, period: u.period || "month" };
      const r = goals.find((g) => g.scope === "role" && g.key === role && g.metric === metric);
      return r ? { target: Number(r.target) || 0, period: r.period || "month" } : null;
    };
    const nameOf = (id) => users.find((u) => u.id === id)?.name || id;
    const withRole = (role) => users.filter((u) => (u.roles || []).includes(role)).map((u) => u.id);
    const goalMap = (uid, role, metrics) => Object.fromEntries(metrics.map((m) => [m, goalFor(uid, role, m)]).filter(([, g]) => g));

    // ── SDR (agrupado por owner) ──────────────────────────────────────────────
    const slaMs = (Number(cadenceOf(product, firstStage(product)).firstTouchHours) || 48) * HOUR;
    const sdrIds = [...new Set([...withRole("sdr"), ...leads.map((l) => l.owner).filter(Boolean)])];
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
      const bookedIds = new Set();
      for (const l of mine) {
        for (const a of actsByLead.get(l.id) || []) {
          if (a.type === "stage" && inWin(a.at) && kindOf(product, a.meta?.to) === "call") bookedIds.add(l.id);
        }
      }
      const booked = [...bookedIds].map((id) => leadById.get(id)).filter(Boolean);
      const callsBooked = booked.length;

      // Show-rate e calls→ganho sobre o cohort de calls agendadas. Compareceu =
      // avançou pra frente (proposta/follow-up/integração/ganho) OU perdeu por
      // OUTRO motivo (a call aconteceu). Não compareceu = perda com motivo
      // "nao_compareceu" (o closer marca). Ainda em Call agendada = não resolvido.
      const FORWARD = new Set(["proposta", "followup", "integracao", "ganho"]);
      let shown = 0, noShow = 0, wonFromCalls = 0;
      for (const l of booked) {
        const won = isWon(product, l.stage);
        const lost = isLoss(product, l.stage);
        if (won) wonFromCalls++;
        const advanced = won || FORWARD.has(kindOf(product, l.stage))
          || (actsByLead.get(l.id) || []).some((a) => a.type === "stage" && FORWARD.has(kindOf(product, a.meta?.to)));
        if (lost && l.lostReason === "nao_compareceu") noShow++;
        else if (advanced || lost) shown++;
      }
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
      for (const l of mine) {
        for (const a of actsByLead.get(l.id) || []) {
          if (!inWin(a.at) || a.author !== uid) continue;
          if (a.meta?.event === "reschedule") reschedules++;
          if (TOUCH_TYPES.has(a.type) || a.type === "stage") contactedIds.add(l.id);
        }
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
        goals: goalMap(uid, "sdr", ["contactRate", "bookingRate", "showRate", "callWinRate", "callsBooked"]),
      };
    }).filter((p) => p.leadsNew > 0 || p.callsBooked > 0 || p.contacted > 0)
      .sort((a, b) => b.callsBooked - a.callsBooked);

    // ── Closer (agrupado por closer) ──────────────────────────────────────────
    // Quem está no campo `closer` de um lead conta — inclusive o CS/integrador
    // que fechou um negócio (o papel não censura o placar; o fechamento dele
    // aparece aqui E as contas dele seguem no painel de CS). O filtro final
    // (calls > 0 || won > 0) já esconde quem não tem movimento.
    const closerIds = [...new Set([...withRole("closer"), ...leads.map((l) => l.closer).filter(Boolean)])];
    // Início do cliente vinculado (leadId) — fallback do momento do fechamento
    // pra lead ganho sem stageSince (fechados antes do log de atividades).
    const customerStartByLead = new Map(customers.filter((c) => c.leadId && c.startedAt).map((c) => [c.leadId, c.startedAt]));
    const FWD = new Set(["proposta", "followup", "integracao", "ganho"]); // avançou = a call aconteceu
    const closer = closerIds.map((uid) => {
      const mine = leads.filter((l) => l.closer === uid);
      // Calls agendadas (pela data da call) e quantas ACONTECERAM (compareceram):
      // avançou pra frente OU perdeu por outro motivo; no-show não conta.
      const callLeads = mine.filter((l) => inWin(l.callAt));
      const calls = callLeads.length;
      let callsShown = 0;
      for (const l of callLeads) {
        if (isLoss(product, l.stage) && l.lostReason === "nao_compareceu") continue;
        const advanced = isWon(product, l.stage) || FWD.has(kindOf(product, l.stage))
          || (actsByLead.get(l.id) || []).some((a) => a.type === "stage" && FWD.has(kindOf(product, a.meta?.to)));
        if (advanced || isLoss(product, l.stage)) callsShown++;
      }
      // GANHO do closer = fechamento = handoff pra INTEGRAÇÃO (ou direto Ganho).
      // Conta a TRANSIÇÃO (stage activity) pra kind integracao/ganho na janela —
      // pega o momento do fechamento mesmo que o card já tenha andado depois. O
      // valor do negócio é lançado NESSA passagem (ver stage-move/DestinoSection).
      const winAt = new Map();
      for (const l of mine) {
        for (const a of actsByLead.get(l.id) || []) {
          if (a.type === "stage" && inWin(a.at) && !winAt.has(l.id)) {
            const k = kindOf(product, a.meta?.to);
            if (k === "integracao" || k === "ganho") winAt.set(l.id, a.at);
          }
        }
      }
      // Fallback pros fechamentos de antes do log de atividades (jul/2026):
      // lead PARADO em ganho/integração sem NENHUMA transição registrada conta
      // pelo stageSince (ou pelo início do cliente vinculado). Com transição
      // registrada fora da janela, o fechamento pertence à outra janela — não
      // entra aqui.
      for (const l of mine) {
        if (winAt.has(l.id)) continue;
        const k = kindOf(product, l.stage);
        if (k !== "integracao" && k !== "ganho") continue;
        const hasWonAct = (actsByLead.get(l.id) || []).some((a) => {
          if (a.type !== "stage") return false;
          const ak = kindOf(product, a.meta?.to);
          return ak === "integracao" || ak === "ganho";
        });
        if (hasWonAct) continue;
        const at = l.stageSince || customerStartByLead.get(l.id) || "";
        if (inWin(at)) winAt.set(l.id, at);
      }
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
        goals: goalMap(uid, "closer", ["won", "revenue", "conversaoCall", "winRateCall", "ticket"]),
      };
    }).filter((p) => p.calls > 0 || p.won > 0)
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

    return { saas: product.id, since, until, sdr, closer, cs, social };
  });
}
