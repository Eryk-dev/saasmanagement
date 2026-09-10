// Digest editorial do blog (blog-digest.js): agrega o que o cockpit sabe
// (diagnósticos, dores × vendas, calls, WhatsApp, resultados, posts) em texto
// pra prompt, SEM vazar dado pessoal. Offline (mem-repo).

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  anonymize, buildBlogDigest, buildAudienceDigest, buildPainDigest, buildCallDigest,
  buildQuestionDigest, buildResultsDigest, existingPostsDigest,
} from "../src/blog-digest.js";

const NOW = new Date("2026-09-10T12:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();

async function seed() {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    painMap: { A: "Subir os mesmos anúncios nas outras contas", B: "Conta banida", OEM: "Autopeças por part number" },
    funnel: [{ stage: "Inbox", kind: "inbox" }, { stage: "Ganho", kind: "ganho" }, { stage: "Perdido", kind: "perdido" }],
  });
  await repo.create("proposal_templates", {
    id: "pt_leverads",
    calc: { catalog: { pains: { A: { label: "Subir anúncios", spin: { P: "Quanto tempo vai embora copiando anúncio?" } } } } },
  });
  await repo.create("forms", { id: "fo_diag", saas: "leverads" });
  // diagnósticos: 3 recentes + 1 velho
  for (const [i, niche] of ["autopecas", "autopecas", "moda"].entries()) {
    await repo.create("form_submissions", { id: `fs_${i}`, saas: "leverads", form: "fo_diag", createdAt: daysAgo(10 + i), answers: { niche, accounts: "3-5", listings: "2k-10k", nome: "Fulano", whatsapp: "11999990000" } });
  }
  await repo.create("form_submissions", { id: "fs_old", saas: "leverads", form: "fo_diag", createdAt: daysAgo(400), answers: { niche: "beleza" } });
  // leads: A fecha 1 de 2, B 0 de 1, interno fora, formExit fora
  await repo.create("leads", { id: "ld_1", saas: "leverads", name: "Carlos Alberto Souza", company: "Peças Boas Autopeças", sourcePain: "A", stage: "Ganho", customerId: "cu_1" });
  await repo.create("leads", { id: "ld_2", saas: "leverads", name: "Maria Fernanda Lima", sourcePain: "A", stage: "Inbox" });
  await repo.create("leads", { id: "ld_3", saas: "leverads", name: "João Pedro", sourcePain: "B", stage: "Perdido" });
  await repo.create("leads", { id: "ld_4", saas: "leverads", name: "Teste Interno", sourcePain: "A", stage: "Ganho", internal: true });
  await repo.create("leads", { id: "ld_5", saas: "leverads", name: "Sem Marketplace", formExit: "mentoria", sourcePain: "A" });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Carlos Alberto Souza" });
  // calls: 2 de venda (uma re-resumida do mesmo meet), 1 integração (fora), 1 velha (fora)
  const summary = (extra) => ({ resumo: "ok", temperatura: "quente", dores: ["medo de banimento"], objecoes: [{ objecao: "Preço alto", comoFoiTratada: "mostrou ROI", resolvida: true }], ...extra });
  await repo.create("activities", { id: "ac_1", saas: "leverads", type: "system", lead: "ld_1", at: daysAgo(5), meta: { event: "call_summary", kind: "call", meetEventId: "m1", summary: summary({}) } });
  await repo.create("activities", { id: "ac_1b", saas: "leverads", type: "system", lead: "ld_1", at: daysAgo(4), meta: { event: "call_summary", kind: "call", meetEventId: "m1", summary: summary({ temperatura: "morno" }) } });
  await repo.create("activities", { id: "ac_2", saas: "leverads", type: "system", lead: "ld_2", at: daysAgo(20), meta: { event: "call_summary", kind: "call", meetEventId: "m2", summary: summary({ temperatura: "frio", objecoes: [{ objecao: "preço alto", resolvida: false }], dores: ["tempo de setup"] }) } });
  await repo.create("activities", { id: "ac_3", saas: "leverads", type: "system", lead: "ld_1", at: daysAgo(3), meta: { event: "call_summary", kind: "integracao", meetEventId: "m3", summary: { resumo: "onboarding", pendencias: [{ item: "OBJEÇÃO FANTASMA" }] } } });
  await repo.create("activities", { id: "ac_4", saas: "leverads", type: "system", lead: "ld_3", at: daysAgo(300), meta: { event: "call_summary", kind: "call", meetEventId: "m4", summary: summary({ objecoes: [{ objecao: "Objeção antiga", resolvida: false }] }) } });
  await repo.create("activities", { id: "ac_5", saas: "leverads", type: "whatsapp", lead: "ld_1", at: daysAgo(1), text: "oi" });
  // whatsapp
  await repo.create("wa_threads", { id: "5511999990000", saas: "leverads", name: "Carlos Alberto Souza", leadId: "ld_1" });
  const msgs = [
    ["wm_1", "in", daysAgo(2), "Como funciona pra subir os anúncios nas outras contas? Meu nome é Carlos Alberto Souza, da loja Peças Boas Autopeças"],
    ["wm_2", "in", daysAgo(3), "Quanto custa? Me chama no 11 99999-0000 ou carlos@pecasboas.com.br"],
    ["wm_3", "in", daysAgo(4), "Dá pra usar na Shopee também?"],
    ["wm_4", "in", daysAgo(5), "dá pra usar na shopee também??"], // duplicata normalizada
    ["wm_5", "in", daysAgo(6), "ok obrigado"], // 10 chars
    ["wm_6", "in", daysAgo(120), "Vocês atendem loja de moda? (velha)"],
    ["wm_7", "out", daysAgo(1), "Claro! Como posso ajudar? (nossa, não do lead)"],
    ["wm_8", "in", daysAgo(7), "Tem integração com o Bling? Sou da empresa Peças Boas Autopeças e meu CNPJ é 12.345.678/0001-90"],
    ["wm_9", "in", daysAgo(8), "Tem integração com o Tiny?"],
    ["wm_10", "in", daysAgo(9), "Tem integração com o Olist?"],
    ["wm_11", "in", daysAgo(10), "Tem integração com a Nuvemshop?"], // 4ª do balde "tem integracao com" → fora
    ["wm_12", "in", daysAgo(11), "Isso é uma afirmação sem pergunta e sem palavra inicial"],
    ["wm_13", "in", daysAgo(12), "12345678901234567890123?"], // maioria dígitos
  ];
  for (const [id, direction, at, text] of msgs) {
    await repo.create("wa_messages", { id, saas: "leverads", thread: "5511999990000", leadId: "ld_1", direction, at, text, author: "Carlos" });
  }
  // posts
  await repo.create("blog_posts", { id: "bp_1", saas: "leverads", status: "publicado", title: "Post publicado", keyword: "kw pub", slug: "post-publicado" });
  await repo.create("blog_posts", { id: "bp_2", saas: "leverads", status: "rascunho", title: "Post rascunho", keyword: "kw ras", slug: "post-rascunho" });
  await repo.create("blog_posts", { id: "bp_3", saas: "leverads", status: "pauta", title: "Pauta aberta", keyword: "kw pauta" });
  await repo.create("blog_posts", { id: "bp_4", saas: "leverads", status: "arquivado", title: "ARQUIVADO NÃO APARECE", keyword: "kw arq" });
  await repo.create("blog_posts", { id: "bp_5", saas: "outro", status: "publicado", title: "OUTRO PRODUTO", keyword: "x" });
  return repo;
}

test("anonymize: telefone, e-mail, url, documento, @handle, auto-apresentação, nomes e empresas conhecidos", () => {
  const out = anonymize(
    "Meu nome é Carlos Alberto Souza, da loja Peças Boas. Liga 11 99999-0000 ou +55 (11) 98888-7777, carlos@x.com.br, www.site.com.br/p?a=1 @meu.perfil CNPJ 12.345.678/0001-90 CPF 123.456.789-09. Maria Fernanda Lima também.",
    { names: ["Maria Fernanda Lima", "Carlos Alberto Souza", "Jo"], companies: ["Peças Boas", "Aç"] },
  );
  assert.ok(out.includes("[telefone]"), out);
  assert.ok(out.includes("[email]"), out);
  assert.ok(out.includes("[link]"), out);
  assert.ok(out.includes("[documento]"), out);
  assert.ok(out.includes("[perfil]"), out);
  assert.ok(out.includes("[nome]"), out);
  assert.ok(!/Carlos|Maria|Souza|99999|@x\.com|site\.com|12\.345|123\.456|meu\.perfil/.test(out), out);
  assert.ok(!/Peças Boas/.test(out), out);
  assert.equal(anonymize(""), "");
  assert.equal(anonymize("sem nada de pessoal aqui?"), "sem nada de pessoal aqui?");
});

test("anonymize: auto-apresentação em minúscula e 'aqui é o'", () => {
  assert.ok(anonymize("aqui é o joão da silva, tudo bem?").startsWith("aqui é o [nome]"));
  assert.ok(anonymize("sou a Ana Paula e vendo peças").includes("sou a [nome]"));
});

test("buildAudienceDigest: janela de 180 dias e distribuições com %", async () => {
  const repo = await seed();
  const a = await buildAudienceDigest(repo, "leverads", NOW);
  assert.equal(a.count, 3); // a de 400 dias fica fora
  assert.equal(a.dists.niche.items[0].value, "autopecas");
  assert.equal(a.dists.niche.items[0].pct, "67%");
  assert.ok(a.text.includes("Nicho (3 respostas): autopecas 67%, moda 33%"));
  assert.ok(!a.text.includes("Fulano") && !a.text.includes("11999990000"));
});

test("buildAudienceDigest: fallback pelo form do produto quando o doc não tem saas", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", { id: "fo_diag", saas: "leverads" });
  await repo.create("form_submissions", { id: "fs_1", form: "fo_diag", createdAt: daysAgo(1), answers: { niche: "moda" } });
  const a = await buildAudienceDigest(repo, "leverads", NOW);
  assert.equal(a.count, 1);
});

test("buildPainDigest: agrupa por sourcePain com rótulo do painMap, vendas por isWonLead, ordena pelo que fecha; interno e formExit fora", async () => {
  const repo = await seed();
  const p = await buildPainDigest(repo, "leverads");
  assert.equal(p.count, 3);
  assert.equal(p.pains[0].code, "A");
  assert.equal(p.pains[0].leads, 2);
  assert.equal(p.pains[0].won, 1);
  assert.equal(p.pains[0].rate, 50);
  assert.equal(p.pains[0].label, "Subir os mesmos anúncios nas outras contas");
  assert.equal(p.pains[0].spin.P, "Quanto tempo vai embora copiando anúncio?");
  assert.equal(p.pains[1].code, "B");
  assert.ok(p.text.includes("[A] Subir os mesmos anúncios nas outras contas: 2 leads, 1 vendas (50%)"));
  assert.ok(p.text.includes("Pergunta de dor usada na call"));
});

test("buildCallDigest: só call de venda, dedup por meet, janela de 180 dias, objeções com tratamento e dores", async () => {
  const repo = await seed();
  const c = await buildCallDigest(repo, "leverads", NOW);
  assert.equal(c.count, 2); // m1 (dedup) + m2; integração e a velha ficam fora
  assert.equal(c.temperatura.morno, 1); // o re-resumo mais recente de m1 vence
  assert.equal(c.temperatura.frio, 1);
  assert.equal(c.objecoes[0].total, 2);
  assert.equal(c.objecoes[0].abertas, 1);
  assert.deepEqual(c.objecoes[0].tratadas, ["mostrou ROI"]);
  assert.ok(c.text.includes("tratada com: mostrou ROI"));
  assert.ok(!c.text.includes("OBJEÇÃO FANTASMA"));
  assert.ok(!c.text.includes("Objeção antiga"));
  assert.ok(c.text.includes("tempo de setup · 1x"));
});

test("buildQuestionDigest: só entrada, 90 dias, tamanho, pergunta, dedup, diversidade e anonimização", async () => {
  const repo = await seed();
  const q = await buildQuestionDigest(repo, "leverads", NOW);
  const all = q.questions.join("\n");
  assert.ok(all.includes("Como funciona pra subir os anúncios"));
  assert.ok(all.includes("[nome]") && all.includes("[telefone]") && all.includes("[email]") && all.includes("[documento]"));
  assert.ok(!/Carlos|Souza|99999|pecasboas|Peças Boas|12\.345/.test(all), all);
  assert.ok(!all.includes("ok obrigado")); // curta
  assert.ok(!all.includes("velha")); // fora da janela
  assert.ok(!all.includes("nossa, não do lead")); // direction out
  assert.ok(!all.includes("afirmação sem pergunta"));
  assert.ok(!all.includes("12345678901234567890123"));
  assert.equal(q.questions.filter((t) => /shopee/i.test(t)).length, 1); // duplicata normalizada
  assert.equal(q.questions.filter((t) => /^Tem integração/.test(t)).length, 3); // balde de 3
  assert.ok(q.text.startsWith("Perguntas e dúvidas"));
  // mais novo primeiro
  assert.ok(q.questions[0].startsWith("Como funciona"));
});

test("buildQuestionDigest: cap", async () => {
  const repo = makeMemRepo();
  for (let i = 0; i < 40; i++) {
    await repo.create("wa_messages", { id: `wm_${i}`, saas: "leverads", direction: "in", at: daysAgo(1), text: `Vocês fazem integração com o sistema ${i}, coisa ${i * 7}?` });
  }
  const q = await buildQuestionDigest(repo, "leverads", NOW, { cap: 5 });
  assert.equal(q.questions.length, 3); // balde "voces fazem integracao" limita a 3 antes do cap
  const q2 = await buildQuestionDigest(repo, "leverads", NOW, { cap: 2 });
  assert.equal(q2.questions.length, 2);
});

test("buildResultsDigest: só tokens presentes, com rótulo; null vira aviso", () => {
  const r = buildResultsDigest(() => ({ resRitmo: "R$ 10,4 mil", resClientes: "23", resDias: "" }));
  assert.equal(r.count, 2);
  assert.ok(r.text.includes("{{resRitmo}} = R$ 10,4 mil (mediana de R$ por mês"));
  assert.ok(!r.text.includes("resDias"));
  assert.ok(r.text.includes("Métricas ausentes não existem: não invente."));
  const empty = buildResultsDigest(() => null);
  assert.equal(empty.count, 0);
  assert.ok(empty.text.includes("Nenhum número real disponível agora."));
  const thrown = buildResultsDigest(() => { throw new Error("boom"); });
  assert.equal(thrown.count, 0);
});

test("existingPostsDigest: agrupa por status, exclui arquivado e outro produto", async () => {
  const repo = await seed();
  const e = await existingPostsDigest(repo, "leverads");
  assert.equal(e.count, 3);
  assert.equal(e.publicado[0].slug, "post-publicado");
  assert.equal(e.fila[0].title, "Post rascunho");
  assert.equal(e.pauta[0].title, "Pauta aberta");
  assert.ok(e.text.includes("Já publicado:\n• Post publicado (keyword: kw pub)"));
  assert.ok(!e.text.includes("ARQUIVADO") && !e.text.includes("OUTRO PRODUTO"));
  const empty = await existingPostsDigest(makeMemRepo(), "leverads");
  assert.equal(empty.text, "Blog vazio: nenhum post ainda.");
});

test("buildBlogDigest: seis seções, contagens, json, zero PII e sem travessão", async () => {
  const repo = await seed();
  const d = await buildBlogDigest({ repo, saas: "leverads", now: NOW, results: () => ({ resRitmo: "R$ 10,4 mil" }) });
  for (const h of ["## PERFIL DE QUEM PROCURA A GENTE", "## DORES QUE FECHAM VENDA", "## OBJEÇÕES E DORES NAS CALLS", "## PERGUNTAS REAIS NO WHATSAPP (anonimizadas)", "## RESULTADOS REAIS", "## JÁ EXISTE NO BLOG (não repetir)"]) {
    assert.ok(d.text.includes(h), h);
  }
  assert.deepEqual(d.counts, { submissions: 3, leads: 3, calls: 2, questions: 6, posts: 3 });
  assert.equal(d.builtAt, NOW.toISOString());
  assert.ok(!/Carlos|Souza|Maria Fernanda|Peças Boas|99999|pecasboas|12\.345|ld_1|wm_1|5511999990000/.test(d.text), d.text);
  assert.ok(!d.text.includes("—"));
  assert.equal(d.json.pains[0].code, "A");
  assert.equal(d.json.calls.count, 2);
  assert.equal(d.json.questions.length, 6);
  assert.equal(d.json.results.resRitmo.value, "R$ 10,4 mil");
  assert.equal(d.json.existing.publicado.length, 1);
  assert.equal(d.json.audience.count, 3);
});

test("buildBlogDigest: cap de ~14k chars corta a seção de WhatsApp primeiro", async () => {
  const repo = makeMemRepo();
  for (let i = 0; i < 400; i++) {
    await repo.create("wa_messages", { id: `wm_${i}`, saas: "leverads", direction: "in", at: daysAgo(1), text: `Dúvida ${i} bem comprida sobre o assunto ${i}: como funciona a sincronização de estoque entre as contas quando o pedido cai numa delas e a outra ainda mostra disponível, tem risco de vender sem estoque? ${"x".repeat(80)}` });
  }
  await repo.create("blog_posts", { id: "bp_1", saas: "leverads", status: "publicado", title: "T", keyword: "k", slug: "t" });
  const d = await buildBlogDigest({ repo, saas: "leverads", now: NOW, results: () => null });
  assert.ok(d.text.length <= 14_000, String(d.text.length));
  assert.ok(d.text.includes("## JÁ EXISTE NO BLOG (não repetir)")); // a última seção sobreviveu ao corte
  assert.ok(d.counts.questions < 120);
});

test("buildBlogDigest: repo vazio não quebra", async () => {
  const d = await buildBlogDigest({ repo: makeMemRepo(), saas: "leverads", now: NOW, results: () => null });
  assert.ok(d.text.includes("Sem diagnóstico respondido"));
  assert.ok(d.text.includes("Nenhuma call de venda resumida"));
  assert.ok(d.text.includes("Blog vazio"));
  assert.deepEqual(d.counts, { submissions: 0, leads: 0, calls: 0, questions: 0, posts: 0 });
});


test("anonymize: preço e parcela viram [valor]/[parcelas]", () => {
  const out = anonymize("Plano anual de R$ 3.288, em 12x de R$ 274, ou 6 parcelas de 319. Ganhou R$ 60 mil a mais.");
  assert.ok(!/R\$/.test(out), out);
  assert.ok(!/3\.288|274|319/.test(out), out);
  assert.ok(out.includes("[valor]") && out.includes("[parcelas]"), out);
});

test("buildCallDigest: objeções e tratamentos saem sem nome de lead, closer nem valor", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", painMap: {} });
  await repo.create("leads", { id: "l9", saas: "leverads", name: "Willian Pereira Souza", company: "Auto Peças Souza" });
  await repo.create("activities", {
    id: "a9", saas: "leverads", type: "system", lead: "l9", at: new Date().toISOString(),
    meta: { event: "call_summary", kind: "call", meetEventId: "m9", summary: {
      temperatura: "morno", dores: ["Willian Pereira Souza perde tempo cadastrando"],
      objecoes: [{ objecao: "Achou o plano de R$ 3.288 caro", resolvida: true, comoFoiTratada: "Jéssica ofereceu 6 parcelas de 319 pra Auto Peças Souza" }],
    } },
  });
  const d = await buildCallDigest(repo, "leverads");
  assert.ok(!/Willian|Souza|3\.288|319/.test(d.text), d.text);
  assert.ok(d.text.includes("[valor]"), d.text);
});
