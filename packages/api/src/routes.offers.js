// Servidor da tela "Links de pagamento" (id `offers`), duas coisas:
//
// 1. /api/offers — os links FIXOS das ofertas (anual / semestral / serviço
//    único), ferramenta pro time pegar o link certo e mandar pro cliente. Um doc
//    por produto na collection `offers`; sem doc, cai nos defaults abaixo.
//    Editar salva pra TODO o time (não é localStorage).
// 2. /api/payment-links — o HISTÓRICO dos links gerados no nome de um lead ou
//    cliente (pela tela, pelo card do lead ou pela ficha do cliente), com o
//    status do dinheiro vindo do espelho do Mercado Pago (payment-links.js).

import { enrichPaymentLinks } from "./payment-links.js";

// Defaults por produto — os links que o Leo criou no Mercado Pago (jul/2026).
// Espelham a escada de ofertas da proposta (sem cifrão, no estilo do Leo).
const DEFAULTS = {
  leverads: [
    { key: "anual", label: "Assinatura anual", price: "12x 599 · 7.188 no ano", link: "https://mpago.la/31nuzcr" },
    { key: "semestral", label: "Assinatura semestral", price: "12x 299 · 3.588 no semestre", link: "https://mpago.la/1zkJq73" },
    { key: "unico", label: "Serviço único", price: "12x 149 · 1.788 uma única vez", link: "https://mpago.la/1oCWiXk" },
  ],
};

const isHttp = (s) => /^https?:\/\//i.test(String(s || "").trim());

// Sanitiza a lista vinda do cliente: mantém a forma {key,label,price,link,
// proposalUrl}, corta o que não presta e só aceita link http(s) (ou vazio).
// proposalUrl = link da proposta pronta pra enviar (atalho "Proposta ↗").
function sanitize(items) {
  if (!Array.isArray(items)) return null;
  return items.slice(0, 20).map((it, i) => ({
    key: String(it?.key || `oferta_${i + 1}`).slice(0, 40),
    label: String(it?.label || "").slice(0, 120),
    price: String(it?.price || "").slice(0, 120),
    link: isHttp(it?.link) ? String(it.link).trim().slice(0, 500) : "",
    proposalUrl: isHttp(it?.proposalUrl) ? String(it.proposalUrl).trim().slice(0, 500) : "",
  })).filter((it) => it.label || it.link);
}

export function registerOfferRoutes(app, repo) {
  // Histórico dos links gerados: o recibo de cada geração cruzado com o espelho
  // do MP (quem pagou, como, quando). Link sem produto (backfill antigo) aparece
  // em qualquer workspace — mesma regra do espelho de pagamentos.
  app.get("/api/payment-links", async (req) => {
    const saas = String(req.query?.saas || "");
    const all = await repo.list("payment_links");
    const links = saas ? all.filter((l) => !l.saas || l.saas === saas) : all;
    const [payments, invoices] = await Promise.all([repo.list("mp_payments"), repo.list("invoices")]);
    return { links: enrichPaymentLinks(links, payments, invoices) };
  });

  async function offersFor(saas) {
    const doc = saas ? await repo.get("offers", saas) : null;
    return doc?.items || DEFAULTS[saas] || [];
  }

  // Lista as ofertas do produto (defaults quando nunca foi editado).
  app.get("/api/offers/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    return { saas: product.id, items: await offersFor(product.id) };
  });

  // Salva os links editados (upsert do doc por produto).
  app.put("/api/offers/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const items = sanitize(req.body?.items);
    if (!items) return reply.code(400).send({ error: "items deve ser uma lista de ofertas" });
    const existing = await repo.get("offers", product.id);
    const saved = existing
      ? await repo.update("offers", product.id, { items })
      : await repo.create("offers", { id: product.id, items });
    return { saas: product.id, items: saved.items };
  });
}

export const OFFER_DEFAULTS = DEFAULTS;
