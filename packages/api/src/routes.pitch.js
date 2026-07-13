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

export function registerPitchRoutes(app, repo, { anthropic } = {}) {
  app.post("/api/pitch/:saas/improve", async (req, reply) => {
    if (!anthropic?.configured()) return reply.code(503).send({ error: "IA não configurada (OPENROUTER_API_KEY ou ANTHROPIC_API_KEY)" });
    const saas = req.params.saas;
    const product = await repo.get("products", saas);
    if (!product) return reply.code(404).send({ error: "Produto não encontrado" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const currentScript = body.currentScript && typeof body.currentScript === "object" ? body.currentScript : {};
    const scriptLabel = String(body.scriptLabel || body.scriptKey || "roteiro");

    // Resumos de call do produto, mais recentes primeiro (janela de 60).
    const acts = (await repo.list("activities"))
      .filter((a) => a && a.saas === saas && a.meta?.event === "call_summary" && a.meta?.summary)
      .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))
      .slice(0, 60);
    if (!acts.length) return reply.code(422).send({ error: "Ainda não há calls resumidas por IA neste produto pra analisar." });

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
