// Passagem dos leads pelos estágios da régua, usada pelas métricas de funil
// (routes.funnel-metrics.js) e pelo custo por estágio do marketing.

import { ladderOf } from "../crm/stages.js";

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
