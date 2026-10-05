// Markdown do blog → HTML (subconjunto, sem deps) + helpers de texto que o
// resto do blog reusa (slug, contagem de palavras, tempo de leitura).
//
// FONTE ÚNICA destes helpers: blog-posts.js (slug do post, wordCount no save)
// e blog-page.js (renderização) importam daqui.
//
// Ordem de segurança em renderMarkdown(): (1) tokens `{{x||fallback}}` são
// substituídos no markdown CRU; (2) cada trecho de texto passa por esc();
// (3) só então a marcação inline (negrito, link, código) vira tag. Nada que o
// autor (ou a IA) escreva chega ao HTML sem escape, e link só sai com esquema
// http(s), caminho relativo ou âncora.

// Escape de HTML (mesmas 5 trocas de manual-page.js). Também vale pra XML.
export const esc = (s) => String(s == null ? "" : s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

// JSON pra dentro de <script type="application/ld+json">: `<` vira < pra
// ninguém fechar a tag por dentro do JSON; U+2028/2029 quebram parsers antigos.
export const escJson = (obj) => JSON.stringify(obj)
  .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// Slug de URL: sem acento, minúsculo, só [a-z0-9-], sem hífen nas pontas, ≤ 80.
export function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

// Palavras do texto CRU (markdown ou não): tokens separados por espaço, sem
// sintaxe de marcação. Serve pro lint (body_curto) e pro tempo de leitura.
export function countWords(md) {
  const plain = String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, " ");
  return plain.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// 200 palavras por minuto, nunca menos de 1 minuto.
export function readingMinutes(words, wpm = 200) {
  const n = Number(words) || 0;
  return Math.max(1, Math.round(n / wpm));
}

// ── Tokens ───────────────────────────────────────────────────────────────────
// `{{resRitmo}}` ou `{{resRitmo||texto de fallback}}`. Namespace = chaves de
// leveradsResults() (res*) + `year`. Ausente → fallback → vazio. Nome fora do
// namespace resolve como ausente (a IA não inventa token). Espelha o
// `{{calc.x||fallback}}` do deck da proposta (proposal-page.js).
const TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\|\|\s*([^}]*?))?\s*\}\}/g;

export function substituteTokens(text, tokens = {}) {
  return String(text || "").replace(TOKEN_RE, (_m, name, fallback) => {
    const v = tokens && Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : undefined;
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
    return fallback !== undefined ? String(fallback).trim() : "";
  });
}

// ── Inline ───────────────────────────────────────────────────────────────────
// Roda sobre texto JÁ escapado. Ordem: código (protege o conteúdo das outras
// regras) → links → negrito → itálico → restaura código.
const SAFE_HREF = /^(https?:\/\/|\/(?!\/)|#)/i; // `//host` (protocolo relativo) fica de fora
const CODE_MARK = "\u0000";

function hrefFor(rawEscaped, base) {
  // o texto chegou escapado: `&amp;` → `&` só pra validar/reescrever
  const raw = rawEscaped.replaceAll("&amp;", "&");
  if (!SAFE_HREF.test(raw)) return null;
  let href = raw;
  let external = false;
  if (raw.startsWith("/")) {
    if (base) {
      let origin = "";
      try { origin = new URL(base).origin; } catch { origin = ""; }
      const rest = raw.replace(/^\/blog(?=\/|$)/, "");
      href = raw.startsWith("/blog") ? `${base}${rest}` : `${origin}${raw}`;
    }
  } else if (/^https?:\/\//i.test(raw)) {
    try {
      const host = new URL(raw).host;
      const baseHost = base ? new URL(base).host : "";
      external = !baseHost || host !== baseHost;
    } catch { return null; }
  }
  return { href: esc(href), external };
}

export function renderInline(escaped, { base = "" } = {}) {
  const codes = [];
  let s = escaped.replace(/`([^`\n]+)`/g, (_m, c) => { codes.push(c); return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`; });
  s = s.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_m, text, url) => {
    const link = hrefFor(url, base);
    if (!link) return text;
    return `<a href="${link.href}"${link.external ? ' rel="noopener"' : ""}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

// ── Blocos ───────────────────────────────────────────────────────────────────
const RE_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RE_HR = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_UL = /^\s*[-*•]\s+(.*)$/;
const RE_OL = /^\s*\d+[.)]\s+(.*)$/;
const RE_QUOTE = /^>\s?(.*)$/;
const RE_FENCE = /^```/;

function headingLevel(hashes) {
  const n = hashes.length;
  if (n <= 2) return 2;
  if (n === 3) return 3;
  return 4;
}

// Tira a marcação inline pra gerar id/plain (o texto ainda é o cru).
const stripInline = (s) => s
  .replace(/`([^`\n]+)`/g, "$1")
  .replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
  .replace(/\*\*([^*\n]+)\*\*/g, "$1")
  .replace(/\*([^*\n]+)\*/g, "$1");

export function renderMarkdown(md, { base = "", tokens = {} } = {}) {
  const src = substituteTokens(String(md || "").replace(/\r\n?/g, "\n"), tokens);
  const lines = src.split("\n");
  const out = [];
  const headings = [];
  const ids = new Map();
  const inline = (t) => renderInline(esc(t), { base });
  const uniqueId = (text) => {
    const basis = slugify(text) || "secao";
    const n = (ids.get(basis) || 0) + 1;
    ids.set(basis, n);
    return n === 1 ? basis : `${basis}-${n}`;
  };

  let i = 0;
  let para = [];
  const flushPara = () => {
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    if (text) out.push(`<p>${inline(text)}</p>`);
  };

  while (i < lines.length) {
    const line = lines[i];
    if (RE_FENCE.test(line)) {
      flushPara();
      const buf = [];
      i++;
      while (i < lines.length && !RE_FENCE.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // fecha (ou fim do texto)
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flushPara(); i++; continue; }
    let m;
    if ((m = line.match(RE_HEADING))) {
      flushPara();
      const level = headingLevel(m[1]);
      const plain = stripInline(m[2]).trim();
      const id = uniqueId(plain);
      if (level <= 3) headings.push({ level, id, text: plain });
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`);
      i++; continue;
    }
    if (RE_HR.test(line)) { flushPara(); out.push("<hr>"); i++; continue; }
    if (RE_QUOTE.test(line)) {
      flushPara();
      const paras = [];
      let cur = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        const t = lines[i].match(RE_QUOTE)[1];
        if (!t.trim()) { if (cur.length) { paras.push(cur.join(" ")); cur = []; } }
        else cur.push(t.trim());
        i++;
      }
      if (cur.length) paras.push(cur.join(" "));
      out.push(`<blockquote>${paras.map((p) => `<p>${inline(p)}</p>`).join("")}</blockquote>`);
      continue;
    }
    if (RE_UL.test(line) || RE_OL.test(line)) {
      flushPara();
      const ordered = RE_OL.test(line);
      const re = ordered ? RE_OL : RE_UL;
      const items = [];
      while (i < lines.length && re.test(lines[i])) { items.push(lines[i].match(re)[1].trim()); i++; }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushPara();
  return { html: out.join("\n"), headings, words: countWords(src) };
}

// Texto corrido sem marcação (description, RSS, JSON-LD). Tokens resolvidos
// com o fallback. Corta em `max` chars numa fronteira de palavra, com "…".
export function plainText(md, max = 300, tokens = {}) {
  const t = substituteTokens(String(md || "").replace(/\r\n?/g, "\n"), tokens)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/^(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!Number.isFinite(max) || max <= 0 || t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}
