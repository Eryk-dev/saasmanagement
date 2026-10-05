// Captura de stories do Instagram de hora em hora (a Graph só entrega story
// vivo). Alimenta o "Stories" da Análise de Desempenho.

import { social as defaultSocial } from "./social.js";
import { syncStories } from "./social-stories.js";

// Id do Instagram do produto: `metaIgUser` é o campo que a descoberta do
// marketing grava; `metaIgUserId` foi o nome antigo desta tela.
export const igIdOf = (p) => String(p?.metaIgUser || p?.metaIgUserId || "");

// Captura de stories de hora em hora: a Graph só entrega o story ENQUANTO
// vive (24h). A captura já roda quando alguém abre Redes sociais/Desempenho;
// este tick cobre a noite e o fim de semana pra o "Stories" da Análise não
// perder o que ninguém abriu. No-op sem META_ACCESS_TOKEN. Throttle de 10 min
// dentro do syncStories, então abrir a tela no meio não duplica.
export function startStoriesCapture(repo, { social = defaultSocial, log, intervalMs = 60 * 60 * 1000 } = {}) {
  if (!social?.configured?.()) {
    log?.info?.("stories capture: sem META_ACCESS_TOKEN — desligado");
    return null;
  }
  async function tick() {
    let captured = 0;
    for (const p of await repo.list("products")) {
      const igUserId = igIdOf(p);
      if (!igUserId) continue;
      try {
        const r = await syncStories(repo, social, { saas: p.id, igUserId });
        captured += r?.captured || 0;
      } catch (e) { log?.warn?.(`stories capture (${p.id}): ${e.message}`); }
    }
    return captured;
  }
  const timer = setInterval(() => tick().catch((e) => log?.warn?.(`stories capture: ${e.message}`)), intervalMs);
  timer.unref?.();
  const first = setTimeout(() => tick().catch((e) => log?.warn?.(`stories capture: ${e.message}`)), 30_000);
  first.unref?.();
  return { tick, stop: () => { clearInterval(timer); clearTimeout(first); } };
}
