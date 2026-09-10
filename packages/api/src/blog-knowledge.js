// Pacote de conhecimento que vai junto com a pauta pro redator (anthropic.js
// blogDraft): a empresa em texto, os fatos permitidos, a dor da pauta, os
// flashcards mais parecidos com o tema e os tokens de resultado presentes.
// Tudo puro e sem deps: ranking por Jaccard de tokens, sem embedding.

import { LEVERADS_DECKS } from "./flashcard-decks.leverads.js";
import { LEVERADS_COMPANY, BLOG_FACTS, BLOG_CASES, POSITIONING_RULES } from "./company.leverads.js";

const STOP = new Set([
  "que", "com", "por", "para", "pra", "uma", "uns", "umas", "dos", "das", "nos", "nas", "não", "nao", "sim",
  "ele", "ela", "eles", "elas", "seu", "sua", "seus", "suas", "meu", "minha", "isso", "isto", "aquilo", "esse",
  "essa", "este", "esta", "mais", "menos", "muito", "muita", "como", "quando", "onde", "qual", "quais", "quanto",
  "quanta", "tem", "ter", "ser", "está", "esta", "são", "sao", "foi", "era", "vai", "vou", "the", "and", "for",
  "você", "voce", "voces", "vocês", "gente", "cada", "todo", "toda", "todos", "todas", "sobre", "entre", "sem",
  "até", "ate", "também", "tambem", "então", "entao", "mas", "ou", "num", "numa", "aqui", "ali", "lá", "já", "ja",
]);

const strip = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Tokens ≥ 3 chars, sem acento, sem stopword. Mantém repetição (quem quiser
// conjunto usa tokenSet).
export function tokenize(text) {
  return strip(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));
}
export const tokenSet = (text) => new Set(tokenize(text));

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Só baralhos de conhecimento geral e das pontas que falam com o cliente.
// Vaga comercial (SDR/closer) fica fora: é roteiro de venda, não matéria de blog.
export const KNOWLEDGE_ROLES = new Set(["geral_negocio", "geral_marketplace", "geral_vendas", "integrator", "social"]);
// Card que fala de preço, comissão, remuneração ou do próprio cockpit nunca
// entra no prompt: nada disso pode aparecer no texto público.
export const EXCLUDE_RE = /R\$|\d+\s?x\b|parcel|remunera|comiss|salári|cockpit|pipeline|no-show|cadência|SDR|closer/i;

const CARD_MAX = 300;
// Os cards ainda falam "clonar" (mecânica interna). O blog fala replicar/publicar
// (posicionamento), então a troca acontece ANTES do texto chegar ao redator:
// menos chance de a palavra proibida ser copiada e cair no lint.
export function reword(s) {
  return String(s || "")
    .replace(/\bclonagem\b/gi, (m) => (m[0] === "C" ? "Replicação" : "replicação"))
    .replace(/\bclonad(o|a)(s?)\b/gi, (m, g, pl) => `${m[0] === "C" ? "R" : "r"}eplicad${g.toLowerCase()}${pl}`)
    .replace(/\bclonar\b/gi, (m) => (m[0] === "C" ? "Replicar" : "replicar"))
    .replace(/\bclona(m|ndo)?\b/gi, (m, suf) => `${m[0] === "C" ? "R" : "r"}eplica${suf || ""}`)
    .replace(/\bclones?\b/gi, (m) => (m[0] === "C" ? "Réplica" : "réplica") + (m.endsWith("s") ? "s" : ""))
    // travessão dos cards vira dois-pontos/vírgula: o redator não pode ver o
    // traço nem pra copiar sem querer.
    .replace(/\s+—\s+/g, ": ").replace(/—/g, ",");
}
const clip = (s) => { const t = reword(s); return t.length > CARD_MAX ? `${t.slice(0, CARD_MAX - 1)}…` : t; };

// Top-k cards por sobreposição de tokens com o texto da pauta.
export function pickFlashcards(cards, text, k = 40) {
  const q = tokenSet(text);
  const out = [];
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || !KNOWLEDGE_ROLES.has(c.role)) continue;
    const front = clip(c.front), back = clip(c.back);
    if (EXCLUDE_RE.test(`${front} ${back}`)) continue;
    const score = jaccard(q, tokenSet(`${front} ${back}`));
    if (score > 0) out.push({ id: c.id, front, back, score });
  }
  return out.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))).slice(0, Math.max(0, k));
}

const pautaText = (p) => [p?.title, p?.keyword, p?.angle, ...(Array.isArray(p?.outline) ? p.outline : []), ...(Array.isArray(p?.faqSeeds) ? p.faqSeeds : [])].filter(Boolean).join(" ");

// Aceita lista de strings ou de objetos ({ objecao } | { text } | { q }).
const asLines = (arr) => (Array.isArray(arr) ? arr : []).map((x) => (typeof x === "string" ? x : x?.objecao || x?.text || x?.q || x?.dor || "")).filter(Boolean);

const EXCERPT_MAX = 3000;

// Trechos do digest (objeções das calls, perguntas do WhatsApp, dores) que
// têm a ver com a pauta, até ~3k chars.
function relevantExcerpts(digest, q) {
  const json = digest?.json || digest || {};
  const pick = (lines) => lines
    .map((l) => ({ l, s: jaccard(q, tokenSet(l)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.l);
  // Formato do blog-digest.js: { calls: { objecoes, dores }, questions: [...] };
  // aceita também as chaves no topo (digest antigo/teste).
  const out = {
    objecoes: pick(asLines(json.calls?.objecoes || json.objecoes)),
    perguntas: pick(asLines(json.questions || json.perguntas || json.whatsappQuestions)),
    dores: pick(asLines(json.calls?.dores || json.dores)),
  };
  let budget = EXCERPT_MAX;
  for (const k of Object.keys(out)) {
    const kept = [];
    for (const l of out[k]) {
      if (budget - l.length < 0) break;
      budget -= l.length; kept.push(l);
    }
    out[k] = kept;
  }
  return out;
}

// Só tokens presentes (string não vazia): métrica ausente não existe.
const presentTokens = (results) => Object.fromEntries(Object.entries(results || {}).filter(([, v]) => typeof v === "string" && v.trim()));

export function buildKnowledgePack({ pauta = {}, digest = null, product = null, pains = null, results = null, decks = LEVERADS_DECKS } = {}) {
  const q = tokenSet(pautaText(pauta));
  const code = pauta.painCode ? String(pauta.painCode) : "";
  const painDef = code && pains ? pains[code] : null;
  // SPIN do catálogo pode vir como objeto ({ P, S, I, N } ou similar): vira
  // linhas "P: ...", nunca "[object Object]" no prompt.
  const spinText = (v) => {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object") return Object.entries(v).filter(([, x]) => typeof x === "string" && x.trim()).map(([k, x]) => `${k}: ${x}`).join("\n");
    return "";
  };
  const pain = code
    ? { code, label: product?.painMap?.[code] || painDef?.label || "", spin: typeof painDef === "string" ? painDef : spinText(painDef?.spin || painDef?.text || "") }
    : null;
  return {
    company: LEVERADS_COMPANY,
    facts: BLOG_FACTS,
    cases: BLOG_CASES.filter((c) => c && c.text).map((c) => c.text),
    rules: POSITIONING_RULES,
    pain,
    cards: pickFlashcards(decks, pautaText(pauta), 40),
    results: presentTokens(typeof results === "function" ? results() : results),
    digestExcerpts: relevantExcerpts(digest, q),
  };
}

// Texto pronto pra seção CONHECIMENTO do prompt.
export function knowledgeText(pack) {
  if (!pack) return "";
  const lines = [];
  lines.push("QUEM SOMOS", pack.company?.what || "", `Missão: ${pack.company?.mission || ""}`, `Visão: ${pack.company?.vision || ""}`);
  for (const f of pack.company?.facts || []) lines.push(`${f.k}: ${f.v}`);
  lines.push("", "FATOS QUE PODEM SER AFIRMADOS (nada além disto e dos cards)");
  for (const f of pack.facts || []) lines.push(`- ${f}`);
  if (pack.cases?.length) { lines.push("", "CASES (sempre sem nome)"); for (const c of pack.cases) lines.push(`- ${c}`); }
  lines.push("", "REGRAS DE POSICIONAMENTO");
  for (const r of pack.rules || []) lines.push(`- ${r}`);
  if (pack.pain) {
    lines.push("", `DOR DA PAUTA [${pack.pain.code}]: ${pack.pain.label || ""}`);
    if (pack.pain.spin) lines.push(String(pack.pain.spin));
  }
  if (pack.cards?.length) {
    lines.push("", "CONHECIMENTO INTERNO (perguntas e respostas do time)");
    for (const c of pack.cards) lines.push(`- [${c.id}] P: ${c.front} R: ${c.back}`);
  }
  const res = Object.entries(pack.results || {});
  lines.push("", "RESULTADOS REAIS (use só estes números, como {{token||texto qualitativo}}; métrica ausente não existe)");
  if (res.length) for (const [k, v] of res) lines.push(`- {{${k}}} = ${v}`);
  else lines.push("- (nenhum número disponível agora: escreva de forma qualitativa)");
  const ex = pack.digestExcerpts || {};
  if (ex.objecoes?.length) { lines.push("", "OBJEÇÕES REAIS OUVIDAS NAS CALLS"); for (const l of ex.objecoes) lines.push(`- ${l}`); }
  if (ex.dores?.length) { lines.push("", "DORES CONFIRMADAS NAS CALLS"); for (const l of ex.dores) lines.push(`- ${l}`); }
  if (ex.perguntas?.length) { lines.push("", "PERGUNTAS REAIS DE LOJISTAS (WhatsApp, anonimizadas)"); for (const l of ex.perguntas) lines.push(`- ${l}`); }
  return lines.join("\n");
}
