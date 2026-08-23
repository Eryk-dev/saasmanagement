// Camada de PRODUTO e OFERTA da proposta (catálogo LeverAds, aprovado pelo Leo
// em 04-06/08/2026) — só age quando o snapshot carrega `calc.catalog` (posto no
// template pela migração ensureProposalCatalog).
//
// O deck no banco continua GENÉRICO (os slides do template, com os dois slides
// de investimento originais como matéria-prima). Na hora de SERVIR a página,
// applyCatalog() transforma o deck no deck do produto decidido na tela zero:
//   - slide de investimento único, clonado do layout do FULL, com os preços e
//     features do produto ativo (semestral abre; anual é o degrau do Shift+1);
//   - tela "como nasce o anúncio OEM" nos produtos com OEM (no OEM avulso ela
//     SUBSTITUI o "Como funciona · 3 etapas", que é todo sobre clonagem);
//   - ritmo claro/escuro re-alternado quando a tela OEM entra no meio.
//
// A régua (matriz contas × anúncios S-E) SUGERE o produto; o closer decide no
// select "Apresentar" (state.product; vazio = seguir a régua). O link do
// cliente (shareProposalOffer) recebe o deck JÁ transformado e travado.
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
const PRODUCT_KEYS = ["full", "fulloem", "oem", "parcialA", "parcialoem"];
// OEM avulso vende por COTA mensal — leque aprovado pelo Leo em 14/08/2026:
// 50, 100 e 200 anúncios/mês, em products.oem.{small,mid,big} no banco.
// Snapshot antigo (só small/big) continua válido: os níveis são lidos do que
// existir, em ordem de cota. A régua abre no MENOR nível pro porte D/E e no
// MAIOR pros demais; o closer troca na tela zero (state.oemCota).
const OEM_LEVEL_KEYS = ["small", "mid", "big"];
const oemLevelsOf = (products) => OEM_LEVEL_KEYS
  .map((k) => products?.oem?.[k])
  .filter((l) => l && l.sem)
  .sort((a, b) => (Number(a.cota) || 0) - (Number(b.cota) || 0));
// Cotas válidas do leque (validação do PATCH da tela zero).
export const oemCotasOf = (products) => oemLevelsOf(products).map((l) => Number(l.cota) || 0);
function oemLevelOf(products, state, small) {
  const levels = oemLevelsOf(products);
  const want = Number(state?.oemCota) || 0;
  return levels.find((l) => (Number(l.cota) || 0) === want)
    || (small ? levels[0] : levels[levels.length - 1])
    || null;
}
// Serviço único: a clonagem entre contas cobrada UMA vez, por faixa de anúncios.
// Não é produto do catálogo — é tabela de consulta do closer na tela zero, então
// não entra no deck nem viaja no link do cliente. `calc.catalog.oneOff` (banco)
// sobrescreve estes valores sem precisar de deploy.
const ONE_OFF_CLONING = {
  tag: "serviço único",
  title: "Clonagem entre contas",
  rows: [
    { range: "Até 100 anúncios", price: "R$ 996" },
    { range: "101 a 500 anúncios", price: "R$ 2.184" },
    { range: "501 a 2.000 anúncios", price: "R$ 2.988" },
  ],
  note: "Consulta do closer · não altera o produto nem a apresentação",
};

// Nome de exibição dos produtos do catálogo (espelho dos `name` da migração
// ensureProposalCatalog — os dois andam juntos). Usado FORA da proposta:
// link de pagamento do lead, coluna Plano do cliente e card da Integração
// (web espelha em lib/payments.js DEAL_PRODUCTS).
export const PRODUCT_LABEL = {
  full: "LeverAds FULL",
  fulloem: "LeverAds + OEM FULL",
  oem: "OEM avulso",
  parcialA: "Parcial",
  parcialoem: "Parcial + OEM 125",
};

// O que pode ser VENDIDO (lead.dealProduct) = os produtos do deck + a clonagem
// avulsa, que é serviço único e não vira apresentação. Separado do
// PRODUCT_LABEL de propósito: "avulso" não existe em catalog.products, então
// nunca pode virar produto ativo do deck (applyCatalog ignoraria).
export const ONE_OFF_KEY = "avulso";
export const DEAL_PRODUCT_LABEL = { ...PRODUCT_LABEL, [ONE_OFF_KEY]: "Clonagem avulsa" };

export const hasCatalog = (calc) => !!(calc && calc.catalog && calc.catalog.products);

// Milhar pt-BR sem depender do ICU do runtime (imagem slim pode vir sem pt-BR).
const fmtBR = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const clone = (o) => JSON.parse(JSON.stringify(o || {}));

function volCol(calc, band) {
  const mid = Number((calc?.volumeMid || {})[band]) || 0;
  return mid <= 100 ? 0 : mid <= 500 ? 1 : mid <= 2000 ? 2 : mid <= 10000 ? 3 : 4;
}

export function tierOf(calc, state) {
  const cat = calc?.catalog || {};
  const accounts = cat.accounts || DEFAULT_ACCOUNTS;
  const grid = cat.grid || DEFAULT_GRID;
  const accI = Math.max(0, accounts.indexOf(String(state?.accounts ?? "")));
  return (grid[accI] || [])[volCol(calc, state?.volume)] || "C";
}

export const lowTier = (t) => t === "D" || t === "E";

const isAuto = (answers) => String(answers?.niche || "").trim().toLowerCase() === "autopecas";

// A régua (contas × anúncios) decide o produto sugerido — TODA dor, inclusive
// a [OEM] do anúncio de part number, só troca a trilha SPIN (pedido do Leo,
// 15/08/2026: quem veio pelo anúncio de OEM também serve pro LeverAds, então a
// dor não rebaixa a apresentação nem o card pro OEM avulso). D/E entra no
// Parcial (combo com OEM 50 se autopeças) e o resto é FULL (+OEM se
// autopeças). O OEM avulso vive no override do closer (state.product).
export function suggestProduct(calc, state, answers) {
  const low = lowTier(tierOf(calc, state));
  const auto = isAuto(answers);
  if (low) return auto ? "parcialoem" : "parcialA";
  return auto ? "fulloem" : "full";
}

export function activeProduct(p) {
  const prod = String(p?.state?.product || "");
  if (prod && p?.calc?.catalog?.products?.[prod]) return prod;
  return suggestProduct(p?.calc, p?.state || {}, p?.data?.answers || {});
}

// Preço do produto que a APRESENTAÇÃO vai abrir (a oferta principal do deck é
// o ANUAL desde 21/08/2026; semestral e recorrente são os degraus secretos do
// Shift+1 e Shift+2). Vira o `lead.amount`: o card do pipeline mostra o mesmo
// número que o closer apresenta. Sem catálogo devolve 0 — quem chama cai na
// fórmula por assentos (contractValue) de sempre.
export function catalogAmount(p) {
  const calc = p?.calc;
  if (!hasCatalog(calc)) return 0;
  const products = calc.catalog.products;
  const key = activeProduct(p);
  const offer = key === "oem"
    ? oemLevelOf(products, p?.state || {}, lowTier(tierOf(calc, p?.state || {})))
    : products[key];
  return moneyOf(offer?.anu?.total);
}

// ── Ofertas ────────────────────────────────────────────────────────────────
// Escreve as TRÊS formas de pagar num slide de pricing (tabela do Leo,
// 21/08/2026): a oferta principal é o ANUAL e os degraus secretos são o
// SEMESTRAL (Shift+1) e a RECORRENTE (Shift+2).
//
// A ordem é o argumento de venda: o anual abre porque é o menor custo total E
// não cobra a clonagem; a recorrente fecha porque tem a menor mensalidade mas
// pede a clonagem na entrada. Quem vê os três na ordem entende sozinho que o
// compromisso paga a entrada.
//
// O *X* no cycles vira o número em destaque no renderer.
const recTotal = (rec, meses) => moneyOf(rec?.per) * meses + moneyOf(rec?.setup);
function offers(slide, prod, pill) {
  const { anu, sem, rec } = prod;
  slide.planTag = "ANUAL";
  slide.price = fmtBR(anu.total);
  slide.per = "no ano";
  slide.cycles = "12x de *" + fmtBR(anu.per) + "*/mês";
  slide.cyclesLabel = "ou";
  slide.currency = false;
  slide.pricePrefix = "";
  if (pill) slide.planPill = pill;
  if (sem) {
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
  if (rec?.per) {
    slide.offer3 = {
      planTag: "RECORRENTE", price: fmtBR(rec.per), per: "/ mês",
      // A entrada é a informação que decide entre este plano e os outros dois,
      // então ela ocupa a linha do cycles em vez de virar letra miúda.
      cycles: rec.setup
        ? "+ R$ " + fmtBR(rec.setup) + " de clonagem na entrada"
        : "sem entrada, cancela quando quiser",
      cyclesLabel: "",
      currency: false, pricePrefix: "",
      planPill: slide.planPill || "sem compromisso de permanência",
    };
  } else {
    delete slide.offer3;
  }
  delete slide.offer4;
  delete slide.showIf;
  return slide;
}

// O subtítulo descreve o PRODUTO, não o plano — vale igual nas três ofertas.
function withSub(slide, text) {
  slide.sub = text;
  for (const o of [slide.offer2, slide.offer3]) if (o) o.sub = text;
  return slide;
}

// Todos os produtos usam o LAYOUT do FULL (grupos encadeados + faixa de preço):
// troca só os itens dos grupos 1 e 2 — o 3 ("lado humano"), synths e títulos
// originais ficam. features espelha os grupos (fallback do layout simples).
function withGroups(slide, motorItems, platItems) {
  const g = slide.benefitGroups || [];
  if (g[0]) g[0].items = motorItems;
  if (g[1]) g[1].items = platItems;
  slide.features = motorItems.concat(platItems);
  return slide;
}

// +OEM FULL parte do slide de autopeças original, que fala em 100 OEM/mês: a
// cota sai do CATÁLOGO (era fixa em 200 no texto e ficou pra trás quando o Leo
// subiu o limite pra 500 em 21/08 — número de produto não se escreve à mão).
const deepCota = (o, cota) => JSON.parse(JSON.stringify(o)
  .replace(/100 anúncios/g, cota + " anúncios")
  .replace(/100 SKUs por mês/g, cota + " anúncios OEM por mês"));

function buildPricing(key, { sBase, sAuto, products, small, oemLevel }) {
  const P = products;
  if (key === "fulloem") {
    const src = sAuto || sBase;
    return offers(deepCota(clone(src), P.fulloem.cota || 500), P.fulloem);
  }
  if (key === "oem") {
    const o = oemLevel || (small ? P.oem.small : P.oem.big);
    const s = withGroups(clone(sBase),
      [o.cota + " anúncios OEM criados por mês", "Compatibilidade veicular em cada anúncio", "Publicados direto nas suas contas (Meli + Shopee)"],
      ["Você só manda a lista de códigos OEM", "Preview antes de publicar", "Acompanhamento dos anúncios criados no painel"]);
    s.key = "investimento_oem";
    offers(s, o);
    return withSub(s, "só a parte de OEM, sem a clonagem · " + o.cota + " anúncios por mês");
  }
  if (key === "parcialA") {
    const s = withGroups(clone(sBase),
      ["Equalização das suas contas", "Automação de clone + estoque", "Até 1.000 anúncios"],
      ["Gerenciador de SKU", "Perguntas de todas as contas num só lugar", "Estoque sincronizado entre as contas"]);
    s.key = "investimento_parcial";
    offers(s, P.parcialA, "até 1.000 anúncios");
    return withSub(s, "plano de entrada");
  }
  if (key === "parcialoem") {
    const cota = P.parcialoem.cota || 125;
    const s = withGroups(clone(sBase),
      ["Equalização das suas contas", "Automação de clone + estoque", "Até 1.000 anúncios", cota + " anúncios OEM por mês com compatibilidade veicular"],
      ["Gerenciador de SKU", "Perguntas de todas as contas num só lugar", "Estoque sincronizado entre as contas"]);
    s.key = "investimento_combo";
    offers(s, P.parcialoem, "até 1.000 anúncios · " + cota + " OEM/mês");
    return withSub(s, "soma: Parcial + OEM " + cota + "/mês");
  }
  // full: o slide original já é o layout e as features certas — só a oferta muda.
  return offers(clone(sBase), P.full);
}

// Tela do processo OEM (layout steps, o mesmo do "Como funciona · 3 etapas").
function oemProcessSlide(cota) {
  return {
    key: "oem_processo",
    type: "steps",
    bg: "dark",
    eyebrow: "OEM · como nasce o anúncio",
    title: "Do código OEM ao *anúncio publicado*, sem trabalho seu.",
    pills: [cota + " anúncios OEM por mês", "ficha técnica completa", "compatibilidade veicular", "preview antes de publicar", "Mercado Livre + Shopee"],
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

// ── Transform principal ─────────────────────────────────────────────────────
// Recebe a proposta (snapshot) e devolve os slides do PRODUTO ativo, ou null
// quando não há catálogo (deck segue como está).
export function applyCatalog(p) {
  const calc = p?.calc;
  if (!hasCatalog(calc)) return null;
  const slides = Array.isArray(p.slides) ? p.slides : [];
  const sBase = slides.find((s) => s?.type === "pricing" && s.key === "investimento")
    || [...slides].reverse().find((s) => s?.type === "pricing");
  if (!sBase) return null; // deck sem slide de investimento — não mexe
  const sAuto = slides.find((s) => s?.type === "pricing" && s.key === "investimento_autopecas") || null;

  const product = activeProduct(p);
  const tier = tierOf(calc, p.state || {});
  const small = lowTier(tier);
  const products = calc.catalog.products;
  const oemLevel = oemLevelOf(products, p.state || {}, small);

  // Slides-base (sem os pricing) + o investimento do produto na posição do 1º pricing.
  const firstPricingIdx = slides.findIndex((s) => s?.type === "pricing");
  const base = slides.filter((s) => s?.type !== "pricing");
  const pricing = buildPricing(product, { sBase, sAuto, products, small, oemLevel });
  const insertAt = firstPricingIdx === -1 ? base.length
    : Math.min(base.length, slides.slice(0, firstPricingIdx).filter((s) => s?.type !== "pricing").length);
  const out = base.slice(0, insertAt).concat([pricing], base.slice(insertAt)).map(clone);

  // Tela do processo OEM + ritmo claro/escuro.
  const oemCota = product === "fulloem" ? (products.fulloem.cota || 200)
    : product === "parcialoem" ? (products.parcialoem.cota || 50)
    : product === "oem" ? (Number(oemLevel?.cota) || 0)
    : 0;
  if (oemCota) {
    const oemSlide = oemProcessSlide(oemCota);
    const stepsIdx = out.findIndex((s) => s.key === "como_funciona" || s.type === "steps");
    if (product === "oem") {
      // OEM avulso não tem clonagem: o "3 etapas" SAI e a tela OEM entra CLARA
      // no lugar; o resto do deck mantém o ritmo original.
      oemSlide.bg = "";
      if (stepsIdx !== -1) out.splice(stepsIdx, 1, oemSlide);
      else out.splice(Math.max(0, out.length - 1), 0, oemSlide);
    } else if (stepsIdx !== -1) {
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

  return { slides: out, product, suggested: suggestProduct(calc, p.state || {}, p.data?.answers || {}), tier, oemCota };
}

// ── Ordem da apresentação · teste A/B (Leo, 12/08/2026; refeito 23/08) ──────
// A = a ordem de sempre (capa → história → marcas → sobre nós → 3 etapas →
// [OEM] → impacto → investimento). B = beta: a APRESENTAÇÃO é só a tela de
// setup do closer (o modo ?k esconde os slides). O deck em si não muda mais
// de ordem, então o link do cliente segue o deck padrão; a reordenação antiga
// do beta (mecanismo primeiro, sem capa, fechamento aberto) foi aposentada.
export const DECK_ORDERS = { A: "padrão", B: "beta · só a tela de setup" };

// ── Payload da tela zero (modo closer) ──────────────────────────────────────
// Tudo que o card de decisão mostra vem PRONTO daqui: o cliente-side não tem
// tabela de preço nenhuma (mudou dado → salva → recarrega → recalcula aqui).
function priceLine(key, products, small, oemLevel) {
  const P = products;
  // Na ordem em que o closer apresenta: anual abre, semestral no Shift+1 e
  // recorrente no Shift+2. Da recorrente vale a mensalidade + a entrada (o
  // custo em 12 meses ele compara no deck, não precisa decorar).
  const line = (o) => "Anual R$ " + fmtBR(o.anu.total) + " (12x " + fmtBR(o.anu.per) + ")" +
    (o.sem ? " · Shift+1 semestral R$ " + fmtBR(o.sem.total) + " (6x " + fmtBR(o.sem.per) + ")" : "") +
    (o.rec?.per ? " · Shift+2 recorrente R$ " + fmtBR(o.rec.per) + "/mês" +
      (o.rec.setup ? " + R$ " + fmtBR(o.rec.setup) + " de clonagem" : " sem entrada") +
      " (12 meses = R$ " + fmtBR(recTotal(o.rec, 12)) + ")" : "");
  if (key === "oem") {
    const o = oemLevel || (small ? P.oem.small : P.oem.big);
    return "OEM " + o.cota + "/mês: " + line(o);
  }
  if (key === "parcialoem") return line(P.parcialoem).replace("Anual", "Anual (soma)");
  return line(P[key]);
}

function offerLine(key, products, small, oemLevel) {
  if (key === "full") return "Plataforma completa nas suas contas: equalização, clone automático, estoque sincronizado, perguntas, SKUs, precificação e promoções.";
  if (key === "fulloem") return "Tudo do FULL + " + (products.fulloem.cota || 500) + " anúncios OEM por mês com compatibilidade veicular.";
  if (key === "oem") {
    const o = oemLevel || (small ? products.oem.small : products.oem.big);
    return o.cota + " anúncios OEM por mês criados pela Lever, sem a clonagem: o cliente só manda a lista de códigos.";
  }
  if (key === "parcialA") return "Equalização + automação de clone/estoque, até 2.000 clones no semestre, gerenciador de SKU e perguntas num lugar só.";
  return "Parcial + 50 anúncios OEM por mês com compatibilidade veicular.";
}

export function catalogUI(p) {
  const calc = p?.calc;
  if (!hasCatalog(calc)) return null;
  const cat = calc.catalog;
  const state = p.state || {};
  const answers = p.data?.answers || {};
  const tier = tierOf(calc, state);
  const small = lowTier(tier);
  const suggested = suggestProduct(calc, state, answers);
  const accounts = cat.accounts || DEFAULT_ACCOUNTS;
  const names = {};
  const priceLines = {};
  const offerLines = {};
  const oemLv = oemLevelOf(cat.products, state, small);
  for (const k of PRODUCT_KEYS) {
    if (!cat.products[k]) continue;
    names[k] = cat.products[k].name || k;
    priceLines[k] = priceLine(k, cat.products, small, oemLv);
    offerLines[k] = offerLine(k, cat.products, small, oemLv);
  }
  // Ordem do select de dor: códigos de 1 letra (A-E) antes dos maiores (OEM),
  // "sem código" sempre por último. Sai pronto daqui porque a tela zero não
  // conhece o catálogo — dor nova no template aparece sem tocar no renderer.
  const painOrder = Object.keys(cat.pains || {})
    .filter((k) => k !== "none")
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .concat(cat.pains?.none ? ["none"] : []);
  return {
    tier, low: small, suggested,
    product: cat.products[String(state.product || "")] ? String(state.product) : "",
    oemNeeded: suggested === "fulloem" || suggested === "parcialoem",
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
    names, priceLines, offerLines,
    // Leque do OEM avulso: cota ATIVA (escolha do closer ou porte da régua) e
    // os níveis com preço curto — vira o select "Cota OEM" da tela zero.
    oemCota: Number(oemLv?.cota) || 0,
    oemLevels: oemLevelsOf(cat.products).map((l) => ({
      cota: Number(l.cota) || 0,
      short: "R$ " + fmtBR(l.anu.total) + " anu (12x " + fmtBR(l.anu.per) + ")" +
        (l.sem ? " · R$ " + fmtBR(l.sem.total) + " sem (6x " + fmtBR(l.sem.per) + ")" : "") +
        (l.rec?.per ? " · R$ " + fmtBR(l.rec.per) + "/mês rec" : ""),
    })),
    pains: cat.pains || {},
    oneOffCloning: clone(cat.oneOff || ONE_OFF_CLONING),
    // Teste A/B da ordem dos slides (pílula na tela zero).
    deckOrder: String(state.deckOrder || "").toUpperCase() === "B" ? "B" : "A",
    deckOrders: DECK_ORDERS,
  };
}

// ── Catálogo pro COCKPIT (fechamento do card) ──────────────────────────────
// O closer fecha a venda no card (Call → Integração / Ganho) e precisa dizer O
// QUE vendeu, com o preço que está na apresentação. Esta é a lista que vai no
// SEED (CONFIG.proposals.catalog[saas]): produto + os preços do catálogo do
// TEMPLATE (banco), pra o cockpit sugerir o valor sem hardcode nem regra
// duplicada — mexeu no preço no banco, o card já fecha com o preço novo.
//
// A clonagem avulsa entra como produto vendível (serviço único, por faixa de
// anúncios) mesmo não sendo produto do deck.
const moneyOf = (v) => {
  if (typeof v === "number") return Math.round(v) || 0;
  const digits = String(v ?? "").replace(/[^\d,]/g, "").split(",")[0].replace(/\D/g, "");
  return digits ? Number(digits) : 0;
};
// Ordem em que o closer apresenta. A RECORRENTE fecha como plano `mensal`: é o
// que a casa já entende de ponta a ponta (valor = a MENSALIDADE, arr = 12×, e
// isRecurringClose gera a assinatura). Inventar um plano "recorrente" novo
// deixaria o PLAN_MONTHS do billing.js sem resposta.
const CYCLES = ["anu", "sem", "rec"];
const cycleLabel = { anu: "Anual", sem: "Semestral", rec: "Recorrente" };
const cyclePlan = { anu: "anual", sem: "semestral", rec: "mensal" };
// Valor que vai pro card: total do ciclo nos compromissos, MENSALIDADE na
// recorrente (a entrada de clonagem vai no rótulo, pro closer não esquecer de
// cobrar — ela não é receita recorrente e não pode inflar o arr).
const cycleValue = (o, k) => (k === "rec" ? moneyOf(o?.rec?.per) : moneyOf(o?.[k]?.total));
const cycleHas = (o, k) => (k === "rec" ? !!moneyOf(o?.rec?.per) : !!o?.[k]?.total);
const cycleTag = (o, k) => (k === "rec" && moneyOf(o?.rec?.setup)
  ? cycleLabel.rec + " · entrada R$ " + fmtBR(o.rec.setup)
  : cycleLabel[k]);

export function dealCatalog(calc) {
  if (!hasCatalog(calc)) return [];
  const cat = calc.catalog;
  const out = [];
  // Preços de um produto: anual/semestral/recorrente direto, ou os níveis de
  // cota do OEM avulso (leque 125/250/500 anúncios), cada um virando três
  // opções nomeadas.
  const pricesOf = (p) => {
    const rows = [];
    for (const k of CYCLES) {
      if (cycleHas(p, k)) rows.push({ plan: cyclePlan[k], label: cycleTag(p, k), value: cycleValue(p, k) });
    }
    for (const level of OEM_LEVEL_KEYS) {
      const lv = p?.[level];
      if (!lv) continue;
      for (const k of CYCLES) {
        if (cycleHas(lv, k)) rows.push({ plan: cyclePlan[k], label: `${cycleTag(lv, k)} · ${lv.cota || level} anúncios`, value: cycleValue(lv, k) });
      }
    }
    return rows;
  };
  for (const key of PRODUCT_KEYS) {
    const p = cat.products?.[key];
    if (!p) continue;
    out.push({ id: key, label: p.name || PRODUCT_LABEL[key] || key, prices: pricesOf(p) });
  }
  const oneOff = cat.oneOff || ONE_OFF_CLONING;
  const rows = (oneOff.rows || []).filter((r) => r && r.price);
  if (rows.length) {
    out.push({
      id: ONE_OFF_KEY,
      label: DEAL_PRODUCT_LABEL[ONE_OFF_KEY],
      oneOff: true, // plano é sempre "Serviço único"
      prices: rows.map((r) => ({ plan: "unico", label: r.range || oneOff.title || "serviço único", value: moneyOf(r.price) })),
    });
  }
  return out;
}
