// Portal público do Suporte: o cliente abre, acompanha e responde o chamado
// sem login (prefixos /s/ e /public/support/ em OPEN_PREFIXES do index.js e no
// proxy do nginx). Mesmo desenho do NPS: o token opaco de 32 hex do link é quem
// identifica o chamado.
//
// Endurecimento da escrita anônima: rate-limit por IP (makeRateLimiter),
// honeypot `_hp` (preenchido = bot → finge sucesso e descarta), texto e anexo
// com os mesmos limites da equipe. Tudo que sai passa por publicTicket — nota
// interna, anexo interno, responsável e SLA ficam no cockpit.

import { makeRateLimiter } from "./forms.js";
import { clientIp } from "./routes.forms.js";
import { ACTOR_PORTAL, addMessage, addTicketAttachment, createTicket, loadSettings } from "./tickets-core.js";
import { readTicketUpload, sendTicketAsset } from "./routes.tickets.js";
import { publicTicket, supportTicketHtml, supportNewTicketHtml, supportNotFoundHtml } from "./support-page.js";

const TOKEN_RE = /^[0-9a-f]{32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const digits = (s) => String(s || "").replace(/\D/g, "");
const html = (reply, code, body) => reply.code(code).type("text/html").header("cache-control", "no-store").send(body);

export function registerSupportPortalRoutes(app, repo, { limits = {} } = {}) {
  const allowRead = makeRateLimiter({ limit: limits.read ?? 60, windowMs: 60_000 });
  const allowWrite = makeRateLimiter({ limit: limits.write ?? 20, windowMs: 60_000 });
  const allowOpen = makeRateLimiter({ limit: limits.open ?? 5, windowMs: 60_000 });
  const allowUpload = makeRateLimiter({ limit: limits.upload ?? 10, windowMs: 60_000 });

  const byToken = async (token) => {
    const t = String(token || "");
    if (!TOKEN_RE.test(t)) return null;
    const found = await repo.listWhere("tickets", { portalToken: t }).catch(() => []);
    return found[0] || null;
  };
  const viewOf = async (ticket) => {
    const [users, product] = await Promise.all([repo.list("users").catch(() => []), repo.get("products", ticket.saas).catch(() => null)]);
    return publicTicket(ticket, { users, product });
  };
  const tooMany = (reply) => reply.code(429).send({ error: "Muitas tentativas. Tente de novo em instantes." });

  // ── Página do chamado ─────────────────────────────────────────────────────
  app.get("/s/:token", async (req, reply) => {
    if (!allowRead(clientIp(req))) return html(reply, 429, supportNotFoundHtml("Muitas tentativas. Tente de novo em instantes."));
    const ticket = await byToken(req.params.token);
    if (!ticket) return html(reply, 404, supportNotFoundHtml());
    const settings = await loadSettings(repo, ticket.saas);
    return html(reply, 200, supportTicketHtml({ token: ticket.portalToken, view: await viewOf(ticket), portalEnabled: settings.portal.enabled }));
  });

  // O mesmo recorte em JSON (integrações e testes).
  app.get("/public/support/:token", async (req, reply) => {
    if (!allowRead(clientIp(req))) return tooMany(reply);
    const ticket = await byToken(req.params.token);
    return ticket ? viewOf(ticket) : reply.code(404).send({ error: "Chamado não encontrado." });
  });

  app.post("/public/support/:token/messages", async (req, reply) => {
    if (!allowWrite(clientIp(req))) return tooMany(reply);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (String(body._hp || "").trim() !== "") return { ok: true };
    const ticket = await byToken(req.params.token);
    if (!ticket) return reply.code(404).send({ error: "Chamado não encontrado." });
    try {
      const r = await addMessage(repo, ticket.id, { kind: "reply", text: body.text, attachments: Array.isArray(body.attachments) ? body.attachments : [] }, { by: ACTOR_PORTAL });
      return reply.code(201).send({ ok: true, ticket: await viewOf(r.ticket) });
    } catch (err) {
      if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code || "" });
      throw err;
    }
  });

  app.post("/public/support/:token/attachments", async (req, reply) => {
    if (!allowUpload(clientIp(req))) return tooMany(reply);
    const ticket = await byToken(req.params.token);
    if (!ticket) return reply.code(404).send({ error: "Chamado não encontrado." });
    if (ticket.status === "closed") return reply.code(409).send({ error: "Este chamado foi encerrado.", code: "ticket_closed" });
    const up = await readTicketUpload(req, reply, repo, ticket.id, ACTOR_PORTAL);
    if (!up) return reply;
    const r = await addTicketAttachment(repo, ticket.id, up, { by: ACTOR_PORTAL, isPublic: true });
    return reply.code(201).send({ ok: true, attachment: { id: r.attachment.id, name: r.attachment.name, size: r.attachment.size } });
  });

  app.get("/public/support/:token/attachments/:aid", async (req, reply) => {
    if (!allowRead(clientIp(req))) return tooMany(reply);
    const ticket = await byToken(req.params.token);
    const att = ticket && (ticket.attachments || []).find((a) => a.id === req.params.aid);
    if (!ticket || !att?.public) return reply.code(404).send({ error: "arquivo não encontrado" });
    return sendTicketAsset(reply, repo, ticket, att.id);
  });

  // ── Abrir chamado novo ────────────────────────────────────────────────────
  const openPortal = async (saas) => {
    const id = String(saas || "").toLowerCase();
    const product = await repo.get("products", id).catch(() => null);
    if (!product) return null;
    const settings = await loadSettings(repo, id);
    return settings.portal.enabled ? { product, settings } : null;
  };

  app.get("/s/new/:saas", async (req, reply) => {
    const portal = await openPortal(req.params.saas);
    if (!portal) return html(reply, 404, supportNotFoundHtml("O atendimento por este link não está disponível."));
    return html(reply, 200, supportNewTicketHtml(portal));
  });

  app.post("/public/support/new/:saas", async (req, reply) => {
    if (!allowOpen(clientIp(req))) return tooMany(reply);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (String(body._hp || "").trim() !== "") return { ok: true };
    const portal = await openPortal(req.params.saas);
    if (!portal) return reply.code(404).send({ error: "O atendimento por este link não está disponível." });
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const subject = String(body.subject || "").trim();
    const description = String(body.description || "").trim();
    if (!name || !subject || !description) return reply.code(400).send({ error: "Preencha nome, resumo e detalhes.", code: "fields_required" });
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: "Confira o e-mail: é por ele que avisamos a resposta.", code: "email_invalid" });

    // Solicitante que já é cliente do produto: vincula pelo e-mail, senão pelo telefone.
    const saas = portal.product.id;
    const customers = await repo.listWhere("customers", { saas }).catch(() => []);
    const phone = digits(body.phone);
    const customer = customers.find((c) => String(c.email || "").trim().toLowerCase() === email)
      || (phone.length >= 10 ? customers.find((c) => digits(c.phone).slice(-10) === phone.slice(-10)) : null);

    try {
      const ticket = await createTicket(repo, {
        saas, subject, description, channel: "portal",
        category: String(body.category || ""),
        customerId: customer?.id || "",
        requester: { name, email, phone: String(body.phone || "") },
      }, { by: ACTOR_PORTAL });
      return reply.code(201).send({ ok: true, number: ticket.number, url: `/s/${ticket.portalToken}` });
    } catch (err) {
      if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code || "" });
      throw err;
    }
  });
}
