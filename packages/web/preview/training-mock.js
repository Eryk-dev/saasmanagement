// Dados exclusivamente da prévia; não entram no build do CRM.
const DAY = 86400000;
const date = (n = 0) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const labels = { geral_negocio: "Negócio LeverAds", geral_marketplace: "Marketplace", sdr: "SDR" };
let cards = Object.keys(labels).flatMap((role, r) => [
  { id: `${role}-1`, role, type: "basic", front: ["Qual problema a LeverAds resolve?", "Como evitar vender um item sem estoque?", "Qual é o objetivo do primeiro contato?"][r], back: ["Centralizar a operação de múltiplas contas de marketplace.", "Manter o estoque sincronizado entre as contas.", "Entender a operação e confirmar se existe aderência ao produto."][r] },
  { id: `${role}-2`, role, type: "basic", front: ["Como reconhecer o perfil ideal de cliente?", "Por que acompanhar a margem de cada anúncio?", "Como confirmar a presença na call?"][r], back: ["Conferir o volume e a complexidade da operação.", "Para avaliar o resultado depois dos custos.", "Confirmar o horário e compartilhar o link da reunião."][r] },
  { id: `${role}-3`, role, type: "basic", front: `Qual rotina deve ser repetida em ${labels[role]}?`, back: "Acompanhar os indicadores e registrar o próximo passo." },
  { id: `${role}-4`, role, type: "basic", front: `Qual sinal exige atenção em ${labels[role]}?`, back: "Uma pendência sem responsável ou prazo definido." },
]);
let reviewed = new Set();
let funDone = 0;
let examDone = false;
let settings = { newPerDay: 10, examEvery: 5, examPass: 70, examQuestions: 5 };
const preview = { 1: "1 min", 2: "6 min", 3: "1 dia", 4: "4 dias" };
const dueCards = () => cards.filter((c) => !reviewed.has(c.id) && !c.id.endsWith('-4'));
const examPending = () => new URLSearchParams(location.search).has("exam") && !examDone;
const queue = () => ({
  dayEnd: `${date()}T23:59:59Z`,
  decks: Object.entries(labels).map(([role, label]) => {
    const all = cards.filter((c) => c.role === role);
    const due = dueCards().filter((c) => c.role === role);
    return { role, label, total: all.length, learned: all.filter((c) => c.id.endsWith('-3') || c.id.endsWith('-4') || reviewed.has(c.id)).length,
      counts: { new: due.filter((c) => c.id.endsWith('-1')).length, learning: due.filter((c) => c.id.endsWith('-2')).length, review: due.filter((c) => c.id.endsWith('-3')).length } };
  }),
  queue: Object.fromEntries(Object.keys(labels).map((role) => [role, dueCards().filter((c) => c.role === role).map((c) => ({ ...c, entryId: c.id, preview, srs: { state: c.id.endsWith('-1') ? 0 : c.id.endsWith('-2') ? 1 : 2 } }))])),
  exam: examPending() ? { id: "preview-exam", count: 5 } : null,
});
const history = () => Object.fromEntries(Array.from({ length: 98 }, (_, i) => [date(-i), i % 8 === 0 ? 0 : (i % 5 + 1) * 3]));
const stats = () => ({ today: date(), streak: 7, bestStreak: 14, doneToday: reviewed.size, days: history(), fun: { total: 20 + funDone },
  memory: { retention30d: 82, reviews30d: 84, mature: 3, young: 3 + reviewed.size, seen: 9, deckSize: cards.length, firstTryPct: 78, lastExam: { score: 80, status: "passed" }, examsDone: 2 },
  nextExam: { every: 5, pass: 70, pool: 3, remaining: 2 },
});
const questions = () => cards.slice(0, 5).map((c, i) => ({ id: `q${i}`, kind: "mc", prompt: c.front, options: [c.back, "Esperar sem registrar a próxima ação."], answerIdx: 0 }));
export const trainingMock = {
  trainingQueue: () => new URLSearchParams(location.search).get("state") === "empty" ? {decks:[],queue:{}} : queue(),
  trainingStats: stats,
  trainingReview: (_saas, id) => { reviewed.add(id); return { srs: { state: 2, due: `${date(1)}T12:00:00Z` }, preview }; },
  trainingFun: () => ({ cards: cards.map((c) => ({ ...c, entryId: c.id, preview })) }),
  trainingFunReview: () => { funDone++; return { ok: true }; },
  flashcards: () => ({ cards, roleLabels: labels, settings }),
  saveFlashcards: (_saas, nextCards, nextSettings) => { cards = structuredClone(nextCards); settings = structuredClone(nextSettings); return { cards, settings }; },
  trainingTeam: () => ({ today: date(), users: ["leo", "lucas", "tiago"].map((id, i) => ({ id, name: ["Leonardo", "Lucas", "Tiago"][i], roles: [i ? "closer" : "sdr"], deckSize: 12, seen: 9, mature: 3, young: 3 - i, dueToday: 9 - i, overdue: i, doneToday: 1, streak: 7 - i * 3,
    retention30d: { pct: 82 - i * 14, n: 84 }, retention7d: { pct: 80, n: 24 }, firstTryPct: 78, retentionByRole: [], weekly: [], forecast: [], days: history(),
    activeDays30d: 20, reviewsPerDay30d: 4, examsDone: 2, examsFailed: i === 2 ? 1 : 0, examPending: false, examAvg: 80, exams: [], lastExam: { score: i === 2 ? 60 : 80, status: i === 2 ? "failed" : "passed" }, fun: { total: 20, last30: 20, today: 0 },
  })) }),
  trainingExamStart: () => ({ count: 5, passScore: 70, questions: questions().map(({ answerIdx, ...q }) => q) }),
  trainingExamSubmit: (_saas, _id, answers) => {
    examDone = true;
    const scored = questions().map((q, i) => ({ ...q, choice: answers[i]?.choice, correct: answers[i]?.choice === q.answerIdx }));
    const score = scored.filter((q) => q.correct).length * 20;
    return { score, passScore: 70, passed: score >= 70, questions: scored };
  },
};
