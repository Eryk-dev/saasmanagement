// Rotas do agente SDR externo (OpenBot): só a chave mestre ou um admin. A
// lógica mora em sdr-agent.js; aqui é só o endpoint de cada ação.
import { isAdmin } from "../auth/roles.js";

export function registerSdrAgentRoutes(app, agent) {
  const guard = (req, reply) => {
    if (!req.authUser || isAdmin(req.authUser)) return false;
    reply.code(403).send({ error: "Só a chave do agente SDR ou um admin" });
    return true;
  };
  const route = (path, run) => app.post(`/api/sdr/agent/leads/:id/${path}`, async (req, reply) => {
    if (guard(req, reply)) return;
    const { status, body } = await run(req.params.id, req.body || {});
    return reply.code(status).send(body);
  });
  route("send", agent.send);
  route("hold", agent.hold);
  route("book", agent.book);
  route("cancel", agent.cancel);
  route("confirm", agent.confirm);
  route("handoff", agent.handoff);
  route("opt-out", agent.optOut);
  route("callback", agent.callback);
  // Toque do relógio (SDR proativo): pode trazer o print do case em base64, por
  // isso o corpo maior que o padrão de 1 MB do Fastify.
  app.post("/api/sdr/agent/leads/:id/touch", { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    if (guard(req, reply)) return;
    const { status, body } = await agent.touch(req.params.id, req.body || {});
    return reply.code(status).send(body);
  });
}
