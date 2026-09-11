// Renderizador de markdown do blog: escape ANTES da marcação, links só com
// esquema seguro, tokens {{x||fallback}} e helpers de texto.
import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, substituteTokens, plainText, countWords, readingMinutes, slugify, escJson, esc } from "../src/blog-markdown.js";

const BASE = "https://leverads.com.br/blog";

test("headings: # e ## viram h2, ### h3, ####+ h4; ids únicos com -2", () => {
  const { html, headings } = renderMarkdown("# Título\n\n## Título\n\n### Sub\n\n#### Quatro\n\n## Outro");
  assert.match(html, /<h2 id="titulo">Título<\/h2>/);
  assert.match(html, /<h2 id="titulo-2">Título<\/h2>/);
  assert.match(html, /<h3 id="sub">Sub<\/h3>/);
  assert.match(html, /<h4 id="quatro">Quatro<\/h4>/);
  assert.ok(!html.includes("<h1"));
  assert.deepEqual(headings.map((h) => [h.level, h.id]), [[2, "titulo"], [2, "titulo-2"], [3, "sub"], [2, "outro"]]);
});

test("parágrafos: linhas seguidas viram um <p> unido por espaço; lista pode vir logo depois", () => {
  const { html } = renderMarkdown("linha um\nlinha dois\n- item a\n- item b\n1. um\n2) dois");
  assert.match(html, /<p>linha um linha dois<\/p>/);
  assert.match(html, /<ul><li>item a<\/li><li>item b<\/li><\/ul>/);
  assert.match(html, /<ol><li>um<\/li><li>dois<\/li><\/ol>/);
});

test("inline: negrito, itálico, código (blindado das outras regras)", () => {
  const { html } = renderMarkdown("**forte** e *leve* e _sub_ e `a **b** [x](https://e.com)`");
  assert.match(html, /<strong>forte<\/strong>/);
  assert.match(html, /<em>leve<\/em>/);
  assert.match(html, /<em>sub<\/em>/);
  assert.match(html, /<code>a \*\*b\*\* \[x\]\(https:\/\/e\.com\)<\/code>/);
});

test("links: http/https/relativo aceitos; relativo /blog/x absoluto sobre a base; externo ganha noopener; & preservado como &amp;", () => {
  const { html } = renderMarkdown("[a](https://x.com/p?a=1&b=2) [b](/blog/outro) [c](/termos) [d](#sec) [e](https://leverads.com.br/blog/z)", { base: BASE });
  assert.match(html, /<a href="https:\/\/x\.com\/p\?a=1&amp;b=2" rel="noopener">a<\/a>/);
  assert.match(html, /<a href="https:\/\/leverads\.com\.br\/blog\/outro">b<\/a>/);
  assert.match(html, /<a href="https:\/\/leverads\.com\.br\/termos">c<\/a>/);
  assert.match(html, /<a href="#sec">d<\/a>/);
  assert.match(html, /<a href="https:\/\/leverads\.com\.br\/blog\/z">e<\/a>/);
});

test("links perigosos viram só texto: javascript:, data:, protocolo relativo", () => {
  const { html } = renderMarkdown("[j](javascript:alert(1)) [d](data:text/html,x) [p](//evil.com/x)");
  assert.ok(!html.includes("<a "), html);
  assert.ok(!html.includes("javascript"), html);
  assert.match(html, /<p>j d p<\/p>/);
});

test("blockquote, hr e cerca de código (só escapada)", () => {
  const { html } = renderMarkdown("> um\n> dois\n>\n> três\n\n---\n\n```\n<b>x</b> & y\n```");
  assert.match(html, /<blockquote><p>um dois<\/p><p>três<\/p><\/blockquote>/);
  assert.ok(html.includes("<hr>"));
  assert.match(html, /<pre><code>&lt;b&gt;x&lt;\/b&gt; &amp; y<\/code><\/pre>/);
});

test("XSS: <script> em parágrafo, título, item, link e citação sai escapado", () => {
  const md = "# <script>1</script>\n\n<script>2</script>\n\n- <img src=x onerror=alert(1)>\n\n> <script>3</script>\n\n[<script>4</script>](https://a.com/\"onmouseover=\"x)";
  const { html } = renderMarkdown(md);
  assert.ok(!html.includes("<script"), html);
  assert.ok(!html.includes("<img"), html);
  assert.ok(!html.includes('onmouseover="'), html);
  assert.ok(html.includes("&lt;script&gt;1&lt;/script&gt;"));
});

test("tokens: presente substitui, ausente usa fallback, desconhecido vira vazio, valor com < é escapado, parágrafo vazio some", () => {
  const md = "A: {{resRitmo}}\n\nB: {{resDias||em poucos dias}}\n\n{{nada}}\n\nC: {{ resClientes || muitos }} clientes\n\n{{resHtml}}";
  const { html } = renderMarkdown(md, { tokens: { resRitmo: "R$ 10,4 mil", resHtml: "<b>x</b>" } });
  assert.match(html, /<p>A: R\$ 10,4 mil<\/p>/);
  assert.match(html, /<p>B: em poucos dias<\/p>/);
  assert.match(html, /<p>C: muitos clientes<\/p>/);
  assert.match(html, /<p>&lt;b&gt;x&lt;\/b&gt;<\/p>/);
  assert.equal((html.match(/<p>/g) || []).length, 4, html);
  assert.equal(substituteTokens("{{a||b}}{{c}}", { a: " " }), "b");
});

test("countWords, readingMinutes, plainText, slugify, escJson", () => {
  assert.equal(countWords("# T\n\nOlá **mundo** [x](u) {{a||b}} fim"), 5);
  assert.equal(readingMinutes(150), 1);
  assert.equal(readingMinutes(450), 2);
  assert.equal(readingMinutes(0), 1);
  const p = plainText("## Olá\n\n**mundo** [x](u) `c` {{resRitmo||dez mil}} > não\n- item", 500);
  assert.equal(p, "Olá mundo x c dez mil > não item");
  const cut = plainText(`${"palavra ".repeat(40)}`, 60);
  assert.ok(cut.length <= 60 && cut.endsWith("…"), cut);
  assert.equal(slugify("Ação de Título: ML & Shopee!"), "acao-de-titulo-ml-shopee");
  assert.equal(slugify("x".repeat(100)).length, 80);
  assert.equal(escJson({ a: "</script>" }), '{"a":"\\u003c/script>"}');
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
