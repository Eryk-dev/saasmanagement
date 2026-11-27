// Rotas do agente Cases (OpenBot), só leitura. Entregam fala de cliente: só a
// chave mestre (a porta do agente, na VPS do Hermes) ou um admin, como as do
// agente SDR; a sessão de qualquer outra pessoa do time leva 403. A lógica
// mora em cases-feed.js.
//
//   GET /api/calls/agent/meetings?since=AAAA-MM-DD&until=AAAA-MM-DD&kind=call|integracao|acompanhamento&saas=leverads
//       as reuniões que aconteceram, sem transcrição
//   GET /api/calls/agent/meetings/:id/transcript[?saas=leverads]
//       a transcrição inteira (a guardada, ou buscada no Google e guardada)
//   GET /api/calls/agent/cases
//       os cases autorizados pelo cliente, com a marca de "pode publicar"
import { isAdmin } from "../auth/roles.js";
import { MEETING_KINDS } from "./cases-feed.js";

// Dia de calendário de verdade (2026-13-01 não passa).
const isDay = (v) => {
  const t = Date.parse(`${v}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(t) && new Date(t).toISOString().startsWith(v);
};

// Produto das reuniões: LeverAds (Ads, Price e OEM) se não vier outro.
const saasOf = (req) => (req.query?.saas === undefined ? "leverads" : String(req.query.saas));

export function registerCasesFeedRoutes(app, feed) {
  const guard = (req, reply) => {
    if (!req.authUser || isAdmin(req.authUser)) return false;
    reply.code(403).send({ error: "Só a chave do agente ou um admin" });
    return true;
  };

  app.get("/api/calls/agent/meetings", async (req, reply) => {
    if (guard(req, reply)) return reply;
    const since = String(req.query?.since || "");
    const until = String(req.query?.until || "");
    const kind = String(req.query?.kind || "");
    if (!isDay(since) || (until && !isDay(until))) return reply.code(400).send({ error: "since=AAAA-MM-DD (obrigatório) e until=AAAA-MM-DD (opcional), dias de Brasília" });
    if (kind && !MEETING_KINDS.includes(kind)) return reply.code(400).send({ error: `kind: ${MEETING_KINDS.join(", ")}` });
    const meetings = await feed.meetings({ since, until, kind, saas: saasOf(req) });
    return { since, until, kind, saas: saasOf(req), count: meetings.length, meetings };
  });

  app.get("/api/calls/agent/meetings/:id/transcript", async (req, reply) => {
    if (guard(req, reply)) return reply;
    const r = await feed.transcript(req.params.id, { saas: saasOf(req) });
    return r.reason === "not_found" ? reply.code(404).send(r) : r;
  });

  app.get("/api/calls/agent/cases", async (req, reply) => {
    if (guard(req, reply)) return reply;
    const cases = await feed.cases();
    return { count: cases.length, cases };
  });
}
