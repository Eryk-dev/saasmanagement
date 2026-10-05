// Domínio de cobrança: planos, assinaturas, motor de billing e o acesso das
// orgs nos produtos.

import { registerBillingRoutes } from "./routes.billing.js";
import { registerLeveradsAccessRoutes, startLeveradsAccessSync } from "./leverads-access.js";
import { startBilling } from "./billing-runner.js";

export function register(app, repo, ctx) {
  // Billing (fase 5): mudança de plano c/ pró-rata, baixa de fatura, tick do motor.
  registerBillingRoutes(app, repo, { mp: ctx.mp, discord: ctx.discord });
  // LeverAds: liga/corta o paywall das orgs do produto conforme o billing daqui
  // (tick manual + report do dry-run; o poller sobe no start deste domínio).
  registerLeveradsAccessRoutes(app, repo, { ...(ctx.opts.leveradsAccess || {}) });
}

export function start(repo, { log }) {
  // Motor de billing (renovações + dunning + pendingChange) — antes só rodava
  // quando alguém chamava POST /api/billing/run; agora anda sozinho (1h).
  startBilling(repo, { log });
  // LeverAds: sincroniza o paywall das orgs do produto (payment_active) com o
  // billing daqui. No-op sem LEVERADS_ADMIN_EMAIL/PASSWORD; dry-run por padrão
  // (LEVERADS_ACCESS_APPLY=1 pra valer). Só toca orgs com de-para explícito.
  startLeveradsAccessSync(repo, { log });
}
