// Domínio de pagamentos: Mercado Pago (links, assinaturas, webhook e
// reconciliação), links de pagamento das ofertas e o financeiro.

import { registerMpRoutes } from "./routes.mp.js";
import { registerOfferRoutes } from "./routes.offers.js";
import { registerFinRoutes } from "./routes.fin.js";
import { startMpSync } from "./mp-payments.js";
import { startPreapprovalSync } from "./mp-subscriptions.js";
import { startMpOutflowSync } from "./mp-outflow.js";
import { mp as defaultMp } from "./mp.js";

export function register(app, repo, ctx) {
  // Mercado Pago (fase 4): link de assinatura + webhook de baixa automática.
  registerMpRoutes(app, repo, { mp: ctx.mp, discord: ctx.discord });
  // Links de pagamento das ofertas (ferramenta).
  registerOfferRoutes(app, repo);
  registerFinRoutes(app, repo, { mp: ctx.mp });
}

export function start(repo, { log, jobOn }) {
  // Reconciliação do Mercado Pago (financeiro): espelha os pagamentos da conta
  // e dá baixa nas faturas — funciona mesmo SEM o webhook configurado no painel
  // (1º tick faz o backfill de 400 dias). No-op sem MERCADOPAGO_ACCESS_TOKEN.
  if (jobOn("mpSync")) startMpSync(repo, { log });
  // Espelho das assinaturas RECORRENTES da conta MP (inclusive as criadas fora
  // do cockpit): a tela Assinaturas → MP liga cada uma ao cliente. No-op sem
  // MERCADOPAGO_ACCESS_TOKEN.
  if (jobOn("preapprovalSync")) startPreapprovalSync(repo, { log });
  // SAÍDAS da conta MP (settlement report): pede o relatório e importa sozinho
  // — o fluxo do MP é assíncrono e antes exigia dois cliques com espera no
  // meio. No-op sem MERCADOPAGO_ACCESS_TOKEN.
  if (jobOn("mpOutflowSync")) startMpOutflowSync(repo, { mp: defaultMp, log });
}
