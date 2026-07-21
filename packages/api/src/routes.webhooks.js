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

// Decide se um pedido entra no fluxo. Regra (decisão do Leo): SÓ quando o pedido
// tem um produto "tarefas diárias" no nome (qualquer variação: "Tarefas Diárias",
// "Quadro Tarefas Diárias + Bônus", "... + Método R.O.T.I.N.A."...). O piso por
// valor fica OPCIONAL: só entra como rede secundária se SHOPIFY_UNIQUEKIDS_MIN > 0.
// Retorna o motivo (pra origem do lead) ou null quando não casa.
export function orderTrigger(order, floor = 0) {
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  const matchProduct = items.some((it) => RE_TAREFAS.test(`${it?.title || ""} ${it?.name || ""}`));
  if (matchProduct) return "comprou tarefas diárias";
  const total = Number(order?.total_price ?? order?.current_total_price ?? 0) || 0;
  if (Number(floor) > 0 && total > Number(floor)) return `compra de R$ ${total}`;
  return null;
}

// Cria (ou reaproveita) o lead da UniqueKids pra um pedido da Shopify.
// COMPARTILHADO pelo webhook (tempo real) e pelo poller de reconciliação — a
// mesma regra de dono/idempotência/campos nos dois caminhos. `at` = data do
// PEDIDO (o poller preenche pedidos antigos com a data real, não "agora"), pra
// as métricas de marketing baterem. Retorna { lead, created }.
export async function upsertShopifyLead(repo, order, { reason, at } = {}) {
  const orderId = String(order?.id ?? order?.admin_graphql_api_id ?? "");
  if (orderId) {
    const dup = (await repo.list("leads")).find(
      (l) => l && l.saas === "uniquekids" && String(l.shopifyOrderId || "") === orderId);
    if (dup) return { lead: dup, created: false };
  }
  const cust = order.customer || {};
  const name = [cust.first_name, cust.last_name].filter(Boolean).join(" ").trim()
    || String(order.name || "").trim() || "Cliente Shopify";
  const phone = order.phone || cust.phone
    || order.shipping_address?.phone || order.billing_address?.phone || "";
  const email = order.email || cust.email || "";
  const owner = await uniquekidsOwner(repo);
  const product = await repo.get("products", "uniquekids");
  const nextAt = initialNextActionAt(product, "");
  const createdAt = at || order.created_at || new Date().toISOString();
  const lead = await repo.create("leads", {
    ...(CREATE_DEFAULTS.leads || {}),
    saas: "uniquekids",
    name, phone, email,
    stage: firstStage(product),
    stageSince: createdAt,
    source: `Shopify · ${reason}`,
    shopifyOrderId: orderId,
    ...(owner ? { owner, closer: owner } : {}),
    ...(nextAt ? { nextActionAt: nextAt } : {}),
    createdAt,
  });
  try {
    await logActivity(repo, {
      saas: "uniquekids", lead: lead.id, type: "system",
      meta: { event: "lead_created", via: "shopify", order: orderId, reason }, author: "shopify",
    });
  } catch { /* histórico é best-effort */ }
  return { lead, created: true };
}

// Poller de reconciliação: puxa os pedidos pagos da Shopify e preenche os leads
// que faltam (dedup por shopifyOrderId). É a rede de segurança pro webhook —
// mesmo que ele falhe/não esteja registrado, os pedidos entram no próximo tick.
// No 1º tick (ou base vazia) varre 40 dias pra trás e faz o backfill sozinho.
// Sem token da Shopify (SHOPIFY_ADMIN_TOKEN), fica DORMENTE.
export function startShopifySync(repo = defaultRepo, { shopify, intervalMs = 15 * 60_000, log = console } = {}) {
  if (!shopify?.configured?.()) { log.info?.("shopify sync: sem SHOPIFY_ADMIN_TOKEN/STORE — desligado"); return () => {}; }
  let running = false;
  async function tick() {
    if (running) return; running = true;
    try {
      const leads = await repo.list("leads");
      const lastAt = leads
        .filter((l) => l.saas === "uniquekids" && l.shopifyOrderId && l.createdAt)
        .map((l) => l.createdAt).sort().pop();
      // 2 dias de folga do último (pedidos pagos com atraso) ou 40 dias no 1º run.
      const since = lastAt
        ? new Date(new Date(lastAt).getTime() - 2 * 86_400_000).toISOString()
        : new Date(Date.now() - 40 * 86_400_000).toISOString();
      const orders = await shopify.paidOrdersSince(since);
      const floor = Number(process.env.SHOPIFY_UNIQUEKIDS_MIN || 0);
      let created = 0;
      for (const o of orders) {
        const reason = orderTrigger(o, floor);
        if (!reason) continue;
        const r = await upsertShopifyLead(repo, o, { reason });
        if (r.created) created++;
      }
      if (created) log.info?.(`shopify sync: ${created} lead(s) novo(s) da UniqueKids`);
    } catch (err) { log.warn?.({ err: err.message }, "shopify sync falhou (re-tenta no próximo ciclo)"); }
    finally { running = false; }
  }
  tick(); // corre no boot (faz o backfill imediato)
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
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
      const floor = Number(process.env.SHOPIFY_UNIQUEKIDS_MIN || 0);
      const reason = orderTrigger(order, floor);
      if (!reason) return reply.code(200).send("no match");
      // 4+5) Idempotência + criação — mesma função do poller de reconciliação.
      const { lead, created } = await upsertShopifyLead(repo, order, { reason, at: new Date().toISOString() });
      if (!created) return reply.code(200).send({ ok: true, duplicate: true, lead: lead.id });
      req.log?.info(`shopify → lead uniquekids ${lead.id} (${reason})`);
      return reply.code(200).send({ ok: true, lead: lead.id });
    });
  });
}
