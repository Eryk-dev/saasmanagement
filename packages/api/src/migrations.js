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
  if (funnel.some((f) => f && f.stage === "Integração")) return false; // já existe

  // Âncora: imediatamente ANTES de "Ganho"; fallback logo APÓS "Negociação".
  let idx = funnel.findIndex((f) => f && f.stage === "Ganho");
  if (idx === -1) {
    const neg = funnel.findIndex((f) => f && f.stage === "Negociação");
    if (neg === -1) return false; // funil inesperado — não mexe
    idx = neg + 1;
  }

  // Mesmo shape que a tela Settings persiste pra um estágio. conv=1 porque é
  // etapa administrativa pós-ganho (não é um gargalo de conversão de venda).
  const stage = { stage: "Integração", conv: 1, color: "", staleDays: 0 };
  const next = [...funnel.slice(0, idx), stage, ...funnel.slice(idx)];
  await repo.update("products", "leverads", { funnel: next });
  return true;
}

// Orquestrador chamado no boot. Cada migração é isolada num try/catch pra que
// uma falha não derrube o start da API.
export async function runStartupMigrations(repo) {
  try {
    const inserted = await ensureIntegrationStage(repo);
    if (inserted) console.log('[migration] estágio "Integração" inserido no funil do leverads');
  } catch (err) {
    console.error("[migration] ensureIntegrationStage falhou:", err?.message || err);
  }
}
