// Comentários de Instagram e página do Facebook no cockpit — o modelo por trás
// da aba "Comentários" da tela de Redes sociais.
//
// Uma collection só (`social_comments`), com o registro já NORMALIZADO entre as
// duas redes: { id, saas, network, postId, postTitle, permalink, author, text,
// at, parentId, ours, hidden, done, replyOf }. O id é o id do comentário na
// Graph, então tudo aqui é idempotente por natureza — o webhook re-entrega o
// mesmo comentário sem duplicar.
//
// Duas fontes escrevem aqui:
//  - WEBHOOK (routes.social.js): comentário novo cai na hora, com o mínimo que
//    a Meta manda. É o que faz a tela acender sozinha.
//  - SYNC (syncComments): varre os posts recentes e reconcilia o estado real
//    (respostas, ocultos, comentários que chegaram enquanto o webhook estava
//    fora do ar). Roda com throttle — ver SYNC_MIN_MS.
//
// "Pendente" = comentário de OUTRA pessoa, não oculto, sem resposta nossa
// abaixo dele e não marcado como resolvido à mão. É a fila de trabalho da tela.

const SYNC_MIN_MS = 60_000; // varredura completa no máximo 1×/min por produto
const lastSync = new Map(); // saas → timestamp da última varredura

export const firstLine = (s) => String(s || "").split("\n")[0].trim();

// Título curto do post pro card do comentário (a legenda inteira não cabe).
export function postTitleOf(caption, fallback = "") {
  const line = firstLine(caption);
  if (!line) return fallback;
  return line.length > 70 ? line.slice(0, 70) + "…" : line;
}

// Grava/atualiza um comentário. PRESERVA o que já sabíamos: o webhook manda
// menos campos que o sync (não traz post nem oculto), então um `undefined` ou
// string vazia vinda dele nunca pode apagar o que a varredura preencheu.
export async function upsertComment(repo, c) {
  const id = String(c.id || "");
  if (!id) return null;
  const prev = await repo.get("social_comments", id);
  const keep = (next, old) => (next === undefined || next === null || next === "" ? (old ?? "") : next);
  const row = {
    id,
    saas: keep(c.saas, prev?.saas),
    network: keep(c.network, prev?.network),
    postId: keep(c.postId, prev?.postId),
    postTitle: keep(c.postTitle, prev?.postTitle),
    permalink: keep(c.permalink, prev?.permalink),
    author: keep(c.author, prev?.author),
    authorId: keep(c.authorId, prev?.authorId),
    text: keep(c.text, prev?.text),
    at: keep(c.at, prev?.at) || new Date().toISOString(),
    parentId: keep(c.parentId, prev?.parentId),
    // Flags booleanas: só sobrescrevem quando vieram de verdade.
    ours: c.ours === undefined ? (prev?.ours ?? false) : !!c.ours,
    hidden: c.hidden === undefined ? (prev?.hidden ?? false) : !!c.hidden,
    done: c.done === undefined ? (prev?.done ?? false) : !!c.done,
    // Rastro de quem respondeu pelo cockpit (o autor da resposta, não da Meta).
    replyBy: keep(c.replyBy, prev?.replyBy),
    repliedAt: keep(c.repliedAt, prev?.repliedAt),
    source: keep(c.source, prev?.source),
  };
  if (prev) await repo.update("social_comments", id, row);
  else await repo.create("social_comments", { ...row, createdAt: new Date().toISOString() });
  return row;
}

// Varre os posts recentes das duas redes e reconcilia a collection.
// `force` ignora o throttle (botão "atualizar" da tela). Devolve o que rodou
// pra tela poder dizer "não deu pra ler o Facebook" sem sumir com o resto.
export async function syncComments(repo, social, { saas, igUserId, pageId, igUsername = "", posts = [], force = false, limit = 8 } = {}) {
  const now = Date.now();
  const last = lastSync.get(saas) || 0;
  if (!force && now - last < SYNC_MIN_MS) return { skipped: true, errors: {} };
  lastSync.set(saas, now);

  const errors = {};
  let found = 0;

  // ── Instagram ──────────────────────────────────────────────────────────────
  // Varre só os posts recentes: comentário em post velho é raro e cada post é
  // uma chamada à Graph.
  if (igUserId) {
    const recent = posts.slice(0, limit);
    await Promise.all(recent.map(async (p) => {
      try {
        const list = await social.igComments(p.id, { limit: 50 });
        for (const c of list) {
          await upsertComment(repo, {
            ...c, saas, network: "instagram",
            postId: p.id, postTitle: postTitleOf(p.caption, "Publicação sem legenda"), permalink: p.permalink || "",
            // A própria conta comentando = resposta nossa. É assim que o
            // "pendente" some quando alguém respondeu pelo app do Instagram.
            ours: !!igUsername && String(c.author || "").toLowerCase() === String(igUsername).toLowerCase(),
            source: "sync",
          });
          found++;
        }
      } catch (e) { errors.instagram = e.message; }
    }));
  }

  // ── Página do Facebook ─────────────────────────────────────────────────────
  // O token da página é buscado UMA vez e reusado em todas as chamadas (cada
  // pageToken() é um round-trip a mais na Graph).
  if (pageId) {
    try {
      const token = await social.pageToken(pageId);
      const fbPosts = await social.fbPosts(pageId, { limit, token });
      await Promise.all(fbPosts.map(async (p) => {
        try {
          const list = await social.fbComments(p.id, { limit: 50, token });
          for (const c of list) {
            await upsertComment(repo, {
              ...c, saas, network: "facebook",
              postId: p.id, postTitle: postTitleOf(p.caption, "Publicação sem texto"), permalink: p.permalink || "",
              // Na página, "nosso" é o comentário assinado pela PRÓPRIA página.
              ours: String(c.authorId || "") === String(pageId),
              source: "sync",
            });
            found++;
          }
        } catch (e) { errors.facebook = e.message; }
      }));
    } catch (e) { errors.facebook = e.message; }
  }

  return { skipped: false, found, errors };
}

// Marca a última varredura como vencida — depois de responder, a próxima
// abertura da tela relê o estado real em vez de esperar o minuto do throttle.
export function invalidateSync(saas) { lastSync.delete(saas); }

// Lista os comentários do produto, já com o estado derivado.
// status: "pending" (fila de trabalho) | "answered" | "all".
export async function listComments(repo, { saas, status = "pending", limit = 200 } = {}) {
  const all = (await repo.list("social_comments")).filter((c) => !saas || c.saas === saas);

  // Respostas nossas indexadas pelo comentário que elas respondem — é o que
  // decide se algo ainda está pendente.
  const oursByParent = new Map();
  for (const c of all) {
    if (!c.ours || !c.parentId) continue;
    const cur = oursByParent.get(c.parentId);
    if (!cur || String(c.at || "") > String(cur.at || "")) oursByParent.set(c.parentId, c);
  }

  const rows = all
    // O feed mostra os comentários DELES; nossas respostas aparecem aninhadas.
    .filter((c) => !c.ours)
    .map((c) => {
      const reply = oursByParent.get(c.id) || null;
      const answered = !!reply || !!c.repliedAt;
      return {
        ...c,
        answered,
        pending: !answered && !c.done && !c.hidden,
        reply: reply ? { id: reply.id, text: reply.text, at: reply.at, author: reply.author } : null,
        // Horas esperando — a tela ordena a fila por isso (mais velho primeiro).
        waitingHours: answered || c.done ? null
          : Math.max(0, Math.round(((Date.now() - new Date(c.at || Date.now()).getTime()) / 3_600_000) * 10) / 10),
      };
    });

  const filtered = status === "all" ? rows
    : status === "answered" ? rows.filter((c) => c.answered)
      : rows.filter((c) => c.pending);

  // Pendentes: o que espera há mais tempo primeiro (é o que corre risco de
  // virar cliente perdido). Resto: mais recente primeiro.
  filtered.sort((a, b) => (status === "pending"
    ? String(a.at || "").localeCompare(String(b.at || ""))
    : String(b.at || "").localeCompare(String(a.at || ""))));

  return filtered.slice(0, limit);
}

// Números do topo da aba: fila, tempo de espera e ritmo de resposta.
export async function commentInsights(repo, { saas, days = 30 } = {}) {
  const all = (await repo.list("social_comments")).filter((c) => !saas || c.saas === saas);
  const since = Date.now() - Math.max(1, days) * 86_400_000;
  const rows = await listComments(repo, { saas, status: "all", limit: 10_000 });
  const period = rows.filter((c) => new Date(c.at || 0).getTime() >= since);
  const pending = rows.filter((c) => c.pending);

  // Tempo de resposta: do comentário até a nossa resposta. Mediana, não média —
  // um comentário esquecido no fim de semana distorce a média (mesmo motivo do
  // waInsights do WhatsApp).
  const times = [];
  for (const c of period) {
    if (!c.reply?.at) continue;
    const ms = new Date(c.reply.at).getTime() - new Date(c.at || 0).getTime();
    if (ms > 0) times.push(ms);
  }
  times.sort((a, b) => a - b);
  const median = times.length
    ? (times.length % 2 ? times[(times.length - 1) / 2]
      : Math.round((times[times.length / 2 - 1] + times[times.length / 2]) / 2))
    : null;

  const oldest = pending.reduce((acc, c) => Math.max(acc, c.waitingHours || 0), 0);
  return {
    days,
    total: all.length,
    inPeriod: period.length,
    pending: pending.length,
    answered: period.filter((c) => c.answered).length,
    hidden: rows.filter((c) => c.hidden).length,
    oldestPendingHours: pending.length ? oldest : null,
    medianReplyMinutes: median == null ? null : Math.round(median / 60_000),
    replySample: times.length,
    answeredRate: period.length ? Math.round((period.filter((c) => c.answered).length / period.length) * 100) : null,
  };
}
