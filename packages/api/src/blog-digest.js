// Digest editorial do blog: o que o cockpit já sabe, resumido pra caber num
// prompt. É a matéria-prima do motor de pautas (blog-engine.js): perfil de quem
// preenche o diagnóstico, dores que fecham venda, objeções e dores das calls,
// perguntas REAIS que o lead digita no WhatsApp, resultados reais do produto e
// o que já existe no blog (pra não repetir).
//
// Regras que sustentam o desenho:
// - Só agregados e frases curtas saem daqui. Nome, telefone, e-mail, empresa,
//   id de lead/thread NUNCA vão pra IA: `anonymize()` roda em todo texto livre.
// - Collections grandes (activities, wa_messages, form_submissions) entram por
//   `listWhere` com projeção, nunca por `repo.list`.
// - Sem travessão no texto gerado (regra de copy do Leo).

import { isRealLead } from "./metrics-core.js";
import { isWonLead } from "./stages.js";
import { isSalesCallSummary, dedupCallSummaries, aggregateCalls } from "./routes.pitch.js";
import { leveradsResults } from "./leverads-results.js";

const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString();

// ── Anonimização ────────────────────────────────────────────────────────────
// Ordem importa: padrões estruturais primeiro (telefone, e-mail, URL, documento,
// @handle), depois a auto-apresentação ("meu nome é X") e por fim os nomes e
// empresas conhecidos do banco.
const RE_PHONE = /(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g;
const RE_EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const RE_URL = /(https?:\/\/|www\.)[^\s]+/gi;
const RE_CPF_CNPJ = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const RE_HANDLE = /(^|[\s(])@[\w.]{2,}/g;
// Valores e parcelas NÃO entram no prompt do redator (o blog não fala de preço,
// e o que entra como exemplo tende a sair no texto).
const RE_PARCELA = /\b\d{1,2}\s?(?:x|vezes|parcelas?)\s?(?:de\s+)?R?\$?\s?[\d.,]+(?:\s?(?:mil|milh[õo]es|milh[ãa]o))?/gi;
const RE_VALOR = /R\$\s?[\d.,]+(?:\s?(?:mil|milh[õo]es|milh[ãa]o))?/g;
// "meu nome é Fulano de Tal", "aqui é o Fulano", "sou a Maria", "me chamo X",
// "da loja Peças Boas", "da empresa ACME". Pega até 4 palavras iniciadas em
// maiúscula (ou tudo até pontuação, quando o lead escreve em minúscula).
const RE_INTRO = /\b(meu nome [ée]|aqui [ée] [oa]|sou [oa]|me chamo|da loja|da empresa)\s+((?:[A-ZÀ-Ú][\wÀ-ú.&-]*)(?:\s+(?:de|da|do|das|dos|e|[A-ZÀ-Ú][\wÀ-ú.&-]*)){0,4}|[^,.!?\n]{2,40})/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function anonymize(text, { names = [], companies = [] } = {}) {
  let t = String(text || "");
  if (!t) return "";
  t = t.replace(RE_URL, "[link]");
  t = t.replace(RE_EMAIL, "[email]");
  t = t.replace(RE_CPF_CNPJ, "[documento]");
  t = t.replace(RE_PHONE, "[telefone]");
  t = t.replace(RE_HANDLE, (m, lead) => `${lead}[perfil]`);
  t = t.replace(RE_PARCELA, "[parcelas]");
  t = t.replace(RE_VALOR, "[valor]");
  t = t.replace(RE_INTRO, (m, lead) => `${lead} [nome]`);
  const clean = (list, min, minWords) => [...new Set((list || [])
    .map((s) => String(s || "").trim())
    .filter((s) => s.length >= min && s.split(/\s+/).length >= minWords))]
    .sort((a, b) => b.length - a.length); // nome mais longo primeiro (não deixa sobra)
  for (const n of clean(names, 6, 2)) t = t.replace(new RegExp(`\\b${escapeRe(n)}\\b`, "gi"), "[nome]");
  for (const c of clean(companies, 4, 1)) t = t.replace(new RegExp(`\\b${escapeRe(c)}\\b`, "gi"), "[empresa]");
  return t.replace(/\s{2,}/g, " ").trim();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const pct = (n, total) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "0%");

function distribution(rows, key, top = 5) {
  const counts = new Map();
  let total = 0;
  for (const r of rows) {
    const v = r?.[key];
    if (v == null || v === "") continue;
    const k = String(Array.isArray(v) ? v.join("+") : v).trim().toLowerCase();
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
    total++;
  }
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([value, n]) => ({ value, n, pct: pct(n, total) }));
  return { total, items };
}

const fmtDist = (label, d) => d.total
  ? `${label} (${d.total} respostas): ${d.items.map((i) => `${i.value} ${i.pct}`).join(", ")}`
  : "";

// ── 1. Perfil (form_submissions) ────────────────────────────────────────────
const AUDIENCE_KEYS = [
  ["niche", "Nicho"], ["accounts", "Contas de marketplace"], ["listings", "Anúncios ativos"],
  ["vende_marketplace", "Já vende em marketplace"], ["plan_expand", "Plano de abrir mais contas"],
  ["marketplaces", "Marketplaces"], ["volume", "Volume de pedidos"], ["staff", "Tamanho do time"],
];

export async function buildAudienceDigest(repo, saas, now = new Date()) {
  const since = iso(now.getTime() - 180 * DAY);
  let subs = await repo.listWhere("form_submissions", { saas }, { fields: ["answers", "createdAt", "form", "saas"] });
  if (!subs.length) {
    const forms = (await repo.list("forms")).filter((f) => f?.saas === saas).map((f) => f.id);
    subs = [];
    for (const form of forms) {
      subs.push(...await repo.listWhere("form_submissions", { form }, { fields: ["answers", "createdAt", "form", "saas"] }));
    }
  }
  const recent = subs.filter((s) => !s.createdAt || String(s.createdAt) >= since);
  const rows = recent.map((s) => (s.answers && typeof s.answers === "object" ? s.answers : s));
  const dists = {};
  const lines = [];
  for (const [key, label] of AUDIENCE_KEYS) {
    const d = distribution(rows, key);
    dists[key] = d;
    const line = fmtDist(label, d);
    if (line) lines.push(`• ${line}`);
  }
  return {
    count: recent.length,
    dists,
    text: recent.length
      ? [`Diagnósticos respondidos nos últimos 180 dias: ${recent.length}.`, ...lines].join("\n")
      : "Sem diagnóstico respondido nos últimos 180 dias.",
  };
}

// ── 2. Dores que fecham venda (leads × painMap) ─────────────────────────────
export async function buildPainDigest(repo, saas) {
  const product = await repo.get("products", saas);
  const painMap = (product && typeof product.painMap === "object" && product.painMap) || {};
  let catalogPains = {};
  try {
    const tpl = await repo.get("proposal_templates", `pt_${saas}`);
    catalogPains = tpl?.calc?.catalog?.pains && typeof tpl.calc.catalog.pains === "object" ? tpl.calc.catalog.pains : {};
  } catch { catalogPains = {}; }
  const leads = (await repo.list("leads")).filter((l) => l?.saas === saas && isRealLead(l));
  const by = new Map();
  let total = 0;
  for (const l of leads) {
    total++;
    const code = String(l.sourcePain || "").trim().toUpperCase();
    if (!code) continue;
    const e = by.get(code) || { code, leads: 0, won: 0 };
    e.leads++;
    if (isWonLead(product, l)) e.won++;
    by.set(code, e);
  }
  const pains = [...by.values()].map((e) => {
    const cat = catalogPains[e.code] || {};
    return {
      ...e,
      label: painMap[e.code] || cat.label || e.code,
      rate: e.leads ? Math.round((e.won / e.leads) * 1000) / 10 : 0,
      spin: cat.spin && typeof cat.spin === "object" ? cat.spin : null,
    };
  }).sort((a, b) => b.won - a.won || b.leads - a.leads);
  const lines = pains.map((p) => `• [${p.code}] ${p.label}: ${p.leads} leads, ${p.won} vendas (${p.rate}%)${p.spin?.P ? `. Pergunta de dor usada na call: "${p.spin.P}"` : ""}`);
  return {
    count: total,
    pains,
    text: pains.length
      ? [`Leads reais do produto: ${total}. Por dor do anúncio que trouxe o lead (ordenado pelo que mais fecha):`, ...lines].join("\n")
      : `Leads reais do produto: ${total}. Nenhum lead com dor rastreada ainda.`,
  };
}

// ── 3. Calls (resumos por IA) ───────────────────────────────────────────────
export async function buildCallDigest(repo, saas, now = new Date()) {
  const since = iso(now.getTime() - 180 * DAY);
  const known = await knownNames(repo, saas);
  const anon = (x) => anonymize(x, known);
  const acts = await repo.listWhere("activities", { saas, type: "system" }, { fields: ["meta", "at", "lead", "saas", "type"] });
  const sales = dedupCallSummaries(acts.filter((a) => isSalesCallSummary(a, saas)))
    .filter((a) => !a.at || String(a.at) >= since);
  // Resumos entram já anonimizados: objeção/dor/tratamento citam lead, closer e valor.
  const summaries = sales.map((a) => a.meta.summary).map((sm) => ({
    ...sm,
    dores: (sm?.dores || []).map(anon),
    objecoes: (sm?.objecoes || []).map((o) => ({ ...o, objecao: anon(o?.objecao), comoFoiTratada: anon(o?.comoFoiTratada) })),
  }));
  const agg = aggregateCalls(summaries);
  // exemplos de tratamento (1-2 por objeção), como no buildCallsDigest do pitch
  const tratadas = new Map();
  for (const s of summaries) {
    for (const o of s?.objecoes || []) {
      const k = String(o?.objecao || "").trim().toLowerCase().slice(0, 80);
      if (!k || !o.resolvida || !o.comoFoiTratada) continue;
      const arr = tratadas.get(k) || [];
      if (arr.length < 2) arr.push(String(o.comoFoiTratada));
      tratadas.set(k, arr);
    }
  }
  const objecoes = agg.objecoes.slice(0, 15).map((o) => ({ ...o, tratadas: tratadas.get(String(o.objecao).trim().toLowerCase().slice(0, 80)) || [] }));
  const dores = agg.dores.slice(0, 15);
  const lines = [
    `Calls de venda resumidas nos últimos 180 dias: ${agg.count} (${agg.temperatura.quente} quentes, ${agg.temperatura.morno} mornas, ${agg.temperatura.frio} frias).`,
    "Objeções mais frequentes (vezes · em aberto · como foi tratada quando resolvida):",
    ...objecoes.map((o) => `• ${o.objecao} · ${o.total}x, ${o.abertas} em aberto${o.tratadas.length ? `; tratada com: ${o.tratadas.join(" / ")}` : ""}`),
    "Dores que mais aparecem nas calls:",
    ...dores.map((d) => `• ${d.dor} · ${d.total}x`),
  ];
  return {
    count: agg.count,
    temperatura: agg.temperatura,
    objecoes,
    dores,
    text: agg.count ? lines.join("\n") : "Nenhuma call de venda resumida nos últimos 180 dias.",
  };
}

// ── 4. Perguntas reais do WhatsApp ──────────────────────────────────────────
const RE_QUESTION_START = /^(como|quanto|qual|quais|tem|dá pra|da pra|funciona|consigo|posso|preciso|e se|serve|vocês|voces)\b/i;
const normalizeQ = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

async function knownNames(repo, saas) {
  const names = [];
  const companies = [];
  const leads = await repo.listWhere("leads", { saas }, { fields: ["name", "company"] }).catch(() => []);
  for (const l of leads) {
    if (l?.name) names.push(String(l.name));
    if (l?.company) companies.push(String(l.company));
  }
  const customers = await repo.listWhere("customers", { saas }, { fields: ["name"] }).catch(() => []);
  for (const c of customers) if (c?.name) names.push(String(c.name));
  // threads do WhatsApp guardam o nome do perfil de quem escreve
  const threads = await repo.listWhere("wa_threads", { saas }, { fields: ["name"] }).catch(() => []);
  for (const t of threads) if (t?.name) names.push(String(t.name));
  return { names, companies };
}

export async function buildQuestionDigest(repo, saas, now = new Date(), { cap = 120 } = {}) {
  const since = iso(now.getTime() - 90 * DAY);
  const msgs = await repo.listWhere("wa_messages", { saas, direction: "in", at: { gte: since } }, { fields: ["text", "at"] });
  const { names, companies } = await knownNames(repo, saas);
  const seen = new Set();
  const buckets = new Map();
  const out = [];
  const sorted = [...msgs].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  for (const m of sorted) {
    const raw = String(m?.text || "").replace(/\s+/g, " ").trim();
    if (raw.length < 15 || raw.length > 280) continue;
    const digits = (raw.match(/\d/g) || []).length;
    if (digits > raw.length / 2) continue;
    if (!raw.includes("?") && !RE_QUESTION_START.test(raw)) continue;
    const text = anonymize(raw, { names, companies });
    const norm = normalizeQ(text);
    if (!norm || seen.has(norm)) continue;
    const bucket = norm.split(" ").slice(0, 3).join(" ");
    const n = buckets.get(bucket) || 0;
    if (n >= 3) continue;
    buckets.set(bucket, n + 1);
    seen.add(norm);
    out.push(text);
    if (out.length >= cap) break;
  }
  return {
    count: out.length,
    questions: out,
    text: out.length
      ? [`Perguntas e dúvidas que os leads mandaram no WhatsApp nos últimos 90 dias (${out.length}, anonimizadas):`, ...out.map((q) => `• ${q}`)].join("\n")
      : "Nenhuma pergunta de lead no WhatsApp nos últimos 90 dias.",
  };
}

// ── 5. Resultados reais ─────────────────────────────────────────────────────
// Rótulo semântico de cada token (a mesma semântica do cabeçalho de
// leverads-results.js). Token ausente não existe: não entra e não vira zero.
export const RESULT_LABELS = {
  resClientes: "clientes rodando (com venda influenciada dentro da janela)",
  resContas: "contas com venda all-time, incluindo a nossa operação",
  resMes: "vendido pelos anúncios da Lever nos últimos 30 dias (clientes + nossa operação)",
  resMesClientes: "fatia dos clientes nos últimos 30 dias",
  resMesNosso: "fatia da nossa operação nos últimos 30 dias",
  resGerado: "GMV all-time gerado nas contas dos clientes",
  resGeradoClientes: "GMV all-time gerado nas contas dos clientes",
  resGeradoTudo: "GMV all-time clientes + nossa operação",
  resGeradoNosso: "GMV all-time só da nossa operação",
  resRitmo: "mediana de R$ por mês por cliente desde a 1ª venda influenciada",
  resDias: "mediana de dias entre conectar a conta e a 1ª venda",
  resAnuncios: "anúncios de destino distintos criados pela plataforma",
  resHoras: "horas de trabalho manual poupadas (15 min por anúncio)",
  resParticipacao: "fatia do faturamento do período que passou pela Lever",
};

export function buildResultsDigest(results = leveradsResults) {
  let tokens = null;
  try { tokens = typeof results === "function" ? results() : results; } catch { tokens = null; }
  const present = {};
  for (const [k, label] of Object.entries(RESULT_LABELS)) {
    if (tokens && tokens[k] != null && tokens[k] !== "") present[k] = { value: String(tokens[k]), label };
  }
  const lines = Object.entries(present).map(([k, v]) => `• {{${k}}} = ${v.value} (${v.label})`);
  return {
    count: lines.length,
    tokens: present,
    text: [
      lines.length ? "Números reais disponíveis (use SEMPRE como {{token||fallback}}, nunca inventados):" : "Nenhum número real disponível agora.",
      ...lines,
      "Métricas ausentes não existem: não invente.",
    ].join("\n"),
  };
}

// ── 6. O que já existe no blog ──────────────────────────────────────────────
export async function existingPostsDigest(repo, saas) {
  const rows = (await repo.listWhere("blog_posts", { saas }, { fields: ["title", "keyword", "slug", "status"] }))
    .filter((r) => r && r.status !== "arquivado");
  const grp = { publicado: [], fila: [], pauta: [] };
  for (const r of rows) {
    const item = { title: r.title || "", keyword: r.keyword || "", slug: r.slug || "" };
    if (r.status === "publicado") grp.publicado.push(item);
    else if (r.status === "agendado" || r.status === "rascunho") grp.fila.push(item);
    else grp.pauta.push(item);
  }
  const fmt = (label, list) => list.length
    ? `${label}:\n${list.map((i) => `• ${i.title}${i.keyword ? ` (keyword: ${i.keyword})` : ""}`).join("\n")}`
    : "";
  const text = [fmt("Já publicado", grp.publicado), fmt("Na fila (agendado/rascunho)", grp.fila), fmt("Pauta aberta", grp.pauta)]
    .filter(Boolean).join("\n");
  return { count: rows.length, ...grp, text: text || "Blog vazio: nenhum post ainda." };
}

// ── Montagem ────────────────────────────────────────────────────────────────
const MAX_CHARS = 14_000;

export async function buildBlogDigest({ repo, saas, now = new Date(), results = leveradsResults }) {
  const [audience, pains, calls, questions, resultsD, existing] = await Promise.all([
    buildAudienceDigest(repo, saas, now),
    buildPainDigest(repo, saas),
    buildCallDigest(repo, saas, now),
    buildQuestionDigest(repo, saas, now),
    Promise.resolve(buildResultsDigest(results)),
    existingPostsDigest(repo, saas),
  ]);

  const section = (title, body) => `## ${title}\n${body}`;
  const compose = (qText) => [
    section("PERFIL DE QUEM PROCURA A GENTE", audience.text),
    section("DORES QUE FECHAM VENDA", pains.text),
    section("OBJEÇÕES E DORES NAS CALLS", calls.text),
    section("PERGUNTAS REAIS NO WHATSAPP (anonimizadas)", qText),
    section("RESULTADOS REAIS", resultsD.text),
    section("JÁ EXISTE NO BLOG (não repetir)", existing.text),
  ].join("\n\n");

  // Cap: a seção de WhatsApp é a que cresce; corta ela primeiro, pergunta a
  // pergunta, até caber. Se ainda assim passar, corta no limite.
  let qs = questions.questions.slice();
  let text = compose(questions.text);
  while (text.length > MAX_CHARS && qs.length) {
    qs = qs.slice(0, Math.max(0, Math.floor(qs.length * 0.8)));
    const qText = qs.length
      ? [`Perguntas e dúvidas que os leads mandaram no WhatsApp nos últimos 90 dias (${qs.length}, anonimizadas):`, ...qs.map((q) => `• ${q}`)].join("\n")
      : "Nenhuma pergunta de lead no WhatsApp nos últimos 90 dias.";
    text = compose(qText);
  }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  text = text.replace(/—/g, ",");

  return {
    text,
    json: {
      audience: { count: audience.count, dists: audience.dists },
      pains: pains.pains,
      calls: { count: calls.count, temperatura: calls.temperatura, objecoes: calls.objecoes, dores: calls.dores },
      questions: qs,
      results: resultsD.tokens,
      existing: { publicado: existing.publicado, fila: existing.fila, pauta: existing.pauta },
    },
    builtAt: now.toISOString(),
    counts: {
      submissions: audience.count,
      leads: pains.count,
      calls: calls.count,
      questions: qs.length,
      posts: existing.count,
    },
  };
}
