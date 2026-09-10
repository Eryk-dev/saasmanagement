// Camada de PRODUTO e OFERTA da proposta (catálogo LeverAds v2, desenhado pelo
// Leo no mapa mental "Produtos" em 10/09/2026) — só age quando o snapshot
// carrega `calc.catalog` no shape v2 (posto no template pela migração
// ensureProposalCatalog / migrateCatalogPricing).
//
// Três LINHAS × PACOTES:
//   - oem   (autopeças: tudo do Ads + criação de anúncios por código OEM)
//   - ads   (Lever Ads: sincronização, cópia, edição em massa, SAC)
//   - price (Lever Price: precificação, produto novo)
//   × essencial / escala / enterprise. Enterprise de OEM e Ads é SOB CONSULTA
//   (não tem preço, não entra em `products`); o do Price tem preço.
// Chave de produto = linha_pacote ("oem_essencial", "price_escala"…): cabe em
// state.product, lead.dealProduct e no select do gate sem campo novo.
//
// Só DUAS formas de pagar: o ANUAL abre a apresentação e o SEMESTRAL é o degrau
// secreto do Shift+1. A recorrente (mensalidade + clonagem na entrada) saiu
// dos planos novos (Leo, 10/09/2026).
//
// O deck no banco continua GENÉRICO (os slides do template, com os dois slides
// de investimento originais como matéria-prima). Na hora de SERVIR a página,
// applyCatalog() transforma o deck no deck do produto decidido na tela zero:
//   - slide de investimento único, clonado do layout do template, com os
//     preços e entregáveis do produto ativo (lidos do catálogo, nunca do texto);
//   - tela "como nasce o anúncio OEM" na linha OEM (entra escura depois do
//     "Como funciona · 3 etapas" e o resto do deck re-alterna claro/escuro).
//
// A régua SUGERE o produto: o NICHO decide a linha (autopeças → OEM, resto →
// Ads) e o Nº DE CONTAS decide o pacote (tierByAccounts). Price nunca é
// sugerido: é cross-sell, escolha manual do closer. A matriz contas × anúncios
// (S-E) continua sendo calculada só como NOTA do cliente (tierOf), usada por
// outras telas. O closer decide no select "Apresentar" (state.product; vazio =
// seguir a régua). O link do cliente (shareProposalOffer) recebe o deck JÁ
// transformado e travado.
//
// Espelho do GRADE_GRID de packages/web/src/lib/ui.js (calibração 24/07) — os
// dois precisam andar juntos.

const DEFAULT_GRID = [
  ["E", "D", "C", "C", "C"],
  ["D", "C", "C", "B", "B"],
  ["C", "B", "B", "A", "A"],
  ["B", "B", "A", "S", "S"],
  ["A", "A", "A", "S", "S"],
];
const DEFAULT_ACCOUNTS = ["1", "2", "3-5", "6-10", "10+"];
const DEFAULT_VOL_LABELS = ["≤100", "100-500", "500-2k", "2-10k", "10k+"];

export const LINE_KEYS = ["oem", "ads", "price"];
export const TIER_KEYS = ["essencial", "escala", "enterprise"];
const TIER_LABEL = { essencial: "Essencial", escala: "Escala", enterprise: "Enterprise" };
// Ordem canônica dos produtos com preço (o que pode virar deck). Produto extra
// gravado no banco (fora desta lista) também entra, depois destes.
const PRODUCT_KEYS = [
  "oem_essencial", "oem_escala",
  "ads_essencial", "ads_escala",
  "price_essencial", "price_escala", "price_enterprise",
];
// Faixa de contas do form → pacote sugerido. `calc.catalog.tierByAccounts`
// (banco) sobrescreve sem deploy.
const DEFAULT_TIER_BY_ACCOUNTS = { "1": "essencial", "2": "essencial", "3-5": "essencial", "6-10": "escala", "10+": "enterprise" };
const DEFAULT_LINES = {
  oem: { name: "Lever OEM", enterprise: "sob consulta" },
  ads: { name: "Lever Ads", enterprise: "sob consulta" },
  price: { name: "Lever Price", enterprise: "" },
};

// Nome de exibição dos produtos do catálogo (espelho dos `name` da migração
// ensureProposalCatalog — os dois andam juntos). Usado FORA da proposta:
// link de pagamento do lead, coluna Plano do cliente e card da Integração
// (web espelha em lib/payments.js DEAL_PRODUCTS).
export const PRODUCT_LABEL = {
  oem_essencial: "Lever OEM · Essencial",
  oem_escala: "Lever OEM · Escala",
  ads_essencial: "Lever Ads · Essencial",
  ads_escala: "Lever Ads · Escala",
  price_essencial: "Lever Price · Essencial",
  price_escala: "Lever Price · Escala",
  price_enterprise: "Lever Price · Enterprise",
};
// Catálogo ANTERIOR (FULL / +OEM / OEM avulso / Parcial / combo / clonagem
// avulsa): não vende mais, mas venda fechada com essas chaves continua
// nomeada na coluna Plano do cliente, no checkout e no card da Integração.
export const LEGACY_PRODUCT_LABEL = {
  full: "LeverAds FULL",
  fulloem: "LeverAds + OEM FULL",
  oem: "OEM avulso",
  parcialA: "Parcial",
  parcialoem: "Parcial + OEM 250",
  avulso: "Clonagem avulsa",
};

// O que pode ser VENDIDO (lead.dealProduct) = os produtos do deck + o pacote de
// OEM avulso (serviço único, não vira apresentação) + os rótulos legados.
// "oem_pack" não existe em catalog.products, então nunca pode virar produto
// ativo do deck (applyCatalog ignoraria).
export const ONE_OFF_KEY = "oem_pack";
export const DEAL_PRODUCT_LABEL = { ...PRODUCT_LABEL, [ONE_OFF_KEY]: "Pacote de OEM avulso", ...LEGACY_PRODUCT_LABEL };

// Só o shape v2 é lido em runtime. Um snapshot v1 que escape da migração
// renderiza o deck cru do template (sem tela zero de catálogo), nunca quebra.
export const CATALOG_VERSION = 2;
export const hasCatalog = (calc) =>
  !!(calc && calc.catalog && calc.catalog.products) && Number(calc.catalog.catalogV) >= CATALOG_VERSION;

// Milhar pt-BR sem depender do ICU do runtime (imagem slim pode vir sem pt-BR).
const fmtBR = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
const moneyOf = (v) => {
  if (typeof v === "number") return Math.round(v) || 0;
  const digits = String(v ?? "").replace(/[^\d,]/g, "").split(",")[0].replace(/\D/g, "");
  return digits ? Number(digits) : 0;
};

function volCol(calc, band) {
  const mid = Number((calc?.volumeMid || {})[band]) || 0;
  return mid <= 100 ? 0 : mid <= 500 ? 1 : mid <= 2000 ? 2 : mid <= 10000 ? 3 : 4;
}

// Nota do cliente (matriz contas × anúncios). Continua existindo como
// informação da tela zero e do card; não decide mais o produto.
export function tierOf(calc, state) {
  const cat = calc?.catalog || {};
  const accounts = cat.accounts || DEFAULT_ACCOUNTS;
  const grid = cat.grid || DEFAULT_GRID;
  const accI = Math.max(0, accounts.indexOf(String(state?.accounts ?? "")));
  return (grid[accI] || [])[volCol(calc, state?.volume)] || "C";
}

export const lowTier = (t) => t === "D" || t === "E";

const isAuto = (answers) => String(answers?.niche || "").trim().toLowerCase() === "autopecas";

// ── Régua: nicho → linha, contas → pacote ──────────────────────────────────
const productKeysOf = (products) => PRODUCT_KEYS
  .filter((k) => products?.[k])
  .concat(Object.keys(products || {}).filter((k) => !PRODUCT_KEYS.includes(k)));
const lineOfKey = (products, key) => String(products?.[key]?.line || String(key).split("_")[0] || "");
const tierOfKey = (products, key) => String(products?.[key]?.tier || String(key).split("_")[1] || "");
const linesOf = (cat) => ({ ...DEFAULT_LINES, ...(cat?.lines || {}) });
const lineName = (cat, line) => linesOf(cat)[line]?.name || line;

export const lineOf = (answers) => (isAuto(answers) ? "oem" : "ads");
export function pkgOf(cat, state) {
  const map = cat?.tierByAccounts || DEFAULT_TIER_BY_ACCOUNTS;
  return map[String(state?.accounts ?? "")] || "essencial";
}
// 10+ contas cai no Enterprise, que em OEM/Ads é sob consulta: a apresentação
// abre no Escala e a tela zero avisa (fecha como Personalizado no gate).
export const enterpriseHint = (cat, state, answers) =>
  pkgOf(cat, state) === "enterprise" && !cat?.products?.[lineOf(answers) + "_enterprise"];

// A dor do anúncio ([A-E]/[OEM]) só troca a trilha SPIN — nunca o produto
// (pedido do Leo, 15/08/2026). Price fica fora da sugestão: é cross-sell.
export function suggestProduct(calc, state, answers) {
  const cat = calc?.catalog || {};
  const products = cat.products || {};
  const line = lineOf(answers);
  let tier = pkgOf(cat, state);
  if (tier === "enterprise" && !products[line + "_enterprise"]) tier = "escala";
  if (!products[line + "_" + tier]) tier = "escala";
  if (!products[line + "_" + tier]) tier = "essencial";
  const key = line + "_" + tier;
  return products[key] ? key : (productKeysOf(products)[0] || key);
}

export function activeProduct(p) {
  const prod = String(p?.state?.product || "");
  if (prod && p?.calc?.catalog?.products?.[prod]) return prod;
  return suggestProduct(p?.calc, p?.state || {}, p?.data?.answers || {});
}

// Preço do produto que a APRESENTAÇÃO vai abrir (o ANUAL). Vira o
// `lead.amount`: o card do pipeline mostra o mesmo número que o closer
// apresenta. Sem catálogo devolve 0 — quem chama cai na fórmula por assentos
// (contractValue) de sempre.
export function catalogAmount(p) {
  const calc = p?.calc;
  if (!hasCatalog(calc)) return 0;
  return moneyOf(calc.catalog.products[activeProduct(p)]?.anu?.total);
}

// ── Ofertas ────────────────────────────────────────────────────────────────
// Escreve as DUAS formas de pagar num slide de pricing: a oferta principal é
// o ANUAL e o degrau secreto é o SEMESTRAL (Shift+1). O *X* no cycles vira o
// número em destaque no renderer.
function offers(slide, prod, pill) {
  const { anu, sem } = prod;
  slide.planTag = "ANUAL";
  slide.price = fmtBR(anu?.total);
  slide.per = "no ano";
  slide.cycles = "12x de *" + fmtBR(anu?.per) + "*/mês";
  slide.cyclesLabel = "ou";
  slide.currency = false;
  slide.pricePrefix = "";
  if (pill) slide.planPill = pill;
  if (sem && sem.total) {
    slide.offer2 = {
      planTag: "SEMESTRAL", price: fmtBR(sem.total), per: "no semestre",
      cycles: "6x de *" + fmtBR(sem.per) + "*/mês", cyclesLabel: "ou",
      currency: false, pricePrefix: "",
      // O semestre cobra SEIS parcelas: herdar o "12x" do anual seria promessa
      // errada no card que o lead está lendo.
      planPill: slide.planPill || "6x sem juros no cartão de crédito",
    };
  } else {
    delete slide.offer2;
  }
  // Recorrente e escada antiga não existem mais nos planos novos.
  delete slide.offer3;
  delete slide.offer4;
  delete slide.showIf;
  return slide;
}

// O subtítulo descreve o PRODUTO, não o plano — vale igual nas duas ofertas.
function withSub(slide, text) {
  slide.sub = text;
  if (slide.offer2) slide.offer2.sub = text;
  return slide;
}

// Todos os produtos usam o LAYOUT do template (grupos encadeados + faixa de
// preço): troca só os itens dos grupos 1 e 2 — o 3 ("lado humano"), synths e
// títulos originais ficam. features espelha os grupos (fallback do layout simples).
function withGroups(slide, motorItems, platItems) {
  const g = slide.benefitGroups || [];
  if (g[0]) g[0].items = motorItems;
  if (g[1]) g[1].items = platItems;
  slide.features = motorItems.concat(platItems);
  return slide;
}

// Escopo curto do pacote (pílula do card de preço e rótulo do select):
// "3 contas · 200 OEM/mês", "7 contas · OEM ilimitado", "até 1.000 anúncios".
export function scopeOf(P) {
  const parts = [];
  if (Number(P?.contas) > 0) parts.push(P.contas + " contas");
  if (P?.line === "oem") {
    parts.push(Number(P.cota) > 0 ? P.cota + " OEM/mês" : (P.cotaLabel || "OEM ilimitado"));
  }
  if (Number(P?.limite) > 0) parts.push("até " + fmtBR(P.limite) + " anúncios");
  else if (P?.limiteLabel) parts.push(P.limiteLabel);
  return parts.join(" · ");
}

function buildPricing(key, { sBase, sAuto, products }) {
  const P = products?.[key];
  if (!P) return null;
  // A linha OEM parte do slide de autopeças do template (quando existe); as
  // outras, do genérico. Entregáveis saem do CATÁLOGO (P.inclui), nunca do
  // texto do slide — era assim que a cota ficava pra trás quando mudava.
  const src = P.line === "oem" && sAuto ? sAuto : sBase;
  const inc = P.inclui || {};
  const s = withGroups(clone(src), Array.isArray(inc.motor) ? inc.motor.slice() : [], Array.isArray(inc.plataforma) ? inc.plataforma.slice() : []);
  s.key = "investimento_" + key;
  offers(s, P, scopeOf(P));
  return withSub(s, P.name || PRODUCT_LABEL[key] || key);
}

// Tela do processo OEM (layout steps, o mesmo do "Como funciona · 3 etapas").
function oemProcessSlide(P) {
  const cota = Number(P?.cota) || 0;
  return {
    key: "oem_processo",
    type: "steps",
    bg: "dark",
    eyebrow: "OEM · como nasce o anúncio",
    title: "Do código OEM ao *anúncio publicado*, sem trabalho seu.",
    pills: [cota ? cota + " anúncios OEM por mês" : "anúncios OEM sem limite mensal", "ficha técnica completa", "compatibilidade veicular", "preview antes de publicar", "Mercado Livre + Shopee"],
    steps: [
      { tag: "ETAPA 01 · LISTA DE CÓDIGOS", title: "Você só manda a lista de códigos OEM",
        text: "Uma planilha simples com os códigos das peças que você quer anunciar. É tudo o que a gente precisa de você nesse processo." },
      { tag: "ETAPA 02 · CRIAÇÃO", title: "A Lever monta o anúncio completo",
        text: "Pra cada código, criamos título, ficha técnica e a compatibilidade veicular aplicada no anúncio, o que faz a peça aparecer na busca certa de cada veículo." },
      { tag: "ETAPA 03 · PUBLICAÇÃO", title: "Preview, publica e acompanha",
        text: "Você aprova no preview, os anúncios entram direto nas suas contas de Mercado Livre e Shopee e você acompanha cada um criado no painel." },
    ],
  };
}

// Matéria-prima de TODO produto: os dois slides de investimento do template —
// o genérico e o de autopeças. Fica num helper porque a tela zero também
// precisa deles: a linha do produto no card do closer é lida do mesmo slide
// que o cliente vai ver.
function pricingSources(p) {
  const slides = Array.isArray(p?.slides) ? p.slides : [];
  const sBase = slides.find((s) => s?.type === "pricing" && s.key === "investimento")
    || [...slides].reverse().find((s) => s?.type === "pricing") || null;
  const sAuto = slides.find((s) => s?.type === "pricing" && s.key === "investimento_autopecas") || null;
  return { slides, sBase, sAuto };
}

// ── Transform principal ─────────────────────────────────────────────────────
// Recebe a proposta (snapshot) e devolve os slides do PRODUTO ativo, ou null
// quando não há catálogo (deck segue como está).
export function applyCatalog(p) {
  const calc = p?.calc;
  if (!hasCatalog(calc)) return null;
  const { slides, sBase, sAuto } = pricingSources(p);
  if (!sBase) return null; // deck sem slide de investimento — não mexe

  const products = calc.catalog.products;
  const product = activeProduct(p);
  const P = products[product];
  if (!P) return null;
  const tier = tierOf(calc, p.state || {});

  // Slides-base (sem os pricing) + o investimento do produto na posição do 1º pricing.
  const firstPricingIdx = slides.findIndex((s) => s?.type === "pricing");
  const base = slides.filter((s) => s?.type !== "pricing");
  const pricing = buildPricing(product, { sBase, sAuto, products });
  const insertAt = firstPricingIdx === -1 ? base.length
    : Math.min(base.length, slides.slice(0, firstPricingIdx).filter((s) => s?.type !== "pricing").length);
  const out = base.slice(0, insertAt).concat([pricing], base.slice(insertAt)).map(clone);

  // Tela do processo OEM + ritmo claro/escuro (só na linha OEM: ela entrega
  // tudo do Ads MAIS o OEM, então o "3 etapas" da clonagem fica).
  const oemLine = lineOfKey(products, product) === "oem";
  if (oemLine) {
    const oemSlide = oemProcessSlide(P);
    const stepsIdx = out.findIndex((s) => s.key === "como_funciona" || s.type === "steps");
    if (stepsIdx !== -1) {
      // Entra ESCURA logo depois do "3 etapas" (claro) e o rabo do deck volta a
      // alternar: impacto claro → investimento escuro.
      out.splice(stepsIdx + 1, 0, oemSlide);
      let dark = false; // o próximo depois da OEM (escura) é claro
      for (let i = stepsIdx + 2; i < out.length; i++) {
        out[i].bg = dark ? "dark" : "";
        dark = !dark;
      }
    } else {
      oemSlide.bg = "";
      out.splice(Math.max(0, out.length - 1), 0, oemSlide);
    }
  }

  return {
    slides: out, product, tier,
    suggested: suggestProduct(calc, p.state || {}, p.data?.answers || {}),
    line: lineOfKey(products, product), pkg: tierOfKey(products, product), oem: oemLine,
  };
}

// ── Ordem da apresentação · teste A/B (Leo, 12/08/2026; refeito 23/08) ──────
// A = a ordem de sempre (capa → história → marcas → sobre nós → 3 etapas →
// [OEM] → impacto → investimento). B = beta: a APRESENTAÇÃO é só a tela de
// setup do closer (o modo ?k esconde os slides). O deck em si não muda mais
// de ordem, então o link do cliente segue o deck padrão.
export const DECK_ORDERS = { A: "padrão", B: "beta · só a tela de setup" };

// ── Payload da tela zero (modo closer) ──────────────────────────────────────
// Tudo que o card de decisão mostra vem PRONTO daqui: o cliente-side não tem
// tabela de preço nenhuma (mudou dado → salva → recarrega → recalcula aqui).
// Na ordem em que o closer apresenta: anual abre, semestral no Shift+1.
function priceLine(P) {
  return "Anual R$ " + fmtBR(P.anu?.total) + " (12x " + fmtBR(P.anu?.per) + ")" +
    (P.sem && P.sem.total ? " · Shift+1 semestral R$ " + fmtBR(P.sem.total) + " (6x " + fmtBR(P.sem.per) + ")" : "");
}

// ── O que o produto ENTREGA, lido do próprio slide ──────────────────────────
// A linha do produto na tela zero é DERIVADA dos empilháveis do slide de
// investimento (os itens dos grupos 1 e 2, na ordem em que o closer revela),
// não escrita à mão: número de produto não se escreve duas vezes.
// O grupo 3 ("o lado humano") fica de fora de propósito: é igual em todos os
// produtos (o template manda nele) e não diferencia oferta nenhuma.
const featText = (f) => String((f && typeof f === "object" ? (f.text ?? f.label ?? "") : f) || "").trim();
const normAns = (v) => String(v == null ? "" : v).trim().toLowerCase();
// Mesmo showIf do renderer (visibleFeats): item condicional só entra quando a
// resposta do lead bate.
function featShown(f, answers) {
  const sh = f && typeof f === "object" ? f.showIf : null;
  if (!sh || !sh.key) return true;
  const want = (Array.isArray(sh.values) ? sh.values : [sh.values]).map(normAns);
  const got = answers?.[sh.key];
  return (Array.isArray(got) ? got : [got]).map(normAns).some((g) => want.includes(g));
}
function offerLine(slide, answers) {
  const groups = Array.isArray(slide?.benefitGroups) ? slide.benefitGroups.slice(0, 2) : [];
  return groups
    .flatMap((g) => (Array.isArray(g?.items) ? g.items : [])
      .filter((f) => featShown(f, answers))
      .map(featText))
    .filter(Boolean)
    .join(" · ");
}

// Tabela de consulta do closer na tela zero: adicionais, pacotes de OEM e o
// que é sob consulta. Não entra no deck nem viaja no link do cliente.
export function quickRefOf(cat) {
  const rows = [];
  const addons = cat?.addons || {};
  const ce = addons.contaExtra;
  if (ce && moneyOf(ce.per)) rows.push({ label: ce.label || "Conta extra no Escala", price: "R$ " + fmtBR(ce.per) + "/mês por conta" });
  for (const pk of Array.isArray(cat?.oemPacks) ? cat.oemPacks : []) {
    if (!moneyOf(pk?.price)) continue;
    rows.push({ label: "Pacote de " + fmtBR(pk.qty) + " anúncios OEM (uma vez)", price: "R$ " + fmtBR(pk.price) });
  }
  for (const st of Array.isArray(addons.setups) ? addons.setups : []) {
    if (!st?.label) continue;
    rows.push({ label: st.label, price: moneyOf(st.price) ? "R$ " + fmtBR(st.price) : "sob consulta" });
  }
  const lines = linesOf(cat);
  for (const line of Object.keys(lines)) {
    if (lines[line]?.enterprise && !cat?.products?.[line + "_enterprise"]) {
      rows.push({ label: lineName(cat, line) + " · Enterprise", price: lines[line].enterprise });
    }
  }
  return {
    tag: "consulta rápida",
    title: "Adicionais e sob consulta",
    rows,
    note: "Consulta do closer · não altera o produto nem a apresentação",
  };
}

export function catalogUI(p) {
  const calc = p?.calc;
  if (!hasCatalog(calc)) return null;
  const cat = calc.catalog;
  const products = cat.products;
  const state = p.state || {};
  const answers = p.data?.answers || {};
  const tier = tierOf(calc, state);
  const suggested = suggestProduct(calc, state, answers);
  const accounts = cat.accounts || DEFAULT_ACCOUNTS;
  const keys = productKeysOf(products);
  const names = {};
  const priceLines = {};
  const offerLines = {};
  // O card monta o slide de CADA produto (o mesmo buildPricing que serve o
  // deck) só pra ler o que ele entrega: o que o closer vê na tela zero é,
  // item por item, o que o lead vai ver empilhado no último slide.
  const { sBase, sAuto } = pricingSources(p);
  for (const k of keys) {
    names[k] = products[k].name || PRODUCT_LABEL[k] || k;
    priceLines[k] = priceLine(products[k]);
    offerLines[k] = sBase ? offerLine(buildPricing(k, { sBase, sAuto, products }), answers) : "";
  }
  // Linhas × pacotes pro select "Apresentar" (optgroup por linha). Enterprise
  // sem preço aparece como opção desabilitada com o texto "sob consulta".
  const lineDefs = linesOf(cat);
  const lineIds = LINE_KEYS.filter((l) => lineDefs[l]).concat(Object.keys(lineDefs).filter((l) => !LINE_KEYS.includes(l)));
  const lines = lineIds.map((id) => ({
    id,
    name: lineName(cat, id),
    products: keys.filter((k) => lineOfKey(products, k) === id).map((k) => ({
      key: k,
      tier: tierOfKey(products, k),
      label: (TIER_LABEL[tierOfKey(products, k)] || tierOfKey(products, k)) + (scopeOf(products[k]) ? " · " + scopeOf(products[k]) : ""),
    })),
    enterprise: products[id + "_enterprise"] ? "" : String(lineDefs[id]?.enterprise || ""),
  })).filter((l) => l.products.length || l.enterprise);
  const active = products[String(state.product || "")] ? String(state.product) : suggested;
  const line = lineOf(answers);
  const pkg = pkgOf(cat, state);
  const hint = enterpriseHint(cat, state, answers);
  const nicheTxt = isAuto(answers) ? "autopeças" : "fora de autopeças";
  const why = String(state.accounts ?? "") + " conta(s) · " + nicheTxt + " → " +
    (hint
      ? lineName(cat, line) + " Enterprise é sob consulta: apresenta o Escala e fecha como Personalizado."
      : lineName(cat, line) + " · " + (TIER_LABEL[pkg] || pkg) + ".");
  // Ordem do select de dor: códigos de 1 letra (A-E) antes dos maiores (OEM),
  // "sem código" sempre por último. Sai pronto daqui porque a tela zero não
  // conhece o catálogo — dor nova no template aparece sem tocar no renderer.
  const painOrder = Object.keys(cat.pains || {})
    .filter((k) => k !== "none")
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .concat(cat.pains?.none ? ["none"] : []);
  return {
    tier, low: lowTier(tier), suggested,
    product: products[String(state.product || "")] ? String(state.product) : "",
    line: lineOfKey(products, active), pkg: tierOfKey(products, active),
    enterpriseHint: hint, why,
    oem: !!state.oem,
    pain: String(state.pain || "") || "none",
    painOrder,
    matrix: {
      grid: cat.grid || DEFAULT_GRID,
      accounts,
      vols: cat.volLabels || DEFAULT_VOL_LABELS,
      accIndex: Math.max(0, accounts.indexOf(String(state.accounts ?? ""))),
      volIndex: volCol(calc, state.volume),
    },
    names, priceLines, offerLines, lines,
    pains: cat.pains || {},
    quickRef: quickRefOf(cat),
    // Teste A/B da ordem dos slides (pílula na tela zero).
    deckOrder: String(state.deckOrder || "").toUpperCase() === "B" ? "B" : "A",
    deckOrders: DECK_ORDERS,
    discountPct: Math.min(15, Math.max(0, Math.round(Number(state.discountPct) || 0))),
  };
}

// ── Catálogo pro COCKPIT (fechamento do card) ──────────────────────────────
// O closer fecha a venda no card (Call → Integração / Ganho) e precisa dizer O
// QUE vendeu, com o preço que está na apresentação. Esta é a lista que vai no
// SEED (CONFIG.proposals.catalog[saas]): produto + os preços do catálogo do
// TEMPLATE (banco), pra o cockpit sugerir o valor sem hardcode nem regra
// duplicada — mexeu no preço no banco, o card já fecha com o preço novo.
// `group` = nome da linha (o select do gate agrupa por optgroup).
//
// O pacote de OEM avulso entra como produto vendível (serviço único, por
// quantidade) mesmo não sendo produto do deck. Enterprise de OEM/Ads (sob
// consulta) não entra: fecha como Personalizado com valor livre.
const CYCLES = ["anu", "sem"];
const cycleLabel = { anu: "Anual", sem: "Semestral" };
const cyclePlan = { anu: "anual", sem: "semestral" };

export function dealCatalog(calc) {
  if (!hasCatalog(calc)) return [];
  const cat = calc.catalog;
  const products = cat.products;
  const out = [];
  for (const key of productKeysOf(products)) {
    const P = products[key];
    const prices = [];
    for (const k of CYCLES) {
      if (P?.[k]?.total) prices.push({ plan: cyclePlan[k], label: cycleLabel[k], value: moneyOf(P[k].total) });
    }
    out.push({ id: key, label: P.name || PRODUCT_LABEL[key] || key, group: lineName(cat, lineOfKey(products, key)), prices });
  }
  const packs = (Array.isArray(cat.oemPacks) ? cat.oemPacks : []).filter((k) => k && moneyOf(k.price));
  if (packs.length) {
    out.push({
      id: ONE_OFF_KEY,
      label: DEAL_PRODUCT_LABEL[ONE_OFF_KEY],
      group: "Adicionais",
      oneOff: true, // plano é sempre "Serviço único"
      prices: packs.map((k) => ({ plan: "unico", label: fmtBR(k.qty) + " anúncios OEM", value: moneyOf(k.price) })),
    });
  }
  return out;
}
