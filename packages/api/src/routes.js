// Orquestrador das rotas REST: monta os clientes compartilhados de base (IA,
// Meta, Mercado Pago, Discord) num ctx e entrega a cada domínio, na ordem de
// domains.js. Os domínios acrescentam ao ctx os clientes que criam (Google,
// mailer, WhatsApp, SDR, blog). As rotas moram nas pastas de domínio.

import { repo as defaultRepo } from "./platform/db.js";
import { DOMAINS } from "./domains.js";
import { mp as defaultMpClient } from "./payments/mp.js";
import { meta as defaultMetaClient } from "./marketing/meta.js";
import { metaCapi as defaultMetaCapi } from "./marketing/meta-capi.js";
import { discord as defaultDiscord } from "./integrations/discord.js";
import { makeAnthropic } from "./integrations/anthropic.js";
import { makeSalesWhatsapp } from "./sdr/sales-whatsapp.js";

export function registerRoutes(app, repo = defaultRepo, opts = {}) {
  const ctx = { opts };
  // Avisos do funil num canal Discord (webhook único, fail-open) — injetado nas
  // superfícies que geram eventos: forms (lead), proposals (vista/aceite),
  // billing (baixa manual/dunning) e MP (pagamento/assinatura).
  ctx.discord = opts.discord || defaultDiscord;
  // Meta CAPI: "Lead" server-side, deduplicado com o Pixel client-side da página
  // pública do form (/f/:id) via event_id compartilhado.
  ctx.metaCapi = opts.metaCapi || defaultMetaCapi;
  // IA (resumo de call + variante de welcome): OpenRouter ou Anthropic direto,
  // detectado pela chave. Criado ANTES das rotas de form (suggest-welcome usa).
  ctx.anthropic = opts.anthropic || makeAnthropic({
    apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || "",
    model: process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || "",
  });
  // `salesWhatsapp` resolve o número CONECTADO na Cloud API pro botão/redirect
  // de WhatsApp do form (getter preguiçoso: o cliente nasce no domínio whatsapp,
  // e a função só é chamada em request; cache de 1h mora no makeSalesWhatsapp).
  ctx.salesWhatsapp = makeSalesWhatsapp(() => ctx.whatsapp);
  ctx.meta = opts.meta || defaultMetaClient;
  ctx.mp = opts.mp || defaultMpClient;

  for (const domain of DOMAINS) domain.register(app, repo, ctx);

  // As rotinas do index.js (startDomains) usam os MESMOS clients das rotas.
  // autoCallMeet vai junto: o poller do SDR cria a sala que falta na hora do
  // lembrete de 2h (sem link, o lembrete de 10min chamava pra lugar nenhum).
  if (!app.hasDecorator("integrationClients")) app.decorate("integrationClients", { google: ctx.google, googleUser: ctx.googleUser, anthropic: ctx.anthropic, mailer: ctx.mailer, whatsapp: ctx.whatsapp, autoCallMeet: ctx.autoCallMeet, blogEngine: ctx.blogEngine, sdrBrain: ctx.sdrBrain });
}
