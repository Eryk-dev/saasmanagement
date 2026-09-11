// Servidor da tela "Links de pagamento" (id `offers`), duas coisas:
//
// 1. /api/offers — os links FIXOS das ofertas (por pacote, anual / semestral e
//    o pacote de OEM), ferramenta pro time pegar o link certo e mandar pro cliente. Um doc
//    por produto na collection `offers`; sem doc, cai nos defaults abaixo.
//    Editar salva pra TODO o time (não é localStorage).
// 2. /api/payment-links — o HISTÓRICO dos links gerados no nome de um lead ou
//    cliente (pela tela, pelo card do lead ou pela ficha do cliente), com o
//    status do dinheiro vindo do espelho do Mercado Pago (payment-links.js).

import { enrichPaymentLinks } from "./payment-links.js";

// Defaults por produto — a escada de ofertas do catálogo v2 (10/09/2026):
// OEM e Ads têm o mesmo preço por pacote; Price é a linha nova. Os links do
// Mercado Pago são do Leo: nascem vazios e ele cola na tela (salva pro time).
const DEFAULTS = {
  leverads: [
    { key: "essencial_anual", label: "Lever OEM / Ads · Essencial · anual", price: "12x 497 · 5.964 no ano", link: "" },
    { key: "essencial_semestral", label: "Lever OEM / Ads · Essencial · semestral", price: "6x 597 · 3.582 no semestre", link: "" },
    { key: "escala_anual", label: "Lever OEM / Ads · Escala · anual", price: "12x 999 · 11.988 no ano", link: "" },
    { key: "escala_semestral", label: "Lever OEM / Ads · Escala · semestral", price: "6x 1.197 · 7.182 no semestre", link: "" },
    { key: "price_essencial_anual", label: "Lever Price · Essencial · anual", price: "12x 797 · 9.564 no ano", link: "" },
    { key: "price_essencial_semestral", label: "Lever Price · Essencial · semestral", price: "6x 847 · 5.082 no semestre", link: "" },
    { key: "price_escala_anual", label: "Lever Price · Escala · anual", price: "12x 1.497 · 17.964 no ano", link: "" },
    { key: "price_escala_semestral", label: "Lever Price · Escala · semestral", price: "6x 1.897 · 11.382 no semestre", link: "" },
    { key: "price_enterprise_anual", label: "Lever Price · Enterprise · anual", price: "12x 3.497 · 41.964 no ano", link: "" },
    { key: "price_enterprise_semestral", label: "Lever Price · Enterprise · semestral", price: "6x 3.997 · 23.982 no semestre", link: "" },
    { key: "oem_pack", label: "Pacote de OEM avulso (uma vez)", price: "1.000 = 2.000 · 2.000 = 3.500 · 3.000 = 4.500", link: "" },
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
