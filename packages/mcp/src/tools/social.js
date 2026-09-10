// Redes sociais (Instagram/Facebook ORGÂNICO) — a tela "Redes sociais" inteira.
//
// O lado pago mora em ads.js; aqui é o perfil: alcance de seguidor × não
// seguidor, ganho e perda de seguidores, engajamento por post e por formato,
// stories (que só têm métrica enquanto vivem), audiência, radar de concorrentes,
// a fila de comentários e as DMs.
//
// Duas ressalvas de forma que mandam no desenho das tools:
//  1. /api/social/summary só serve janela de 7, 30 ou 90 dias TERMINANDO HOJE
//     (ALLOWED_DAYS na rota). Não dá pra pedir "mês passado" nem o período
//     anterior — então o `period` do modelo é encaixado na janela mais próxima,
//     isso é dito em nota, e a comparação sai da série diária (segunda metade
//     contra a primeira), que é a única honesta que a API permite.
//  2. Tudo que fala com a Meta é fail-soft lá na API: bloco sem permissão volta
//     null e o erro vai pra `errors`. Aqui esses erros viram `notes` — sumir com
//     eles faria o relatório afirmar "zero" onde o certo é "não deu pra ler".

import { z } from "zod";
import { http } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, delta, today, shiftDay } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, round2, num } from "../core/shape.js";

const GROUP = "Redes sociais (Instagram/Facebook)";

const UNITS = {
  pctNaoSeguidores: "%", taxaEngajamento: "%", taxaEngajamentoDoPerfil: "%", engRate: "%", answeredRate: "%",
  exitRate: "%", pct: "%", share: "%",
  waitingHours: "h", oldestPendingHours: "h", medianReplyMinutes: "min",
  avgWatchMs: "ms", totalWatchMs: "ms",
  postsPerWeek: "posts/sem",
};

const COLS = {
  posts: ["at", "type", "caption", "reach", "views", "likes", "comments", "saves", "shares", "totalInteractions", "engRate", "profileVisits", "follows", "avgWatchMs", "permalink", "id"],
  publicados: ["at", "format", "kind", "networks", "caption", "instagram", "facebook", "id"],
  comentarios: ["at", "waitingHours", "network", "author", "text", "postTitle", "answered", "hidden", "done", "resposta", "permalink", "id"],
  stories: ["at", "type", "caption", "reach", "views", "replies", "shares", "totalInteractions", "profileVisits", "follows", "navForward", "navBack", "navExit", "exitRate", "permalink", "id"],
  dms: ["updatedAt", "name", "username", "unread", "snippet", "recipientId", "id"],
  mensagens: ["at", "ours", "fromName", "text", "hasAttachment", "id"],
  concorrentes: ["username", "name", "followers", "mediaCount", "avgLikes", "avgComments", "postsPerWeek", "error"],
  hashtags: ["name", "top", "medianLikes", "maxLikes", "error"],
  marcacoes: ["at", "username", "type", "likes", "comments", "permalink"],
  demografia: ["key", "value", "share"],
  paginas: ["pageId", "name", "igUsername", "igUserId", "saas"],
};

// A janela que a rota de resumo aceita. Pedido fora disso é encaixado no mais
// próximo — e a nota diz que foi encaixado, senão o relatório mente na data.
const ALLOWED_DAYS = [7, 30, 90];
const snapDays = (d) => ALLOWED_DAYS.reduce((best, a) => (Math.abs(a - d) < Math.abs(best - d) ? a : best), 30);

// A janela REALMENTE servida (N dias terminando hoje), pra o envelope declarar
// o período certo em vez do que foi pedido.
const servedPeriod = (days) => resolvePeriod({ since: shiftDay(today(), -(days - 1)), until: today() });

const pct = (parte, todo) => (todo > 0 ? round2((parte / todo) * 100) : null);
const corta = (s, n = 90) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Erros fail-soft da API ({ bloco: mensagem }) viram nota — cada bloco que
// falhou é um número ausente, não um zero.
const errosComoNotas = (errors, prefixo = "") =>
  Object.entries(errors || {}).map(([k, v]) => `${prefixo}${k}: ${v}`);

// Ranking de demografia (countries/cities/ages/genders) com participação.
function demoRows(lista = [], limit = 10) {
  const total = lista.reduce((a, x) => a + num(x.value), 0);
  return lista.slice(0, limit).map((x) => ({ key: x.key, value: num(x.value), share: pct(num(x.value), total) }));
}

const INCLUDES = ["reach", "followers", "interactions", "formats", "clicks", "series", "posts", "insights", "page"];

export function registerSocialTools(tool) {
  tool("social_report", {
    group: GROUP,
    title: "Painel de redes sociais",
    description: "Alcance seguidor vs não seguidor, saldo de seguidores, interações, engajamento por formato e tendência do perfil no Instagram/Facebook.",
    external: true,
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      include: z.array(z.enum([...INCLUDES, "all"])).optional().describe("Padrão: reach, followers, interactions, formats, insights."),
      compare: z.boolean().optional().describe("Compara a 2ª metade da janela com a 1ª (padrão true)."),
      limit: z.number().int().optional(),
    },
    hint: "sem número nenhum? confira metaIgUser/metaPageId do produto com social_pages.",
  }, async ({ saas, period, since, until, include, compare = true, limit = 30 }) => {
    const product = await resolveProduct(saas);
    const pedido = resolvePeriod({ period, since, until });
    const days = snapDays(pedido.days);
    const p = servedPeriod(days);
    const inc = new Set(include?.includes("all") ? INCLUDES : (include?.length ? include : ["reach", "followers", "interactions", "formats", "insights"]));

    const d = await http.get("/api/social/summary", { saas: product.id, days });
    const ins = d.insights || {};
    const rb = d.reachBreakdown;
    const alcanceTotal = rb ? num(rb.follower) + num(rb.nonFollower) : null;

    const totals = {
      conta: d.account?.username ? `@${d.account.username}` : null,
      seguidores: d.account?.followers_count ?? null,
      seguindo: d.account?.follows_count ?? null,
      publicacoes: d.account?.media_count ?? null,
      seguidoresGanhosLiquido: d.followerGrowth ?? null,
      seguiram: d.followsBreakdown?.follows ?? null,
      deixaramDeSeguir: d.followsBreakdown?.unfollows ?? null,
      alcance: ins.reach ?? null,
      pctNaoSeguidores: rb ? pct(num(rb.nonFollower), alcanceTotal) : null,
      visitasAoPerfil: ins.profile_views ?? null,
      contasEngajadas: ins.accounts_engaged ?? null,
      interacoes: ins.total_interactions ?? null,
      curtidas: ins.likes ?? null,
      comentarios: ins.comments ?? null,
      salvamentos: ins.saves ?? null,
      compartilhamentos: ins.shares ?? null,
      visualizacoes: ins.views ?? null,
      cliquesNoLinkDaBio: ins.profile_links_taps ?? null,
      cliquesNoSite: ins.website_clicks ?? null,
      taxaEngajamento: d.engagement?.rate ?? null,
      alcanceMedioPorPost: d.engagement?.avgReach ?? null,
    };

    const tables = {};
    if (inc.has("reach") && rb) {
      tables.alcance = {
        label: "Alcance por origem",
        columns: ["origem", "alcance", "share"],
        rows: [
          { origem: "Não seguidores", alcance: num(rb.nonFollower), share: pct(num(rb.nonFollower), alcanceTotal) },
          { origem: "Seguidores", alcance: num(rb.follower), share: pct(num(rb.follower), alcanceTotal) },
        ],
      };
    }
    if (inc.has("followers") && (d.followsBreakdown || d.followerGrowth != null)) {
      tables.seguidores = {
        label: "Seguidores no período",
        columns: ["movimento", "contas"],
        rows: [
          { movimento: "Seguiram", contas: d.followsBreakdown?.follows ?? null },
          { movimento: "Deixaram de seguir", contas: d.followsBreakdown?.unfollows ?? null },
          { movimento: "Saldo líquido", contas: d.followerGrowth ?? null },
        ],
      };
    }
    if (inc.has("interactions") && d.interactionTypes) {
      tables.interacoes = {
        label: "Interações por tipo",
        columns: ["tipo", "quantidade"],
        rows: Object.entries(d.interactionTypes).map(([tipo, quantidade]) => ({ tipo, quantidade })).sort((a, b) => b.quantidade - a.quantidade),
      };
    }
    if (inc.has("formats")) {
      if (d.formats?.length) {
        tables.formatos = { label: "Desempenho médio por formato (posts do perfil)", columns: ["label", "count", "avgReach", "avgEng"], rows: d.formats };
      }
      if (d.reachByFormat?.length) {
        const t = d.reachByFormat.reduce((a, x) => a + num(x.value), 0);
        tables.alcancePorFormato = {
          label: "Alcance oficial por formato (inclui story e anúncio)",
          columns: ["key", "value", "share"],
          rows: d.reachByFormat.map((x) => ({ ...x, share: pct(num(x.value), t) })),
        };
      }
    }
    if (inc.has("clicks") && d.linkTaps?.length) {
      tables.cliques = { label: "Cliques no perfil por botão", columns: ["key", "value"], rows: d.linkTaps };
    }
    if (inc.has("posts") && d.media?.length) {
      // a API chama o salvamento de `saved`; a coluna do relatório é `saves`.
      const s = select(d.media.map((m) => ({ ...m, saves: m.saved, caption: corta(m.caption), engRate: pct(num(m.totalInteractions), num(m.reach)) })), { sort: "totalInteractions:desc", limit });
      tables.posts = { label: "Publicações recentes do perfil", columns: COLS.posts, rows: s.rows, page: s.page };
    }
    if (inc.has("insights") && d.insightsText?.length) {
      tables.recomendacoes = { label: "Leitura do período", columns: ["tone", "text"], rows: d.insightsText };
    }
    if (inc.has("page") && d.page) {
      tables.pagina = {
        label: "Página do Facebook",
        columns: ["nome", "curtidas", "seguidores", "link"],
        rows: [{ nome: d.page.name || "", curtidas: d.page.fan_count ?? null, seguidores: d.page.followers_count ?? null, link: d.page.link || "" }],
      };
    }

    // Série diária: saldo de seguidores e alcance por dia, casados pela data.
    const serie = [];
    if (d.followerSeries || d.reachSeries) {
      const mapa = new Map();
      for (const v of d.followerSeries || []) mapa.set(v.date, { date: v.date, seguidores: num(v.value), alcance: null });
      for (const v of d.reachSeries || []) mapa.set(v.date, { ...(mapa.get(v.date) || { date: v.date, seguidores: null }), alcance: num(v.value) });
      serie.push(...[...mapa.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))));
      if (inc.has("series")) tables.serie = { label: "Série diária", columns: ["date", "seguidores", "alcance"], rows: serie };
    }

    // A única comparação possível: a API não serve janela anterior (só 7/30/90
    // terminando hoje), então o "antes" sai da primeira metade da própria série.
    if (compare && serie.length >= 4) {
      const meio = Math.floor(serie.length / 2);
      const soma = (arr, k) => round2(arr.reduce((a, x) => a + num(x[k]), 0));
      const a = serie.slice(meio), b = serie.slice(0, meio);
      tables.tendencia = {
        label: `Tendência: últimos ${a.length}d vs ${b.length}d anteriores (dentro da janela)`,
        columns: ["metrica", "atual", "anterior", "variacao", "variacao_pct"],
        rows: [["seguidores", "saldo de seguidores"], ["alcance", "alcance somado por dia"]].map(([k, rotulo]) => {
          const dd = delta(soma(a, k), soma(b, k));
          return dd && { metrica: rotulo, atual: dd.current, anterior: dd.previous, variacao: dd.abs, variacao_pct: dd.pct };
        }).filter(Boolean),
      };
    }

    const notes = errosComoNotas(d.errors, "não deu pra ler ");
    if (d.configured === false) notes.push(`Meta não configurada no servidor (${d.missing || "META_ACCESS_TOKEN"}): nenhum número orgânico existe.`);
    if (days !== pedido.days) notes.push(`a API só serve janelas de 7, 30 ou 90 dias terminando HOJE: o pedido (${pedido.since} → ${pedido.until}, ${pedido.days}d) foi atendido como ${p.since} → ${p.until} (${days}d).`);
    notes.push("alcance é único por janela; a soma dos dias da série é maior que o alcance do período (mesma pessoa alcançada em dias diferentes conta duas vezes).");
    if (d.media?.length) notes.push(`engajamento por post e por formato vem dos ${d.media.length} posts mais recentes do perfil, não da janela inteira.`);

    return result({
      kind: "social.report",
      title: `Redes sociais · ${product.name || product.id}`,
      scope: { saas: product.id, igUserId: d.igUserId || null, pageId: d.pageId || null },
      period: p,
      units: UNITS,
      totals,
      tables,
      notes,
      source: { endpoint: `GET /api/social/summary?saas=${product.id}&days=${days}` },
    });
  });

  tool("social_posts", {
    group: GROUP,
    title: "Publicações e desempenho",
    description: "Posts recentes do perfil no Instagram com alcance e interações, ou o histórico publicado pelo cockpit (source=cockpit).",
    external: true,
    input: {
      saas: z.string().optional(),
      source: z.enum(["profile", "cockpit"]).optional().describe("profile = perfil na Meta (padrão); cockpit = publicado por aqui."),
      ...periodInput(z),
      sort: z.enum(["reach", "totalInteractions", "likes", "comments", "saves", "shares", "views", "at"]).optional().describe("Do maior pro menor; 'at' = mais recente. Só em source=profile."),
      q: z.string().optional(),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, source = "profile", period, since, until, sort = "totalInteractions", q, limit = 12 }) => {
    const product = await resolveProduct(saas);

    if (source === "cockpit") {
      const p = resolvePeriod({ period, since, until });
      const all = await http.get("/api/social/posts", { saas: product.id });
      const rows = (all || [])
        .filter((x) => String(x.at || "").slice(0, 10) >= p.since && String(x.at || "").slice(0, 10) <= p.until)
        .map((x) => ({
          at: x.at, format: x.format, kind: x.kind, networks: (x.networks || []).join("+"),
          caption: corta(x.caption),
          instagram: x.results?.instagram ? (x.results.instagram.ok ? x.results.instagram.permalink || x.results.instagram.id || "ok" : `erro: ${x.results.instagram.error}`) : "",
          facebook: x.results?.facebook ? (x.results.facebook.ok ? x.results.facebook.permalink || x.results.facebook.id || "ok" : `erro: ${x.results.facebook.error}`) : "",
          id: x.id,
        }));
      const s = select(rows, { q, qFields: ["caption", "format", "kind"], sort: "at:desc", limit });
      const falhas = rows.filter((r) => String(r.instagram).startsWith("erro") || String(r.facebook).startsWith("erro")).length;
      return result({
        kind: "social.posts.cockpit",
        title: `Publicações feitas pelo cockpit · ${product.name || product.id}`,
        scope: { saas: product.id, source },
        period: p,
        totals: { publicacoes: rows.length, comFalhaEmAlgumaRede: falhas },
        columns: COLS.publicados,
        rows: s.rows,
        rowsLabel: "Publicações",
        page: s.page,
        notes: ["a API guarda só as 30 publicações mais recentes do produto — janelas antigas vêm incompletas."],
        source: { endpoint: `GET /api/social/posts?saas=${product.id}` },
      });
    }

    // Perfil: as métricas por post são do post INTEIRO (desde que foi ao ar),
    // então a janela não muda o número — pedimos a menor (7d) só pra não
    // disparar 90 dias de chamadas de insight à toa.
    const d = await http.get("/api/social/summary", { saas: product.id, days: 7 });
    // `saves` é criado ANTES do select: a API devolve o campo como `saved` e
    // sem isso ordenar por saves não ordenava nada (campo inexistente).
    const media = (d.media || []).map((m) => ({
      ...m, saves: m.saved, caption: corta(m.caption), engRate: pct(num(m.totalInteractions), num(m.reach)),
    }));
    const s = select(media, { q, qFields: ["caption", "type"], sort: sort === "at" ? "at:desc" : `${sort}:desc`, limit });
    const soma = (k) => media.reduce((a, m) => a + num(m[k]), 0);
    return result({
      kind: "social.posts",
      title: `Publicações do perfil · ${product.name || product.id}`,
      scope: { saas: product.id, source, sort },
      units: UNITS,
      totals: {
        posts: media.length,
        alcance: soma("reach"), curtidas: soma("likes"), comentarios: soma("comments"),
        salvamentos: soma("saved"), compartilhamentos: soma("shares"), interacoes: soma("totalInteractions"),
        alcanceMedio: media.length ? Math.round(soma("reach") / media.length) : null,
        taxaEngajamentoDoPerfil: d.engagement?.rate ?? null,
      },
      columns: COLS.posts,
      rows: s.rows,
      rowsLabel: "Posts",
      page: s.page,
      notes: [
        "a Meta devolve só os ~12 posts mais recentes do perfil: isto não é o histórico completo e o period não recorta esta lista.",
        "métricas por post são acumuladas desde a publicação, não da janela.",
        ...errosComoNotas(d.errors, "não deu pra ler "),
      ],
      source: { endpoint: `GET /api/social/summary?saas=${product.id}` },
    });
  });

  tool("social_comments", {
    group: GROUP,
    title: "Fila de comentários",
    description: "Comentários de Instagram e Facebook (inclusive de anúncio) com tempo de espera, tempo mediano de resposta e taxa de atendimento.",
    external: true,
    input: {
      saas: z.string().optional(),
      status: z.enum(["pending", "answered", "all"]).optional().describe("pending = fila (padrão)."),
      network: z.enum(["instagram", "facebook", "all"]).optional(),
      q: z.string().optional(),
      sort: z.enum(["espera", "recente", "antigo"]).optional().describe("espera = maior espera primeiro. Padrão: ordem da tela."),
      sync: z.boolean().optional().describe("Varre a Meta agora, ignorando o intervalo de 5 min."),
      limit: z.number().int().optional(),
    },
    hint: "comentário sem produto na fila? abra a tela Redes sociais uma vez ou rode com sync=true pra reconciliar.",
  }, async ({ saas, status = "pending", network = "all", q, sort, sync = false, limit = 30 }) => {
    const product = await resolveProduct(saas);
    const d = await http.get("/api/social/comments", { saas: product.id, status, ...(sync ? { sync: 1 } : {}) });
    const rows = (d.comments || []).map((c) => ({
      at: c.at, waitingHours: c.waitingHours, network: c.network, author: c.author,
      text: corta(c.text, 200), postTitle: c.postTitle, answered: c.answered, pending: c.pending,
      hidden: c.hidden, done: c.done,
      resposta: c.reply?.text ? corta(c.reply.text, 120) : "",
      permalink: c.permalink, id: c.id,
    }));
    const ordem = { espera: "waitingHours:desc", recente: "at:desc", antigo: "at" }[sort];
    const s = select(rows, { where: network === "all" ? undefined : { network }, q, qFields: ["author", "text", "postTitle"], sort: ordem, limit });
    const i = d.insights || {};
    return result({
      kind: "social.comments",
      title: `Comentários (${status}) · ${product.name || product.id}`,
      scope: { saas: product.id, status, network },
      units: UNITS,
      totals: {
        pendentes: i.pending ?? null,
        respondidosNoPeriodo: i.answered ?? null,
        comentariosUltimos30d: i.inPeriod ?? null,
        answeredRate: i.answeredRate ?? null,
        oldestPendingHours: i.oldestPendingHours ?? null,
        medianReplyMinutes: i.medianReplyMinutes ?? null,
        ocultos: i.hidden ?? null,
        totalArmazenado: i.total ?? null,
      },
      columns: COLS.comentarios,
      rows: s.rows,
      rowsLabel: "Comentários",
      page: s.page,
      notes: [
        ...errosComoNotas(d.errors, "varredura falhou em "),
        "a lista do banco vem limitada a 200 comentários por status, e a varredura cobre os posts recentes + os usados em anúncio.",
        i.medianReplyMinutes == null ? "sem resposta suficiente nos últimos 30d pra calcular tempo mediano." : "tempo mediano (não média): um comentário esquecido no fim de semana não distorce.",
      ],
      source: { endpoint: `GET /api/social/comments?saas=${product.id}&status=${status}` },
    });
  });

  tool("social_comment_reply", {
    group: GROUP,
    title: "Responder comentário",
    description: "Publica resposta pública ao comentário em nome da marca e tira o item da fila.",
    write: true, external: true,
    danger: "a resposta fica PÚBLICA no post, em nome da marca, na hora.",
    input: {
      comment_id: z.string(),
      text: z.string().min(1).describe("Texto público da resposta."),
    },
    hint: "erro 422 costuma ser permissão do token (instagram_manage_comments / pages_manage_engagement) ou comentário apagado na Meta.",
  }, async ({ comment_id, text }) => {
    const r = await http.post(`/api/social/comments/${encodeURIComponent(comment_id)}/reply`, { text });
    return result({
      kind: "social.comment.reply",
      title: "Resposta publicada",
      scope: { comment_id },
      totals: { ok: !!r.ok, replyId: r.replyId || null },
      detail: { texto: text },
      source: { endpoint: `POST /api/social/comments/${comment_id}/reply` },
    });
  });

  tool("social_comment_hide", {
    group: GROUP,
    title: "Ocultar / mostrar comentário",
    description: "Oculta ou mostra o comentário na Meta: some para todos menos quem escreveu; não apaga.",
    write: true, external: true,
    danger: "muda o que o público vê no post.",
    input: {
      comment_id: z.string(),
      hide: z.boolean().optional().describe("true oculta (padrão), false mostra."),
    },
  }, async ({ comment_id, hide = true }) => {
    const r = await http.post(`/api/social/comments/${encodeURIComponent(comment_id)}/hide`, { hide });
    return result({
      kind: "social.comment.hide",
      title: hide ? "Comentário ocultado" : "Comentário visível de novo",
      scope: { comment_id },
      totals: { ok: !!r.ok, hidden: !!r.hidden },
      source: { endpoint: `POST /api/social/comments/${comment_id}/hide` },
    });
  });

  tool("social_comment_done", {
    group: GROUP,
    title: "Resolver comentário sem responder",
    description: "Marca o comentário como resolvido só no cockpit; nada muda na Meta.",
    write: true,
    input: {
      comment_id: z.string(),
      done: z.boolean().optional().describe("true resolve (padrão), false devolve pra fila."),
    },
  }, async ({ comment_id, done = true }) => {
    const r = await http.post(`/api/social/comments/${encodeURIComponent(comment_id)}/done`, { done });
    return result({
      kind: "social.comment.done",
      title: done ? "Comentário resolvido" : "Comentário de volta à fila",
      scope: { comment_id },
      totals: { ok: !!r.ok, done: !!r.done },
      notes: ["estado interno do cockpit: o comentário continua igual para quem vê o post."],
      source: { endpoint: `POST /api/social/comments/${comment_id}/done` },
    });
  });

  tool("social_dms", {
    group: GROUP,
    title: "Direct e Messenger",
    description: "Conversas de Instagram Direct ou Messenger com não lidas e último trecho, ou as mensagens de uma conversa.",
    external: true,
    input: {
      saas: z.string().optional(),
      action: z.enum(["threads", "messages"]).optional().describe("Padrão threads."),
      network: z.enum(["instagram", "facebook"]).optional().describe("Padrão instagram. facebook = Messenger."),
      conversation_id: z.string().optional().describe("Obrigatório em action=messages (id de threads)."),
      q: z.string().optional(),
      limit: z.number().int().optional(),
    },
    hint: "as conversas dos dois canais moram na PÁGINA do Facebook: sem metaPageId no produto não há DM (veja social_pages).",
  }, async ({ saas, action = "threads", network = "instagram", conversation_id, q, limit = 25 }) => {
    const product = await resolveProduct(saas);
    if (action === "messages") {
      if (!conversation_id) throw new Error("action=messages exige `conversation_id` (pegue em social_dms com action=threads).");
      const d = await http.get("/api/social/dms/messages", { saas: product.id, id: conversation_id });
      const msgs = (d.messages || []).map((m) => ({ at: m.at, ours: !!m.ours, fromName: m.fromName, text: corta(m.text, 400), hasAttachment: !!m.hasAttachment, id: m.id }));
      const s = select(msgs, { limit: Math.max(limit, msgs.length) });
      return result({
        kind: "social.dms.messages",
        title: `Conversa ${conversation_id}`,
        scope: { saas: product.id, conversation_id },
        totals: { mensagens: msgs.length, nossas: msgs.filter((m) => m.ours).length, ultimaEm: msgs[msgs.length - 1]?.at || null },
        columns: COLS.mensagens,
        rows: s.rows,
        rowsLabel: "Mensagens",
        page: s.page,
        notes: ["a Meta devolve as 30 mensagens mais recentes, em ordem cronológica."],
        source: { endpoint: `GET /api/social/dms/messages?saas=${product.id}&id=${conversation_id}` },
      });
    }
    const d = await http.get("/api/social/dms", { saas: product.id, network });
    const rows = (d.threads || []).map((t) => ({
      updatedAt: t.updatedAt, name: t.name, username: t.username, unread: num(t.unread),
      snippet: corta(t.snippet, 120), recipientId: t.recipientId, id: t.id,
    }));
    const s = select(rows, { q, qFields: ["name", "username", "snippet"], sort: "updatedAt:desc", limit });
    return result({
      kind: "social.dms",
      title: `DMs (${network}) · ${product.name || product.id}`,
      scope: { saas: product.id, network },
      totals: { conversas: rows.length, comNaoLidas: rows.filter((r) => r.unread > 0).length, naoLidas: rows.reduce((a, r) => a + r.unread, 0) },
      columns: COLS.dms,
      rows: s.rows,
      rowsLabel: "Conversas",
      page: s.page,
      notes: [
        ...errosComoNotas(d.errors),
        d.configured === false ? "Meta não configurada no servidor." : "use recipientId em social_dm_send; a Meta só aceita responder dentro de 24h da última mensagem da pessoa.",
      ],
      source: { endpoint: `GET /api/social/dms?saas=${product.id}&network=${network}` },
    });
  });

  tool("social_dm_send", {
    group: GROUP,
    title: "Enviar mensagem direta",
    description: "Envia DM de Instagram Direct ou Messenger como a página.",
    write: true, external: true,
    danger: "manda mensagem para uma pessoa de verdade, em nome da marca.",
    input: {
      saas: z.string().optional(),
      recipient_id: z.string().describe("campo recipientId de social_dms."),
      text: z.string().min(1),
    },
    hint: "422 aqui quase sempre é a janela de 24h da Meta: fora dela só dá pra responder com template aprovado.",
  }, async ({ saas, recipient_id, text }) => {
    const product = await resolveProduct(saas);
    const r = await http.post("/api/social/dms/send", { saas: product.id, recipientId: recipient_id, text });
    return result({
      kind: "social.dm.send",
      title: "Mensagem enviada",
      scope: { saas: product.id, recipient_id },
      totals: { ok: !!r.ok, messageId: r.id || null },
      detail: { texto: text },
      source: { endpoint: "POST /api/social/dms/send" },
    });
  });

  tool("social_audience", {
    group: GROUP,
    title: "Audiência e melhor horário",
    description: "Demografia (país, cidade, idade, gênero) de quem segue, foi alcançado e engajou, e os melhores horários pra postar.",
    external: true,
    input: {
      saas: z.string().optional(),
      cut: z.enum(["followers", "reached", "engaged", "all"]).optional(),
      limit: z.number().int().optional().describe("Linhas por país/cidade (padrão 10)."),
    },
  }, async ({ saas, cut = "all", limit = 10 }) => {
    const product = await resolveProduct(saas);
    const d = await http.get("/api/social/audience", { saas: product.id });
    const cortes = { followers: ["demographics", "Quem segue"], reached: ["reached", "Quem foi alcançado (30d)"], engaged: ["engaged", "Quem engajou (30d)"] };
    const tables = {};
    for (const [nome, [campo, rotulo]] of Object.entries(cortes)) {
      if (cut !== "all" && cut !== nome) continue;
      const dm = d[campo];
      if (!dm) continue;
      for (const [chave, sufixo] of [["countries", "países"], ["cities", "cidades"], ["ages", "faixas de idade"], ["genders", "gêneros"]]) {
        const todas = dm[chave] || [];
        const rows = demoRows(todas, chave === "countries" || chave === "cities" ? limit : 20);
        // O ranking é cortado aqui: o rótulo diz o corte, senão "top 10" passa
        // por "a audiência inteira" e a participação some sem aviso.
        if (rows.length) tables[`${nome}_${chave}`] = { label: `${rotulo} — ${sufixo}${todas.length > rows.length ? ` (top ${rows.length} de ${todas.length})` : ""}`, columns: COLS.demografia, rows };
      }
    }
    if (d.onlineFollowers) {
      tables.horarios = {
        label: "Seguidores online por hora (média)",
        columns: ["hora", "seguidores"],
        rows: d.onlineFollowers.map((v, h) => ({ hora: `${String(h).padStart(2, "0")}h`, seguidores: num(v) })),
      };
    }
    return result({
      kind: "social.audience",
      title: `Audiência · ${product.name || product.id}`,
      scope: { saas: product.id, cut },
      units: UNITS,
      totals: {
        melhoresHoras: d.bestHours?.length ? d.bestHours.map((h) => `${String(h).padStart(2, "0")}h`).join(", ") : null,
        picoDeSeguidoresOnline: d.onlineFollowers ? Math.max(...d.onlineFollowers) : null,
      },
      tables,
      notes: [
        ...errosComoNotas(d.errors, "não deu pra ler "),
        d.configured === false ? "Meta não configurada no servidor (META_ACCESS_TOKEN): nenhum recorte de audiência existe." : "",
        "demografia é um retrato de agora (não do período) e a Meta só entrega com volume mínimo de conta — recorte vazio significa 'sem dado', não zero.",
      ].filter(Boolean),
      source: { endpoint: `GET /api/social/audience?saas=${product.id}` },
    });
  });

  tool("social_stories", {
    group: GROUP,
    title: "Stories capturados",
    description: "Histórico dos stories com alcance, respostas, avanços, voltas e saídas (a Meta só dá métrica nas 24h de vida).",
    external: true,
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      sync: z.boolean().optional().describe("Captura agora, ignorando o intervalo de 10 min."),
      sort: z.enum(["at", "reach", "views", "totalInteractions", "replies"]).optional().describe("Padrão at; os demais, do maior pro menor."),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, sync = false, sort = "at", limit = 12 }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const d = await http.get("/api/social/stories", { saas: product.id, ...(sync ? { sync: 1 } : {}) });
    const todos = (d.stories || []).map((s) => ({
      ...s, caption: corta(s.caption), exitRate: pct(num(s.navExit), num(s.reach)),
    }));
    const naJanela = todos.filter((s) => {
      const dia = String(s.at || "").slice(0, 10);
      return dia >= p.since && dia <= p.until;
    });
    const s = select(naJanela, { sort: sort === "at" ? "at:desc" : `${sort}:desc`, limit });
    const soma = (k) => naJanela.reduce((a, x) => a + num(x[k]), 0);
    return result({
      kind: "social.stories",
      title: `Stories · ${product.name || product.id}`,
      scope: { saas: product.id },
      period: p,
      units: UNITS,
      totals: {
        stories: naJanela.length,
        alcance: soma("reach"), visualizacoes: soma("views"), respostas: soma("replies"),
        compartilhamentos: soma("shares"), interacoes: soma("totalInteractions"),
        visitasAoPerfil: soma("profileVisits"), novosSeguidores: soma("follows"),
        alcanceMedio: naJanela.length ? Math.round(soma("reach") / naJanela.length) : null,
        exitRate: pct(soma("navExit"), soma("reach")),
      },
      columns: COLS.stories,
      rows: s.rows,
      rowsLabel: "Stories",
      page: s.page,
      notes: [
        ...errosComoNotas(d.errors, "captura falhou em "),
        "story postado e expirado sem ninguém abrir o cockpit no meio fica sem métrica: a Graph não devolve insight depois das 24h.",
        `o histórico guardado são os ${todos.length} stories mais recentes do produto — janelas antigas vêm incompletas.`,
      ],
      source: { endpoint: `GET /api/social/stories?saas=${product.id}` },
    });
  });

  tool("social_discovery", {
    group: GROUP,
    title: "Radar de concorrentes",
    description: "Concorrentes monitorados, hashtags vigiadas e posts que marcaram a conta; action=track troca as listas.",
    // action=track grava no cadastro do produto — a tool escreve, mesmo que o
    // padrão só leia. Idempotente: a mesma lista aplicada de novo dá no mesmo.
    write: true, idempotent: true, external: true,
    input: {
      saas: z.string().optional(),
      action: z.enum(["get", "track"]).optional(),
      competitors: z.array(z.string()).optional().describe("Só em track: SUBSTITUI a lista de @ (máx. 6, business/creator)."),
      hashtags: z.array(z.string()).optional().describe("Só em track: SUBSTITUI a lista (máx. 5)."),
    },
    hint: "concorrente com erro 'não é business/creator' não tem dado público — a Meta só abre business_discovery para contas profissionais.",
  }, async ({ saas, action = "get", competitors, hashtags }) => {
    const product = await resolveProduct(saas);
    if (action === "track") {
      if (!competitors && !hashtags) throw new Error("action=track exige `competitors` e/ou `hashtags` (a lista informada substitui a atual).");
      const patch = {};
      if (competitors) patch.igCompetitors = competitors.map((c) => String(c).replace(/^@/, "").trim()).filter(Boolean).slice(0, 6);
      if (hashtags) patch.igHashtags = hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 5);
      await http.patch(`/api/products/${encodeURIComponent(product.id)}`, patch);
    }
    const d = await http.get("/api/social/discovery", { saas: product.id });
    return result({
      kind: "social.discovery",
      title: `Radar · ${product.name || product.id}`,
      scope: { saas: product.id, action },
      units: UNITS,
      totals: {
        concorrentes: (d.competitors || []).length,
        hashtags: (d.hashtags || []).length,
        marcacoes: (d.tagged || []).length,
      },
      tables: {
        concorrentes: { label: "Concorrentes monitorados", columns: COLS.concorrentes, rows: d.competitors || [] },
        hashtags: { label: "Hashtags vigiadas (top media pública)", columns: COLS.hashtags, rows: d.hashtags || [] },
        marcacoes: {
          label: "Posts de terceiros que marcaram a conta",
          columns: COLS.marcacoes,
          rows: (d.tagged || []).map((t) => ({ at: t.at, username: t.username, type: t.type, likes: t.likes, comments: t.comments, permalink: t.permalink })),
        },
      },
      notes: [
        ...errosComoNotas(d.errors, "não deu pra ler "),
        "tetos da API, não da conta: 6 concorrentes, 5 hashtags e as 8 marcações mais recentes.",
        "alcance de concorrente é privado: só curtidas e comentários públicos entram na conta.",
        "a Meta libera 30 hashtags ÚNICAS por semana por conta — repetir as mesmas não gasta cota nova.",
        action === "track" ? "listas gravadas no cadastro do produto (igCompetitors/igHashtags)." : "",
      ].filter(Boolean),
      source: { endpoint: `GET /api/social/discovery?saas=${product.id}` },
    });
  });

  tool("social_new_followers", {
    group: GROUP,
    title: "Novos seguidores (24h)",
    description: "Saldo líquido de seguidores nas últimas ~24h; o Instagram não expõe quem seguiu.",
    external: true,
    input: { saas: z.string().optional() },
  }, async ({ saas }) => {
    const product = await resolveProduct(saas);
    const d = await http.get(`/api/social/new-followers/${encodeURIComponent(product.id)}`);
    return result({
      kind: "social.new_followers",
      title: `Novos seguidores (24h) · ${product.name || product.id}`,
      scope: { saas: product.id },
      totals: { conta: d.username ? `@${d.username}` : null, novosSeguidoresLiquido: d.count ?? null },
      notes: [
        d.configured === false ? "Meta não configurada ou produto sem Instagram: sem número (veja social_pages)." : "saldo LÍQUIDO (ganhos menos perdas) de ontem+hoje; o bucket de hoje costuma vir parcial.",
        "a plataforma não entrega a lista nem o @ de quem seguiu.",
      ],
      source: { endpoint: `GET /api/social/new-followers/${product.id}` },
    });
  });

  tool("social_pages", {
    group: GROUP,
    title: "Páginas e contas conectadas",
    description: "Páginas do Facebook do token, Instagram vinculado e produto ligado; action=connect liga uma página ao produto.",
    // action=connect grava metaPageId/metaIgUser no produto — escreve, ainda
    // que o padrão só liste. Reconectar a mesma página não muda mais nada.
    write: true, idempotent: true, external: true,
    input: {
      saas: z.string().optional().describe("Obrigatório em action=connect."),
      action: z.enum(["list", "connect"]).optional(),
      page_id: z.string().optional().describe("Só em connect: coluna pageId do list."),
    },
    hint: "lista vazia costuma ser token sem pages_show_list, ou conta pessoal sem página business.",
  }, async ({ saas, action = "list", page_id }) => {
    const [d, lista] = await Promise.all([
      http.get("/api/social/pages"),
      http.get("/api/products"),
    ]);
    const produtos = Array.isArray(lista) ? lista : [];
    const paginas = d.pages || [];
    let conectado = null;
    if (action === "connect") {
      const product = await resolveProduct(saas);
      if (!page_id) throw new Error("action=connect exige `page_id` (rode com action=list pra ver os ids).");
      const pagina = paginas.find((x) => String(x.pageId) === String(page_id));
      if (!pagina) throw new Error(`página ${page_id} não está entre as que o token administra: ${paginas.map((x) => `${x.pageId} (${x.name})`).join(", ") || "nenhuma"}`);
      await http.patch(`/api/products/${encodeURIComponent(product.id)}`, { metaPageId: pagina.pageId, metaIgUser: pagina.igUserId || "" });
      conectado = { saas: product.id, pageId: pagina.pageId, igUserId: pagina.igUserId || "", igUsername: pagina.igUsername || "" };
    }
    const porPagina = new Map(produtos.filter((p) => p.metaPageId).map((p) => [String(p.metaPageId), p.id]));
    const rows = paginas.map((x) => ({ ...x, saas: porPagina.get(String(x.pageId)) || null }));
    return result({
      kind: "social.pages",
      title: "Páginas do Facebook e Instagram conectados",
      scope: conectado ? { saas: conectado.saas, pageId: conectado.pageId } : undefined,
      totals: { configurada: !!d.configured, paginas: rows.length, ligadas: rows.filter((r) => r.saas).length, ...(conectado ? { conectadoAgora: `${conectado.saas} → ${conectado.pageId}` } : {}) },
      columns: COLS.paginas,
      rows,
      rowsLabel: "Páginas",
      tables: {
        produtos: {
          label: "Produtos do cockpit",
          columns: ["id", "name", "metaPageId", "metaIgUser", "metaAdAccount"],
          rows: produtos.map((p) => ({ id: p.id, name: p.name, metaPageId: p.metaPageId || null, metaIgUser: p.metaIgUser || p.metaIgUserId || null, metaAdAccount: p.metaAdAccount || null })),
        },
      },
      notes: [
        d.configured === false ? "META_ACCESS_TOKEN não configurado no servidor: nada orgânico funciona." : "",
        "produto sem metaPageId/metaIgUser ainda funciona por descoberta automática pelos criativos dos anúncios — mas depende de ter anúncio no ar.",
        action === "connect" ? "conectar troca a conta onde o cockpit publica, modera e lê métricas." : "",
      ].filter(Boolean),
      source: { endpoint: "GET /api/social/pages" },
    });
  });

  tool("social_publish", {
    group: GROUP,
    title: "Publicar no Instagram/Facebook",
    description: "Publica post orgânico (feed, story ou reel) no Instagram e/ou Facebook a partir de mídia já enviada.",
    write: true, external: true, destructive: true,
    danger: "publica no perfil real e o cockpit não desfaz — apagar só pelo app da Meta.",
    input: {
      saas: z.string().optional(),
      asset_ids: z.array(z.string()).min(1).describe("ids de mídia enviada pela tela Redes sociais (o MCP não sobe arquivo)."),
      format: z.enum(["feed", "story", "reel"]).optional(),
      kind: z.enum(["image", "carousel", "video", "sequence"]).optional().describe("Padrão image. sequence (vários stories) só com format=story."),
      caption: z.string().optional().describe("Legenda pública; story não usa."),
      networks: z.array(z.enum(["instagram", "facebook"])).optional().describe("Padrão só instagram."),
    },
    hint: "sem asset_id? a mídia precisa ser enviada antes pela tela Redes sociais (upload multipart), que devolve o id.",
  }, async ({ saas, asset_ids, format = "feed", kind = "image", caption = "", networks = ["instagram"] }) => {
    const product = await resolveProduct(saas);
    const r = await http.post("/api/social/publish", {
      saas: product.id, format, kind, assetIds: asset_ids, caption, networks,
    }, { timeoutMs: 300_000 });
    const rows = Object.entries(r.results || {}).map(([rede, v]) => ({
      rede, ok: !!v.ok, id: v.id || "", permalink: v.permalink || "", erro: v.error || "",
    }));
    return result({
      kind: "social.publish",
      title: `Publicação ${r.ok ? "no ar" : "falhou"} · ${format}/${kind}`,
      scope: { saas: product.id, postId: r.postId || null },
      totals: { ok: !!r.ok, redes: rows.length, falhas: rows.filter((x) => !x.ok).length },
      columns: ["rede", "ok", "id", "permalink", "erro"],
      rows,
      rowsLabel: "Redes",
      notes: rows.some((x) => !x.ok) ? ["resultado parcial: uma rede publicou e a outra não — leia a coluna erro antes de tentar de novo, pra não duplicar o post."] : [],
      source: { endpoint: "POST /api/social/publish" },
    });
  });

  tool("social_ai_copy", {
    group: GROUP,
    title: "Copy do post por IA",
    description: "Sugere por IA os textos dos campos do template e a legenda; nada é gravado.",
    external: true,
    input: {
      dor: z.string().optional().describe("Dor/tema do post."),
      suggestion: z.string().optional(),
      format_label: z.string().optional().describe("Ex.: Feed 1080×1350, Story."),
      template_name: z.string().optional(),
      fields: z.array(z.object({
        key: z.string(), label: z.string().optional(), example: z.string().optional(),
      })).min(1).describe("Campos do template."),
    },
    hint: "400 aqui significa IA não configurada no servidor (OPENROUTER_API_KEY / ANTHROPIC_API_KEY).",
  }, async ({ dor = "", suggestion = "", format_label = "", template_name = "", fields }) => {
    const r = await http.post("/api/social/ai-copy", {
      dor, suggestion, formatLabel: format_label, templateName: template_name, fields,
    }, { timeoutMs: 180_000 });
    return result({
      kind: "social.ai_copy",
      title: "Copy sugerida",
      totals: { campos: Object.keys(r.fields || {}).length },
      columns: ["campo", "texto"],
      rows: Object.entries(r.fields || {}).map(([campo, texto]) => ({ campo, texto })),
      rowsLabel: "Campos",
      detail: { caption: r.caption || "" },
      notes: ["rascunho: revise antes de mandar pro social_publish — o que sai daqui vira texto público."],
      source: { endpoint: "POST /api/social/ai-copy" },
    });
  });
}
