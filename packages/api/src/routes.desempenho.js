// Análise de Desempenho — o que o placar por pessoa (/api/scoreboard) NÃO tem
// e a revisão de fim de dia precisa (Leo, 10/09/2026):
//   • objeções e temperatura das calls de cada closer NA JANELA (os resumos
//     por IA, agregados com a mesma régua da Análise de pitch);
//   • produção do social (feed/stories) lida do Instagram da conta;
//   • os registros MANUAIS do dia (social selling da SDR, criativos do social
//     media), collection `daily_logs`, 1 doc por pessoa por dia.
// Os números de funil/venda por pessoa seguem no scoreboard: a tela lê os dois
// e casa por `user`. Regra de métrica nova nasce no metrics-core.

import { dayKey, rangeFromQuery } from "./metrics-core.js";
import { aggregateCalls, dedupCallSummaries, isSalesCallSummary } from "./routes.pitch.js";
import { syncStories } from "./social-stories.js";
import { social as defaultSocial } from "./social.js";

export const LOG_FIELDS = ["socialSelling", "creatives"];
export const logId = (saas, user, day) => `dl_${saas}_${user}_${day}`;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isAdmin = (u) => !u || (u.roles || []).includes("admin"); // sem sessão = key mestre
// Id do Instagram do produto: `metaIgUser` é o campo que a descoberta do
// marketing grava; `metaIgUserId` foi o nome antigo desta tela.
const igIdOf = (p) => String(p?.metaIgUser || p?.metaIgUserId || "");

// Formatos do Instagram que contam como "conteúdo no feed": foto, carrossel e
// reel (VIDEO). Story vem por outro caminho (social_stories).
const FEED_TYPES = new Set(["IMAGE", "CAROUSEL_ALBUM", "VIDEO"]);

export function registerDesempenhoRoutes(app, repo, { social = defaultSocial, now = () => new Date() } = {}) {
  app.get("/api/desempenho/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { since, until } = rangeFromQuery(req.query || {});
    const inWin = (iso) => iso && dayKey(iso) >= since && dayKey(iso) <= until;
    const me = req.authUser || null;
    const admin = isAdmin(me);
    // Lente individual (mesmo espírito do #468): sem etiqueta admin, a pessoa
    // só recebe o próprio recorte.
    const visible = (uid) => admin || uid === me?.id;

    const [leads, acts, users, logsAll] = await Promise.all([
      repo.list("leads"), repo.list("activities"), repo.list("users").catch(() => []), repo.list("daily_logs").catch(() => []),
    ]);
    const leadById = new Map(leads.filter((l) => l.saas === product.id).map((l) => [l.id, l]));

    // ── Objeções por closer (resumos de call da JANELA) ──────────────────────
    // Responsável = closer do lead, senão o dono (o call_summary é gravado por
    // "cockpit" e não guarda quem conduziu) — a mesma inferência da Análise de
    // pitch. Dedup por call (re-resumo não conta duas vezes).
    const summaries = dedupCallSummaries(acts.filter((a) => isSalesCallSummary(a, product.id) && inWin(a.at)));
    const byResp = new Map();
    for (const a of summaries) {
      const l = leadById.get(a.lead);
      const uid = l?.closer || l?.owner || "";
      if (!uid) continue;
      if (!byResp.has(uid)) byResp.set(uid, []);
      byResp.get(uid).push(a);
    }
    const objections = {};
    for (const [uid, list] of byResp) {
      if (!visible(uid)) continue;
      const agg = aggregateCalls(list.map((a) => a.meta.summary));
      objections[uid] = {
        ...agg,
        recent: list.slice(0, 8).map((a) => ({
          leadId: a.lead,
          leadName: leadById.get(a.lead)?.name || "",
          at: a.at || "",
          temperatura: a.meta.summary.temperatura || "",
          resumo: String(a.meta.summary.resumo || "").slice(0, 400),
          objecoes: (a.meta.summary.objecoes || []).map((o) => ({ objecao: o.objecao, resolvida: !!o.resolvida })),
        })),
      };
    }

    // ── Registros manuais do dia (social selling / criativos) ─────────────────
    const logs = {};
    for (const d of logsAll) {
      if (d.saas !== product.id || !d.user || !isDay(d.day) || d.day < since || d.day > until) continue;
      if (!visible(d.user)) continue;
      const e = logs[d.user] || { socialSelling: 0, creatives: 0, days: {} };
      const row = { socialSelling: Math.max(0, Number(d.socialSelling) || 0), creatives: Math.max(0, Number(d.creatives) || 0), note: String(d.note || "") };
      e.socialSelling += row.socialSelling;
      e.creatives += row.creatives;
      e.days[d.day] = row;
      logs[d.user] = e;
    }

    // ── Produção do social (a conta é uma só) ─────────────────────────────────
    const out = { feed: null, posts: 0, reels: 0, stories: null, items: [], storyItems: [], errors: {}, configured: !!social?.configured?.() };
    const igUserId = igIdOf(product);
    if (out.configured && igUserId) {
      try {
        const media = await social.igMedia(igUserId, { limit: 50 });
        const inside = (media || []).filter((m) => FEED_TYPES.has(m.type) && inWin(m.at));
        out.posts = inside.filter((m) => m.type !== "VIDEO").length;
        out.reels = inside.filter((m) => m.type === "VIDEO").length;
        out.feed = inside.length;
        out.items = inside.slice(0, 30).map((m) => ({ id: m.id, at: m.at, type: m.type, permalink: m.permalink || "", caption: String(m.caption || "").split("\n")[0].slice(0, 90) }));
      } catch (e) { out.errors.feed = e.message; }
      try {
        const r = await syncStories(repo, social, { saas: product.id, igUserId });
        Object.assign(out.errors, r?.errors || {});
      } catch (e) { out.errors.stories = e.message; }
    } else if (out.configured) {
      out.errors.setup = "sem Instagram no produto: configure metaIgUser em Ajustes ou abra a tela Redes sociais pra descoberta";
    }
    // O histórico de stories sai do banco mesmo com a captura falhando.
    const stories = (await repo.list("social_stories").catch(() => [])).filter((s) => s.saas === product.id && inWin(s.at));
    out.stories = stories.length;
    out.storyItems = stories.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30).map((s) => ({ id: s.id, at: s.at, type: s.type || "", permalink: s.permalink || "", caption: String(s.caption || "").slice(0, 90) }));

    const social_ = users.filter((u) => (!u.saas || u.saas === product.id) && (u.roles || []).includes("social")).map((u) => u.id);
    return { saas: product.id, since, until, me: me?.id || "", admin, objections, logs, social: out, socialUsers: social_ };
  });

  // Registro do dia: +1 social selling (SDR, no Meu dia) / criativos feitos
  // (social media, na tela Redes sociais) / ajuste do admin na Análise. Upsert
  // idempotente por pessoa+dia; `inc` soma, valor absoluto substitui; nunca
  // negativo. Quem não é admin só grava o próprio.
  app.post("/api/desempenho/:saas/log", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const body = req.body || {};
    const me = req.authUser || null;
    const user = String(body.user || me?.id || "");
    if (!user) return reply.code(400).send({ error: "user obrigatório" });
    if (!isAdmin(me) && user !== me.id) return reply.code(403).send({ error: "só o admin registra pelos outros" });
    const day = String(body.day || dayKey(now()));
    if (!isDay(day)) return reply.code(400).send({ error: "day inválido (YYYY-MM-DD)" });
    const id = logId(product.id, user, day);
    const cur = (await repo.get("daily_logs", id)) || null;
    const next = { id, saas: product.id, user, day, note: cur?.note || "" };
    for (const f of LOG_FIELDS) {
      let v = Number(cur?.[f]) || 0;
      if (body[f] != null && body[f] !== "") v = Number(body[f]) || 0;
      if (body.inc && body.inc[f] != null) v += Number(body.inc[f]) || 0;
      next[f] = Math.max(0, Math.round(v));
    }
    if (typeof body.note === "string") next.note = body.note.slice(0, 500);
    next.updatedAt = now().toISOString();
    const saved = cur ? await repo.update("daily_logs", id, next) : await repo.create("daily_logs", { ...next, createdAt: next.updatedAt });
    return saved;
  });
}

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
