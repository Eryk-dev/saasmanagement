// Views salvas por usuário (Lever CRM, transversais): um conjunto de filtros de
// uma tela com nome ("meus leads de autopeças", "follow-ups do Leo"). Ficam no
// servidor, então seguem a pessoa de máquina em máquina; cada um só vê e apaga
// as suas.
//
//   GET    /api/views?screen=pipeline   as views da pessoa naquela tela
//   POST   /api/views                   { screen, name, filters }
//   DELETE /api/views/:id

const SCREEN_RE = /^[a-z_]{2,30}$/;

export function registerViewRoutes(app, repo) {
  const me = (req) => req.authUser?.id || "api";
  app.get("/api/views", async (req) => {
    const screen = String(req.query?.screen || "");
    const mine = await repo.listWhere("saved_views", { user: me(req), ...(SCREEN_RE.test(screen) ? { screen } : {}) });
    return { views: mine.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")) };
  });
  app.post("/api/views", async (req, reply) => {
    const screen = String(req.body?.screen || "");
    const name = String(req.body?.name || "").trim().slice(0, 60);
    const filters = req.body?.filters;
    if (!SCREEN_RE.test(screen) || !name) return reply.code(400).send({ error: "Informe a tela e um nome para a view." });
    if (!filters || typeof filters !== "object" || JSON.stringify(filters).length > 4000) return reply.code(400).send({ error: "Filtros inválidos." });
    return reply.code(201).send(await repo.create("saved_views", { user: me(req), screen, name, filters, createdAt: new Date().toISOString() }));
  });
  app.delete("/api/views/:id", async (req, reply) => {
    const v = await repo.get("saved_views", req.params.id);
    if (!v || v.user !== me(req)) return reply.code(404).send({ error: "View não encontrada." });
    await repo.remove("saved_views", v.id);
    return { removed: true };
  });
}
