// FSRS (o algoritmo do Anki moderno) por trás dos treinamentos — embrulha a
// ts-fsrs no que as rotas precisam: estado por card serializável em JSON puro,
// próximo estado por rating (1 Errei · 2 Difícil · 3 Bom · 4 Fácil), preview
// dos intervalos pros 4 botões e o "dia de estudo" no fuso de São Paulo com
// virada às 4h (régua do Anki: estudar 1h da manhã conta como o dia anterior).

import { fsrs, generatorParameters, createEmptyCard } from "ts-fsrs";

// Sem fuzz: intervalos determinísticos (testável e previsível pro treinando).
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

// 0 novo · 1 aprendendo · 2 revisão · 3 reaprendendo (enum State da ts-fsrs).
export const CARD_STATE = { new: 0, learning: 1, review: 2, relearning: 3 };

// São Paulo é UTC-3 fixo (sem horário de verão desde 2019); -4h é a virada.
const DAY_SHIFT_MS = (3 + 4) * 3600 * 1000;

export function dayKey(at = new Date()) {
  return new Date(at.getTime() - DAY_SHIFT_MS).toISOString().slice(0, 10);
}

// Fim do dia de estudo corrente: a próxima virada (4h em SP = 7h UTC).
export function dayEnd(at = new Date()) {
  return new Date(Date.parse(`${dayKey(at)}T07:00:00Z`) + 24 * 3600 * 1000);
}

const plain = (x) => JSON.parse(JSON.stringify(x));

// Aplica um rating ao estado atual (ou a um card virgem) e devolve o novo
// estado + o log da revisão (estado ANTES, pro training_reviews).
export function applyRating(state, rating, at = new Date()) {
  const { card, log } = scheduler.next(state || createEmptyCard(at), at, rating);
  return { card: plain(card), log: plain(log) };
}

// Intervalos que cada botão daria AGORA, no formato curto do Anki
// ("<1min", "10min", "3d", "2,1m"). O front mostra embaixo de cada botão.
export function previewIntervals(state, at = new Date()) {
  const rec = scheduler.repeat(state || createEmptyCard(at), at);
  const out = {};
  for (const rating of [1, 2, 3, 4]) {
    out[rating] = formatSpan(new Date(rec[rating].card.due).getTime() - at.getTime());
  }
  return out;
}

function formatSpan(ms) {
  const min = ms / 60000;
  if (min < 1) return "<1min";
  if (min < 60) return `${Math.round(min)}min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 31) return `${Math.round(d)}d`;
  const mo = d / 30.44;
  if (mo < 12) return `${mo.toFixed(1).replace(".", ",").replace(",0", "")}m`;
  return `${(d / 365.25).toFixed(1).replace(".", ",").replace(",0", "")}a`;
}
