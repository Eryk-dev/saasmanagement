// Domínio do SDR automatizado: o cérebro conversacional, o fluxo determinístico
// (primeiro toque, lembretes, resgate de no-show) e o handoff pro time.
// Publica no ctx o cérebro do SDR (sdrBrain).

import { registerSdrRoutes } from "./routes.sdr.js";
import { makeSdrBrain, startSdrBrainSweep } from "./sdr-brain.js";
import { startSdrFlow } from "./sdr-flow.js";
import { startSdrHandoffReminder } from "./sdr-handoff-reminder.js";
import { makeSdrAi } from "./sdr-ai.js";

export function register(app, repo, ctx) {
  // O cérebro nasce depois do cliente de WhatsApp (domínio whatsapp) e usa o
  // Meet do domínio google pra marcar e cancelar a call.
  // IA do robô: provedor/modelo escolhidos na aba Robô, sobre o cliente padrão.
  const sdrAi = ctx.opts.sdrAi || makeSdrAi({ base: ctx.anthropic });
  ctx.sdrBrain = ctx.opts.sdrBrain || makeSdrBrain({ repo, whatsapp: ctx.whatsapp, anthropic: ctx.anthropic, aiFor: (choice) => sdrAi.resolve(choice).client, autoCallMeet: ctx.autoCallMeet, cancelCallMeet: ctx.cancelCallMeet, log: app.log });
  // SDR automatizado: horários livres no servidor + templates + status +
  // bateria de replay (o motor determinístico é o poller startSdrFlow, com o
  // MESMO client).
  registerSdrRoutes(app, repo, { whatsapp: ctx.whatsapp, anthropic: ctx.anthropic, sdrAi });
}

export function start(repo, { clients, log, jobOn }) {
  // SDR automatizado (primeiro toque + lembretes de call + resgate de no-show):
  // poller de 60s, no-op sem product.sdrBot.enabled. Age em nome do SDR dono,
  // com autoria interna "sdr-bot" (fora da régua de contato humano).
  if (jobOn("sdrFlow")) startSdrFlow(repo, { ...clients, log });
  // Retomada do SDR conversacional: mensagem recebida que ficou SEM decisão
  // (a API reiniciou no meio do debounce/IA/atraso de resposta) é tratada de
  // novo no ciclo seguinte, em vez de morrer no silêncio (16/09: Vinicius).
  if (jobOn("sdrBrainSweep")) startSdrBrainSweep(clients.sdrBrain, { log });
  // Handoff do robô SDR sem ninguém assumir em 30 min vira aviso pro closer/dono
  // (e repete de 2h em 2h enquanto ninguém falar).
  if (jobOn("sdrHandoffReminder")) startSdrHandoffReminder(repo, { log });
}
