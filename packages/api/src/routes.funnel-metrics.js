// Métricas REAIS de funil — derivadas do histórico de transições (activities
// `stage`, gravadas por lead-flow.js), não do estágio atual. Leads criados antes
// da timeline existir não têm histórico: caem na aproximação legada (índice do
// estágio atual na régua), a MESMA do marketing pré-CRM — números degradam
// honestos, nunca inventam transição (`coverage` expõe a proporção).

import { ladderOf, kindOf, isWon, firstStage, LOSS_KINDS, TOUCH_TYPES } from "./stages.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const dayStr = (d) => new Date(d).toISOString().slice(0, 10);

function rangeFromQuery(q, now = new Date()) {
  const until = q.until || dayStr(now);
  const since = q.since || dayStr(new Date(now.getTime() - 29 * DAY_MS));
  return { since, until };
}

const round2 = (n) => Math.round(n * 100) / 100;

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Quantos leads PASSARAM por cada estágio da régua de progresso. Lead com
// histórico conta todo estágio da régua até o mais avançado que tocou (from/to
// das activities + estágio atual); lead sem histórico conta 0..índice do estágio
// atual (aproximação legada — fora da régua = só a entrada). Compartilhado com
// o custo-por-estágio do marketing (routes.marketing.js).
export function stagePassCounts(product, leads, actsByLead) {
  const ladder = ladderOf(product);
  const pos = new Map(ladder.map((s, i) => [s, i]));
  const counts = ladder.map(() => 0);
  for (const l of leads) {
    const stageActs = (actsByLead.get(l.id) || []).filter((a) => a.type === "stage");
    let maxIdx;
    if (stageActs.length) {
      const touched = new Set([l.stage]);
      for (const a of stageActs) {
        if (a.meta?.from) touched.add(a.meta.from);
        if (a.meta?.to) touched.add(a.meta.to);
      }
      maxIdx = 0; // esteve na régua pelo menos na entrada
      for (const s of touched) if (pos.has(s) && pos.get(s) > maxIdx) maxIdx = pos.get(s);
    } else {
      maxIdx = pos.has(l.stage) ? pos.get(l.stage) : 0;
    }
    for (let i = 0; i <= maxIdx && i < counts.length; i++) counts[i]++;
  }
  return { ladder, counts };
}

export function registerFunnelMetricsRoutes(app, repo) {
  app.get("/api/funnel/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { since, until } = rangeFromQuery(req.query || {});

    // Cohort = leads CRIADOS no período (mesma janela do marketing/metrics).
    const leads = (await repo.list("leads")).filter(
      (l) => l.saas === product.id && l.createdAt && dayStr(l.createdAt) >= since && dayStr(l.createdAt) <= until,
    );
    const actsByLead = new Map();
    for (const a of await repo.list("activities")) {
      if (!a.lead || a.saas !== product.id) continue;
      if (!actsByLead.has(a.lead)) actsByLead.set(a.lead, []);
      actsByLead.get(a.lead).push(a);
    }
    for (const list of actsByLead.values()) list.sort((x, y) => String(x.at || "").localeCompare(String(y.at || "")));

    const { ladder, counts } = stagePassCounts(product, leads, actsByLead);

    // Tempo por estágio: só intervalos FECHADOS (par de transições consecutivas;
    // entrada no 1º estágio = createdAt). O intervalo aberto do estágio atual
    // não conta — não distorce a mediana com leads parados.
    const durations = new Map();
    let withHistory = 0;
    for (const l of leads) {
      const stageActs = (actsByLead.get(l.id) || []).filter((a) => a.type === "stage");
      if (!stageActs.length) continue;
      withHistory++;
      let prevAt = l.createdAt;
      let prevStage = stageActs[0].meta?.from || firstStage(product);
      for (const a of stageActs) {
        const days = (new Date(a.at) - new Date(prevAt)) / DAY_MS;
        if (prevStage && Number.isFinite(days) && days >= 0) {
          if (!durations.has(prevStage)) durations.set(prevStage, []);
          durations.get(prevStage).push(days);
        }
        prevAt = a.at;
        prevStage = a.meta?.to || "";
      }
    }

    const stages = ladder.map((stage, i) => ({
      stage,
      kind: kindOf(product, stage),
      entered: counts[i],
      current: leads.filter((l) => l.stage === stage).length,
      convToNext: i < ladder.length - 1 && counts[i] > 0 ? round2(counts[i + 1] / counts[i]) : null,
      medianDaysInStage: durations.has(stage) ? round2(median(durations.get(stage))) : null,
    }));

    // Fechamento e perdas do cohort (pelo estágio atual).
    const wonCount = leads.filter((l) => isWon(product, l.stage)).length;
    const lostLeads = leads.filter((l) => kindOf(product, l.stage) === "perdido");
    const dqLeads = leads.filter((l) => kindOf(product, l.stage) === "desqualificado");
    const winRate = wonCount + lostLeads.length > 0 ? round2(wonCount / (wonCount + lostLeads.length)) : null;

    const reasonCounts = {};
    for (const l of [...lostLeads, ...dqLeads]) {
      const r = l.lostReason || "nao_informado";
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    }
    const lossReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) =>
        b.count - a.count ||
        // "nao_informado" (buraco de processo) sempre no fim do empate
        (a.reason === "nao_informado") - (b.reason === "nao_informado") ||
        a.reason.localeCompare(b.reason));

    // SLA de 1º toque: criação → 1ª activity de TOQUE (whatsapp/call/email/
    // meeting). `untouched` = nunca tocado até agora.
    const touchHours = [];
    let untouched = 0;
    for (const l of leads) {
      const touch = (actsByLead.get(l.id) || []).find((a) => TOUCH_TYPES.has(a.type));
      if (!touch) { untouched++; continue; }
      const h = (new Date(touch.at) - new Date(l.createdAt)) / HOUR_MS;
      if (Number.isFinite(h) && h >= 0) touchHours.push(h);
    }
    const firstTouch = {
      medianHours: touchHours.length ? round2(median(touchHours)) : null,
      buckets: {
        h1: touchHours.filter((h) => h <= 1).length,
        h4: touchHours.filter((h) => h <= 4).length,
        h24: touchHours.filter((h) => h <= 24).length,
      },
      touched: touchHours.length,
      untouched,
    };

    return {
      saas: product.id, since, until,
      coverage: { leads: leads.length, withHistory },
      stages,
      winRate, wonCount, lostCount: lostLeads.length, dqCount: dqLeads.length,
      lossReasons,
      firstTouch,
    };
  });
}
