// Domínio de marketing: Meta (insights, veiculação, criativos), redes sociais,
// disparos, sequências de nutrição e os webhooks de entrada (Shopify, Linear).

import { registerWebhookRoutes } from "./routes.webhooks.js";
import { registerMarketingRoutes } from "./routes.marketing.js";
import { registerAdDeliveryRoutes, startAdDelivery } from "./ad-delivery.js";
import { registerSocialRoutes } from "./routes.social.js";
import { registerCampaignRoutes } from "./routes.disparos.js";
import { registerSequenceRoutes } from "./routes.sequences.js";
import { startMarketingAutoSync } from "./meta-sync.js";
import { startDripSequences } from "./drip-runner.js";
import { startStoriesCapture } from "./stories-capture.js";
import { startShopifySync } from "./shopify-sync.js";
import { makeShopify } from "./shopify.js";

export function register(app, repo, ctx) {
  const { opts } = ctx;
  // Webhooks de entrada (Shopify da UniqueKids → lead pra Ana). Rota aberta,
  // autenticada por assinatura HMAC da Shopify (ver routes.webhooks.js).
  registerWebhookRoutes(app, repo, { ...(opts.linear ? { linear: opts.linear } : {}), ...(opts.webhooks || {}) });
  // Marketing: sync de insights da Meta + métricas cruzadas com o funil.
  registerMarketingRoutes(app, repo, { meta: ctx.meta });
  // Regras de veiculação (agenda cheia pausa, janela de fim de semana, sexta
  // curta, orçamento alvo) — config/estado/log + tick manual; o poller sobe no
  // start deste domínio.
  registerAdDeliveryRoutes(app, repo, { meta: ctx.meta });
  // Mídia social: métricas do perfil + publicação orgânica (IG/página FB) +
  // copy do post por IA (mesma chave OpenRouter/Anthropic do resto).
  registerSocialRoutes(app, repo, { social: opts.social, meta: ctx.meta, anthropic: ctx.anthropic });
  // Disparos: campanhas de e-mail + WhatsApp pros leads qualificados (ferramenta).
  // Depende do googleClient/mailer (domínio google, registrado antes): o envio
  // nativo de e-mail (send-email) e o gate de gmail usam os dois.
  registerCampaignRoutes(app, repo, { anthropic: ctx.anthropic, google: ctx.google, mailer: ctx.mailer });
  // Sequências de nutrição (drip): rotas de inscrição/avanço/métricas + tick manual.
  registerSequenceRoutes(app, repo, { mailer: ctx.mailer });
}

export function start(repo, { clients, log }) {
  // Sync automático da Meta no servidor (uma execução pro time inteiro; no-op
  // sem META_ACCESS_TOKEN). O SPA só lê — não faz mais polling por aba.
  startMarketingAutoSync(repo, { log });
  // Regras de veiculação dos anúncios (agenda cheia pausa, janela de fim de
  // semana, orçamento alvo): tick invariante de 60s; regra nasce desligada, o
  // toggle vive na tela Publicidade. No-op sem META_ACCESS_TOKEN.
  startAdDelivery(repo, { log });
  // Sequências de nutrição (drip): auto-inscreve e avança os passos (e-mail pela
  // conta Google; WhatsApp fica na fila assistida). No-op sem sequência ativa.
  startDripSequences(repo, { ...clients, log });
  // Captura de stories do Instagram de hora em hora (a Graph só entrega story
  // vivo): alimenta o "Stories" da Análise de Desempenho. No-op sem token.
  startStoriesCapture(repo, { log });
  // Reconciliação da Shopify (UniqueKids): puxa os pedidos pagos e preenche os
  // leads que faltam — rede de segurança pro webhook orders/paid (que ficou 8
  // dias sem entregar). No-op sem SHOPIFY_ADMIN_TOKEN + SHOPIFY_STORE.
  startShopifySync(repo, {
    shopify: makeShopify({
      store: process.env.SHOPIFY_STORE || "4b778b.myshopify.com",
      token: process.env.SHOPIFY_ADMIN_TOKEN || "",
    }),
    log,
  });
}
