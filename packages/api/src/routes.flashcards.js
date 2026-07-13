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

// Cartão: { id, role, front (pergunta/gatilho), back (resposta/técnica) }.
const ROLE_LABELS = { sdr: "SDR", closer: "Closer", integrator: "Integrador · CS", social: "Mídia social" };

// 10 flashcards pra cada vaga, na voz da LeverAds (clona anúncios ML/Shopee
// entre contas). O Leo edita à vontade na tela.
const DEFAULTS = {
  leverads: [
    // ── SDR ──────────────────────────────────────────────────────────────
    { id: "sdr_1", role: "sdr", front: "O que a LeverAds faz, em 1 frase?", back: "Clona e sincroniza seus anúncios entre todas as contas de Mercado Livre e Shopee, sozinha. Mais exposição, menos operação e retrabalho." },
    { id: "sdr_2", role: "sdr", front: "Qual é o SEU objetivo na ligação de SDR?", back: "Confirmar os dados (nicho, contas, anúncios, expansão) e AGENDAR a call com o closer. Você qualifica e marca, não vende aqui." },
    { id: "sdr_3", role: "sdr", front: "Lead: 'me manda por WhatsApp'", back: "'Mando sim! Mas em 10 min no vídeo eu te mostro clonando um anúncio SEU de verdade, entende muito mais rápido. Prefere amanhã de manhã ou no fim da tarde?'" },
    { id: "sdr_4", role: "sdr", front: "Perguntas de qualificação, na ordem", back: "1) Nicho · 2) Nome da loja/empresa · 3) Quantas contas de marketplace · 4) Quantos anúncios na maior conta · 5) Pretende abrir mais contas · 6) Tamanho do time de marketing." },
    { id: "sdr_5", role: "sdr", front: "Lead: 'não tenho tempo agora'", back: "'É rapidinho: 20-30 min e você já sai vendo a ferramenta rodando na SUA conta. Qual o melhor horário essa semana pra eu reservar com o especialista?'" },
    { id: "sdr_6", role: "sdr", front: "Como criar urgência sem forçar?", back: "Ancore na dor ('cada dia com anúncio parado numa conta é venda indo pro concorrente') e use a agenda ('consigo encaixar amanhã 10h, seguro pra você?')." },
    { id: "sdr_7", role: "sdr", front: "Lead: 'já uso outra ferramenta'", back: "'Boa, então já sabe o valor de automatizar. Vale ver como a gente clona ENTRE ML e Shopee e mantém atributo/SKU no lugar, costuma ser o que falta. 15 min pra comparar?'" },
    { id: "sdr_8", role: "sdr", front: "Não atendeu a ligação. E agora?", back: "Liga de novo em seguida. Caiu na caixa 2×, manda o WhatsApp de apresentação e registra o toque (vai pra Qualificando e retoma amanhã). Cadência de até 5 toques." },
    { id: "sdr_9", role: "sdr", front: "O que NUNCA pode faltar antes de passar pro closer?", back: "Call agendada (dia e hora), o closer responsável e o e-mail do lead pro convite do Meet. Sem isso a call não acontece." },
    { id: "sdr_10", role: "sdr", front: "Frase de transição pra agendar a call", back: "'Fechado! Vou te colocar com nosso especialista pra você ver a ferramenta clonando um anúncio de verdade na sua operação. Melhor amanhã de manhã ou no fim da tarde?'" },
    // ── Closer ───────────────────────────────────────────────────────────
    { id: "clo_1", role: "closer", front: "Como abrir a call (primeiros 2 min)?", back: "Rapport rápido + confirma o cenário (contas, anúncios, dor). Alinhe a agenda: 'vou te mostrar rodando na sua conta e no fim a gente vê se faz sentido, combinado?'" },
    { id: "clo_2", role: "closer", front: "O teste que desarma quase toda objeção", back: "Clonar 10 anúncios DELE na criação da conta, ~2h de trabalho manual feito em minutos, sem cartão e sem compromisso. Ele vê o valor na própria operação." },
    { id: "clo_3", role: "closer", front: "Objeção: 'tá caro'", back: "Não baixe o preço de cara. Empilhe valor: quanto custa um funcionário pra fazer isso (~R$50 mil/ano), quanto vale a exposição extra. SÓ então a escada de ofertas." },
    { id: "clo_4", role: "closer", front: "A escada de ofertas (de cima pra baixo)", back: "Anual 12x 599 (âncora) → se travar, Semestral 12x 299 → último recurso, Serviço único 12x 149. Nunca comece pela mais barata; desça só na objeção real de preço." },
    { id: "clo_5", role: "closer", front: "Objeção: 'tenho medo de banir a conta'", back: "'Justamente por isso existe processo: atributo e SKU no lugar, clonagem no padrão. Risco é operar tudo na mão. Te mostro contas rodando há meses sem problema.'" },
    { id: "clo_6", role: "closer", front: "Prova social pra usar na call", back: "Case Unique: conta nova clonada da mãe fez +105% em vendas, +98,8% pedidos e +115% visitas no 1º mês. Prints reais do painel do Mercado Livre." },
    { id: "clo_7", role: "closer", front: "Objeção: 'vou pensar'", back: "Isola a real: 'claro! Só pra eu te ajudar: é o preço, o timing ou uma dúvida de como funciona?'. Resolve a objeção verdadeira em vez de deixar esfriar." },
    { id: "clo_8", role: "closer", front: "Como conduzir pro fechamento", back: "Recapitula a dor + o que ele viu no teste + a oferta. Pergunta de compromisso: 'faz sentido começar pelo anual pra travar o melhor preço?'. Depois, silêncio." },
    { id: "clo_9", role: "closer", front: "Objeção: 'preciso falar com meu sócio'", back: "'Decisão boa se toma junto. Topa marcar 15 min com ele ainda essa semana pra eu tirar as dúvidas na fonte? Seguro esse valor até lá.'" },
    { id: "clo_10", role: "closer", front: "Depois do 'sim', o que garantir?", back: "Link de pagamento certo (anual/semestral/único), confirmar o e-mail e já encaminhar pra integração (o setup começa). Não deixe o lead 'no ar' após o aceite." },
  ],
};

const ROLES = new Set(Object.keys(ROLE_LABELS));
const ROLE_ORDER = Object.keys(ROLE_LABELS);

function sanitize(cards) {
  if (!Array.isArray(cards)) return null;
  return cards.slice(0, 400).map((c, i) => ({
    id: String(c?.id || `card_${i + 1}`).slice(0, 60),
    role: ROLES.has(c?.role) ? c.role : "sdr",
    front: String(c?.front || "").slice(0, 600),
    back: String(c?.back || "").slice(0, 1200),
  })).filter((c) => c.front.trim() || c.back.trim());
}

// Ajustes do treino por produto. Só um por enquanto: quantos cards NOVOS por
// dia entram na fila de cada baralho (limite do Anki; revisões não têm teto).
const DEFAULT_NEW_PER_DAY = 10;
function sanitizeSettings(input, existing = {}) {
  const out = { newPerDay: DEFAULT_NEW_PER_DAY, ...existing };
  if (input && typeof input === "object" && input.newPerDay != null) {
    const n = Math.round(Number(input.newPerDay));
    if (Number.isFinite(n)) out.newPerDay = Math.min(200, Math.max(0, n));
  }
  return out;
}

// Vagas que o usuário treina: as etiquetas do cadastro (roles do funil). Sem
// etiqueta (ex.: admin) = vê todos os baralhos.
function rolesForUser(user) {
  const tags = (user?.roles || []).filter((r) => ROLES.has(r));
  return tags.length ? ROLE_ORDER.filter((r) => tags.includes(r)) : [...ROLE_ORDER];
}

const stateDocId = (saas, userId) => `${saas}__${userId}`;
const EMPTY_STATES = (saas, userId) => ({ id: stateDocId(saas, userId), saas, user: userId, cards: {}, newDone: {} });

// ── Fila do dia (o coração do Anki) ──────────────────────────────────────────
// Por baralho (vaga): aprendendo (due até o fim do dia) → revisões vencidas →
// novos até o limite diário. Cada card sai com o preview dos 4 intervalos.
function buildDeckQueue(cards, statesDoc, { now, newBudget }) {
  const end = dayEnd(now);
  const learning = [], review = [], fresh = [];
  for (const card of cards) {
    const st = statesDoc.cards[card.id] || null;
    if (!st || st.state === CARD_STATE.new) fresh.push({ card, st });
    else if (st.state === CARD_STATE.review) { if (new Date(st.due) <= end) review.push({ card, st }); }
    else if (new Date(st.due) <= end) learning.push({ card, st }); // learning/relearning
  }
  const byDue = (a, b) => new Date(a.st.due) - new Date(b.st.due);
  learning.sort(byDue); review.sort(byDue);
  const newToday = fresh.slice(0, Math.max(0, newBudget));
  const pack = ({ card, st }) => ({ ...card, srs: st, preview: previewIntervals(st, now) });
  return {
    counts: { new: newToday.length, learning: learning.length, review: review.length },
    cards: [...learning.map(pack), ...review.map(pack), ...newToday.map(pack)],
  };
}

// Base oficial de um produto (doc salvo ou defaults) — usada pelas rotas e
// pelo lembrete diário.
export async function flashcardsBase(repo, saas) {
  const doc = saas ? await repo.get("flashcards", saas) : null;
  return doc?.cards || DEFAULTS[saas] || [];
}

// Retrato da equipe num produto (rota /team e lembrete diário do Discord).
export async function teamSnapshot(repo, saas, cardsBase, now = new Date()) {
  const end = dayEnd(now);
  const today = dayKey(now);
  const users = (await repo.list("users"))
    .filter((u) => !u.saas || u.saas === saas) // respeita o escopo de produto do usuário
    .map((u) => ({ id: u.id, name: u.name, roles: Array.isArray(u.roles) ? u.roles : [] }));
  const reviews = (await repo.list("training_reviews")).filter((r) => r.saas === saas);
  const rows = [];
  for (const u of users) {
    const roles = rolesForUser(u);
    const deck = cardsBase.filter((c) => roles.includes(c.role));
    const statesDoc = (await repo.get("training_states", stateDocId(saas, u.id))) || EMPTY_STATES(saas, u.id);
    let dueToday = 0, overdue = 0, seen = 0;
    for (const card of deck) {
      const st = statesDoc.cards[card.id];
      if (!st || st.state === CARD_STATE.new) continue;
      seen++;
      const due = new Date(st.due);
      if (due <= end) { dueToday++; if (dayKey(due) < today) overdue++; }
    }
    const mine = reviews.filter((r) => r.user === u.id);
    const doneToday = mine.filter((r) => dayKey(new Date(r.at)) === today).length;
    const last7 = mine.filter((r) => now - new Date(r.at) <= 7 * 864e5);
    const again7dPct = last7.length ? Math.round((last7.filter((r) => r.rating === 1).length / last7.length) * 100) : null;
    const days = new Set(mine.map((r) => dayKey(new Date(r.at))));
    let streak = 0;
    for (let d = new Date(now.getTime() - (days.has(today) ? 0 : 864e5)); days.has(dayKey(d)); d = new Date(d.getTime() - 864e5)) streak++;
    const lastAt = mine.reduce((m, r) => (r.at > m ? r.at : m), "");
    rows.push({ ...u, deckSize: deck.length, seen, dueToday, overdue, doneToday, again7dPct, streak, lastReviewAt: lastAt || null });
  }
  return rows;
}

export function registerFlashcardRoutes(app, repo) {
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
  app.get("/api/flashcards/:saas/queue", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const now = new Date();
    const { cards, settings } = await baseDoc(product.id);
    const statesDoc = (await repo.get("training_states", stateDocId(product.id, user.id))) || EMPTY_STATES(product.id, user.id);
    const doneByRole = statesDoc.newDone[dayKey(now)] || {};
    const decks = [], queue = {};
    for (const role of rolesForUser(user)) {
      const deck = buildDeckQueue(cards.filter((c) => c.role === role), statesDoc, {
        now, newBudget: settings.newPerDay - (doneByRole[role] || 0),
      });
      decks.push({ role, label: ROLE_LABELS[role], total: cards.filter((c) => c.role === role).length, counts: deck.counts });
      queue[role] = deck.cards;
    }
    return { saas: product.id, today: dayKey(now), dayEnd: dayEnd(now).toISOString(), newPerDay: settings.newPerDay, decks, queue };
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
    const { cards } = await baseDoc(product.id);
    const card = cards.find((c) => c.id === String(req.body?.cardId || ""));
    if (!card) return reply.code(404).send({ error: "card não encontrado na base" });

    const now = new Date();
    const docId = stateDocId(product.id, user.id);
    const statesDoc = (await repo.get("training_states", docId)) || EMPTY_STATES(product.id, user.id);
    const prev = statesDoc.cards[card.id] || null;
    const wasNew = !prev || prev.state === CARD_STATE.new;
    const { card: next, log } = applyRating(prev, rating, now);
    statesDoc.cards[card.id] = next;

    if (wasNew) {
      const today = dayKey(now);
      const day = { ...(statesDoc.newDone[today] || {}) };
      day[card.role] = (day[card.role] || 0) + 1;
      // só os últimos 14 dias interessam (o limite é diário)
      statesDoc.newDone = Object.fromEntries(
        Object.entries({ ...statesDoc.newDone, [today]: day }).sort().slice(-14)
      );
    }

    const existing = await repo.get("training_states", docId);
    if (existing) await repo.update("training_states", docId, { cards: statesDoc.cards, newDone: statesDoc.newDone });
    else await repo.create("training_states", statesDoc);

    // log da revisão (dashboard/otimização) — best-effort, nunca trava o estudo.
    try {
      await repo.create("training_reviews", {
        saas: product.id, user: user.id, cardId: card.id, role: card.role,
        rating, prevState: log.state, due: next.due, at: now.toISOString(),
      });
    } catch { /* fail-open */ }

    return { cardId: card.id, srs: next, preview: previewIntervals(next, now) };
  });

  // Dashboard da equipe: quem está em dia, quem acumulou, acerto e sequência.
  app.get("/api/flashcards/:saas/team", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const { cards } = await baseDoc(product.id);
    return { saas: product.id, today: dayKey(new Date()), roleLabels: ROLE_LABELS, users: await teamSnapshot(repo, product.id, cards) };
  });

  app.put("/api/flashcards/:saas", async (req, reply) => {
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
