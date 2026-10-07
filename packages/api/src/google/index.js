// Domínio Google: conta conectada, Meet e agenda. Publica no ctx os clientes que
// os outros domínios usam (google, googleUser, meets) e o mailer, que envia pela
// conta Google.

import { registerGoogleRoutes } from "./routes.google.js";
import { makeMailer } from "../integrations/mailer.js";
import { startBookingSync } from "./booking-sync.js";

export function register(app, repo, ctx) {
  const { opts } = ctx;
  // Google Meet: conectar conta (OAuth) + criar call na agenda do closer.
  // Claude resume as calls (transcrição → timeline) quando há ANTHROPIC_API_KEY.
  const g = registerGoogleRoutes(app, repo, { google: opts.google, googleUser: opts.googleUser, anthropic: ctx.anthropic });
  Object.assign(ctx, {
    google: g.client, googleUser: g.googleUser, briefer: g.briefer,
    autoIntegrationMeet: g.autoIntegrationMeet, cancelIntegrationMeet: g.cancelIntegrationMeet,
    autoCallMeet: g.autoCallMeet, moveCallMeet: g.moveCallMeet, cancelCallMeet: g.cancelCallMeet,
  });
  // Mailer (e-mail dos disparos/sequências): hoje envia pela conta Google conectada.
  ctx.mailer = opts.mailer || makeMailer({ google: ctx.google });
}

export function start(repo, { clients, log, stops }) {
  // Marcação pelo link de convite da agenda → integração no card (booking-sync.js).
  const sync = startBookingSync(repo, { googleUser: clients.googleUser, google: clients.google, log });
  if (sync) stops?.push?.(sync.stop);
}
