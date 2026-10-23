// Configurações → Integrações → E-mail (Resend). Ler: quem tem a tela
// Configurações (auth/screens.js). Gravar, remover e testar: etiqueta admin.
// A chave nunca volta para a tela — só `last4`.

import { domainOf, publicEmailConfig, readEmailSecret, removeEmailConfig, saveEmailConfig } from "./email-config.js";
import { NOT_CONFIGURED, UPSTREAM_FAILED } from "../platform/http-status.js";
import { applyResendEvent, verifySvix } from "./resend-webhook.js";

const isAdmin = (user) => !user || (user.roles || []).includes("admin"); // sem usuário = key mestre

export function registerEmailRoutes(app, repo, { mailer, resend, google }) {
  // Estado do domínio do remetente no Resend (verificado libera o envio).
  async function domainStatus(cfg) {
    if (!cfg?.apiKey || !cfg?.fromEmail) return null;
    try {
      const want = domainOf(cfg.fromEmail);
      const d = (await resend.domains(cfg.apiKey)).find((x) => x.name === want || want.endsWith(`.${x.name}`));
      return d ? { name: d.name, status: d.status } : { name: want, status: "not_found" };
    } catch (err) {
      return { name: domainOf(cfg.fromEmail), status: "error", error: String(err.message || err).slice(0, 200) };
    }
  }
  async function state() {
    const cfg = await readEmailSecret(repo);
    return {
      ...publicEmailConfig(cfg),
      active: await mailer.provider(),
      gmail: !!(google?.gmailReady && (await google.gmailReady().catch(() => false))),
      domainStatus: await domainStatus(cfg),
    };
  }

  app.get("/api/email/config", async () => state());

  app.put("/api/email/config", async (req, reply) => {
    if (!isAdmin(req.authUser)) return reply.code(403).send({ error: "Configurar o e-mail exige a etiqueta admin" });
    try {
      await saveEmailConfig(repo, req.body || {}, { by: req.authUser?.id || "api" });
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message, errors: err.errors });
      throw err;
    }
    return state();
  });

  app.delete("/api/email/config", async (req, reply) => {
    if (!isAdmin(req.authUser)) return reply.code(403).send({ error: "Configurar o e-mail exige a etiqueta admin" });
    await removeEmailConfig(repo);
    return state();
  });

  // E-mail de teste pelo provedor ativo: confere chave, remetente e domínio de verdade.
  app.post("/api/email/test", async (req, reply) => {
    if (!isAdmin(req.authUser)) return reply.code(403).send({ error: "Testar o e-mail exige a etiqueta admin" });
    const to = String(req.body?.to || req.authUser?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply.code(400).send({ error: "Informe o e-mail que vai receber o teste" });
    const provider = await mailer.provider();
    if (!provider) return reply.code(NOT_CONFIGURED).send({ error: "Nenhum provedor de e-mail configurado" });
    try {
      const out = await mailer.send({ to, subject: "Teste de e-mail do Cockpit", text: `Este é um e-mail de teste enviado pelo Cockpit (${provider}). Se chegou, o envio está funcionando.` });
      return { ok: true, provider, to, id: out?.id || "" };
    } catch (err) {
      return reply.code(UPSTREAM_FAILED).send({ error: String(err.message || err).slice(0, 300), provider });
    }
  });

  // Webhook do Resend (rota aberta em /api/webhooks/, autenticada pela
  // assinatura Svix com o segredo salvo em Integrações). Instância encapsulada:
  // guarda o corpo cru sem mudar o parse JSON do resto do app.
  app.register(async (wh) => {
    wh.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
      req.rawBody = body;
      try { done(null, body && body.length ? JSON.parse(body.toString("utf8")) : {}); }
      catch (err) { err.statusCode = 400; done(err); }
    });
    wh.post("/api/webhooks/resend", async (req, reply) => {
      const secret = (await readEmailSecret(repo))?.webhookSecret || "";
      if (!secret) return reply.code(NOT_CONFIGURED).send({ error: "segredo do webhook do Resend não configurado" });
      if (!verifySvix(req.rawBody, req.headers, secret)) return reply.code(401).send({ error: "assinatura inválida" });
      const updated = await applyResendEvent(repo, req.body);
      return { ok: true, updated };
    });
  });
}
