// Base dos treinamentos: papéis, catálogo padrão de cards, entradas de cada
// card e o retrato da equipe (tela e lembrete diário). As rotas moram em
// routes.flashcards.js; o agendamento FSRS, em fsrs.js.

import { LEVERADS_DECKS } from "./flashcard-decks.leverads.js";
import { CARD_STATE, dayEnd, dayKey } from "./fsrs.js";
import { isAdmin } from "../auth/roles.js";

// Cartão: { id, role, front (pergunta/gatilho), back (resposta/técnica) }.
export const ROLE_LABELS = {
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
export const DEFAULTS = { leverads: LEVERADS_DECKS };

export const ROLES = new Set(Object.keys(ROLE_LABELS));

const ROLE_ORDER = Object.keys(ROLE_LABELS);

// {{c1::texto}} ou {{c1::texto::dica}} — mesmo formato do Anki.
export const CLOZE_RE = /\{\{c(\d+)::(.*?)\}\}/gs;

export function clozeIndexes(text) {
  const ns = new Set();
  for (const m of String(text || "").matchAll(CLOZE_RE)) ns.add(Number(m[1]));
  return [...ns].sort((a, b) => a - b);
}

// Um card pode virar vários itens de estudo: cloze por índice, occlusion por
// máscara. O estado FSRS (e a fila) é por ENTRY — `id`, `id::c1`, `id::m2`.
export function cardEntries(card) {
  if (card.type === "cloze") {
    const ns = clozeIndexes(card.front);
    if (ns.length) return ns.map((n) => ({ entryId: `${card.id}::c${n}`, sub: `c${n}` }));
  } else if (card.type === "occlusion") {
    return (card.masks || []).map((m) => ({ entryId: `${card.id}::${m.id}`, sub: m.id }));
  }
  return [{ entryId: card.id, sub: null }];
}

// Vagas que o usuário treina: os DOIS baralhos de conhecimentos gerais entram
// pra todo mundo, primeiro (a porta de entrada do treinamento); a partir deles
// a pessoa segue no fluxo da vaga dela (etiquetas do cadastro, roles do funil).
// Admin SEM vaga não recebe fila nenhuma (antes, "sem etiqueta" caía em todos
// os baralhos, o oposto de isento); admin QUE TAMBÉM tem vaga mantém a fila
// dela pra estudar quando quiser, só não é cobrado (fora do quadro da equipe).
// Cadastro novo, ainda sem etiqueta nenhuma, segue vendo tudo.
export function rolesForUser(user) {
  const tags = (user?.roles || []).filter((r) => ROLES.has(r));
  if (tags.length) return ROLE_ORDER.filter((r) => GENERAL_ROLES.includes(r) || tags.includes(r));
  return isAdmin(user) ? [] : [...ROLE_ORDER];
}

export const stateDocId = (saas, userId) => `${saas}__${userId}`;

export const EMPTY_STATES = (saas, userId) => ({ id: stateDocId(saas, userId), saas, user: userId, cards: {}, newDone: {} });

// Base oficial de um produto (doc salvo ou defaults) — usada pelas rotas e
// pelo lembrete diário.
export async function flashcardsBase(repo, saas) {
  const doc = saas ? await repo.get("flashcards", saas) : null;
  return doc?.cards || DEFAULTS[saas] || [];
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

// `onlyUser` recorta a foto numa pessoa só: é como o card "Sua memória" da aba
// Estudar lê retenção/maduros/acerto de primeira sem duplicar régua nenhuma (a
// conta é a MESMA da aba Equipe, o que garante que o aluno e o gestor nunca
// vejam números diferentes do mesmo dado). Pedido explícito passa por cima do
// filtro de admin: o dono da operação não é cobrado no quadro, mas vê a
// própria memória quando estuda.
// `preloaded`: listas/docs que o chamador já leu (o /stats lê reviews, 4fun e
// o estado da pessoa pra si mesmo) — evita reler as mesmas coleções na mesma
// requisição. Faltando alguma, lê do repo como sempre.
export async function teamSnapshot(repo, saas, cardsBase, now = new Date(), { onlyUser = "", preloaded = {} } = {}) {
  const end = dayEnd(now);
  const today = dayKey(now);
  const [usersAll, reviewsAll, examsAll, funAll] = await Promise.all([
    repo.list("users"),
    preloaded.reviews || repo.list("training_reviews"),
    preloaded.exams || repo.list("training_exams"),
    preloaded.funLog || repo.list("training_fun"),
  ]);
  const users = usersAll
    .filter((u) => !u.saas || u.saas === saas) // respeita o escopo de produto do usuário
    // Admin fica FORA do quadro de cobrança: treinamento é opcional pra quem
    // toca o negócio, então listar ele como "atrasado" seria ruído.
    .filter((u) => (onlyUser ? u.id === onlyUser : !isAdmin(u)))
    .map((u) => ({ id: u.id, name: u.name, roles: Array.isArray(u.roles) ? u.roles : [] }));
  const reviews = reviewsAll.filter((r) => r.saas === saas);
  const exams = examsAll.filter((e) => e.saas === saas);
  // 4fun: estudo livre além da cota. Fica FORA de tudo que é cobrança (due,
  // retenção, sequência) e aparece em coluna própria — é mérito, não meta.
  const funLog = funAll.filter((r) => r.saas === saas);
  // Estado de cada pessoa numa leva só (era um await por usuário dentro do laço).
  const stateDocs = await Promise.all(users.map((u) => preloaded.states?.[u.id] || repo.get("training_states", stateDocId(saas, u.id))));
  const rows = [];
  for (const [i, u] of users.entries()) {
    const roles = rolesForUser(u);
    // o baralho conta ENTRIES (cloze/occlusion viram vários itens de estudo)
    const deck = cardsBase.filter((c) => roles.includes(c.role)).flatMap((c) => cardEntries(c).map((e) => ({ ...e, role: c.role })));
    const statesDoc = stateDocs[i] || EMPTY_STATES(saas, u.id);
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
    const examAvg = doneExams.length ? Math.round(doneExams.reduce((a, e) => a + (e.score || 0), 0) / doneExams.length) : null;
    // histórico (mais recente primeiro): a tela abre cada uma pra ver as questões
    const examList = doneExams.slice(-12).reverse().map((e) => ({
      id: e.id, score: e.score ?? null, status: e.status,
      finishedAt: e.finishedAt || null, questions: (e.questions || []).length,
    }));

    rows.push({
      ...u, deckSize: deck.length, seen, dueToday, overdue, doneToday, again7dPct, streak, lastReviewAt: lastAt || null,
      mature, young, forecast,
      retention7d, retention30d, firstTryPct, retentionByRole, weekly,
      activeDays30d, reviewsPerDay30d, days, medianMs, rushPct, fun,
      examsDone: doneExams.length,
      examsFailed: doneExams.filter((e) => e.status === "failed").length,
      examAvg, exams: examList,
      lastExam: lastExam ? { score: lastExam.score, status: lastExam.status } : null,
      examPending: myExams.some((e) => e.status === "pending"),
    });
  }
  return rows;
}

export const FLASHCARD_DEFAULTS = DEFAULTS;
