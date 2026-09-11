// Tarefas de IA do blog (blogPautas / blogDraft / blogRevise): prompt carrega
// digest, existentes e seções; schema por tarefa; maxTokens chega nos dois
// provedores; não configurado falha claro; a voz não tem travessão.

import test from "node:test";
import assert from "node:assert/strict";

const { makeAnthropic, BLOG_VOICE, BLOG_PROMPT_VERSION } = await import("../src/anthropic.js");

// fetch fake: grava o corpo e responde no formato do provedor escolhido.
function fakeFetch(parsed, { openrouter = false } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const text = JSON.stringify(parsed);
    return {
      status: 200,
      json: async () => (openrouter
        ? { choices: [{ message: { content: text } }], usage: { prompt_tokens: 5, completion_tokens: 7 }, model: "openai/x" }
        : { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 7 } }),
    };
  };
  return { fetch, calls };
}

const PAUTA = {
  title: "Como operar várias contas no Mercado Livre", keyword: "várias contas mercado livre", intent: "guia",
  category: "Operação multi-contas", painCode: "A", angle: "a gente vê isso todo dia", outline: ["Por que", "Como"],
  evidence: ["DORES: A · 12 ganhos"], faqSeeds: ["Pode ter duas contas?"], priority: 1,
};

test("blogPautas: prompt leva digest, existentes, categorias e n; schema blog_pautas; default 16k tokens (Anthropic)", async () => {
  const { fetch, calls } = fakeFetch({ pautas: [PAUTA] });
  const ai = makeAnthropic({ fetch, apiKey: "sk-ant-x" });
  const r = await ai.blogPautas({
    digest: "PERFIL DE QUEM PROCURA A GENTE\n- autopeças 49%",
    existing: ["Post antigo sobre estoque"],
    categorias: ["Operação multi-contas", "Shopee"],
    n: 4,
  });
  assert.equal(r.pautas.length, 1);
  assert.equal(r.pautas[0].keyword, "várias contas mercado livre");
  assert.deepEqual(r.usage, { input_tokens: 5, output_tokens: 7 });
  const body = calls[0].body;
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.format.schema.required[0], "pautas");
  assert.match(body.system, /EDITOR-CHEFE/);
  const userMsg = body.messages[0].content;
  assert.match(userMsg, /autopeças 49%/);
  assert.match(userMsg, /Post antigo sobre estoque/);
  assert.match(userMsg, /Já existe no blog/);
  assert.match(userMsg, /Categorias permitidas: Operação multi-contas · Shopee/);
  assert.match(userMsg, /DIGEST:/);
  assert.match(userMsg, /Gere 4 pautas\./);
});

test("blogPautas no OpenRouter: response_format strict com nome blog_pautas e max_tokens 16000", async () => {
  const { fetch, calls } = fakeFetch({ pautas: [] }, { openrouter: true });
  const ai = makeAnthropic({ fetch, apiKey: "sk-or-x" });
  const r = await ai.blogPautas({ digest: "x" });
  assert.deepEqual(r.pautas, []);
  const body = calls[0].body;
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.response_format.json_schema.name, "blog_pautas");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[1].content, /Gere 6 pautas\./);
});

test("blogDraft: seções PAUTA/EVIDÊNCIAS/CONHECIMENTO/REGRAS EXTRAS + CTA; schema blog_draft; 24000 tokens nos dois provedores", async () => {
  const draft = { title: "T", slug: "varias-contas-mercado-livre", description: "d", body_md: "## A\n\ntexto", faq: [{ q: "q", a: "a" }], tags: ["ml"], sourcesUsed: ["ger_n_4"] };
  for (const openrouter of [false, true]) {
    const { fetch, calls } = fakeFetch(draft, { openrouter });
    const ai = makeAnthropic({ fetch, apiKey: openrouter ? "sk-or-x" : "sk-ant-x" });
    const r = await ai.blogDraft({
      pauta: PAUTA,
      knowledge: "QUEM SOMOS: empresa de tecnologia",
      rules: ["não cite concorrente"],
      ctaUrl: "https://levermoney.com.br/f/fo_diagnostico_leverads",
    });
    assert.equal(r.draft.slug, "varias-contas-mercado-livre");
    assert.equal(r.draft.faq[0].q, "q");
    const body = calls[0].body;
    assert.equal(body.max_tokens, 24000);
    const userMsg = openrouter ? body.messages[1].content : body.messages[0].content;
    const system = openrouter ? body.messages[0].content : body.system;
    assert.match(system, /REDATOR/);
    for (const sec of ["PAUTA:", "EVIDÊNCIAS:", "CONHECIMENTO:", "REGRAS EXTRAS:"]) assert.ok(userMsg.includes(sec), `falta ${sec}`);
    assert.match(userMsg, /"keyword": "várias contas mercado livre"/);
    assert.match(userMsg, /DORES: A · 12 ganhos/);
    assert.match(userMsg, /QUEM SOMOS: empresa de tecnologia/);
    assert.match(userMsg, /não cite concorrente/);
    assert.match(userMsg, /https:\/\/levermoney\.com\.br\/f\/fo_diagnostico_leverads/);
    assert.match(userMsg, /fazer o diagnóstico gratuito/);
    const schemaName = openrouter ? body.response_format.json_schema.name : "blog_draft";
    assert.equal(schemaName, "blog_draft");
    const schema = openrouter ? body.response_format.json_schema.schema : body.output_config.format.schema;
    assert.deepEqual(schema.required, ["title", "slug", "description", "body_md", "faq", "tags", "sourcesUsed"]);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.faq.items.additionalProperties, false);
  }
});

test("blogRevise: INSTRUÇÃO + PROBLEMAS DO LINT + ARTIGO ATUAL; schema blog_revise sem slug", async () => {
  const revised = { title: "T2", description: "d2", body_md: "## B", faq: [], tags: ["x"], changeNote: "tirei o travessão" };
  const { fetch, calls } = fakeFetch(revised);
  const ai = makeAnthropic({ fetch, apiKey: "sk-ant-x" });
  const r = await ai.blogRevise({
    post: { title: "T", description: "d", body: "## A\n\ntexto com preço", faq: [{ q: "q", a: "a" }], tags: ["ml"] },
    instruction: "deixe mais curto",
    lintIssues: [{ code: "travessao", msg: "tem travessão no corpo" }, "preco: tem R$"],
  });
  assert.equal(r.revised.changeNote, "tirei o travessão");
  const body = calls[0].body;
  assert.equal(body.max_tokens, 24000);
  assert.match(body.system, /REVISOR/);
  const userMsg = body.messages[0].content;
  assert.match(userMsg, /INSTRUÇÃO:\ndeixe mais curto/);
  assert.match(userMsg, /- travessao: tem travessão no corpo/);
  assert.match(userMsg, /- preco: tem R\$/);
  assert.match(userMsg, /ARTIGO ATUAL:/);
  assert.match(userMsg, /"body_md": "## A\\n\\ntexto com preço"/);
  const schema = body.output_config.format.schema;
  assert.deepEqual(schema.required, ["title", "description", "body_md", "faq", "tags", "changeNote"]);
  assert.equal("slug" in schema.properties, false);
});

test("blog: sem chave configurada, as três tarefas falham claro", async () => {
  const ai = makeAnthropic({ fetch: async () => ({}), apiKey: "" });
  await assert.rejects(() => ai.blogPautas({ digest: "x" }), /IA não configurada/);
  await assert.rejects(() => ai.blogDraft({ pauta: PAUTA }), /IA não configurada/);
  await assert.rejects(() => ai.blogRevise({ post: {}, instruction: "x" }), /IA não configurada/);
});

test("BLOG_VOICE: sem travessão no próprio texto; versão do prompt exportada", () => {
  assert.ok(!BLOG_VOICE.includes("—"));
  assert.match(BLOG_VOICE, /primeira pessoa do plural/);
  assert.match(BLOG_VOICE, /\{\{token\|\|texto qualitativo\}\}/);
  assert.equal(BLOG_PROMPT_VERSION, "2026-09-v1");
});

test("maxTokens: chamadas antigas seguem com 16000 (regressão)", async () => {
  const { fetch, calls } = fakeFetch({ fields: [], caption: "" });
  const ai = makeAnthropic({ fetch, apiKey: "sk-ant-x" });
  await ai.suggestSocialCopy({ fields: [{ key: "x", label: "X", example: "y" }] });
  assert.equal(calls[0].body.max_tokens, 16000);
});
