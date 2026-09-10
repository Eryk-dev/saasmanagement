// Pente fino do post: 1 positivo + 1 negativo por regra, níveis do plano.
import test from "node:test";
import assert from "node:assert/strict";
import { lintPost, lintOk } from "../src/blog-lint.js";

const CTA = "https://levermoney.com.br/f/fo_diagnostico_leverads";
const BODY = `## Por que a operação trava\n\n${"Texto de corpo com palavras suficientes pra passar da régua. ".repeat(75)}\n\n## Como a LeverAds entra nisso\n\nFaça o [diagnóstico gratuito](${CTA}?utm_source=blog&utm_medium=organic&utm_campaign=blog&utm_content=slug) e a gente mostra.`;
const GOOD = {
  title: "Como operar duas contas no Mercado Livre sem dobrar o time",
  slug: "como-operar-duas-contas-no-mercado-livre",
  description: "Um guia direto pra quem já vende em marketplace e quer abrir a segunda conta sem contratar mais gente nem furar o estoque.",
  keyword: "operação",
  body: BODY,
  faq: [{ q: "Serve pra Shopee?", a: "Sim." }, { q: "E o estoque?", a: "Fica integrado." }],
  tags: ["mercado livre", "estoque"],
};
const codes = (p, opts) => lintPost(p, { ctaUrl: CTA, ...(opts || {}) }).map((i) => `${i.code}:${i.level}`);

test("post bom passa limpo", () => {
  assert.deepEqual(codes(GOOD), []);
  assert.equal(lintOk(lintPost(GOOD, { ctaUrl: CTA })), true);
});

const erro = (patch, code, opts) => test(`erro ${code}`, () => {
  const c = codes({ ...GOOD, ...patch }, opts);
  assert.ok(c.includes(`${code}:erro`), `esperava ${code}, veio ${c.join(" ")}`);
  assert.equal(lintOk(lintPost({ ...GOOD, ...patch }, { ctaUrl: CTA, ...(opts || {}) })), false);
});
const aviso = (patch, code, opts) => test(`aviso ${code}`, () => {
  const c = codes({ ...GOOD, ...patch }, opts);
  assert.ok(c.includes(`${code}:aviso`), `esperava ${code}, veio ${c.join(" ")}`);
  assert.ok(!c.some((x) => x.endsWith(":erro")), `só aviso: ${c.join(" ")}`);
});

erro({ body: `${BODY}\n\nIsso — aquilo.` }, "travessao");
erro({ body: `${BODY}\n\nSão 12x de 99.` }, "preco");
erro({ body: `${BODY}\n\nPor R$ 349.` }, "preco");
erro({ body: `${BODY}\n\nSai 999/mês.` }, "preco");
erro({ body: `${BODY}\n\nDá 400 por mês.` }, "preco");
erro({ body: `${BODY}\n\nPode parcelar.` }, "preco");
erro({ body: `${BODY}\n\nA mensalidade fica em 300.` }, "preco");
erro({ title: "Como clonar anúncios" }, "clonar");
erro({ body: `${BODY}\n\nFalei com João da Silva ontem.` }, "nome_cliente", { names: ["João da Silva", "Ana", "Loja XYZ"] });
erro({ body: `${BODY}\n\nChama no (11) 99999-1234.` }, "contato");
erro({ body: `${BODY}\n\nMande pra x@y.com.` }, "contato");
erro({ body: `${BODY}\n\nCNPJ 12.345.678/0001-90.` }, "contato");
erro({ body: `${BODY}\n\n<script>alert(1)</script>` }, "html_bruto");
erro({ body: `${BODY}\n\n<b>negrito</b>` }, "html_bruto");
erro({ body: `${BODY}\n\n| a | b |` }, "tabela_ou_imagem");
erro({ body: `${BODY}\n\n![foto](x.png)` }, "tabela_ou_imagem");
erro({ title: " " }, "title_vazio");
erro({ description: "" }, "description_vazia");
erro({ body: "## H2\n\ncurto demais." }, "body_curto");
erro({ body: BODY.replace(/^## /gm, "") }, "sem_h2");
erro({ slug: "Preview" }, "slug_invalido");
erro({ slug: "preview" }, "slug_invalido");
erro({ body: `${BODY}\n\nVende {{resRitmo}} por mês.` }, "token_sem_fallback");

aviso({ body: `${BODY}\n\nIsso – aquilo.` }, "meia_risca");
aviso({ title: "Um título grande demais pra caber no resultado do Google sem cortar" }, "title_longo");
aviso({ description: `${GOOD.description} ${"x".repeat(60)}` }, "description_longa");
aviso({ description: "Curta demais." }, "description_curta");
aviso({ body: `${BODY}\n\n${"palavra ".repeat(1600)}` }, "body_longo");
aviso({ body: `# Título\n\n${BODY}` }, "h1_no_body");
aviso({ keyword: "logística reversa" }, "keyword_ausente");
aviso({ body: BODY.replace(/\[diagnóstico gratuito\]\([^)]+\)/, "diagnóstico") }, "sem_cta");
aviso({ body: BODY.replace(/\?utm_source=blog[^)]*/, "") }, "cta_sem_utm");
aviso({ faq: [{ q: "só uma", a: "resposta" }] }, "faq_curta");
aviso({ body: `${BODY}\n\nResultado garantido.` }, "promessa");
aviso({ body: `${BODY}\n\nBora 🚀` }, "emoji");

test("token com fallback e keyword sem acento passam; nome curto não conta", () => {
  const c = codes({ ...GOOD, keyword: "OPERAÇÃO", body: `${BODY}\n\nVende {{resRitmo||bem}} por mês.` }, { names: ["Ana", "Lu Sá"] });
  assert.deepEqual(c, []);
});

test("sem ctaUrl não avalia CTA; sem faq/tags não quebra", () => {
  const c = lintPost({ ...GOOD, faq: undefined, tags: undefined }, {}).map((i) => i.code);
  assert.ok(!c.includes("sem_cta") && !c.includes("cta_sem_utm"));
  assert.ok(c.includes("faq_curta"));
  assert.equal(lintOk(undefined), true);
});
