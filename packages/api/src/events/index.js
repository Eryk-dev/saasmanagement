// Domínio de eventos dos produtos: a caixa de entrada assinada e idempotente
// (events-core.js) e a timeline única do cliente e do lead (timeline.js).

import { registerEventRoutes } from "./routes.events.js";
import { startCrmEvents } from "./events-core.js";

export function register(app, repo) {
  registerEventRoutes(app, repo);
}

// Reentrega: pendentes, falhos e sem dono voltam a ser processados.
export function start(repo, { log, stops, jobOn }) {
  if (!jobOn("crmEvents")) return;
  const runner = startCrmEvents(repo, { log });
  stops?.push?.(runner.stop);
}
