// Webhooks de sistemas externos → cockpit. Hoje: Shopify da UniqueKids.
//
// A cada pedido PAGO do produto "tarefas diárias" (ou compra acima de um piso),
// cria um lead na UniqueKids pra Ana ligar oferecendo a consulta grátis. A rota
// é ABERTA (a Shopify não manda a key do cockpit): a autenticidade vem da
// ASSINATURA HMAC da Shopify, conferida contra o corpo CRU com o segredo do
// webhook (SHOPIFY_WEBHOOK_SECRET_UNIQUEKIDS). Sem segredo configurado, recusa.
import crypto from "node:crypto";
import { repo as defaultRepo } from "./db.js";
import { CREATE_DEFAULTS } from "./routes.js";
import { firstStage } from "./stages.js";
import { initialNextActionAt, logActivity, autoLeadOwner } from "./lead-flow.js";

// "tarefas diárias" com tolerância a acento/plural (título do item ou do produto).
const RE_TAREFAS = /tarefas?\s*di[aá]ri/i;

// Dono do lead da UniqueKids (a Ana). Preferência: SDR único do produto
// (autoLeadOwner); senão a única pessoa ESCOPADA em uniquekids; senão o único
// closer escopado. Resolve em runtime, sem hardcodar id nem exigir papel novo.
async function uniquekidsOwner(repo) {
  const sdr = await autoLeadOwner(repo, "uniquekids");
  if (sdr) return sdr;
  const users = await repo.list("users").catch(() => []);
  const scoped = (users || []).filter((u) => u && u.saas === "uniquekids");
  if (scoped.length === 1) return scoped[0].id;
  const closers = scoped.filter((u) => Array.isArray(u.roles) && u.roles.includes("closer"));
  if (closers.length === 1) return closers[0].id;
  return null;
}

// Verifica a assinatura HMAC-SHA256 (base64) do corpo cru com o segredo. Tempo
// constante; comprimentos diferentes = inválido (timingSafeEqual exige igualdade).
export function verifyShopifyHmac(rawBody, sentHeader, secret) {
  if (!secret || !sentHeader) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody || Buffer.alloc(0)).digest("base64");
  const a = Buffer.from(String(sentHeader));
  const b = Buffer.from(digest);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Decide se um pedido entra no fluxo: item "tarefas diárias" OU total acima do
// piso (R$ 299 por padrão, configurável). Retorna o motivo (pra origem do lead)
// ou null quando não casa.
export function orderTrigger(order, floor = 299) {
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  const matchProduct = items.some((it) => RE_TAREFAS.test(`${it?.title || ""} ${it?.name || ""}`));
  const total = Number(order?.total_price ?? order?.current_total_price ?? 0) || 0;
  if (matchProduct) return "comprou tarefas diárias";
  if (total > Number(floor)) return `compra de R$ ${total}`;
  return null;
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
        return reply.code(503).send("not configured");
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
      const floor = Number(process.env.SHOPIFY_UNIQUEKIDS_MIN || 299);
      const reason = orderTrigger(order, floor);
      if (!reason) return reply.code(200).send("no match");
      // 4) Idempotência: a Shopify reentrega; o mesmo pedido não cria lead 2x.
      const orderId = String(order.id ?? order.admin_graphql_api_id ?? "");
      if (orderId) {
        const dup = (await repo.list("leads")).find(
          (l) => l && l.saas === "uniquekids" && String(l.shopifyOrderId || "") === orderId);
        if (dup) return reply.code(200).send({ ok: true, duplicate: true, lead: dup.id });
      }
      // 5) Cria o lead pra Ana (owner+closer = ela, pra aparecer no funil todo).
      const cust = order.customer || {};
      const name = [cust.first_name, cust.last_name].filter(Boolean).join(" ").trim()
        || String(order.name || "").trim() || "Cliente Shopify";
      const phone = order.phone || cust.phone
        || order.shipping_address?.phone || order.billing_address?.phone || "";
      const email = order.email || cust.email || "";
      const owner = await uniquekidsOwner(repo);
      const product = await repo.get("products", "uniquekids");
      const nextAt = initialNextActionAt(product, "");
      const now = new Date().toISOString();
      const lead = await repo.create("leads", {
        ...(CREATE_DEFAULTS.leads || {}),
        saas: "uniquekids",
        name, phone, email,
        stage: firstStage(product),
        stageSince: now,
        source: `Shopify · ${reason}`,
        shopifyOrderId: orderId,
        ...(owner ? { owner, closer: owner } : {}),
        ...(nextAt ? { nextActionAt: nextAt } : {}),
        createdAt: now,
      });
      try {
        await logActivity(repo, {
          saas: "uniquekids", lead: lead.id, type: "system",
          meta: { event: "lead_created", via: "shopify", order: orderId, reason }, author: "shopify",
        });
      } catch { /* histórico é best-effort */ }
      req.log?.info(`shopify → lead uniquekids ${lead.id} (${reason})`);
      return reply.code(200).send({ ok: true, lead: lead.id });
    });
  });
}
