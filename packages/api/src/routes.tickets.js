// Rotas do módulo de Suporte. Duas camadas de acesso:
//   1. tela (screens.js): /api/tickets → `tickets`; /api/support/ →
//      `support_settings` (com leitura de carona pra `tickets`);
//   2. produto (support-scope.js): ticket de produto fora do escopo da sessão
//      responde 404, criar nele responde 403. A chave mestre vê tudo.
//
// `tickets`, `ticket_events`, `ticket_assets` e `ticket_settings` são PRIVATE
// no CRUD genérico (routes.js): o isolamento não pode ter porta dos fundos.
// Erro de domínio sai em 4xx com { error, code } (mesma régua de routes.tasks.js).

import { randomUUID } from "node:crypto";
import { ticketScope, inScope, isAdminUser, sanitizeSupportSaas } from "./support-scope.js";
import {
  ACTOR_API, httpError, createTicket, patchTicket, addMessage, addTicketAttachment, removeTicketAttachment,
  deleteTicket, bulkTickets, listTickets, ticketActivity, loadSettings, saveSettings,
  TICKET_STATUSES, TICKET_PRIORITIES, PRIORITY_LABEL, TICKET_CHANNELS, ticketTitle,
} from "./tickets-core.js";

const MAX_ASSET = 5 * 1024 * 1024;

const guarded = (fn) => async (req, reply) => {
  try {
    return await fn(req, reply);
  } catch (err) {
    if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code || "" });
    throw err;
  }
};
const actorOf = (req) => req.authUser?.id || ACTOR_API;
const notFound = (reply) => reply.code(404).send({ error: "Not found" });

// Base do link público (e-mail ao cliente, portal-link do MCP). Mesma régua do
// publicBase de routes.js: env manda; host local é http (era https fixo e o
// link saía https://localhost:8787, que não abre); host público é https.
export const baseUrlOf = (req) => {
  const env = process.env.COCKPIT_PUBLIC_URL || process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/+$/, "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return `http://localhost:${process.env.API_PORT || 8787}`;
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
  return `${local ? "http" : "https"}://${host}`;
};
export const portalLink = (baseUrl, ticket) => `${baseUrl}/s/${ticket.portalToken}`;

// Arquivo do ticket: bytes em base64 em `ticket_assets`, preso ao ticket
// (`ticket`), servido só por rota com escopo (interna) ou pelo token (portal).
export async function readTicketUpload(req, reply, repo, ticketId, by) {
  let file;
  try { file = await req.file({ limits: { fileSize: MAX_ASSET } }); }
  catch (err) { reply.code(413).send({ error: "arquivo acima de 5MB", code: "asset_too_large", detail: err?.message }); return null; }
  if (!file) { reply.code(400).send({ error: "envie um arquivo (multipart, campo file)" }); return null; }
  let buf;
  try { buf = await file.toBuffer(); }
  catch { reply.code(413).send({ error: "arquivo acima de 5MB", code: "asset_too_large" }); return null; }
  if (buf.length > MAX_ASSET) { reply.code(413).send({ error: "arquivo acima de 5MB", code: "asset_too_large" }); return null; }
  const id = `tia_${randomUUID()}`;
  await repo.create("ticket_assets", {
    id, ticket: ticketId, mime: file.mimetype || "application/octet-stream", size: buf.length, name: file.filename || "",
    data: buf.toString("base64"), by, at: new Date().toISOString(),
  });
  return { id, name: file.filename || "", mime: file.mimetype || "", size: buf.length };
}

export async function sendTicketAsset(reply, repo, ticket, aid) {
  const ref = (ticket.attachments || []).find((a) => a.id === aid);
  const doc = ref ? await repo.get("ticket_assets", aid) : null;
  if (!doc || doc.ticket !== ticket.id) return reply.code(404).send({ error: "arquivo não encontrado" });
  const mime = doc.mime || "application/octet-stream";
  // O mime vem de quem enviou (inclusive o cliente anônimo do portal): só
  // imagem raster e PDF abrem no navegador; SVG/HTML baixam, e o sandbox impede
  // script de rodar na origem do cockpit.
  const inline = /^image\/(png|jpe?g|gif|webp)$/i.test(mime) || mime === "application/pdf";
  const safeName = String(doc.name || doc.id).replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  reply.header("cache-control", "private, max-age=3600");
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-security-policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  reply.header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${safeName}"`);
  return reply.type(mime).send(Buffer.from(doc.data || "", "base64"));
}

// Aviso ao cliente de que o atendente respondeu (só com o toggle do produto,
// e-mail do solicitante e mailer pronto). Nunca derruba a resposta.
export async function emailCustomerReply(repo, { mailer, ticket, message, baseUrl, log } = {}) {
  try {
    if (!mailer || message?.kind !== "reply" || message?.author?.type !== "agent") return false;
    const email = ticket?.requester?.email;
    if (!email || !ticket.portalToken || !baseUrl) return false;
    const settings = await loadSettings(repo, ticket.saas);
    if (!settings.notifyCustomerByEmail) return false;
    if (!(await mailer.ready())) return false;
    const product = await repo.get("products", ticket.saas).catch(() => null);
    const brand = product?.name || "Suporte";
    const link = portalLink(baseUrl, ticket);
    const hello = ticket.requester?.name ? `Olá, ${ticket.requester.name.split(" ")[0]}!` : "Olá!";
    await mailer.send({
      to: email,
      fromName: brand,
      subject: `[${brand}] Nova resposta no chamado #${ticket.number}: ${ticket.subject}`,
      text: `${hello}\n\nRespondemos o seu chamado #${ticket.number} (${ticket.subject}):\n\n${message.text}\n\nPara ver a conversa completa ou responder, acesse:\n${link}\n\n${brand}`,
    });
    return true;
  } catch (err) {
    log?.warn?.(`ticket e-mail: ${err.message}`);
    return false;
  }
}

export function registerTicketRoutes(app, repo, { mailer = null } = {}) {
  const scopeOf = (req) => ticketScope(req.authUser);
  const loadScoped = async (req) => {
    const t = await repo.get("tickets", req.params.id);
    return t && inScope(scopeOf(req), t.saas) ? t : null;
  };
  const canAdmin = (req) => !req.authUser || isAdminUser(req.authUser);

  // Vocabulário do módulo (SPA e MCP não duplicam a lista).
  app.get("/api/tickets/meta", async () => ({
    statuses: TICKET_STATUSES,
    priorities: TICKET_PRIORITIES.map((key) => ({ key, label: PRIORITY_LABEL[key] })),
    channels: TICKET_CHANNELS,
  }));

  app.get("/api/tickets", guarded(async (req) => listTickets(repo, scopeOf(req), req.query)));

  app.post("/api/tickets", guarded(async (req, reply) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const saas = String(body.saas ?? "").trim().toLowerCase();
    if (saas && !inScope(scopeOf(req), saas)) throw httpError(403, "você não atende tickets deste produto", "saas_out_of_scope");
    const created = await createTicket(repo, { ...body, channel: body.channel === "portal" ? "internal" : body.channel }, { by: actorOf(req) });
    return reply.code(201).send(created);
  }));

  app.post("/api/tickets/bulk", guarded(async (req) => {
    const scope = scopeOf(req);
    return bulkTickets(repo, req.body || {}, { by: actorOf(req), allowed: (t) => inScope(scope, t.saas) });
  }));

  app.get("/api/tickets/:id", guarded(async (req, reply) => (await loadScoped(req)) || notFound(reply)));

  app.patch("/api/tickets/:id", guarded(async (req, reply) => {
    if (!(await loadScoped(req))) return notFound(reply);
    const r = await patchTicket(repo, req.params.id, req.body || {}, { by: actorOf(req) });
    return r ? r.ticket : notFound(reply);
  }));

  app.delete("/api/tickets/:id", guarded(async (req, reply) => {
    if (!(await loadScoped(req))) return notFound(reply);
    if (!canAdmin(req)) throw httpError(403, "só admin apaga ticket; feche-o em vez disso", "delete_forbidden");
    const r = await deleteTicket(repo, req.params.id);
    return r ? { ok: true, ...r } : notFound(reply);
  }));

  app.post("/api/tickets/:id/messages", guarded(async (req, reply) => {
    if (!(await loadScoped(req))) return notFound(reply);
    const b = req.body || {};
    const r = await addMessage(repo, req.params.id, { kind: b.kind, text: b.text, status: b.status, attachments: b.attachments }, { by: actorOf(req) });
    if (!r) return notFound(reply);
    const emailed = await emailCustomerReply(repo, { mailer, ticket: r.ticket, message: r.message, baseUrl: baseUrlOf(req), log: app.log });
    return reply.code(201).send({ ...r, emailed });
  }));

  app.get("/api/tickets/:id/activity", guarded(async (req, reply) => {
    const t = await loadScoped(req);
    return t ? ticketActivity(repo, t, { limit: req.query?.limit }) : notFound(reply);
  }));

  // Link do portal pro atendente copiar (a URL pública depende do host).
  app.get("/api/tickets/:id/portal-link", guarded(async (req, reply) => {
    const t = await loadScoped(req);
    return t ? { url: portalLink(baseUrlOf(req), t), title: ticketTitle(t) } : notFound(reply);
  }));

  // ── Anexos ────────────────────────────────────────────────────────────────
  // ?public=1: já nasce visível no portal. Sem isso, fica interno até ser
  // citado numa resposta pública.
  app.post("/api/tickets/:id/attachments", guarded(async (req, reply) => {
    const t = await loadScoped(req);
    if (!t) return notFound(reply);
    const up = await readTicketUpload(req, reply, repo, t.id, actorOf(req));
    if (!up) return reply;
    const isPublic = req.query?.public === "1" || req.query?.public === "true";
    const r = await addTicketAttachment(repo, t.id, up, { by: actorOf(req), isPublic });
    return reply.code(201).send(r);
  }));
  app.get("/api/tickets/:id/attachments/:aid", guarded(async (req, reply) => {
    const t = await loadScoped(req);
    return t ? sendTicketAsset(reply, repo, t, req.params.aid) : notFound(reply);
  }));
  app.delete("/api/tickets/:id/attachments/:aid", guarded(async (req, reply) => {
    if (!(await loadScoped(req))) return notFound(reply);
    const r = await removeTicketAttachment(repo, req.params.id, req.params.aid, { by: actorOf(req) });
    return r ? r.ticket : notFound(reply);
  }));

  // ── Configurações de SLA por produto ──────────────────────────────────────
  app.get("/api/support/settings/:saas", guarded(async (req, reply) => {
    const saas = String(req.params.saas || "").toLowerCase();
    if (!inScope(scopeOf(req), saas) || !(await repo.get("products", saas))) return notFound(reply);
    return loadSettings(repo, saas);
  }));
  app.put("/api/support/settings/:saas", guarded(async (req, reply) => {
    const saas = String(req.params.saas || "").toLowerCase();
    if (!inScope(scopeOf(req), saas)) return notFound(reply);
    return saveSettings(repo, saas, req.body || {}, { by: actorOf(req) });
  }));

  // ── Atendentes: quem atende qual produto ──────────────────────────────────
  const agentView = (u) => {
    const roles = Array.isArray(u.roles) ? u.roles : [];
    return {
      id: u.id, name: u.name || u.id, photo: u.photo || "",
      support: roles.includes("support"), admin: roles.includes("admin"),
      supportSaas: sanitizeSupportSaas(u.supportSaas),
    };
  };
  app.get("/api/support/agents", guarded(async () => (await repo.list("users")).map(agentView)));

  // Só mexe em `supportSaas` e na etiqueta `support`. Quem não é admin só
  // inclui/remove produtos do PRÓPRIO escopo — não dá pra se promover a um
  // produto que não atende.
  app.put("/api/support/agents/:userId", guarded(async (req, reply) => {
    const user = await repo.get("users", req.params.userId);
    if (!user) return notFound(reply);
    const b = req.body || {};
    const patch = {};
    if ("supportSaas" in b) {
      const products = new Set((await repo.list("products")).map((p) => String(p.id)));
      const wanted = sanitizeSupportSaas(b.supportSaas).filter((s) => products.has(s));
      const scope = scopeOf(req);
      const current = sanitizeSupportSaas(user.supportSaas);
      patch.supportSaas = scope === null
        ? wanted
        : [...current.filter((s) => !scope.includes(s)), ...wanted.filter((s) => scope.includes(s))];
    }
    if ("support" in b) {
      const roles = Array.isArray(user.roles) ? user.roles.filter((r) => r !== "support") : [];
      patch.roles = b.support === true ? [...roles, "support"] : roles;
    }
    if (!Object.keys(patch).length) throw httpError(400, "nada para alterar (supportSaas, support)", "patch_empty");
    const updated = await repo.update("users", user.id, patch);
    return agentView(updated);
  }));
}
