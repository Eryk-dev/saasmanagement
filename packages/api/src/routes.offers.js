// Links de pagamento das ofertas — ferramenta simples pro time pegar o link
// certo de cada oferta (anual / semestral / serviço único) e mandar pro cliente
// depois de fechar. Um doc por produto na collection `offers`; sem doc, cai nos
// defaults abaixo. Editar salva pra TODO o time (não é localStorage).

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
