// Motor da cadência por etapa: move o lead pra coluna do dia em que ele está.
//
// Poller de fundo, mesmo padrão do drip-runner. Invariante, não evento: cada
// passada garante o estado CERTO do momento, então perder um ciclo (deploy,
// container reiniciado, fim de semana) não deixa lead preso — a passada
// seguinte coloca ele na coluna correta de uma vez, mesmo que pule colunas.
//
// Só toca lead que está numa etapa da cadência. Quem respondeu e foi pra
// Qualificando, quem marcou call, quem fechou ou foi descartado nunca é movido
// pelo relógio — ali o dono do movimento é a pessoa.

import { etapaAlvo, estaNaCadencia, ETAPA_NUTRICAO, CADENCIA_FLAG } from "./cadencia-stages.js";
import { applyStageMove } from "./lead-flow.js";

export function makeCadenciaRunner({ repo, log = console }) {
  async function tick(now = Date.now()) {
    const cfg = await repo.get("app_config", CADENCIA_FLAG);
    if (cfg?.enabled !== true) return { movidos: 0, desligado: true };

    const produtos = await repo.list("products");
    const funis = new Map(produtos.map((p) => [p.id, (p.funnel || []).map((f) => f.stage)]));

    const leads = await repo.list("leads");
    let movidos = 0;

    for (const lead of leads) {
      if (!estaNaCadencia(lead.stage)) continue;
      const etapas = funis.get(lead.saas);
      if (!etapas || !etapas.length) continue;

      const alvo = etapaAlvo(lead, now, { temNutricao: etapas.includes(ETAPA_NUTRICAO) });
      if (!alvo || alvo === lead.stage) continue;
      // Etapa que o funil daquele produto não tem: não inventa coluna.
      if (!etapas.includes(alvo)) continue;

      try {
        // applyStageMove busca o produto sozinho; passar outro só criaria uma
        // segunda fonte de verdade pro kind da etapa de destino.
        const patch = await applyStageMove(repo, {
          lead, toStage: alvo, author: "system", now: new Date(now),
        });
        await repo.update("leads", lead.id, { ...patch, stage: alvo });
        movidos += 1;
      } catch (err) {
        // Um lead problemático não pode parar a fila inteira.
        log.warn?.({ err: err?.message, lead: lead.id }, "cadência: falha ao mover lead");
      }
    }
    return { movidos, desligado: false };
  }
  return { tick };
}

// De hora em hora: a granularidade da cadência é o DIA, então passada de hora
// em hora já coloca todo mundo na coluna certa com folga, sem varrer a base
// toda a cada minuto.
export function startCadencia(repo, { intervalMs = 3_600_000, log = console } = {}) {
  const worker = makeCadenciaRunner({ repo, log });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await worker.tick();
      if (r.movidos) log.info?.(`[cadência] ${r.movidos} lead(s) movido(s) pra coluna do dia`);
    } catch (err) { log.warn?.({ err: err.message }, "poller da cadência falhou"); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 25_000).unref?.(); // primeiro passe pouco depois do boot
  return { stop: () => clearInterval(timer), run };
}
