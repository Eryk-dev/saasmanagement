// Domínio de calls: resumo das calls de venda, briefing do integrador,
// consultas 1:1 (UniqueKids), copiloto ao vivo e análise de pitch.

import { registerPitchRoutes } from "./routes.pitch.js";
import { registerConsultationRoutes } from "./routes.consultations.js";
import { registerCopilotRoutes } from "./copilot.js";
import { startCallSummaries } from "./call-summaries.js";
import { startIntegrationBriefs } from "./integration-brief.js";
import { startConsultationSummaries } from "./consultations.js";

export function register(app, repo, ctx) {
  // Insight de pitch: melhora o roteiro de venda a partir dos resumos das calls.
  registerPitchRoutes(app, repo, { anthropic: ctx.anthropic });
  // Consultas 1:1 + Manual da Família (UniqueKids): Meet da consulta, resumo IA,
  // compor manual e página pública /m/:id. Depois do Google (usa os 2 clients).
  registerConsultationRoutes(app, repo, { google: ctx.google, googleUser: ctx.googleUser, anthropic: ctx.anthropic });
  // Copiloto da call: transcrição ao vivo (áudio da aba do Meet + mic, via
  // browser) + cues da IA sobre o roteiro. Rotas sob /api/leads → guard do
  // pipeline já cobre.
  registerCopilotRoutes(app, repo, { transcriber: ctx.opts.transcriber, anthropic: ctx.anthropic });
}

export function start(repo, { clients, log }) {
  // Resumo automático de calls: só faz algo com ANTHROPIC_API_KEY + Google conectado.
  startCallSummaries(repo, { ...clients, log });
  // Briefing de passagem pro integrador (card que entrou em Integração): tenta
  // de novo enquanto a transcrição da call de venda não fica pronta no Google.
  startIntegrationBriefs(repo, { ...clients, log });
  // Resumo automático das consultas 1:1 (UniqueKids): mesmo circuito, poller próprio.
  startConsultationSummaries(repo, { ...clients, log });
}
