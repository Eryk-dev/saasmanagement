// Hermes no ticket: o que a seção lateral precisa (retrato, permissões e as
// pessoas do Linear pra "passar para o time") e as ações do guia. Mesmo acesso
// das rotas de ticket: tela `tickets` (screens.js) + produto no escopo.

import { ticketScope, inScope } from "../auth/support-scope.js";
import { loadSettings } from "./tickets-core.js";
import { UPSTREAM_FAILED } from "../platform/http-status.js";
import { defaultLinear } from "./linear.js";
import { linearPeople } from "./ticket-linear.js";
import { hermesPermissions, runHermesAction } from "./hermes-actions.js";

const guarded = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply);
  } catch (err) {
    if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code || "" });
    throw err;
  }
};
const notFound = (reply) => reply.code(404).send({ error: "Not found" });

export function registerHermesRoutes(app, repo, { linear = defaultLinear } = {}) {
  const loadScoped = async (req) => {
    const t = await repo.get("tickets", req.params.id);
    return t && inScope(ticketScope(req.authUser), t.saas) ? t : null;
  };

  app.get("/api/tickets/:id/hermes", guarded(async (req, reply) => {
    const t = await loadScoped(req);
    if (!t) return notFound(reply);
    const { linear: lcfg } = await loadSettings(repo, t.saas);
    const perm = hermesPermissions(t, lcfg.hermes, req.authUser || null);
    // Pessoas só pra quem pode passar o card adiante (cache de 10 min).
    const people = perm.allowed.passar_time ? await linearPeople(linear).catch(() => []) : [];
    return {
      ...perm, mirror: !!(lcfg.enabled && lcfg.teamId), hermes: t.hermes || null,
      people: people.filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name })),
    };
  }));

  app.post("/api/tickets/:id/hermes", guarded(async (req, reply) => {
    const t = await loadScoped(req);
    if (!t) return notFound(reply);
    try {
      const r = await runHermesAction(repo, t.id, req.body || {}, { linear, user: req.authUser || null, log: app.log });
      return r ? r.ticket : notFound(reply);
    } catch (err) {
      if (err?.statusCode && err.statusCode < 500) throw err;
      // Erro do lado do Linear sai como 4xx (http-status.js), como no vínculo.
      app.log?.warn?.(`hermes (${req.body?.action || "?"} no ticket ${t.id}): ${err?.message}`);
      return reply.code(UPSTREAM_FAILED).send({ error: err?.message || "o Linear não respondeu", code: "linear_failed" });
    }
  }));
}
