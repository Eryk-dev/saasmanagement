// Agregação dos resumos de call (activity call_summary): contagens de
// temperatura, objeções e dores. Usada pela Análise de Pitches, pela Análise
// de Desempenho e pelo digest do blog.

// Agregação ESTRUTURADA dos resumos pra tela de Análise de pitch (contagens):
// temperatura, objeções (total + quantas em aberto) e dores, ordenadas por
// frequência. Mesma normalização do digest (case-insensitive, corta em 80).
export function aggregateCalls(summaries) {
  const objMap = new Map();
  const doresMap = new Map();
  const temp = { quente: 0, morno: 0, frio: 0 };
  for (const s of summaries || []) {
    if (s?.temperatura && temp[s.temperatura] != null) temp[s.temperatura]++;
    for (const o of s?.objecoes || []) {
      const k = String(o?.objecao || "").trim().toLowerCase().slice(0, 80);
      if (!k) continue;
      const e = objMap.get(k) || { objecao: o.objecao, total: 0, abertas: 0 };
      e.total++;
      if (!o.resolvida) e.abertas++;
      objMap.set(k, e);
    }
    for (const d of s?.dores || []) {
      const k = String(d || "").trim().toLowerCase().slice(0, 80);
      if (!k) continue;
      const e = doresMap.get(k) || { dor: d, total: 0 };
      e.total++;
      doresMap.set(k, e);
    }
  }
  return {
    count: (summaries || []).length,
    temperatura: temp,
    objecoes: [...objMap.values()].sort((a, b) => b.total - a.total),
    dores: [...doresMap.values()].sort((a, b) => b.total - a.total),
  };
}

// Resumo de call de VENDA de um produto (kind integracao fica de fora — outra
// estrutura, outra tela). Usado pela Análise de pitch e pela Análise de
// Desempenho (objeções por closer).
export const isSalesCallSummary = (a, saas) =>
  !!a && (!saas || a.saas === saas) && a.meta?.event === "call_summary" && !!a.meta?.summary && a.meta?.kind !== "integracao";

// Uma linha por CALL: re-resumo (mesma call) não conta duas vezes. Dedup pelo
// meetEventId (senão pelo lead), mantendo o resumo mais recente. Devolve em
// ordem decrescente de data.
export function dedupCallSummaries(list) {
  const all = [...(list || [])].sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));
  const seen = new Set();
  const acts = [];
  for (const a of all) {
    const key = a.meta?.meetEventId || a.lead || a.id;
    if (seen.has(key)) continue;
    seen.add(key);
    acts.push(a);
  }
  return acts;
}
