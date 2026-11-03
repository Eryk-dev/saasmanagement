// Liberação do LeverPrice pelo status pago (lógica em leverprice-access.js).
// Sob o guard de Clientes (auth/screens.js).
//
//   GET  /api/leverprice-access/status   último relatório (liberados, previstos, esperando e o motivo)
//   POST /api/leverprice-access/run      { apply } roda agora; aplicar pede etiqueta admin

import { NOT_CONFIGURED, NOT_CONFIGURED_MSG, envLeverpriceClient, leverpriceAccessReport, runAndKeep } from "./leverprice-access.js";

const isAdmin = (u) => !u || (u.roles || []).includes("admin");

export function registerLeverpriceAccessRoutes(app, repo, { client } = {}) {
  app.get("/api/leverprice-access/status", async () => leverpriceAccessReport() || { mode: "never-ran" });
  app.post("/api/leverprice-access/run", async (req, reply) => {
    if (req.body?.apply === true && !isAdmin(req.authUser)) {
      return reply.code(403).send({ error: "Liberar o LeverPrice na mão exige etiqueta admin" });
    }
    const cli = client || envLeverpriceClient();
    if (!cli.configured()) return reply.code(NOT_CONFIGURED).send({ error: NOT_CONFIGURED_MSG });
    const apply = req.body?.apply === true || process.env.LEVERPRICE_ACCESS_APPLY === "1";
    return runAndKeep(repo, { client: cli, apply, log: req.log });
  });
}
