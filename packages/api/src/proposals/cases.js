// Cases: a prova social da casa, num lugar só.
//
// Os resultados reais dos clientes (Unique +105%, Dyno Nutri R$ 60 mil em 20
// dias, Unicoox) viviam só no roteiro do closer e nos flashcards, ou seja, na
// boca de quem estava na call. O deck de slides tem um slide "Quem já está
// dentro" que nasceu com COLCHETES pra preencher à mão antes de cada reunião, o
// site não tem depoimento nenhum e o robô é proibido de citar número. Resultado:
// a prova mais barata do funil não circula.
//
// Aqui o case é um registro, com autorização e fonte por número, e três
// consumidores: o deck (escolhe pelo nicho do lead), o site (JSON público) e a
// própria ficha do cliente, que é de onde ele nasce.
//
// REGRA QUE NÃO SE NEGOCIA: nada vai a público sem `authorizedAt` e sem `source`
// em cada métrica. O slide promete "números conferidos no painel"; publicar sem
// conferir transforma a prova em risco na primeira checagem que o cliente fizer.

export const CASE_SOURCES = ["painel", "print", "cliente"];

const str = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);

// Sem acento e sem caixa: o nicho do LEAD vem do formulário como "autopecas"
// (proposal-catalog.js), mas quem cadastra o case escreve "Autopeças". Sem
// dobrar o acento, o case certo some do deck do lead certo, em silêncio.
export const normalizeNiche = (v) => String(v || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .trim().toLowerCase();

// ── Números do painel que se refazem sozinhos ───────────────────────────────
// Decisão do Leo (28/09/2026): a prova do slide 06 tem que estar atualizada em
// TODA apresentação, do mesmo jeito que o faturado do portfólio (os tokens
// `res*` do leverads-results.js). Os quatro cases do painel foram apurados à
// mão em 14/09 e em duas semanas já estavam velhos: a Motvia tinha saído de
// R$ 287 mil para R$ 442 mil, ou seja, o deck mostrava MENOS do que o cliente
// tinha feito. Prova encolhendo com o tempo é o contrário do que o slide serve
// pra fazer.
//
// Como funciona: cada medida do painel carrega uma CHAVE (`metric`). Quem tem
// chave é refeito na abertura do deck a partir do painel do produto
// (org_revenue_generated / platform_orders, via orgSnapshot); quem não tem
// (número de print ou dito pelo cliente, como o "+105%" da Unique) fica
// exatamente como está. O rótulo e o período continuam sendo do texto salvo:
// o painel manda no NÚMERO, nunca na frase.
//
// A régua de tempo/custo é a do slide e não muda aqui sem mudar o slide:
// 10 minutos por anúncio, ao custo de um funcionário de R$ 3.000 em 220 horas
// (44 horas semanais).
export const PANEL_METRICS = ["gmvTotal", "ordersTotal", "hoursSaved", "costAvoided", "influenced30"];
export const PANEL_MINUTES_PER_LISTING = 10;
export const PANEL_SALARY = 3000;
export const PANEL_MONTH_HOURS = 220;

const nfBR = (n, max = 0) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: max }).format(Number(n) || 0);

// Número curto no tom do slide: "442 mil", "1,2 mi". Uma casa decimal só onde
// ela informa (10,4 mil diz algo; 286,9 mil só polui).
export const shortBR = (n) => {
  const v = Number(n) || 0;
  return v >= 1e6 ? `${nfBR(v / 1e6, 1)} mi`
    : v >= 1e3 ? `${nfBR(v / 1e3, v < 1e5 ? 1 : 0)} mil`
      : nfBR(v);
};

// Nome do case sem acento, caixa nem pontuação: é a chave que casa o card
// congelado no snapshot da proposta com o registro vivo do banco.
export const caseKey = (s) => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Retrato do painel (orgSnapshot) → o valor de cada medida, já formatado.
// Medida sem base (zero) devolve "", e aí o valor salvo continua valendo: deck
// com número de ontem é melhor que deck com "R$ 0".
export function panelMetricValue(key, snap = {}) {
  const horas = (Number(snap.listings) || 0) * PANEL_MINUTES_PER_LISTING / 60;
  const num = {
    gmvTotal: Number(snap.gmvTotal) || 0,
    ordersTotal: Number(snap.ordersTotal) || 0,
    hoursSaved: horas,
    costAvoided: horas * PANEL_SALARY / PANEL_MONTH_HOURS,
    influenced30: Number(snap.gmv30d) || 0,
  }[key];
  if (!(num > 0)) return "";
  if (key === "ordersTotal") return nfBR(num);
  if (key === "hoursSaved") return `${shortBR(num)} h`;
  return `R$ ${shortBR(num)}`;
}

// As quatro medidas do slide 06, na ordem em que o card as mostra. Uma função
// só pra migração (que semeia) e pro recálculo (que atualiza), senão as duas
// contas divergem no dia em que a régua mudar.
export function panelCaseFacts(snap = {}) {
  const met = (metric, label, period = "") => ({ metric, label, value: panelMetricValue(metric, snap), period, source: "painel", proofUrl: "" });
  return {
    headline: `${nfBR(snap.listings)} anúncios criados pela plataforma ao longo da parceria.`,
    metrics: [
      met("gmvTotal", "gerado por anúncios da Lever", "todo o período"),
      met("ordersTotal", "pedidos gerados no período"),
      met("hoursSaved", "de cadastro manual poupadas"),
      met("costAvoided", "de custo fixo evitado"),
    ],
  };
}

// Rótulo da régua → chave da medida. Os cases anteriores a 28/09 (e os que o
// time cria fora da migração, como USACAR e Vikn) foram escritos com os
// rótulos exatos de `panelCaseFacts` e sem chave nenhuma; sem este mapa, eles
// seriam justamente os cards que continuariam congelados. O rótulo é comparado
// sem acento nem caixa, e só decide quando a fonte já é o painel.
const rotuloChave = new Map([
  ["gerado por anuncios da lever", "gmvTotal"],
  ["pedidos gerados no periodo", "ordersTotal"],
  ["de cadastro manual poupadas", "hoursSaved"],
  ["de custo fixo evitado", "costAvoided"],
  ["vendidos pelos anuncios da lever", "influenced30"],
]);
const semAcento = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const chaveDaMedida = (m) => m?.metric || rotuloChave.get(semAcento(m?.label)) || "";

// Manchete escrita pela régua ("574.780 anúncios criados pela plataforma ao
// longo da parceria"), com ou sem o marcador `headlineAuto` — os cases criados
// fora da migração não têm o marcador, mas têm a frase.
const MANCHETE_DA_REGUA = /^[\d.,]+\s+anúncios criados pela plataforma/i;

// O case com os números de HOJE. Sem retrato do painel (banco do produto fora,
// case sem org vinculada), devolve o registro intacto.
export function caseWithLiveNumbers(doc = {}, snap = null) {
  if (!snap) return doc;
  const metrics = (doc.metrics || []).map((m) => {
    if (m?.source !== "painel") return m;
    const chave = chaveDaMedida(m);
    const value = chave ? panelMetricValue(chave, snap) : "";
    return value ? { ...m, value } : m;
  });
  // A manchete do card do painel também é um número: quem nasceu da régua
  // acompanha.
  const daRegua = doc.headlineAuto || MANCHETE_DA_REGUA.test(doc.headline || "");
  const headline = daRegua && Number(snap.listings) > 0 ? panelCaseFacts(snap).headline : doc.headline;
  return { ...doc, metrics, headline, liveAt: new Date().toISOString() };
}

export function validateCase(doc = {}) {
  const metrics = (Array.isArray(doc.metrics) ? doc.metrics : []).map((m) => ({
    // `metric` é a CHAVE da medida (ver PANEL_METRICS): é ela que deixa o
    // número ser refeito no painel a cada abertura do deck. Chave desconhecida
    // vira "" e a medida passa a valer só pelo texto, como qualquer número
    // escrito à mão.
    metric: PANEL_METRICS.includes(m?.metric) ? m.metric : "",
    label: str(m?.label, 80),
    value: str(m?.value, 40),
    period: str(m?.period, 40),
    source: CASE_SOURCES.includes(m?.source) ? m.source : "",
    proofUrl: str(m?.proofUrl, 500),
  })).filter((m) => m.label || m.value);
  return {
    ...doc,
    name: str(doc.name, 80),
    niche: str(doc.niche, 60),
    headline: str(doc.headline, 160),
    quote: str(doc.quote, 600),
    quoteAuthor: str(doc.quoteAuthor, 80),
    logoUrl: str(doc.logoUrl, 500),
    period: str(doc.period, 40),
    authorizedVia: ["whatsapp", "email", "form"].includes(doc.authorizedVia) ? doc.authorizedVia : "",
    metrics,
    public: doc.public === true,
    order: Number.isFinite(Number(doc.order)) ? Number(doc.order) : 0,
  };
}

// O que falta pra publicar. Lista vazia = pode. A lista existe (em vez de um
// booleano) porque a tela mostra exatamente o que está faltando.
export function publishBlockers(doc = {}) {
  const faltando = [];
  if (!str(doc.name)) faltando.push("o nome do cliente");
  if (!str(doc.niche)) faltando.push("o nicho");
  if (!doc.authorizedAt) faltando.push("a autorização do cliente (data)");
  const metrics = Array.isArray(doc.metrics) ? doc.metrics : [];
  if (!metrics.length) faltando.push("pelo menos um número");
  else if (metrics.some((m) => !CASE_SOURCES.includes(m?.source))) faltando.push("a fonte de cada número (painel, print ou o próprio cliente)");
  return faltando;
}

export const canPublish = (doc) => publishBlockers(doc).length === 0;

// Versão pública: só o que pode sair da casa. Nunca o cliente do cockpit, nunca
// o print da prova (que costuma ter dado da conta dele), nunca contato.
export function publicCase(doc = {}) {
  return {
    name: doc.name || "",
    niche: doc.niche || "",
    headline: doc.headline || "",
    metrics: (doc.metrics || []).map((m) => ({ label: m.label || "", value: m.value || "", period: m.period || "", source: m.source || "" })),
    quote: doc.quote || "",
    quoteAuthor: doc.quoteAuthor || "",
    logoUrl: doc.logoUrl || "",
    order: Number(doc.order) || 0,
  };
}

// Escolha pro deck: público e autorizado, nicho do lead primeiro, depois a ordem
// que o time definiu e os mais recentes. Sem nicho, só a ordem.
export function pickCases(cases = [], { niche = "", limit = 4, strictNiche = false } = {}) {
  const alvo = normalizeNiche(niche);
  const elegiveis = (cases || []).filter((c) => c?.public === true && c?.authorizedAt && canPublish(c)
    && (!strictNiche || normalizeNiche(c.niche) === alvo));
  const peso = (c) => (alvo && normalizeNiche(c.niche) === alvo ? 0 : 1);
  return elegiveis
    .sort((a, b) => peso(a) - peso(b)
      || (Number(a.order) || 0) - (Number(b.order) || 0)
      || String(b.authorizedAt || "").localeCompare(String(a.authorizedAt || "")))
    .slice(0, Math.max(0, limit));
}
