// Migrações idempotentes de boot — rodam uma vez por inicialização, depois de
// initDb()/ensureDefaultAdmins(). Cada uma DEVE ser segura pra rodar repetidas
// vezes (todo deploy reinicia o container) e nunca deve corromper dados que já
// existem: na dúvida sobre o estado, não mexe.

// Garante o estágio "Integração" no funil do produto `leverads`, posicionado
// entre "Negociação" e "Ganho". Integração é pós-venda: negócio já fechado,
// agenda-se a call de setup (campo `integrationAt` no card) antes de marcar Ganho.
//
// Idempotente: se "Integração" já está no funil, não faz nada. Defensiva: se o
// produto/funil não existir ou não tiver as âncoras esperadas, sai sem alterar.
export async function ensureIntegrationStage(repo) {
  const product = await repo.get("products", "leverads");
  if (!product || !Array.isArray(product.funnel) || product.funnel.length === 0) return false;

  const funnel = product.funnel;
  const existing = funnel.find((f) => f && f.stage === "Integração");
  if (existing) {
    // Reparo idempotente: a 1ª versão inseriu staleDays=0, que marca TODO card como
    // parado (dias na coluna ≥ 0). Normaliza pra "" (sem limiar). Só age se precisar.
    if (existing.staleDays === 0) {
      const next = funnel.map((f) => (f === existing ? { ...f, staleDays: "" } : f));
      await repo.update("products", "leverads", { funnel: next });
      return true;
    }
    return false; // já existe e está ok
  }

  // Âncora: imediatamente ANTES de "Ganho"; fallback logo APÓS "Negociação".
  let idx = funnel.findIndex((f) => f && f.stage === "Ganho");
  if (idx === -1) {
    const neg = funnel.findIndex((f) => f && f.stage === "Negociação");
    if (neg === -1) return false; // funil inesperado — não mexe
    idx = neg + 1;
  }

  // Mesmo shape que a tela Settings persiste. conv=1 porque é etapa administrativa
  // pós-ganho (não é gargalo de conversão); staleDays "" = sem marcação de parado.
  const stage = { stage: "Integração", conv: 1, color: "", staleDays: "" };
  const next = [...funnel.slice(0, idx), stage, ...funnel.slice(idx)];
  await repo.update("products", "leverads", { funnel: next });
  return true;
}

// Orquestrador chamado no boot. Cada migração é isolada num try/catch pra que
// uma falha não derrube o start da API.
export async function runStartupMigrations(repo) {
  try {
    const changed = await ensureIntegrationStage(repo);
    if (changed) console.log('[migration] estágio "Integração" garantido no funil do leverads');
  } catch (err) {
    console.error("[migration] ensureIntegrationStage falhou:", err?.message || err);
  }
}
