// Domínio e-mail: o mailer que os outros domínios usam (marketing, clientes,
// suporte) e a configuração do provedor em Configurações → Integrações.
// Registrado depois do google: sem Resend configurado, o envio cai no Gmail.

import { makeMailer } from "./mailer.js";
import { makeResend } from "./resend.js";
import { registerEmailRoutes } from "./routes.email.js";

export function register(app, repo, ctx) {
  const { opts } = ctx;
  const resend = opts.resend || makeResend();
  ctx.mailer = opts.mailer || makeMailer({ google: ctx.google, repo, resend });
  registerEmailRoutes(app, repo, { mailer: ctx.mailer, resend, google: ctx.google });
}
