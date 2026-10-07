// Cockpit API — single source of truth for the portfolio cockpit.
// Fastify + SQLite. When COCKPIT_API_KEY is set, EVERY route requires the key
// (reads + writes) so nothing leaks; only the liveness check stays open.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { initDb, repo } from "./platform/db.js";
import { registerRoutes } from "./routes.js";
import { startDomains } from "./domains.js";
import { ensureBootstrapAdmin, makeAuthHook, userByAuthId } from "./auth/auth.js";
import { resolveAuthMode, makeJwksCache, makeJwtResolver } from "./auth/auth-jwt.js";
import { assertSafeBoot, makeJobGate } from "./platform/app-env.js";
import { makeCorsDelegator } from "./platform/cors-policy.js";
import { makeScreenGuardHook } from "./auth/screens.js";
import { runStartupMigrations, regenerateOpenLeadsToSlides } from "./platform/migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

const PORT = Number(process.env.API_PORT || 8787);
const API_KEY = process.env.COCKPIT_API_KEY || "";
// Routes that stay open even with a key (liveness probes from the PaaS + login).
const OPEN_PATHS = new Set(["/api/health", "/embed.js", "/favicon.ico", "/api/auth/login", "/api/google/callback", "/public/blog"]);
// Superfície pública do form builder (página + envio anônimo) e do proposal
// builder (página /p/:id, aceite, painel do closer via editKey). Endurecimento
// (rate-limit, honeypot, token) vive em routes.forms.js / routes.proposals.js.
const OPEN_PREFIXES = ["/f/", "/public/forms/", "/fi/", "/public/integration-forms/", "/p/", "/public/proposals/", "/public/mp/", "/public/social/", "/public/training/", "/public/users/", "/public/activities/", "/public/tasks/", "/public/followup/", "/public/lp/", "/u/", "/m/", "/api/webhooks/",
  // Link curto do convite de agenda (auth/booking-page.js): preview em português
  // no WhatsApp e redirecionamento pra agenda do Google de quem atende.
  "/a/",
  // Blog público (routes.blog-public.js): o copylever faz proxy de leverads.com.br/blog
  // pra cá. Sem o header x-blog-proxy tudo sai noindex + canonical em leverads.com.br,
  // então expor no host do cockpit não duplica conteúdo. Raiz `public` já está no nginx.
  "/public/blog/",
  // NPS (routes.nps.js): o cliente responde a nota pelo link do e-mail/WhatsApp,
  // sem login. O token de 32 hex do link é quem identifica a avaliação.
  "/public/nps/",
  // Portal do Suporte (routes.support-portal.js): o cliente abre, acompanha e
  // responde o chamado pelo link. O token de 32 hex identifica o chamado; abrir
  // chamado novo só funciona com o portal ligado no produto.
  "/s/", "/public/support/",
  // Cases públicos (routes.cases.js): o site da LeverAds faz proxy com cache
  // deste JSON. Só case autorizado e marcado como público sai daqui.
  "/public/cases",
  // Prints do deck de criação de anúncios (routes.proposals.js): imagens da
  // própria apresentação, carregadas pela página /p/:id sem login.
  "/public/deck/"];

// Read the key from either header style: `x-api-key: <key>` or `Authorization: Bearer <key>`.
// Exceção: /api/events (SSE) — EventSource não manda headers, então a key/token
// de sessão vem em `?key=` SÓ nessa rota (evita segredo em log de URL no resto).
function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  if (req.url.split("?")[0] === "/api/events") return String(req.query?.key || "");
  return "";
}

// Fora de produção, recusa subir com banco ou API de produção no env (app-env.js).
const APP_ENV = assertSafeBoot();
const jobOn = makeJobGate();
// Login pela identidade central (auth-jwt.js): legacy | dual | gotrue.
const AUTH_MODE = resolveAuthMode();

await initDb();
// Primeiro admin de um banco vazio, vindo de BOOTSTRAP_ADMIN_USER/PASSWORD
// (só quando `users` está vazia — nunca reseta senha).
await ensureBootstrapAdmin(repo);
// Migrações idempotentes de dados (ex.: garante o estágio "Integração" no funil).
await runStartupMigrations(repo);

const app = Fastify({ logger: true });
// O que as rotinas dos domínios precisam parar quando o app fecha.
const stops = [];
app.addHook("onClose", async () => { for (const stop of stops) stop(); });

const isOpenPath = (path) => OPEN_PATHS.has(path) || OPEN_PREFIXES.some((p) => path.startsWith(p));
// CORS restrito às origens do cockpit, exceto nas rotas abertas (cors-policy.js).
await app.register(cors, { delegator: makeCorsDelegator({ isOpenPath }) });
// Upload de criativo (vídeo) pra Meta — limite folgado pra vídeo de anúncio.
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 1 } });

// Auth: when COCKPIT_API_KEY is set, every route requires the key OR a valid
// user session token (same header). CORS preflight, liveness and login stay open.
app.addHook("onRequest", makeAuthHook({
  apiKey: API_KEY, repo,
  openPaths: OPEN_PATHS, openPrefixes: OPEN_PREFIXES,
  providedKey,
  authMode: AUTH_MODE,
  jwtUser: AUTH_MODE === "legacy" ? null : makeJwtResolver({
    jwks: makeJwksCache({ url: process.env.AUTH_JWKS_URL }),
    findUser: (sub) => userByAuthId(repo, sub),
    issuer: process.env.AUTH_JWT_ISSUER || "",
    log: app.log,
  }),
}));
// Restrição de telas por usuário (user.screens): sessão restrita só alcança as
// rotas das telas permitidas; key mestre (MCP/integrações) passa direto.
app.addHook("onRequest", makeScreenGuardHook());

registerRoutes(app);

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`Cockpit API ready on http://localhost:${PORT}  (APP_ENV=${APP_ENV}; AUTH_MODE=${AUTH_MODE}; master key: ${API_KEY ? "on" : "off — só sessão"})`);
  // Leads abertos que ainda apontam pro deck antigo (A/B) ganham a apresentação
  // em slides. É uma proposta nova por lead, então roda depois de ouvir.
  if (jobOn("regenerateOpenLeadsToSlides")) regenerateOpenLeadsToSlides(repo, { baseUrl: process.env.COCKPIT_PUBLIC_URL || "", log: app.log })
    .then((n) => { if (n) app.log.info(`[migration] apresentação em slides regerada pra ${n} lead(s) aberto(s)`); })
    .catch((err) => app.log.error(`[migration] regenerateOpenLeadsToSlides falhou: ${err?.message || err}`));
  // Rotinas em segundo plano de cada domínio (pollers, lembretes, syncs), com
  // os MESMOS clients das rotas. Cada uma é no-op sem a integração configurada;
  // o que cada domínio sobe e por quê está no start do index.js dele. `jobOn`
  // (app-env.js) liga ou desliga cada rotina pelo nome, fora de produção.
  startDomains(repo, { clients: app.integrationClients, log: app.log, stops, jobOn });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
