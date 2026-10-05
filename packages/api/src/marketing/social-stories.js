// Stories do Instagram no cockpit — captura e histórico.
//
// A Graph só expõe as métricas de um story ENQUANTO ele vive (24h); depois o
// insight some. Então a captura roda quando a tela abre (com throttle) e cada
// passada ATUALIZA o snapshot do story vivo — as métricas crescem ao longo das
// 24h e a última leitura vira o registro definitivo na collection
// `social_stories` (id = id da mídia na Graph, idempotente).
//
// Limite conhecido: story postado e expirado sem ninguém abrir o cockpit no
// meio fica sem métrica (a Graph não devolve mais). Com o time abrindo a tela
// todo dia útil, na prática captura tudo.

const SYNC_MIN_MS = 10 * 60_000; // captura no máximo 1×/10min por produto
const lastSync = new Map();

export async function syncStories(repo, social, { saas, igUserId, force = false } = {}) {
  if (!igUserId) return { skipped: true, errors: {} };
  const now = Date.now();
  if (!force && now - (lastSync.get(saas) || 0) < SYNC_MIN_MS) return { skipped: true, errors: {} };
  lastSync.set(saas, now);

  const errors = {};
  let captured = 0;
  try {
    const live = await social.igStories(igUserId);
    for (const s of live) {
      const prev = await repo.get("social_stories", s.id);
      const row = {
        id: s.id, saas,
        at: s.at || prev?.at || new Date().toISOString(),
        caption: s.caption || prev?.caption || "",
        type: s.type || prev?.type || "",
        permalink: s.permalink || prev?.permalink || "",
        // Métrica nova sobrescreve; null preserva a última leitura boa.
        reach: s.reach ?? prev?.reach ?? null,
        views: s.views ?? prev?.views ?? null,
        replies: s.replies ?? prev?.replies ?? null,
        shares: s.shares ?? prev?.shares ?? null,
        totalInteractions: s.totalInteractions ?? prev?.totalInteractions ?? null,
        profileVisits: s.profileVisits ?? prev?.profileVisits ?? null,
        follows: s.follows ?? prev?.follows ?? null,
        navForward: s.navForward ?? prev?.navForward ?? null,
        navBack: s.navBack ?? prev?.navBack ?? null,
        navExit: s.navExit ?? prev?.navExit ?? null,
        navNext: s.navNext ?? prev?.navNext ?? null,
        updatedAt: new Date().toISOString(),
      };
      if (prev) await repo.update("social_stories", s.id, row);
      else await repo.create("social_stories", { ...row, createdAt: new Date().toISOString() });
      captured++;
    }
  } catch (e) { errors.stories = e.message; }
  return { skipped: false, captured, errors };
}

export function invalidateStoriesSync(saas) { lastSync.delete(saas); }

// Histórico pro card da tela: mais novos primeiro.
export async function listStories(repo, { saas, limit = 12 } = {}) {
  const all = (await repo.list("social_stories")).filter((s) => !saas || s.saas === saas);
  return all.sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, limit);
}
