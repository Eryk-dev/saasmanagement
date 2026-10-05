// Domínio de suporte: tickets, SLA, portal do cliente e o espelho com o Linear.

import { registerTicketRoutes } from "./routes.tickets.js";
import { registerSupportPortalRoutes } from "./routes.support-portal.js";
import { startTicketSla } from "./ticket-sla-runner.js";
import { startLinearSync } from "./ticket-linear-runner.js";

export function register(app, repo, ctx) {
  const { opts } = ctx;
  // Suporte: tickets (fila, kanban, conversa, SLA), configurações de SLA por
  // produto e atendentes (routes.tickets.js).
  registerTicketRoutes(app, repo, { mailer: ctx.mailer, ...(opts.linear ? { linear: opts.linear } : {}) });
  // Portal público do cliente: /s/:token (chamado) e /s/new/:saas (abrir).
  registerSupportPortalRoutes(app, repo, opts.supportPortal);
}

export function start(repo, { log }) {
  // SLA dos tickets de suporte: aviso a 80% e estouro (1ª resposta/resolução)
  // na caixa de entrada de quem atende + fechamento automático dos resolvidos.
  startTicketSla(repo, { log });
  // Espelho dos tickets com o Linear: drena a fila de saída (issue criada e
  // atualizada, mensagem vira comentário) e reconcilia as issues mudadas lá —
  // a rede de segurança do webhook /api/webhooks/linear. No-op sem LINEAR_API_KEY.
  startLinearSync(repo, { log });
}
