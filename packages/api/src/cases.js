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

export function validateCase(doc = {}) {
  const metrics = (Array.isArray(doc.metrics) ? doc.metrics : []).map((m) => ({
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
export function pickCases(cases = [], { niche = "", limit = 4 } = {}) {
  const alvo = normalizeNiche(niche);
  const elegiveis = (cases || []).filter((c) => c?.public === true && c?.authorizedAt && canPublish(c));
  const peso = (c) => (alvo && normalizeNiche(c.niche) === alvo ? 0 : 1);
  return elegiveis
    .sort((a, b) => peso(a) - peso(b)
      || (Number(a.order) || 0) - (Number(b.order) || 0)
      || String(b.authorizedAt || "").localeCompare(String(a.authorizedAt || "")))
    .slice(0, Math.max(0, limit));
}
