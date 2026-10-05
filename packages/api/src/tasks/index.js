// Domínio de tarefas: quadro de Tarefas, widget de feedback e a sugestão de
// rotina (UniqueKids).

import { registerRoutineRoutes } from "./routes.routine.js";
import { registerFeedbackRoutes } from "./routes.feedback.js";
import { registerTaskRoutes } from "./routes.tasks.js";
import { startTaskReminder } from "./task-reminder.js";

export function register(app, repo, ctx) {
  // UniqueKids · sugestão de solução da rotina por IA (método R.O.T.I.N.A) no lead.
  registerRoutineRoutes(app, repo, { anthropic: ctx.anthropic });
  // Widget de feedback: o reporte vira card no quadro de Tarefas.
  registerFeedbackRoutes(app, repo);
  // Quadro de Tarefas: mover, concluir, comentários, subtarefas, anexos,
  // ações em massa, atividade + caixa de entrada (routes.tasks.js).
  registerTaskRoutes(app, repo);
}

export function start(repo, { log, jobOn }) {
  // Lembrete diário das tarefas (vence hoje / atrasada) na caixa de entrada de
  // cada pessoa + resumo no Discord quando configurado.
  if (jobOn("taskReminder")) startTaskReminder(repo, { log });
}
