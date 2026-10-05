// Widget de feedback (todas as telas): o reporte vira card no quadro de Tarefas.

import { createTask } from "./tasks-core.js";

export function registerFeedbackRoutes(app, repo) {
  // ── Feedback (widget flutuante, toda tela) ────────────────────────────────
  // O reporte vira um card no quadro de Tarefas (label bug/melhoria) — nada de
  // coleção nova. Rota própria e aberta a qualquer sessão logada porque
  // /api/tasks exige a tela "tasks" e reportar bug tem que funcionar de
  // qualquer tela, por qualquer usuário. O servidor monta o card: título = 1ª
  // linha, contexto (tela + quem reportou, pelo authUser) na descrição, card no
  // FIM da primeira coluna do quadro (mesma régua de order do kanban).
  app.post("/api/feedback", async (req, reply) => {
    const kind = req.body?.kind === "melhoria" ? "melhoria" : "bug";
    const text = String(req.body?.text || "").trim();
    if (!text) return reply.code(400).send({ error: "escreva o reporte antes de enviar" });
    const photo = String(req.body?.photo || "");
    const [firstLine, ...rest] = text.split("\n");
    const context = `Reportado pelo widget de feedback · tela ${String(req.body?.screen || "?").slice(0, 80)} · por ${req.authUser?.name || "API key"}`;
    // createTask: card no FIM da primeira coluna (order = max + 1), quem
    // reportou vira seguidor (recebe "concluída" quando o bug for fechado).
    try {
      return await createTask(repo, {
        title: firstLine.trim().slice(0, 120),
        description: [rest.join("\n").trim(), context].filter(Boolean).join("\n\n"),
        saas: "", // geral: o card aparece no quadro em qualquer workspace
        priority: kind === "bug" ? "P1" : "P2", labels: [kind],
        cover: photo.startsWith("/public/tasks/") ? photo : "", // só asset nosso
      }, { by: req.authUser?.id || "api" });
    } catch (err) {
      if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      throw err;
    }
  });

  // O recorte que o painel do widget mostra (últimos reportes + colunas do
  // quadro pro status) — não expõe o board inteiro a quem não tem a tela.
  app.get("/api/feedback", async () => {
    const [tasks, boards] = await Promise.all([repo.list("tasks"), repo.list("task_boards")]);
    const reports = tasks
      .filter((t) => (t.labels || []).some((l) => l === "bug" || l === "melhoria"))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 4)
      .map((t) => ({ id: t.id, title: t.title, column: t.column, labels: t.labels, createdAt: t.createdAt, completed: !!t.completed }));
    return { reports, columns: boards[0]?.columns || [], doneKey: boards[0]?.doneKey ?? "" };
  });
}
