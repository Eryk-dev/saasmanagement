// Times (lógica em teams.js).
//
//   GET   /api/teams?saas=&all=1   times ativos do produto (all=1 traz os arquivados)
//   POST  /api/teams               { name, saas, kind, members, manager } (só admin)
//   PATCH /api/teams/:id           mesmo corpo, ou { status: "archived" } (só admin)
//
// Leitura aberta a quem está logado, como a lista de usuários.

import { createTeam, listTeams, updateTeam } from "./teams.js";

const isAdmin = (u) => !u || (u.roles || []).includes("admin");

export function registerTeamRoutes(app, repo) {
  const send = (reply, fn) => fn().catch((err) => {
    if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  });
  app.get("/api/teams", async (req) => ({ teams: await listTeams(repo, { saas: String(req.query?.saas || ""), all: req.query?.all === "1" }) }));
  app.post("/api/teams", async (req, reply) => {
    if (!isAdmin(req.authUser)) return reply.code(403).send({ error: "Criar time exige etiqueta admin" });
    return send(reply, async () => reply.code(201).send(await createTeam(repo, req.body)));
  });
  app.patch("/api/teams/:id", async (req, reply) => {
    if (!isAdmin(req.authUser)) return reply.code(403).send({ error: "Editar time exige etiqueta admin" });
    return send(reply, () => updateTeam(repo, req.params.id, req.body));
  });
}
