// Domínio de métricas: metas, publicidade e despesas, funil, pace do pipeline,
// placar por pessoa e Análise de Desempenho.

import { registerMetasRoutes } from "./routes.metas.js";
import { registerMetricsRoutes } from "./routes.metrics.js";
import { registerFunnelMetricsRoutes } from "./routes.funnel-metrics.js";
import { registerPipelinePaceRoutes } from "./routes.pipeline-pace.js";
import { registerScoreboardRoutes } from "./routes.scoreboard.js";
import { registerDesempenhoRoutes } from "./routes.desempenho.js";

export function register(app, repo, ctx) {
  const { opts } = ctx;
  // Metas de desempenho por vaga/pessoa (ferramenta; escreve na collection goals).
  registerMetasRoutes(app, repo);
  // getWhatsapp é getter: o client nasce no domínio whatsapp, registrado depois,
  // e o custo de WhatsApp do resumo de despesas resolve na hora do request.
  registerMetricsRoutes(app, repo, { getWhatsapp: () => ctx.whatsapp });
  // Métricas reais de funil (conversão/tempo por estágio, motivos de perda, SLA)
  // a partir do histórico de transições da timeline.
  registerFunnelMetricsRoutes(app, repo);
  // Pace de caixa do pipeline: recebido no mês → meta diária por papel.
  registerPipelinePaceRoutes(app, repo, opts.pipelinePace);
  // Placar por pessoa/papel (SDR/closer/CS) — o cockpit de gestão da Visão geral.
  registerScoreboardRoutes(app, repo, opts.scoreboard);
  // Análise de Desempenho: objeções por closer na janela, produção do social e
  // os registros manuais do dia (social selling / criativos).
  registerDesempenhoRoutes(app, repo, { social: opts.social, now: opts.scoreboard?.now, ...(opts.desempenho || {}) });
}
