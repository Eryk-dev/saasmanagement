// Domínio do blog: páginas públicas (via proxy do site) e a redação por IA.
// Publica no ctx o motor do blog, que as rotas e o poller compartilham.

import { registerBlogPublicRoutes } from "./routes.blog-public.js";
import { registerBlogRoutes } from "./routes.blog.js";
import { makeBlogEngine, startBlogEngine } from "./blog-engine.js";
import { publicBase } from "../platform/request.js";

export function register(app, repo, ctx) {
  const { opts } = ctx;
  // Blog público (leverads.com.br/blog via proxy do copylever): índice, post,
  // categoria, sitemap, feed e preview assinado. Sem chave (OPEN_PREFIXES).
  registerBlogPublicRoutes(app, repo, opts.blogPublic || {});
  // Redação do blog: motor único (pautas → rascunho por IA → agenda → publica),
  // compartilhado pelas rotas e pelo poller (integrationClients.blogEngine).
  ctx.blogEngine = opts.blogEngine || makeBlogEngine({ repo, anthropic: ctx.anthropic, log: app.log });
  registerBlogRoutes(app, repo, { anthropic: ctx.anthropic, engine: ctx.blogEngine, publicBase });
}

export function start(repo, { clients, log }) {
  // Blog SEO: minera pautas, rascunha 1 post por ciclo e publica os agendados
  // (15 min). No-op sem doc app_config/blog_<saas> ou com rules.enabled=false;
  // sem IA configurada só publica o que já está agendado.
  startBlogEngine(repo, { engine: clients.blogEngine, log });
}
