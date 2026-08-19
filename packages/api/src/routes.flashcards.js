// Treinamentos — flashcards por vaga (SDR / closer / …) com repetição espaçada
// FSRS POR PESSOA (o mesmo algoritmo do Anki moderno).
//
// Três camadas, três collections:
//   `flashcards`        — a BASE oficial por produto (gestor edita pra todo o time,
//                         mesma forma de offers/metas). Card: { id, role, front, back }.
//   `training_states`   — o agendamento INDIVIDUAL: um doc por usuário×produto com o
//                         estado FSRS de cada card (due, stability, difficulty, …).
//                         Card novo na base nasce "novo" pra todos; card removido some.
//   `training_reviews`  — log append-only de cada resposta (rating 1-4). É o dashboard
//                         da equipe e a matéria-prima pra otimizar o FSRS depois.

import { applyRating, previewIntervals, dayKey, dayEnd, CARD_STATE } from "./fsrs.js";
import { LEVERADS_DECKS } from "./flashcard-decks.leverads.js";

// Cartão: { id, role, front (pergunta/gatilho), back (resposta/técnica) }.
const ROLE_LABELS = {
  geral_negocio: "Geral · Negócio",
  geral_marketplace: "Geral · Marketplaces",
  geral_vendas: "Geral · Estratégia de vendas",
  sdr: "SDR", closer: "Closer", integrator: "Integrador · CS", social: "Mídia social",
};
// Conhecimentos gerais: todo mundo passa por eles antes do baralho da vaga.
const GENERAL_ROLES = ["geral_negocio", "geral_marketplace", "geral_vendas"];

// Base oficial (SEED): 3 baralhos de conhecimentos GERAIS (a porta de entrada de
// todo mundo) + 1 baralho por vaga, 150 cards cada, na voz da LeverAds. O conteúdo
// mora em flashcard-decks.leverads.js; o dono segue editando pela tela (o doc
// `flashcards` salvo congela este seed; a migração anexa só expansão nova).
const DEFAULTS = { leverads: LEVERADS_DECKS };

const ROLES = new Set(Object.keys(ROLE_LABELS));
const ROLE_ORDER = Object.keys(ROLE_LABELS);

// Tipos de card: basic (frente/verso), cloze (deleções {{c1::...}} no texto —
// cada índice vira um sub-card) e occlusion (imagem + retângulos tapados —
// cada máscara vira um sub-card). Imagem opcional em basic/cloze.
const CARD_TYPES = new Set(["basic", "cloze", "occlusion"]);

function sanitizeMasks(masks) {
  if (!Array.isArray(masks)) return [];
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  return masks.slice(0, 30).map((m, i) => ({
    id: /^m\d+$/.test(String(m?.id)) ? m.id : `m${i + 1}`,
    x: clamp01(m?.x), y: clamp01(m?.y), w: clamp01(m?.w), h: clamp01(m?.h),
  })).filter((m) => m.w > 0.005 && m.h > 0.005);
}

function sanitize(cards) {
  if (!Array.isArray(cards)) return null;
  // 7 baralhos × 150 = 1050 na base oficial; folga pro dono acrescentar os dele.
  return cards.slice(0, 2000).map((c, i) => {
    const type = CARD_TYPES.has(c?.type) ? c.type : "basic";
    return {
      id: String(c?.id || `card_${i + 1}`).slice(0, 60),
      role: ROLES.has(c?.role) ? c.role : "sdr",
      type,
      front: String(c?.front || "").slice(0, 600),
      back: String(c?.back || "").slice(0, 1200),
      image: String(c?.image || "").slice(0, 60),
      ...(type === "occlusion" ? { masks: sanitizeMasks(c?.masks) } : {}),
    };
  }).filter((c) => (c.type === "occlusion" ? (c.image && c.masks.length) : (c.front.trim() || c.back.trim())));
}

// {{c1::texto}} ou {{c1::texto::dica}} — mesmo formato do Anki.
const CLOZE_RE = /\{\{c(\d+)::(.*?)\}\}/gs;
export function clozeIndexes(text) {
  const ns = new Set();
  for (const m of String(text || "").matchAll(CLOZE_RE)) ns.add(Number(m[1]));
  return [...ns].sort((a, b) => a - b);
}

// Um card pode virar vários itens de estudo: cloze por índice, occlusion por
// máscara. O estado FSRS (e a fila) é por ENTRY — `id`, `id::c1`, `id::m2`.
function cardEntries(card) {
  if (card.type === "cloze") {
    const ns = clozeIndexes(card.front);
    if (ns.length) return ns.map((n) => ({ entryId: `${card.id}::c${n}`, sub: `c${n}` }));
  } else if (card.type === "occlusion") {
    return (card.masks || []).map((m) => ({ entryId: `${card.id}::${m.id}`, sub: m.id }));
  }
  return [{ entryId: card.id, sub: null }];
}

// Ajustes do treino por produto: quantos cards NOVOS por dia entram na fila
// (limite GLOBAL da pessoa, repartido em rodízio entre os baralhos dela;
// revisões não têm teto) e a prova de checkpoint — a cada
// quantos cards GRADUADOS ela cai (0 = desligada), com quantas questões e
// qual nota mínima. Tudo do gestor, na tela Editar.
const SETTING_BOUNDS = {
  newPerDay: { min: 0, max: 200, def: 10 },
  examEvery: { min: 0, max: 200, def: 30 },   // 0 = prova desligada
  examQuestions: { min: 3, max: 12, def: 6 },
  examPass: { min: 50, max: 100, def: 70 },
};
function sanitizeSettings(input, existing = {}) {
  const out = {};
  for (const [key, b] of Object.entries(SETTING_BOUNDS)) {
    const raw = input && typeof input === "object" && input[key] != null ? input[key] : (existing?.[key] ?? b.def);
    const n = Math.round(Number(raw));
    out[key] = Number.isFinite(n) ? Math.min(b.max, Math.max(b.min, n)) : b.def;
  }
  return out;
}

// "admin" é o dono da operação (Leo, Eryk, Jonathan): não é vaga de funil e
// não gera treinamento obrigatório.
export function isAdmin(user) {
  return (user?.roles || []).includes("admin");
}

// A BASE de cards é material oficial do time: quem treina não edita. Um
// treinando "consertando" o gabarito contamina o estudo de todo mundo (e a
// prova de checkpoint sai do mesmo texto). Sessão de usuário sem etiqueta
// admin toma 403; key mestre (sem authUser: MCP/integração) segue passando.
function requireAdmin(req, reply) {
  if (!req.authUser || isAdmin(req.authUser)) return true;
  reply.code(403).send({ error: "só admin edita os flashcards" });
  return false;
}

// Vagas que o usuário treina: os DOIS baralhos de conhecimentos gerais entram
// pra todo mundo, primeiro (a porta de entrada do treinamento); a partir deles
// a pessoa segue no fluxo da vaga dela (etiquetas do cadastro, roles do funil).
// Admin SEM vaga não recebe fila nenhuma (antes, "sem etiqueta" caía em todos
// os baralhos, o oposto de isento); admin QUE TAMBÉM tem vaga mantém a fila
// dela pra estudar quando quiser, só não é cobrado (fora do quadro da equipe).
// Cadastro novo, ainda sem etiqueta nenhuma, segue vendo tudo.
function rolesForUser(user) {
  const tags = (user?.roles || []).filter((r) => ROLES.has(r));
  if (tags.length) return ROLE_ORDER.filter((r) => GENERAL_ROLES.includes(r) || tags.includes(r));
  return isAdmin(user) ? [] : [...ROLE_ORDER];
}

const stateDocId = (saas, userId) => `${saas}__${userId}`;
const EMPTY_STATES = (saas, userId) => ({ id: stateDocId(saas, userId), saas, user: userId, cards: {}, newDone: {} });

// ── Fila do dia (o coração do Anki) ──────────────────────────────────────────
// Por baralho (vaga): aprendendo (due até o fim do dia) → revisões vencidas →
// novos até o limite diário. Cada card sai com o preview dos 4 intervalos.
function buildDeckQueue(cards, statesDoc, { now, newBudget }) {
  const end = dayEnd(now);
  const learning = [], review = [], fresh = [];
  let learned = 0; // entries já graduadas (em revisão) = a pontuação do tema
  for (const card of cards) {
    for (const { entryId, sub } of cardEntries(card)) {
      const st = statesDoc.cards[entryId] || null;
      const item = { card, entryId, sub, st };
      if (!st || st.state === CARD_STATE.new) fresh.push(item);
      else if (st.state === CARD_STATE.review) { learned++; if (new Date(st.due) <= end) review.push(item); }
      else if (new Date(st.due) <= end) learning.push(item); // learning/relearning
    }
  }
  const byDue = (a, b) => new Date(a.st.due) - new Date(b.st.due);
  learning.sort(byDue); review.sort(byDue);
  const newToday = fresh.slice(0, Math.max(0, newBudget));
  const pack = ({ card, entryId, sub, st }) => ({ ...card, entryId, sub, srs: st, preview: previewIntervals(st, now) });
  return {
    counts: { new: newToday.length, learning: learning.length, review: review.length },
    learned,
    cards: [...learning.map(pack), ...review.map(pack), ...newToday.map(pack)],
  };
}

// Base oficial de um produto (doc salvo ou defaults) — usada pelas rotas e
// pelo lembrete diário.
export async function flashcardsBase(repo, saas) {
  const doc = saas ? await repo.get("flashcards", saas) : null;
  return doc?.cards || DEFAULTS[saas] || [];
}

// ── Prova de checkpoint ──────────────────────────────────────────────────────
// A cada `examEvery` cards graduados cai uma prova sobre exatamente esses
// cards: múltipla escolha com distratores tirados dos gabaritos de OUTROS
// cards (plausíveis por construção, sem trabalho manual) e, com IA
// configurada, 2 digitadas corrigidas semanticamente. Abaixo de 70% reprova
// e os cards errados voltam pra fila como novos.
const EXAM_PASS = 70; // fallback pra prova antiga sem passScore congelado

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// pergunta e resposta certa de uma entry (occlusion fica fora — é visual)
function entryQA(card, sub) {
  if (!card || card.type === "occlusion") return null;
  if (card.type === "cloze") {
    const target = Number(String(sub || "").slice(1));
    let answer = null;
    const prompt = String(card.front || "").replace(CLOZE_RE, (m, n, body) => {
      const content = body.split("::")[0];
      if (Number(n) === target) { answer = content; return "_____"; }
      return content;
    });
    return answer ? { prompt: `Complete: ${prompt}`, answer } : null;
  }
  if (!card.front?.trim() || !card.back?.trim()) return null;
  return { prompt: card.front, answer: card.back };
}

function buildExamQuestions(cards, coveredEntries, { typedCount = 0, questionCount = SETTING_BOUNDS.examQuestions.def } = {}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const qas = [];
  for (const entryId of shuffle(coveredEntries)) {
    const baseId = entryId.split("::")[0];
    const card = byId.get(baseId);
    const sub = entryId.includes("::") ? entryId.slice(baseId.length + 2) : null;
    const qa = entryQA(card, sub);
    if (qa) qas.push({ entryId, role: card.role, ...qa });
    if (qas.length >= questionCount) break;
  }
  // distratores: respostas de outros cards, preferindo o mesmo baralho
  const pool = cards.flatMap((c) => cardEntries(c)
    .map((e) => entryQA(c, e.sub)).filter(Boolean)
    .map((q) => ({ role: c.role, answer: q.answer })));
  const typed = Math.min(typedCount, Math.max(0, qas.length - 3)); // digitadas só se sobrar MC suficiente
  return qas.map((qa, i) => {
    if (i >= qas.length - typed) return { kind: "typed", entryId: qa.entryId, prompt: qa.prompt, ideal: qa.answer };
    const cand = pool.filter((p) => p.answer !== qa.answer);
    const ds = [...new Set([
      ...shuffle(cand.filter((p) => p.role === qa.role)).map((p) => p.answer),
      ...shuffle(cand.filter((p) => p.role !== qa.role)).map((p) => p.answer),
    ])].slice(0, 3);
    const options = shuffle([qa.answer, ...ds]);
    return { kind: "mc", entryId: qa.entryId, prompt: qa.prompt, options, answerIdx: options.indexOf(qa.answer) };
  });
}

// Retrato da equipe num produto (rota /team e lembrete diário do Discord).
// True retention (métrica clássica do Anki): % de acerto (rating ≥ 2, Difícil
// conta como lembrou) SÓ nas revisões de cards que JÁ estavam em revisão
// (prevState = review) — mede memória de verdade, sem misturar o aprendizado
// do dia. `null` quando não há amostra.
function retentionOf(reviews) {
  const rs = reviews.filter((r) => r.prevState === CARD_STATE.review);
  if (!rs.length) return { pct: null, n: 0 };
  return { pct: Math.round((rs.filter((r) => r.rating >= 2).length / rs.length) * 100), n: rs.length };
}

export async function teamSnapshot(repo, saas, cardsBase, now = new Date()) {
  const end = dayEnd(now);
  const today = dayKey(now);
  const users = (await repo.list("users"))
    .filter((u) => !u.saas || u.saas === saas) // respeita o escopo de produto do usuário
    // Admin fica FORA do quadro de cobrança: treinamento é opcional pra quem
    // toca o negócio, então listar ele como "atrasado" seria ruído.
    .filter((u) => !isAdmin(u))
    .map((u) => ({ id: u.id, name: u.name, roles: Array.isArray(u.roles) ? u.roles : [] }));
  const reviews = (await repo.list("training_reviews")).filter((r) => r.saas === saas);
  const exams = (await repo.list("training_exams")).filter((e) => e.saas === saas);
  // 4fun: estudo livre além da cota. Fica FORA de tudo que é cobrança (due,
  // retenção, sequência) e aparece em coluna própria — é mérito, não meta.
  const funLog = (await repo.list("training_fun")).filter((r) => r.saas === saas);
  const rows = [];
  for (const u of users) {
    const roles = rolesForUser(u);
    // o baralho conta ENTRIES (cloze/occlusion viram vários itens de estudo)
    const deck = cardsBase.filter((c) => roles.includes(c.role)).flatMap((c) => cardEntries(c).map((e) => ({ ...e, role: c.role })));
    const statesDoc = (await repo.get("training_states", stateDocId(saas, u.id))) || EMPTY_STATES(saas, u.id);
    let dueToday = 0, overdue = 0, seen = 0, mature = 0, young = 0;
    const forecast = Array.from({ length: 7 }, (_, i) => ({ day: dayKey(new Date(end.getTime() + i * 864e5)), n: 0 }));
    for (const { entryId } of deck) {
      const st = statesDoc.cards[entryId];
      if (!st || st.state === CARD_STATE.new) continue;
      seen++;
      if (st.state === CARD_STATE.review) { if ((st.scheduled_days || 0) >= 21 ) mature++; else young++; }
      const due = new Date(st.due);
      if (due <= end) { dueToday++; if (dayKey(due) < today) overdue++; }
      else if (due <= new Date(end.getTime() + 7 * 864e5)) {
        forecast[Math.min(6, Math.floor((due - end) / 864e5))].n++;
      }
    }

    const mine = reviews.filter((r) => r.user === u.id);
    const inWindow = (days) => mine.filter((r) => now - new Date(r.at) <= days * 864e5);
    const last7 = inWindow(7), last30 = inWindow(30);
    const doneToday = mine.filter((r) => dayKey(new Date(r.at)) === today).length;
    const again7dPct = last7.length ? Math.round((last7.filter((r) => r.rating === 1).length / last7.length) * 100) : null;

    // memória e aprendizado
    const retention7d = retentionOf(last7);
    const retention30d = retentionOf(last30);
    const firstTries = last30.filter((r) => r.prevState === CARD_STATE.new);
    const firstTryPct = firstTries.length ? Math.round((firstTries.filter((r) => r.rating >= 3).length / firstTries.length) * 100) : null;
    const retentionByRole = roles.map((role) => ({ role, label: ROLE_LABELS[role], ...retentionOf(last30.filter((r) => r.role === role)) }))
      .filter((x) => x.n > 0);
    // 8 semanas de true retention (da mais antiga pra atual) pro gráfico;
    // back=1 é a semana corrente (idade 0..7 dias)
    const weekly = Array.from({ length: 8 }, (_, i) => {
      const back = 8 - i;
      const ws = mine.filter((r) => {
        const age = (now - new Date(r.at)) / 864e5;
        return age > (back - 1) * 7 && age <= back * 7;
      });
      return { start: dayKey(new Date(now.getTime() - (back * 7 - 1) * 864e5)), ...retentionOf(ws) };
    });

    // ritmo de resposta (anti-burla): mediana e % de respostas relâmpago
    const timed = last30.filter((r) => (r.ms || 0) > 0).map((r) => r.ms).sort((a, b) => a - b);
    const medianMs = timed.length ? timed[Math.floor(timed.length / 2)] : null;
    const rushPct = timed.length ? Math.round((timed.filter((v) => v < 1500).length / timed.length) * 100) : null;

    // constância
    const dayCounts = {};
    for (const r of mine) { const d = dayKey(new Date(r.at)); dayCounts[d] = (dayCounts[d] || 0) + 1; }
    const activeDays30d = Object.keys(dayCounts).filter((d) => (now - Date.parse(`${d}T12:00:00Z`)) / 864e5 <= 30).length;
    const reviewsPerDay30d = Math.round((last30.length / 30) * 10) / 10;
    const since = dayKey(new Date(now.getTime() - 27 * 7 * 864e5));
    const days = Object.fromEntries(Object.entries(dayCounts).filter(([d]) => d >= since).sort());
    let streak = 0;
    for (let d = new Date(now.getTime() - (dayCounts[today] ? 0 : 864e5)); dayCounts[dayKey(d)]; d = new Date(d.getTime() - 864e5)) streak++;
    const lastAt = mine.reduce((m, r) => (r.at > m ? r.at : m), "");

    // 4fun da pessoa (log separado, não entra em nenhuma média acima)
    const myFun = funLog.filter((r) => r.user === u.id);
    const myFun30 = myFun.filter((r) => now - new Date(r.at) <= 30 * 864e5);
    const fun = {
      today: myFun.filter((r) => dayKey(new Date(r.at)) === today).length,
      last30: myFun30.length,
      total: myFun.length,
      hitPct: myFun30.length ? Math.round((myFun30.filter((r) => r.rating >= 3).length / myFun30.length) * 100) : null,
    };

    // provas de checkpoint
    const myExams = exams.filter((e) => e.user === u.id);
    const doneExams = myExams.filter((e) => e.status !== "pending").sort((a, b) => (a.finishedAt || "").localeCompare(b.finishedAt || ""));
    const lastExam = doneExams.at(-1) || null;

    rows.push({
      ...u, deckSize: deck.length, seen, dueToday, overdue, doneToday, again7dPct, streak, lastReviewAt: lastAt || null,
      mature, young, forecast,
      retention7d, retention30d, firstTryPct, retentionByRole, weekly,
      activeDays30d, reviewsPerDay30d, days, medianMs, rushPct, fun,
      examsDone: doneExams.length,
      examsFailed: doneExams.filter((e) => e.status === "failed").length,
      lastExam: lastExam ? { score: lastExam.score, status: lastExam.status } : null,
      examPending: myExams.some((e) => e.status === "pending"),
    });
  }
  return rows;
}

export function registerFlashcardRoutes(app, repo, { anthropic = null } = {}) {
  async function baseDoc(saas) {
    const doc = saas ? await repo.get("flashcards", saas) : null;
    return {
      cards: doc?.cards || DEFAULTS[saas] || [],
      settings: sanitizeSettings(null, doc?.settings),
    };
  }

  // Fila/revisão são POR PESSOA — exigem sessão de usuário (a key mestre de
  // integração não tem "quem").
  function requireUser(req, reply) {
    if (req.authUser?.id) return req.authUser;
    reply.code(401).send({ error: "treino é por pessoa — faça login no cockpit (sessão de usuário)" });
    return null;
  }

  app.get("/api/flashcards/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const { cards, settings } = await baseDoc(product.id);
    return { saas: product.id, roleLabels: ROLE_LABELS, cards, settings };
  });

  // A fila do dia do usuário logado: um baralho por vaga dele (sem etiqueta =
  // todos), com contadores novo/aprendendo/revisar e os cards prontos pra sessão.
  // O limite de novos é GLOBAL (newPerDay vale pro dia da pessoa, não por
  // baralho) e sai em rodízio entre os baralhos — com 3 baralhos e limite 10,
  // o dia tem 10 novos alternados, não 30.
  app.get("/api/flashcards/:saas/queue", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const now = new Date();
    const { cards, settings } = await baseDoc(product.id);
    const statesDoc = (await repo.get("training_states", stateDocId(product.id, user.id))) || EMPTY_STATES(product.id, user.id);
    const doneByRole = statesDoc.newDone[dayKey(now)] || {};
    const built = rolesForUser(user).map((role) => {
      const roleCards = cards.filter((c) => c.role === role);
      return {
        role,
        total: roleCards.flatMap(cardEntries).length,
        deck: buildDeckQueue(roleCards, statesDoc, { now, newBudget: Infinity }),
      };
    });
    // rodízio: cada vaga do orçamento vai pro baralho com MENOS novos no dia
    // (feitos + já alocados); baralho sem card novo sobrando cede a vez
    let budget = Math.max(0, settings.newPerDay - Object.values(doneByRole).reduce((a, b) => a + b, 0));
    const given = Object.fromEntries(built.map(({ role }) => [role, doneByRole[role] || 0]));
    const alloc = Object.fromEntries(built.map(({ role }) => [role, 0]));
    while (budget > 0) {
      const next = built
        .filter(({ role, deck }) => alloc[role] < deck.counts.new)
        .sort((a, b) => given[a.role] - given[b.role])[0];
      if (!next) break;
      alloc[next.role]++; given[next.role]++; budget--;
    }
    const decks = [], queue = {};
    for (const { role, total, deck } of built) {
      decks.push({ role, label: ROLE_LABELS[role], total, counts: { ...deck.counts, new: alloc[role] }, learned: deck.learned });
      queue[role] = deck.cards.slice(0, deck.counts.learning + deck.counts.review + alloc[role]);
    }
    const pendingExam = (await repo.list("training_exams"))
      .find((e) => e.saas === product.id && e.user === user.id && e.status === "pending");
    return {
      saas: product.id, today: dayKey(now), dayEnd: dayEnd(now).toISOString(), newPerDay: settings.newPerDay, decks, queue,
      exam: pendingExam ? { id: pendingExam.id, count: pendingExam.coveredEntries.length } : null,
    };
  });

  // Prova de checkpoint — gera as questões na primeira abertura. O gabarito
  // NUNCA vai pro cliente; a correção é toda no servidor.
  app.post("/api/flashcards/:saas/exam/:id/start", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const exam = await repo.get("training_exams", req.params.id);
    if (!exam || exam.saas !== req.params.saas || exam.user !== user.id) return reply.code(404).send({ error: "prova não encontrada" });
    if (exam.status !== "pending") return reply.code(400).send({ error: "prova já respondida" });
    let questions = exam.questions;
    let passScore = exam.passScore;
    if (!questions?.length) {
      const { cards, settings } = await baseDoc(exam.saas);
      questions = buildExamQuestions(cards, exam.coveredEntries, {
        typedCount: anthropic?.configured?.() ? 2 : 0,
        questionCount: settings.examQuestions,
      });
      if (!questions.length) return reply.code(400).send({ error: "sem questões possíveis — os cards desta prova saíram da base" });
      passScore = settings.examPass; // congela a régua vigente na abertura
      await repo.update("training_exams", exam.id, { questions, passScore });
    }
    return {
      id: exam.id, count: exam.coveredEntries.length, passScore: passScore ?? EXAM_PASS,
      questions: questions.map((q) => ({ kind: q.kind, prompt: q.prompt, options: q.options || null })),
    };
  });

  app.post("/api/flashcards/:saas/exam/:id/submit", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    const exam = await repo.get("training_exams", req.params.id);
    if (!exam || exam.saas !== req.params.saas || exam.user !== user.id) return reply.code(404).send({ error: "prova não encontrada" });
    if (exam.status !== "pending" || !exam.questions?.length) return reply.code(400).send({ error: "prova não está aberta" });
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    const results = [];
    for (let i = 0; i < exam.questions.length; i++) {
      const q = exam.questions[i];
      const a = answers[i] || {};
      if (q.kind === "mc") {
        const choice = Number.isInteger(a.choice) ? a.choice : -1;
        results.push({ ...q, choice, correct: choice === q.answerIdx, feedback: "" });
      } else {
        const text = String(a.text || "").trim();
        let correct = false, feedback = "";
        if (text && anthropic?.configured?.()) {
          try {
            const g = await anthropic.gradeAnswer({ question: q.prompt, ideal: q.ideal, answer: text, productName: product?.name });
            correct = g.score >= 60;
            feedback = g.feedback || "";
          } catch {
            correct = true; feedback = "IA indisponível na correção — questão contou como certa";
          }
        }
        results.push({ ...q, text, correct, feedback });
      }
    }
    const passScore = exam.passScore ?? EXAM_PASS;
    const score = Math.round((results.filter((r) => r.correct).length / results.length) * 100);
    const passed = score >= passScore;

    // reprovou: os cards das questões erradas voltam pra fila como novos
    let resetCount = 0;
    if (!passed) {
      const docId = stateDocId(exam.saas, user.id);
      const statesDoc = await repo.get("training_states", docId);
      if (statesDoc) {
        for (const r of results.filter((x) => !x.correct)) {
          if (statesDoc.cards[r.entryId]) { delete statesDoc.cards[r.entryId]; resetCount++; }
        }
        await repo.update("training_states", docId, { cards: statesDoc.cards });
      }
    }
    await repo.update("training_exams", exam.id, {
      status: passed ? "passed" : "failed", score, finishedAt: new Date().toISOString(), questions: results,
    });
    return {
      score, passed, passScore, resetCount,
      questions: results.map((q) => ({
        kind: q.kind, prompt: q.prompt, options: q.options || null,
        answerIdx: q.answerIdx ?? null, choice: q.choice ?? null,
        text: q.text ?? "", ideal: q.ideal || null, correct: q.correct, feedback: q.feedback,
      })),
    };
  });

  // Uma resposta: aplica o rating (1 Errei · 2 Difícil · 3 Bom · 4 Fácil) no
  // FSRS, persiste o estado do usuário e loga a revisão. Devolve o novo estado
  // + preview (o front decide se o card volta ainda nesta sessão).
  app.post("/api/flashcards/:saas/review", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const rating = Number(req.body?.rating);
    if (![1, 2, 3, 4].includes(rating)) return reply.code(400).send({ error: "rating deve ser 1..4" });
    const { cards, settings } = await baseDoc(product.id);
    // `cardId` é o ENTRY id: `id` (basic), `id::c1` (cloze) ou `id::m2` (occlusion)
    const entryId = String(req.body?.cardId || "");
    const baseId = entryId.split("::")[0];
    const card = cards.find((c) => c.id === baseId);
    if (!card || !cardEntries(card).some((e) => e.entryId === entryId)) {
      return reply.code(404).send({ error: "card não encontrado na base" });
    }

    const now = new Date();
    const docId = stateDocId(product.id, user.id);
    const statesDoc = (await repo.get("training_states", docId)) || EMPTY_STATES(product.id, user.id);
    const prev = statesDoc.cards[entryId] || null;
    const wasNew = !prev || prev.state === CARD_STATE.new;
    const { card: next, log } = applyRating(prev, rating, now);
    statesDoc.cards[entryId] = next;

    if (wasNew) {
      const today = dayKey(now);
      const day = { ...(statesDoc.newDone[today] || {}) };
      day[card.role] = (day[card.role] || 0) + 1;
      // só os últimos 14 dias interessam (o limite é diário)
      statesDoc.newDone = Object.fromEntries(
        Object.entries({ ...statesDoc.newDone, [today]: day }).sort().slice(-14)
      );
    }

    // graduou (chegou em "revisão" pela primeira vez)? alimenta a prova de
    // checkpoint; ao juntar `examEvery` graduados, cria a prova pendente.
    const graduated = next.state === CARD_STATE.review && (!prev || prev.state !== CARD_STATE.review);
    if (graduated && settings.examEvery > 0) {
      const pool = [...new Set([...(statesDoc.gradPool || []), entryId])];
      if (pool.length >= settings.examEvery) {
        statesDoc.gradPool = pool.slice(settings.examEvery);
        try {
          await repo.create("training_exams", {
            id: `ex_${now.getTime().toString(36)}_${user.id}_${Math.random().toString(36).slice(2, 6)}`,
            saas: product.id, user: user.id, status: "pending",
            coveredEntries: pool.slice(0, settings.examEvery), createdAt: now.toISOString(),
          });
        } catch { /* fail-open */ }
      } else {
        statesDoc.gradPool = pool;
      }
    }

    const existing = await repo.get("training_states", docId);
    if (existing) await repo.update("training_states", docId, { cards: statesDoc.cards, newDone: statesDoc.newDone, gradPool: statesDoc.gradPool || [] });
    else await repo.create("training_states", statesDoc);

    // log da revisão (dashboard/otimização) — best-effort, nunca trava o estudo.
    // id explícito: o gerador do repo colide quando 2 creates caem no mesmo ms
    // (2 pessoas revisando juntas), e a colisão apagaria uma revisão em silêncio.
    try {
      await repo.create("training_reviews", {
        id: `rv_${now.getTime().toString(36)}_${user.id}_${Math.random().toString(36).slice(2, 8)}`,
        saas: product.id, user: user.id, cardId: entryId, role: card.role,
        rating, prevState: log.state, prevIvl: prev?.scheduled_days || 0,
        // tempo frente→resposta (anti-burla: ninguém lembra de verdade em <1,5s)
        ms: Math.max(0, Math.min(300000, Math.round(Number(req.body?.ms) || 0))),
        due: next.due, at: now.toISOString(),
      });
    } catch { /* fail-open */ }

    return { cardId: entryId, srs: next, preview: previewIntervals(next, now) };
  });

  // ── Modo 4fun: estudar ALÉM da cota, sem virar compromisso ─────────────────
  // A fila do dia é fechada de propósito (10 novos + o que o FSRS devolveu), e
  // quem quer estudar mais não tinha o que fazer. O 4fun abre a base inteira da
  // pessoa em ordem aleatória, mas NÃO toca no FSRS: não agenda card, não gasta
  // o limite de novos, não alimenta prova de checkpoint e não entra em
  // retenção/sequência/feitas hoje — senão estudar por vontade própria mexeria
  // na régua de cobrança de quem só cumpre o combinado. O que fica é o log em
  // `training_fun`: o número existe, separado.
  const FUN_MAX = 60;
  app.get("/api/flashcards/:saas/fun", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const { cards } = await baseDoc(product.id);
    // baralhos da pessoa; admin sem vaga (que não tem fila obrigatória) estuda tudo
    const roles = rolesForUser(user);
    const mine = roles.length ? cards.filter((c) => roles.includes(c.role)) : cards;
    const pool = shuffle(mine.flatMap((card) => cardEntries(card).map(({ entryId, sub }) => ({ ...card, entryId, sub }))));
    const n = Math.min(FUN_MAX, Math.max(1, Math.round(Number(req.query?.n) || 20)));
    return { saas: product.id, total: pool.length, cards: pool.slice(0, n) };
  });

  app.post("/api/flashcards/:saas/fun/review", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const rating = Number(req.body?.rating);
    if (![1, 2, 3, 4].includes(rating)) return reply.code(400).send({ error: "rating deve ser 1..4" });
    const { cards } = await baseDoc(product.id);
    const entryId = String(req.body?.cardId || "");
    const card = cards.find((c) => c.id === entryId.split("::")[0]);
    if (!card || !cardEntries(card).some((e) => e.entryId === entryId)) {
      return reply.code(404).send({ error: "card não encontrado na base" });
    }
    const now = new Date();
    // log e SÓ log: nenhum estado FSRS é escrito aqui, de propósito.
    await repo.create("training_fun", {
      id: `fn_${now.getTime().toString(36)}_${user.id}_${Math.random().toString(36).slice(2, 8)}`,
      saas: product.id, user: user.id, cardId: entryId, role: card.role, rating,
      ms: Math.max(0, Math.min(300000, Math.round(Number(req.body?.ms) || 0))),
      at: now.toISOString(),
    });
    return { cardId: entryId, fun: true };
  });

  // Imagem dos cards (colada/enviada no editor): base64 na collection (máx
  // 3MB) e servida em /public/training/:id — rota ABERTA (a tag <img> não
  // manda header; o id randômico é a chave, mesmo desenho de /public/social).
  app.post("/api/flashcards/:saas/asset", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!requireAdmin(req, reply)) return; // imagem só entra pelo editor, que é do admin
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "envie uma imagem (multipart, campo file)" });
    if (!/^image\//.test(file.mimetype || "")) return reply.code(400).send({ error: "só aceito imagem" });
    const buf = await file.toBuffer();
    if (buf.length > 3 * 1024 * 1024) return reply.code(413).send({ error: "imagem acima de 3MB — recorte ou comprima" });
    const id = `ta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await repo.create("training_assets", {
      id, saas: product.id, mime: file.mimetype, size: buf.length,
      data: buf.toString("base64"), by: user.id, at: new Date().toISOString(),
    });
    return { id, url: `/public/training/${id}` };
  });

  app.get("/public/training/:id", async (req, reply) => {
    const doc = await repo.get("training_assets", req.params.id);
    if (!doc) return reply.code(404).send({ error: "imagem não encontrada" });
    reply.header("cache-control", "public, max-age=86400, immutable");
    return reply.type(doc.mime || "image/png").send(Buffer.from(doc.data || "", "base64"));
  });

  // Consistência do usuário logado: revisões por dia (~27 semanas, heatmap),
  // sequência atual e a melhor de todos os tempos.
  app.get("/api/flashcards/:saas/stats", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const now = new Date();
    const today = dayKey(now);
    const mine = (await repo.list("training_reviews")).filter((r) => r.saas === product.id && r.user === user.id);
    const counts = {};
    for (const r of mine) {
      const d = dayKey(new Date(r.at));
      counts[d] = (counts[d] || 0) + 1;
    }
    const since = dayKey(new Date(now.getTime() - 27 * 7 * 864e5));
    const days = Object.fromEntries(Object.entries(counts).filter(([d]) => d >= since).sort());
    let streak = 0;
    for (let d = new Date(now.getTime() - (counts[today] ? 0 : 864e5)); counts[dayKey(d)]; d = new Date(d.getTime() - 864e5)) streak++;
    // melhor sequência: varre os dias com revisão em ordem, contando corridas.
    let bestStreak = 0, run = 0, prev = null;
    for (const d of Object.keys(counts).sort()) {
      run = prev && (Date.parse(d) - Date.parse(prev) === 864e5) ? run + 1 : 1;
      bestStreak = Math.max(bestStreak, run);
      prev = d;
    }
    // 4fun entra SEPARADO: não soma em streak/feitas hoje (não é compromisso),
    // mas aparece pra pessoa ver o quanto estudou a mais.
    const funMine = (await repo.list("training_fun")).filter((r) => r.saas === product.id && r.user === user.id);
    const fun30 = funMine.filter((r) => now - new Date(r.at) <= 30 * 864e5);
    const fun = {
      doneToday: funMine.filter((r) => dayKey(new Date(r.at)) === today).length,
      total: funMine.length,
      hitPct30d: fun30.length ? Math.round((fun30.filter((r) => r.rating >= 3).length / fun30.length) * 100) : null,
    };
    return { saas: product.id, today, streak, bestStreak, doneToday: counts[today] || 0, days, fun };
  });

  // Dashboard da equipe: quem está em dia, quem acumulou, acerto e sequência.
  app.get("/api/flashcards/:saas/team", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const { cards } = await baseDoc(product.id);
    return { saas: product.id, today: dayKey(new Date()), roleLabels: ROLE_LABELS, users: await teamSnapshot(repo, product.id, cards) };
  });

  app.put("/api/flashcards/:saas", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const cards = sanitize(req.body?.cards);
    if (!cards) return reply.code(400).send({ error: "cards deve ser uma lista" });
    const existing = await repo.get("flashcards", product.id);
    const settings = sanitizeSettings(req.body?.settings, existing?.settings);
    const saved = existing
      ? await repo.update("flashcards", product.id, { cards, settings })
      : await repo.create("flashcards", { id: product.id, cards, settings });
    return { saas: product.id, cards: saved.cards, settings: saved.settings };
  });
}

export const FLASHCARD_DEFAULTS = DEFAULTS;
