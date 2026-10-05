// Domínio de treinamentos: flashcards por vaga com repetição espaçada.

import { registerFlashcardRoutes } from "./routes.flashcards.js";
import { startTrainingReminder } from "./training-reminder.js";

export function register(app, repo, ctx) {
  // Treinamentos: flashcards por vaga com repetição espaçada (FSRS) por pessoa
  // + prova de checkpoint (a IA corrige as questões digitadas).
  registerFlashcardRoutes(app, repo, { anthropic: ctx.anthropic });
}

export function start(repo, { log, jobOn }) {
  // Lembrete diário de treinamento (flashcards vencendo) — no-op sem Discord.
  if (jobOn("trainingReminder")) startTrainingReminder(repo, { log });
}
