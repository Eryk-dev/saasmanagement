// Webhooks de sistemas externos → cockpit. Hoje: Shopify da UniqueKids e
// Linear (issue espelhada de um ticket de suporte).
//
// A cada pedido PAGO do produto "tarefas diárias" (ou compra acima de um piso),
// cria um lead na UniqueKids pra Ana ligar oferecendo a consulta grátis. A rota
// é ABERTA (a Shopify não manda a key do cockpit): a autenticidade vem da
// ASSINATURA HMAC da Shopify, conferida contra o corpo CRU com o segredo do
// webhook (SHOPIFY_WEBHOOK_SECRET_UNIQUEKIDS). Sem segredo configurado, recusa.
import crypto from "node:crypto";
import { repo as defaultRepo } from "../platform/db.js";
import { NOT_CONFIGURED } from "../platform/http-status.js";
import { applyLinearIssue, applyLinearComment, importLinearIssue, productForIssue } from "../support/ticket-linear.js";
import { defaultLinear } from "../support/linear.js";
import { orderTrigger, upsertShopifyLead } from "./shopify-sync.js";

// Assinatura do Linear: HMAC-SHA256 do corpo CRU em hex, no header
// `linear-signature`. Mesma postura da Shopify — sem segredo configurado, a
// rota recusa (integração aberta seria porta pra qualquer um mexer em ticket).
export function verifyLinearSignature(rawBody, sentHeader, secret) {
  if (!secret || !sentHeader) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody || Buffer.alloc(0)).digest("hex");
  const a = Buffer.from(String(sentHeader));
  const b = Buffer.from(digest);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Reenvio antigo (replay) não entra: o Linear carimba o instante no corpo.
export const linearTimestampOk = (ts, { now = Date.now(), toleranceMs = 5 * 60_000 } = {}) => {
  const n = Number(ts);
  return !Number.isFinite(n) || n <= 0 ? true : Math.abs(now - n) <= toleranceMs;
};

// Verifica a assinatura HMAC-SHA256 (base64) do corpo cru com o segredo. Tempo
// constante; comprimentos diferentes = inválido (timingSafeEqual exige igualdade).
export function verifyShopifyHmac(rawBody, sentHeader, secret) {
  if (!secret || !sentHeader) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody || Buffer.alloc(0)).digest("base64");
  const a = Buffer.from(String(sentHeader));
  const b = Buffer.from(digest);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function registerWebhookRoutes(app, repo = defaultRepo, opts = {}) {
  // Instância encapsulada só do webhook: um parser que GUARDA o corpo cru (pra
  // conferir o HMAC) sem afetar o parse JSON das demais rotas do app.
  app.register(async (wh) => {
    wh.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
      req.rawBody = body;
      try { done(null, body && body.length ? JSON.parse(body.toString("utf8")) : {}); }
      catch (err) { err.statusCode = 400; done(err); }
    });

    wh.post("/api/webhooks/shopify/uniquekids", async (req, reply) => {
      const secret = opts.secret
        || process.env.SHOPIFY_WEBHOOK_SECRET_UNIQUEKIDS
        || process.env.SHOPIFY_WEBHOOK_SECRET
        || "";
      if (!secret) {
        req.log?.error("shopify webhook uniquekids: segredo não configurado (SHOPIFY_WEBHOOK_SECRET_UNIQUEKIDS)");
        return reply.code(NOT_CONFIGURED).send("not configured");
      }
      // 1) Autenticidade.
      if (!verifyShopifyHmac(req.rawBody, req.headers["x-shopify-hmac-sha256"], secret)) {
        return reply.code(401).send("invalid signature");
      }
      // 2) Só pedidos (orders/*). Ping de verificação e outros tópicos: 200 e ignora.
      const topic = String(req.headers["x-shopify-topic"] || "");
      if (topic && !topic.startsWith("orders/")) return reply.code(200).send("ignored");
      const order = req.body || {};
      // 3) Gatilho: "tarefas diárias" OU total acima do piso.
      const floor = Number(process.env.SHOPIFY_UNIQUEKIDS_MIN || 0);
      const reason = orderTrigger(order, floor);
      if (!reason) return reply.code(200).send("no match");
      // 4+5) Idempotência + criação — mesma função do poller de reconciliação.
      const { lead, created } = await upsertShopifyLead(repo, order, { reason, at: new Date().toISOString() });
      if (!created) return reply.code(200).send({ ok: true, duplicate: true, lead: lead.id });
      req.log?.info(`shopify → lead uniquekids ${lead.id} (${reason})`);
      return reply.code(200).send({ ok: true, lead: lead.id });
    });

    // Linear → ticket de suporte. Cadastre a URL em Settings → API → Webhooks
    // com os eventos "Issues" e "Comments" (LINEAR_WEBHOOK_SECRET = o segredo
    // mostrado lá). Estado da issue vira status do ticket e comentário vira
    // aviso na atividade e no sino (ticket-linear.js). Issue sem ticket do projeto
    // de suporte de um produto vira ticket; qualquer outra: 200 e ignora
    // — o webhook é do workspace inteiro, não só dos tickets.
    wh.post("/api/webhooks/linear", async (req, reply) => {
      const secret = opts.linearSecret || process.env.LINEAR_WEBHOOK_SECRET || "";
      if (!secret) {
        req.log?.error("webhook linear: segredo não configurado (LINEAR_WEBHOOK_SECRET)");
        return reply.code(NOT_CONFIGURED).send("not configured");
      }
      if (!verifyLinearSignature(req.rawBody, req.headers["linear-signature"], secret)) {
        return reply.code(401).send("invalid signature");
      }
      const body = req.body || {};
      if (!linearTimestampOk(body.webhookTimestamp)) return reply.code(200).send("stale");
      const data = body.data || {};
      try {
        if (body.type === "Issue" && (body.action === "create" || body.action === "update")) {
          const r = await applyLinearIssue(repo, data, { log: req.log, linear: opts.linear || defaultLinear });
          if (r) return reply.code(200).send({ ok: true, ticket: r.ticket });
          // Sem ticket: se a issue é do projeto de suporte de algum produto,
          // foi aberta direto no Linear e vira ticket agora.
          const saas = await productForIssue(repo, data);
          const imp = saas ? await importLinearIssue(repo, data, { saas, log: req.log, linear: opts.linear || defaultLinear }) : null;
          return reply.code(200).send({ ok: true, ticket: imp?.ticket || null, imported: !!imp?.created });
        }
        if (body.type === "Comment" && (body.action === "create" || body.action === "update")) {
          const issueId = data.issueId || data.issue?.id || "";
          const r = await applyLinearComment(repo, { issueId, comment: data, log: req.log });
          return reply.code(200).send({ ok: true, ticket: r?.ticket || null });
        }
      } catch (err) {
        // 500 faria o Linear reenviar; o estado certo volta na reconciliação.
        req.log?.warn(`webhook linear (${body.type}/${body.action}): ${err.message}`);
        return reply.code(200).send({ ok: false, error: "aplicado depois" });
      }
      return reply.code(200).send("ignored");
    });
  });
}
