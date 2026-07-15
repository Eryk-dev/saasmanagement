// Análise de integração (CS/onboarding): agrega os resumos das calls de
// INTEGRAÇÃO (activity call_summary com meta.kind="integracao") de um produto —
// sentimento do cliente, pendências recorrentes do onboarding e o que mais é
// configurado. Read-only. Espelho do routes.pitch.js, mas do lado pós-venda.

// Agregação estruturada: distribuição de sentimento, pendências (com quem
// resolve) e itens configurados, ordenados por frequência. Normalização
// case-insensitive (corta em 80), igual ao aggregateCalls.
export function aggregateIntegrations(summaries) {
  const sentimento = { satisfeito: 0, neutro: 0, "em risco": 0 };
  const pendMap = new Map();
  const confMap = new Map();
  for (const s of summaries || []) {
    if (s?.sentimento && sentimento[s.sentimento] != null) sentimento[s.sentimento]++;
    for (const p of s?.pendencias || []) {
      const item = typeof p === "object" && p ? p.item : p;
      const resp = typeof p === "object" && p ? String(p.responsavel || "") : "";
      const k = String(item || "").trim().toLowerCase().slice(0, 80);
      if (!k) continue;
      const e = pendMap.get(k) || { item, total: 0, cliente: 0, equipe: 0 };
      e.total++;
      if (/client/i.test(resp)) e.cliente++;
      else if (/equip|time/i.test(resp)) e.equipe++;
      pendMap.set(k, e);
    }
    for (const c of s?.configurado || []) {
      const k = String(c || "").trim().toLowerCase().slice(0, 80);
      if (!k) continue;
      const e = confMap.get(k) || { item: c, total: 0 };
      e.total++;
      confMap.set(k, e);
    }
  }
  return {
    count: (summaries || []).length,
    sentimento,
    pendencias: [...pendMap.values()].sort((a, b) => b.total - a.total),
    configurado: [...confMap.values()].sort((a, b) => b.total - a.total),
  };
}

export function registerIntegrationRoutes(app, repo) {
  app.get("/api/integrations/:saas/summary", async (req) => {
    const saas = req.params.saas;
    const all = (await repo.list("activities"))
      .filter((a) => a && a.saas === saas && a.meta?.event === "call_summary" && a.meta?.summary && a.meta?.kind === "integracao")
      .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));
    // Uma linha por call de integração: re-resumo (mesmo meetEventId) não conta 2×.
    const seen = new Set();
    const acts = [];
    for (const a of all) {
      const key = a.meta?.meetEventId || a.lead || a.id;
      if (seen.has(key)) continue;
      seen.add(key);
      acts.push(a);
    }
    const agg = aggregateIntegrations(acts.map((a) => a.meta.summary));
    const leadsById = new Map((await repo.list("leads")).map((l) => [l.id, l]));
    const recent = acts.slice(0, 25).map((a) => ({
      leadId: a.lead,
      leadName: leadsById.get(a.lead)?.name || "",
      company: leadsById.get(a.lead)?.company || "",
      at: a.at || "",
      sentimento: a.meta.summary.sentimento || "",
      resumo: a.meta.summary.resumo || "",
      recordingUrl: a.meta.recordingUrl || "",
    }));
    return { ...agg, recent };
  });
}
