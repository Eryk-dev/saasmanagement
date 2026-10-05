// Domínio WhatsApp (Cloud API): webhook, inbox, envio e automações. Publica no
// ctx o cliente de WhatsApp que SDR, clientes e bootstrap usam.

import { registerWhatsappRoutes } from "./routes.whatsapp.js";
import { startWaWaitingReminder } from "./wa-waiting-reminder.js";

export function register(app, repo, ctx) {
  const { opts } = ctx;
  // WhatsApp (Cloud API): webhook (recebe) + envio pelo drawer do lead. O SDR
  // conversa com o cliente direto no cockpit; as mensagens viram timeline.
  // O cérebro conversacional nasce DEPOIS (domínio sdr); o webhook o alcança
  // por getter preguiçoso (mesmo desenho do salesWhatsapp).
  ctx.whatsapp = registerWhatsappRoutes(app, repo, { whatsapp: opts.whatsapp, anthropic: ctx.anthropic, transcriber: opts.transcriber, getSdrBrain: () => ctx.sdrBrain });
}

export function start(repo, { log, jobOn }) {
  // Silêncio nosso no WhatsApp: cliente falou e ninguém voltou em N horas (3 por
  // padrão) vira aviso na caixa de entrada de quem cuida do lead.
  if (jobOn("waWaitingReminder")) startWaWaitingReminder(repo, { log });
}
