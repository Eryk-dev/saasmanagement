// Pente fino do post antes de aprovar/agendar/publicar. Puro: recebe o doc e
// devolve a lista de problemas. `erro` bloqueia a publicação (blog-engine.js
// e routes.blog.js recusam); `aviso` só aparece na tela.
//
// O que é erro é a régua de copy do Leo (sem travessão, sem preço, sem
// "clonar", sem nome de cliente) mais o que quebraria a página (HTML cru,
// tabela/imagem que o renderizador não suporta, slug inválido, token sem
// fallback). Nada aqui corrige texto: quem corrige é a IA (blogRevise) ou o
// humano.

import { countWords } from "./blog-markdown.js";
import { isValidSlug } from "./blog-posts.js";

export const LINT_LEVELS = { erro: "erro", aviso: "aviso" };

const RE = {
  travessao: /—/,
  meiaRisca: /–/,
  preco: /R\$\s?\d|\b\d+\s?x\s?(de\s+)?R?\$?\s?\d|\b\d[\d.,]*\s?(reais|\/m[êe]s|por m[êe]s)|\bparcel|\bmensalidade\b[^.\n]{0,30}\d|\bplano\s+(anual|semestral|mensal)\s+(de|por)\s+R?\$?\s?\d/i,
  clonar: /\bclon(a|e|ar|agem|ado|ada|ando|es|ou)?\b/i,
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/,
  phone: /(\(\d{2}\)\s?|\+55\s?\d{2}\s?|\b\d{2}\s)9?\d{4}[-\s]\d{4}\b|\b\d{2}9\d{8}\b|\b9\d{4}-\d{4}\b/,
  cpf: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  cnpj: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
  html: /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i,
  tabela: /^\s*\|/m,
  imagem: /!\[/,
  tokenSemFallback: /\{\{\s*[A-Za-z][\w]*\s*\}\}/,
  h1: /^#\s+\S/m,
  h2: /^##\s+\S/m,
  promessa: /garantid|dobrar (as |suas )?vendas|100% de/i,
  emoji: /\p{Extended_Pictographic}/u,
};

const strip = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const issue = (code, level, msg) => ({ code, level, msg });

// Links markdown do corpo: [{ text, url }].
function links(body) {
  const out = [];
  for (const m of String(body || "").matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) out.push({ text: m[1], url: m[2] });
  return out;
}

export function lintPost(post, { names = [], ctaUrl = "" } = {}) {
  const p = post || {};
  const title = String(p.title || "").trim();
  const description = String(p.description || "").trim();
  const body = String(p.body || "");
  const faq = Array.isArray(p.faq) ? p.faq : [];
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const all = [title, description, body, ...faq.flatMap((f) => [f?.q, f?.a]), ...tags].filter(Boolean).join("\n");
  const out = [];

  // ── erro ──
  if (RE.travessao.test(all)) out.push(issue("travessao", "erro", "Travessão (—) no texto: use vírgula, ponto ou parênteses."));
  if (RE.preco.test(all)) out.push(issue("preco", "erro", "Preço, parcela ou condição comercial no texto: o blog não fala de valor."));
  if (RE.clonar.test(all)) out.push(issue("clonar", "erro", 'Fala em "clonar/clonagem": use publicar, replicar, sincronizar, operar, escalar.'));
  const hit = (Array.isArray(names) ? names : [])
    .map((n) => String(n || "").trim())
    .filter((n) => n.length >= 6 && /\s/.test(n))
    .find((n) => new RegExp(`(^|[^\\p{L}])${escapeRe(strip(n))}(?=$|[^\\p{L}])`, "iu").test(strip(all)));
  if (hit) out.push(issue("nome_cliente", "erro", `Nome de cliente/lead no texto: "${hit}".`));
  if (RE.email.test(all) || RE.phone.test(all) || RE.cpf.test(all) || RE.cnpj.test(all)) out.push(issue("contato", "erro", "Telefone, e-mail ou documento no texto."));
  if (RE.html.test(all)) out.push(issue("html_bruto", "erro", "HTML cru no texto: escreva só em markdown."));
  if (RE.tabela.test(body) || RE.imagem.test(body)) out.push(issue("tabela_ou_imagem", "erro", "Tabela ou imagem no markdown: o blog não renderiza (use lista e texto)."));
  if (!title) out.push(issue("title_vazio", "erro", "Sem título."));
  if (!description) out.push(issue("description_vazia", "erro", "Sem meta description."));
  const words = countWords(body);
  if (words < 700) out.push(issue("body_curto", "erro", `Corpo curto: ${words} palavras (mínimo 700).`));
  if (!RE.h2.test(body)) out.push(issue("sem_h2", "erro", "Sem nenhum H2 (## ) no corpo."));
  if (!isValidSlug(p.slug)) out.push(issue("slug_invalido", "erro", "Slug inválido ou reservado (só a-z, 0-9 e hífen, até 80)."));
  if (RE.tokenSemFallback.test(all)) out.push(issue("token_sem_fallback", "erro", "Token {{x}} sem fallback: escreva {{x||texto qualitativo}}."));

  // ── aviso ──
  if (RE.meiaRisca.test(all)) out.push(issue("meia_risca", "aviso", "Meia-risca (–) no texto: prefira vírgula ou ponto."));
  if (title.length > 60) out.push(issue("title_longo", "aviso", `Título com ${title.length} caracteres (o Google corta em ~60).`));
  if (description.length > 155) out.push(issue("description_longa", "aviso", `Description com ${description.length} caracteres (máximo 155).`));
  if (description && description.length < 70) out.push(issue("description_curta", "aviso", `Description curta (${description.length}; mire 70 a 155).`));
  if (words > 2200) out.push(issue("body_longo", "aviso", `Corpo longo: ${words} palavras (mire até 2.200).`));
  if (RE.h1.test(body)) out.push(issue("h1_no_body", "aviso", "H1 (# ) no corpo: o único H1 é o título; será rebaixado pra H2."));
  const kw = strip(p.keyword || "").trim();
  if (kw && !strip(body).includes(kw)) out.push(issue("keyword_ausente", "aviso", `A palavra-chave "${p.keyword}" não aparece no corpo.`));
  let ctaHost = "";
  try { ctaHost = ctaUrl ? new URL(ctaUrl).host : ""; } catch { ctaHost = ""; }
  if (ctaHost) {
    const cta = links(body).filter((l) => { try { return new URL(l.url).host === ctaHost; } catch { return false; } });
    if (!cta.length) out.push(issue("sem_cta", "aviso", "Nenhum link pro diagnóstico no corpo."));
    else if (!cta.some((l) => /[?&]utm_source=blog\b/.test(l.url))) out.push(issue("cta_sem_utm", "aviso", "Link do diagnóstico sem utm_source=blog (a atribuição do lead se perde)."));
  }
  if (faq.filter((f) => f?.q && f?.a).length < 2) out.push(issue("faq_curta", "aviso", "FAQ com menos de 2 perguntas."));
  if (RE.promessa.test(all)) out.push(issue("promessa", "aviso", "Promessa de resultado (garantido, dobrar vendas, 100%)."));
  if (RE.emoji.test(all)) out.push(issue("emoji", "aviso", "Emoji no texto."));

  return out;
}

export const lintOk = (issues) => !(Array.isArray(issues) ? issues : []).some((i) => i?.level === "erro");
