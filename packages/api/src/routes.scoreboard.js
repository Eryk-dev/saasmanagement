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

    const [allLeads, allActs, allCustomers, proposals, subs, users, goalsAll] = await Promise.all([
      repo.list("leads"),
      repo.list("activities"),
      repo.list("customers"),
      repo.list("proposals"),
      repo.list("subscriptions"),
      repo.list("users").catch(() => []),
      repo.list("goals"),
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
      const contacted = touchHours.length; // leads novos que ele JÁ tocou (1º contato feito)
      return {
        user: uid, name: nameOf(uid),
        leadsNew,
        leadsPrev, // leads da janela anterior (base da meta dinâmica de calls)
        contacted,
        contactRate: leadsNew > 0 ? round2((contacted / leadsNew) * 100) : null,
        callsBooked,
        bookingRate: leadsNew > 0 ? round2((callsBooked / leadsNew) * 100) : null,
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
    }).filter((p) => p.leadsNew > 0 || p.callsBooked > 0)
      .sort((a, b) => b.callsBooked - a.callsBooked);

    // ── Closer (agrupado por closer) ──────────────────────────────────────────
    const closerIds = [...new Set([...withRole("closer"), ...leads.map((l) => l.closer).filter(Boolean)])];
    const closer = closerIds.map((uid) => {
      const mine = leads.filter((l) => l.closer === uid);
      const calls = mine.filter((l) => inWin(l.callAt)).length;
      const won = mine.filter((l) => isWon(product, l.stage) && inWin(l.stageSince));
      const lost = mine.filter((l) => isLoss(product, l.stage) && inWin(l.stageSince));
      const revenue = won.reduce((a, l) => a + (Number(l.amount) || 0), 0);
      const props = proposals.filter((p) => p.saas === product.id && leadById.get(p.lead)?.closer === uid && inWin(p.createdAt)).length;
      const cycle = won.map((l) => (new Date(l.stageSince) - new Date(l.createdAt)) / DAY).filter((d) => Number.isFinite(d) && d >= 0);
      const decided = won.length + lost.length;
      return {
        user: uid, name: nameOf(uid),
        calls, proposals: props,
        won: won.length, revenue: round2(revenue),
        closeRate: decided > 0 ? round2((won.length / decided) * 100) : null,
        ticket: won.length > 0 ? round2(revenue / won.length) : null,
        cycleDays: median(cycle),
        goals: goalMap(uid, "closer", ["won", "revenue", "calls", "proposals"]),
      };
    }).filter((p) => p.calls > 0 || p.won > 0 || p.proposals > 0)
      .sort((a, b) => b.revenue - a.revenue);

    // ── CS / retenção (agrupado por customer.owner) ───────────────────────────
    const csIds = [...new Set([...withRole("integrator"), ...customers.map((c) => c.owner).filter(Boolean)])];
    const cs = csIds.map((uid) => {
      const mine = customers.filter((c) => c.owner === uid);
      const mineIds = new Set(mine.map((c) => c.id));
      const newAccounts = mine.filter((c) => inWin(c.startedAt)).length;
      // Churn magro: assinatura cancelada COM data na janela (billing ainda não
      // grava evento de churn dedicado — cresce quando gravar).
      const churned = subs.filter((s) => mineIds.has(s.customer) && s.status === "canceled" && inWin(s.canceledAt)).length;
      return {
        user: uid, name: nameOf(uid),
        activeAccounts: mine.length,
        newAccounts,
        churned,
        goals: goalMap(uid, "integrator", ["newAccounts", "activeAccounts"]),
      };
    }).filter((p) => p.activeAccounts > 0 || p.newAccounts > 0)
      .sort((a, b) => b.activeAccounts - a.activeAccounts);

    return { saas: product.id, since, until, sdr, closer, cs };
  });
}
