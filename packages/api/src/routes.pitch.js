// Insight de pitch a partir das calls: agrega os resumos de call (activity
// call_summary, geradas da transcrição do Meet pela IA) de um produto e pede pro
// modelo uma versão MELHOR do roteiro daquela etapa, que antecipa as objeções
// recorrentes e aproveita as dores mais citadas. NÃO grava nada — o cockpit
// mostra a sugestão pro time revisar e salvar em product.scripts (aba Scripts).

// Digest compacto dos resumos de call pra caber no prompt: objeções mais
// frequentes (com quantas ficaram em aberto e como foram tratadas quando
// resolvidas), dores mais citadas e a distribuição de temperatura.
export function buildCallsDigest(summaries) {
  const objMap = new Map(); // chave normalizada -> { objecao, total, abertas, tratadas: [] }
  const doresMap = new Map();
  const temp = { quente: 0, morno: 0, frio: 0 };
  for (const s of summaries || []) {
    if (s?.temperatura && temp[s.temperatura] != null) temp[s.temperatura]++;
    for (const o of s?.objecoes || []) {
      const k = String(o?.objecao || "").trim().toLowerCase().slice(0, 80);
      if (!k) continue;
      const e = objMap.get(k) || { objecao: o.objecao, total: 0, abertas: 0, tratadas: [] };
      e.total++;
      if (!o.resolvida) e.abertas++;
      if (o.resolvida && o.comoFoiTratada && e.tratadas.length < 2) e.tratadas.push(o.comoFoiTratada);
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
  const objs = [...objMap.values()].sort((a, b) => b.total - a.total).slice(0, 12);
  const dores = [...doresMap.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  const lines = [
    `Calls analisadas: ${(summaries || []).length} (temperatura: ${temp.quente} quentes, ${temp.morno} mornas, ${temp.frio} frias).`,
    "",
    "Objeções mais frequentes (vezes que apareceram · quantas ficaram em aberto · como foram tratadas quando resolvidas):",
    ...objs.map((o) => `• ${o.objecao} · ${o.total}x, ${o.abertas} em aberto${o.tratadas.length ? `; tratada com: ${o.tratadas.join(" / ")}` : ""}`),
    "",
    "Dores que mais aparecem nas calls:",
    ...dores.map((d) => `• ${d.dor} · ${d.total}x`),
  ];
  return lines.join("\n");
}

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

export function registerPitchRoutes(app, repo, { anthropic } = {}) {
  // Painel de Análise de pitch: estatísticas agregadas das calls resumidas do
  // produto + as calls recentes (com nome do lead). Read-only; alimenta a tela.
  app.get("/api/pitch/:saas/calls", async (req) => {
    const saas = req.params.saas;
    // Filtro por closer: ausente = TODOS; presente (mesmo "") = só as calls
    // daquele closer ("" = calls sem closer atribuído).
    const closerFilter = req.query.closer != null ? String(req.query.closer) : null;
    const all = (await repo.list("activities"))
      .filter((a) => a && a.saas === saas && a.meta?.event === "call_summary" && a.meta?.summary && a.meta?.kind !== "integracao")
      .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));
    // Uma linha por CALL: re-resumo (mesma call) não conta duas vezes. Dedup pelo
    // meetEventId (senão pelo lead), mantendo o resumo mais recente (já ordenado).
    const seen = new Set();
    const acts = [];
    for (const a of all) {
      const key = a.meta?.meetEventId || a.lead || a.id;
      if (seen.has(key)) continue;
      seen.add(key);
      acts.push(a);
    }
    // Closer responsável pela call = closer do lead (o call_summary é gravado por
    // "cockpit", não guarda quem conduziu; o campo do lead é o melhor sinal).
    const leadsById = new Map((await repo.list("leads")).map((l) => [l.id, l]));
    const closerOf = (a) => leadsById.get(a.lead)?.closer || "";
    // Lista de closers com contagem, sobre TODAS as calls (pré-filtro) — alimenta
    // o seletor e não muda quando um closer é selecionado.
    const cmap = new Map();
    for (const a of acts) { const c = closerOf(a); cmap.set(c, (cmap.get(c) || 0) + 1); }
    const closers = [...cmap.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
    const scoped = closerFilter == null ? acts : acts.filter((a) => closerOf(a) === closerFilter);
    const agg = aggregateCalls(scoped.map((a) => a.meta.summary));
    const recent = scoped.slice(0, 25).map((a) => ({
      leadId: a.lead,
      leadName: leadsById.get(a.lead)?.name || "",
      stage: leadsById.get(a.lead)?.stage || "",
      closer: closerOf(a),
      at: a.at || "",
      temperatura: a.meta.summary.temperatura || "",
      resumo: a.meta.summary.resumo || "",
      recordingUrl: a.meta.recordingUrl || "",
    }));
    return { ...agg, recent, closers, closer: closerFilter, aiConfigured: !!anthropic?.configured() };
  });

  app.post("/api/pitch/:saas/improve", async (req, reply) => {
    if (!anthropic?.configured()) return reply.code(503).send({ error: "IA não configurada (OPENROUTER_API_KEY ou ANTHROPIC_API_KEY)" });
    const saas = req.params.saas;
    const product = await repo.get("products", saas);
    if (!product) return reply.code(404).send({ error: "Produto não encontrado" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const currentScript = body.currentScript && typeof body.currentScript === "object" ? body.currentScript : {};
    const scriptLabel = String(body.scriptLabel || body.scriptKey || "roteiro");
    const closerFilter = body.closer != null ? String(body.closer) : null; // null = todos os closers

    // Resumos de call do produto, mais recentes primeiro. Quando um closer é
    // escolhido, o diagnóstico olha só as calls dele (mesma atribuição do painel).
    let acts = (await repo.list("activities"))
      .filter((a) => a && a.saas === saas && a.meta?.event === "call_summary" && a.meta?.summary && a.meta?.kind !== "integracao")
      .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));
    if (closerFilter != null) {
      const leadsById = new Map((await repo.list("leads")).map((l) => [l.id, l]));
      acts = acts.filter((a) => (leadsById.get(a.lead)?.closer || "") === closerFilter);
    }
    acts = acts.slice(0, 60);
    if (!acts.length) return reply.code(422).send({ error: closerFilter != null ? "Esse closer ainda não tem calls resumidas por IA pra analisar." : "Ainda não há calls resumidas por IA neste produto pra analisar." });

    const digest = buildCallsDigest(acts.map((a) => a.meta.summary));
    try {
      const { suggestion } = await anthropic.improvePitch({
        productName: product.name || saas,
        scriptLabel,
        currentScript,
        calls: digest,
      });
      return { ...suggestion, base: acts.length };
    } catch (err) {
      req.log?.warn?.({ err }, "improve-pitch falhou");
      return reply.code(502).send({ error: String(err?.message || err).slice(0, 300) });
    }
  });
}
