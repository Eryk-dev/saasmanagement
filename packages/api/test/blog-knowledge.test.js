// Pacote de conhecimento do redator: ranking dos cards, exclusões, sincronia
// da voz da empresa entre web e API, tokens ausentes fora.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tokenize, jaccard, pickFlashcards, buildKnowledgePack, knowledgeText, reword, EXCLUDE_RE } from "../src/blog-knowledge.js";
import { LEVERADS_COMPANY, BLOG_FACTS, POSITIONING_RULES } from "../src/company.leverads.js";
import { LEVERADS_DECKS } from "../src/flashcard-decks.leverads.js";

test("tokenize: sem acento, sem stopword, ≥ 3 chars", () => {
  assert.deepEqual(tokenize("Ação de título: ML & Shopee com estoque, você"), ["acao", "titulo", "shopee", "estoque"]);
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
  assert.equal(jaccard(new Set(), new Set(["b"])), 0);
});

test("pickFlashcards: ranking por sobreposição, filtro de baralho e exclusão de preço/interno", () => {
  const cards = [
    { id: "c1", role: "geral_negocio", front: "O que é a conta-mãe?", back: "A conta matriz: o que publica nela replica pras outras e o estoque comanda a baixa." },
    { id: "c2", role: "geral_negocio", front: "Nossa oferta", back: "Plano anual: 7.188 em 12x de 599, R$ fixo." },
    { id: "c3", role: "closer", front: "Como fechar a conta-mãe na call", back: "Mostrar a conta-mãe rodando ao vivo e pedir o cartão." },
    { id: "c4", role: "geral_marketplace", front: "Estoque em várias contas", back: "Estoque integrado evita furo de estoque quando vende em duas contas." },
    { id: "c5", role: "social", front: "Cadência de posts", back: "Cadência semanal no cockpit." },
    { id: "c6", role: "integrator", front: "Ping", back: "Nada a ver com o assunto pesquisado." },
  ];
  const got = pickFlashcards(cards, "conta-mãe e estoque integrado entre contas", 10);
  const ids = got.map((c) => c.id);
  assert.ok(ids.includes("c1") && ids.includes("c4"));
  assert.ok(!ids.includes("c2"), "preço fora");
  assert.ok(!ids.includes("c3"), "baralho closer fora");
  assert.ok(!ids.includes("c5"), "cadência/cockpit fora");
  assert.ok(!ids.includes("c6"), "sem sobreposição fora");
  assert.ok(got[0].score >= got[got.length - 1].score);
  assert.equal(pickFlashcards(cards, "conta-mãe estoque", 1).length, 1);
  assert.ok(EXCLUDE_RE.test("comissão do SDR"));
});

test("reword: cards deixam de falar em clonar antes de chegar ao redator", () => {
  assert.equal(reword("Clona e sincroniza; a clonagem; anúncios clonados; clonar; o clone; Clonando"), "Replica e sincroniza; a replicação; anúncios replicados; replicar; o réplica; Replicando");
  const big = pickFlashcards(LEVERADS_DECKS, "conta-mãe replica anúncios entre contas", 40);
  assert.ok(big.length > 0);
  assert.ok(big.every((c) => !/\bclon/i.test(`${c.front} ${c.back}`)), "nenhum card selecionado fala em clonar");
  assert.ok(big.every((c) => c.front.length <= 300 && c.back.length <= 300));
});

test("buildKnowledgePack + knowledgeText: dor, tokens presentes e trechos do digest relevantes", () => {
  const pack = buildKnowledgePack({
    pauta: { title: "Estoque integrado entre contas do Mercado Livre", keyword: "estoque integrado", painCode: "C", outline: ["Furo de estoque"] },
    product: { painMap: { C: "gerenciar SKUs em múltiplas contas" } },
    pains: { C: { spin: "Você já vendeu produto que não tinha em estoque?" } },
    results: { resRitmo: "R$ 10,4 mil", resDias: "", resClientes: null },
    digest: { json: { objecoes: [{ objecao: "medo de furo de estoque" }, { objecao: "preço alto" }], perguntas: ["como fica o estoque em duas contas?", "vocês atendem moda?"], dores: ["estoque desencontrado"] } },
    decks: LEVERADS_DECKS,
  });
  assert.equal(pack.pain.code, "C");
  assert.equal(pack.pain.label, "gerenciar SKUs em múltiplas contas");
  assert.match(pack.pain.spin, /estoque/);
  assert.deepEqual(Object.keys(pack.results), ["resRitmo"]);
  assert.ok(pack.cards.length > 0 && pack.cards.length <= 40);
  assert.deepEqual(pack.digestExcerpts.objecoes, ["medo de furo de estoque"]);
  assert.deepEqual(pack.digestExcerpts.perguntas, ["como fica o estoque em duas contas?"]);
  const text = knowledgeText(pack);
  assert.ok(text.includes("QUEM SOMOS") && text.includes(LEVERADS_COMPANY.what));
  assert.ok(text.includes("{{resRitmo}} = R$ 10,4 mil"));
  assert.ok(text.includes("DOR DA PAUTA [C]"));
  assert.ok(text.includes("PERGUNTAS REAIS DE LOJISTAS"));
  assert.ok(!text.includes("—"), "voz da empresa sem travessão");
  const empty = knowledgeText(buildKnowledgePack({ pauta: { title: "x" }, decks: [] }));
  assert.ok(empty.includes("nenhum número disponível"));
  assert.equal(knowledgeText(null), "");
});

test("company.leverads.js espelha o COMPANY da tela Treinamentos", async () => {
  const web = await readFile(new URL("../../web/src/screens/training.jsx", import.meta.url), "utf8");
  const m = web.match(/const COMPANY = \{\s*what: "([^"]+)"/);
  assert.ok(m, "COMPANY.what não encontrado em training.jsx");
  assert.equal(LEVERADS_COMPANY.what, m[1]);
  assert.ok(web.includes("company.leverads.js"), "training.jsx sem o comentário de sincronia");
  assert.ok(BLOG_FACTS.every((f) => !/R\$|\d+x|clon/i.test(f)), "fatos sem preço e sem clonar");
  assert.ok(POSITIONING_RULES.length >= 8);
});
