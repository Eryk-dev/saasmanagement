// Cases (prova social): o gate de publicação, a escolha por nicho, o que sai
// pro público e o JSON aberto que o site consome.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { validateCase, publishBlockers, canPublish, publicCase, pickCases } from "../src/proposals/cases.js";
import { registerCaseRoutes } from "../src/proposals/routes.cases.js";
import { ensureKnownCases, ensurePanelCases } from "../src/platform/migrations.js";

const completo = (over = {}) => ({
  id: "ca_1", saas: "leverads", customerId: "cu_1", name: "Lupa Auto Peças", niche: "autopecas",
  headline: "Espelhou o catálogo em 3 contas",
  metrics: [{ label: "vendidos pelos anúncios da Lever", value: "R$ 82 mil", period: "últimos 30 dias", source: "painel", proofUrl: "https://x/print.png" }],
  quote: "Em duas semanas o catálogo estava nas três contas.", quoteAuthor: "Ana",
  authorizedAt: "2026-09-01", authorizedBy: "eryk", authorizedVia: "whatsapp",
  public: true, order: 1, ...over,
});

// ── Gate ──────────────────────────────────────────────────────────────────
test("publishBlockers: sem autorização, sem número ou sem fonte não publica", () => {
  assert.deepEqual(publishBlockers(completo()), []);
  assert.deepEqual(publishBlockers(completo({ authorizedAt: "" })), ["a autorização do cliente (data)"]);
  assert.deepEqual(publishBlockers(completo({ metrics: [] })), ["pelo menos um número"]);
  assert.deepEqual(publishBlockers(completo({ metrics: [{ label: "vendas", value: "+105%" }] })),
    ["a fonte de cada número (painel, print ou o próprio cliente)"]);
  assert.deepEqual(publishBlockers(completo({ name: "", niche: "" })), ["o nome do cliente", "o nicho"]);
  assert.equal(canPublish(completo()), true);
});

test("validateCase: corta campo longo, descarta fonte inválida e força tipos", () => {
  const v = validateCase({ name: "x".repeat(200), public: "sim", order: "3", metrics: [{ label: "a", value: "1", source: "inventada" }, { label: "", value: "" }] });
  assert.equal(v.name.length, 80);
  assert.equal(v.public, false); // só `true` literal publica
  assert.equal(v.order, 3);
  assert.equal(v.metrics.length, 1); // métrica vazia sai
  assert.equal(v.metrics[0].source, "");
});

// ── Público ───────────────────────────────────────────────────────────────
test("publicCase: não vaza cliente do cockpit, print da prova nem contato", () => {
  const pub = publicCase(completo());
  assert.deepEqual(Object.keys(pub).sort(), ["headline", "logoUrl", "metrics", "name", "niche", "order", "quote", "quoteAuthor"]);
  assert.equal(pub.customerId, undefined);
  assert.equal(pub.metrics[0].proofUrl, undefined);
  assert.equal(pub.metrics[0].source, "painel");
});

// ── Escolha pro deck ──────────────────────────────────────────────────────
test("pickCases: nicho do lead primeiro, depois a ordem do time", () => {
  const lista = [
    completo({ id: "a", name: "Moda A", niche: "moda", order: 1 }),
    completo({ id: "b", name: "Auto B", niche: "autopecas", order: 5 }),
    completo({ id: "c", name: "Auto C", niche: "AutoPeças ", order: 2 }),
    completo({ id: "d", name: "Casa D", niche: "casa", order: 0 }),
  ];
  const r = pickCases(lista, { niche: "autopecas", limit: 4 });
  assert.deepEqual(r.map((c) => c.name), ["Auto C", "Auto B", "Casa D", "Moda A"]);
  assert.equal(pickCases(lista, { niche: "autopecas", limit: 2 }).length, 2);
});

test("pickCases: rascunho e case sem autorização ficam de fora", () => {
  const lista = [
    completo({ id: "a", name: "Público" }),
    completo({ id: "b", name: "Rascunho", public: false }),
    completo({ id: "c", name: "Sem autorização", authorizedAt: "" }),
    completo({ id: "d", name: "Sem fonte", metrics: [{ label: "x", value: "1" }] }),
  ];
  assert.deepEqual(pickCases(lista).map((c) => c.name), ["Público"]);
  assert.deepEqual(pickCases([]), []);
});

test("pickCases: seleção estrita de autopeças não completa a fileira com outro nicho", () => {
  const rows = [
    completo({ name: "Auto A", niche: "Autopeças" }),
    completo({ name: "Suplementos", niche: "suplementos" }),
    completo({ name: "Auto pendente", authorizedAt: "" }),
  ];
  assert.deepEqual(pickCases(rows, { niche: "autopecas", strictNiche: true }).map(c => c.name), ["Auto A"]);
});

// ── Rotas ─────────────────────────────────────────────────────────────────
async function buildApp(repo, over = {}) {
  const app = Fastify();
  registerCaseRoutes(app, repo, { influenced: async () => new Map([["org-1", 82000]]), ...over });
  await app.ready();
  return app;
}

test("rascunho a partir do cliente já vem com o número do painel", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld_1", niche: "autopecas" });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Lupa", contact: "Ana", leadId: "ld_1", leveradsOrgId: "org-1" });
  const app = await buildApp(repo);
  const r = await app.inject({ method: "POST", url: "/api/cases/from-customer", payload: { customer: "cu_1" } });
  assert.equal(r.statusCode, 201);
  const doc = r.json();
  assert.equal(doc.name, "Lupa");
  assert.equal(doc.niche, "autopecas");
  assert.equal(doc.quoteAuthor, "Ana");
  assert.equal(doc.public, false);
  assert.equal(doc.metrics[0].source, "painel");
  assert.match(doc.metrics[0].value, /R\$ 82\.000/);
  assert.ok(doc.blockers.includes("a autorização do cliente (data)"));
  await app.close();
});

test("publicar sem autorização dá 422 dizendo o que falta", async () => {
  const repo = makeMemRepo();
  await repo.create("cases", completo({ id: "ca_1", public: false, authorizedAt: "" }));
  const app = await buildApp(repo);
  const r = await app.inject({ method: "POST", url: "/api/cases/ca_1/publish", payload: { public: true } });
  assert.equal(r.statusCode, 422);
  assert.deepEqual(r.json().blockers, ["a autorização do cliente (data)"]);
  assert.equal((await repo.get("cases", "ca_1")).public, false);
  await app.close();
});

test("com autorização publica, e despublicar volta pra rascunho", async () => {
  const repo = makeMemRepo();
  await repo.create("cases", completo({ id: "ca_1", public: false }));
  const app = await buildApp(repo);
  assert.equal((await app.inject({ method: "POST", url: "/api/cases/ca_1/publish", payload: { public: true } })).statusCode, 200);
  assert.equal((await repo.get("cases", "ca_1")).public, true);
  await app.inject({ method: "POST", url: "/api/cases/ca_1/publish", payload: { public: false } });
  assert.equal((await repo.get("cases", "ca_1")).public, false);
  await app.close();
});

test("JSON público sai com cache, sem campo interno, e nunca estoura", async () => {
  const repo = makeMemRepo();
  await repo.create("cases", completo({ id: "ca_1" }));
  await repo.create("cases", completo({ id: "ca_2", name: "Rascunho", public: false }));
  const app = await buildApp(repo);
  const r = await app.inject({ url: "/public/cases.json" });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["cache-control"], /max-age=300/);
  assert.match(r.headers["cache-control"], /stale-while-revalidate=3600/);
  assert.equal(r.json().count, 1);
  assert.equal(r.json().cases[0].name, "Lupa Auto Peças");
  assert.equal(r.json().cases[0].customerId, undefined);
  await app.close();

  // Banco fora do ar: devolve lista vazia, não 5xx (o EasyPanel engole 5xx e o
  // site perderia a seção inteira).
  const quebrado = { ...makeMemRepo(), list: async () => { throw new Error("db down"); } };
  const app2 = await buildApp(quebrado);
  const r2 = await app2.inject({ url: "/public/cases.json" });
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(r2.json().cases, []);
  await app2.close();
});

// ── Migração ──────────────────────────────────────────────────────────────
test("migração: cases conhecidos entram em rascunho e não duplicam", async () => {
  const repo = makeMemRepo();
  assert.equal(await ensureKnownCases(repo), 3);
  const todos = await repo.list("cases");
  assert.deepEqual(todos.map((c) => c.name).sort(), ["Dyno Nutri", "Unicoox", "Unique"]);
  assert.ok(todos.every((c) => c.public === false), "nenhum nasce público");
  assert.ok(todos.every((c) => publishBlockers(c).length > 0), "todos exigem conferência antes de publicar");
  assert.equal(await ensureKnownCases(repo), 0);
});

// ── Deck: slide 06 com case real, colchetes quando não há ─────────────────
import { proposalSlidesPageHtml } from "../src/proposals/proposal-slides-page.js";

const deck = (cases) => proposalSlidesPageHtml({
  id: "pr_1", name: "Proposta", layout: "slides", theme: {}, slides: [], calc: {},
  data: { lead: { name: "Ana", company: "Lupa" }, answers: { niche: "autopecas" }, cases },
  state: {}, accepted: false,
}, { editable: false });

test("deck: sem case publicado o slide 06 mantém os colchetes", () => {
  const html = deck([]);
  assert.match(html, /\[CLIENTE\] · \[NICHO\]/);
  assert.match(html, /data-cases-fallback/);
  assert.match(html, /"cases":\[\]/);
});

test("deck: com cases, eles vão no snapshot e o fallback some na pintura", () => {
  const html = deck([
    { name: "Auto C", niche: "autopecas", metrics: [{ label: "vendidos", value: "R$ 82 mil", period: "30 dias", source: "painel" }], quote: "", quoteAuthor: "", headline: "", order: 1 },
  ]);
  assert.match(html, /"name":"Auto C"/);
  assert.match(html, /R\$ 82 mil/);
  assert.match(html, /data-cases\b/);
  // O fallback continua no HTML (é ele que aparece quando não há case), mas a
  // pintura o esconde: a regra está no script, não no markup.
  assert.match(html, /fb\.style\.display = \(D\.cases \|\| \[\]\)\.length \? "none" : "contents"/);
});

// ── Os quatro cases do painel (página 10 do deck C) ───────────────────────
test("migração do painel: quatro cases em rascunho, com as quatro medidas do slide", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { saas: "leverads", name: "USACAR Autopeças" });
  assert.equal(await ensurePanelCases(repo), 4);
  const todos = await repo.list("cases");
  // Os cases da casa desde 28/09: Dyno Nutri e 123tudo saíram de circulação.
  assert.deepEqual(todos.map((c) => c.name), ["Motvia", "Lupa Autopeças", "USACAR Autopeças", "Vikn Comércio de Auto Peças"]);
  assert.ok(todos.every((c) => c.metrics.length === 4), "cada case leva as quatro medidas do slide");
  assert.ok(todos.every((c) => c.metrics.every((m) => m.source === "painel")), "todo número vem do painel");
  assert.ok(todos.every((c) => c.public === false), "nada nasce público: nome e logo de cliente pedem autorização");
  assert.ok(todos.every((c) => publishBlockers(c).includes("a autorização do cliente (data)")));
  // O vínculo com o cadastro entra quando o cliente existe, e some quando não.
  assert.ok(todos.find((c) => c.name === "USACAR Autopeças").customerId);
  assert.equal(todos.find((c) => c.name === "Motvia").customerId, "");
});

test("migração do painel: atualiza o case que já existia em vez de duplicar, e roda uma vez só", async () => {
  const repo = makeMemRepo();
  // USACAR e Vikn foram cadastrados à mão em 15/09, antes de entrarem no seed:
  // a migração tem que ATUALIZAR esses registros, não criar um segundo card.
  const antes = await repo.create("cases", completo({
    id: "ca_usacar", name: "USACAR Autopeças", public: true, authorizedAt: "2026-09-15",
    metrics: [{ label: "gerado por anúncios da Lever", value: "R$ 94,9 mil", period: "todo o período", source: "painel" }],
  }));
  assert.equal(await ensurePanelCases(repo), 4);
  const todos = await repo.list("cases");
  assert.equal(todos.filter((c) => c.name === "USACAR Autopeças").length, 1, "um card por cliente");
  const depois = todos.find((c) => c.name === "USACAR Autopeças");
  assert.equal(depois.id, antes.id, "mesmo registro, número novo");
  assert.equal(depois.metrics[0].value, "R$ 127 mil");
  assert.equal(depois.metrics[0].source, "painel");
  assert.equal(depois.public, true, "publicação e autorização do time ficam de pé");
  assert.equal(depois.authorizedAt, "2026-09-15");
  assert.equal(todos.length, 4);
  assert.equal(await ensurePanelCases(repo), 0, "idempotente: não mexe no que o time editar depois");
});

test("cases acumulados: usa totais auditados, preserva autorização e retoma uma migração parcial", async () => {
  const repo = makeMemRepo();
  const antigo = await repo.create("cases", completo({
    name: "Motvia", seed: "painel-30d-2026-09", logoUrl: "https://x/logo.png",
  }));
  const outroProduto = await repo.create("cases", completo({ id: "ca_outro", saas: "outro", name: "Motvia" }));
  assert.equal(await ensurePanelCases(repo), 4);
  const motvia = await repo.get("cases", antigo.id);
  assert.equal(motvia.metrics[0].value, "R$ 442 mil");
  assert.equal(motvia.metrics[0].period, "todo o período");
  assert.equal(motvia.metrics[1].value, "3.008");
  assert.equal(motvia.metrics[2].value, "95,8 mil h");
  assert.equal(motvia.metrics[3].value, "R$ 1,3 mi");
  assert.equal(motvia.evidence.gmvTotal, 442453.32);
  assert.equal(motvia.evidence.listings, 574780);
  assert.equal(motvia.public, antigo.public);
  assert.equal(motvia.authorizedAt, antigo.authorizedAt);
  assert.equal(motvia.authorizedBy, antigo.authorizedBy);
  assert.equal(motvia.logoUrl, antigo.logoUrl);
  assert.equal(motvia.customerId, antigo.customerId);
  assert.equal(publicCase(motvia).evidence, undefined, "a prova interna não vai para a página pública");
  assert.deepEqual(await repo.get("cases", outroProduto.id), outroProduto);

  const todos = (await repo.list("cases")).filter((c) => c.saas === "leverads");
  assert.deepEqual(todos.map((c) => c.metrics[0].value), ["R$ 442 mil", "R$ 281 mil", "R$ 127 mil", "R$ 49,7 mil"]);
  assert.ok(todos.every((c) => !JSON.stringify(c.metrics).includes("do mês")));
  const lupa = todos.find((c) => c.name === "Lupa Autopeças");
  await repo.update("cases", lupa.id, { seed: "painel-30d-2026-09", metrics: [] });
  assert.equal(await ensurePanelCases(repo), 1, "um case já atualizado não bloqueia a atualização dos demais");
  await repo.update("cases", motvia.id, { headline: "Revisão posterior do time" });
  assert.equal(await ensurePanelCases(repo), 0);
  assert.equal((await repo.get("cases", motvia.id)).headline, "Revisão posterior do time");
});

// ── Slide 3 e slide de resultados ─────────────────────────────────────────
test("deck: o slide de quem somos mostra as fotos da operação, não os placeholders", () => {
  const html = deck([]);
  for (const foto of ["operacao-interna-2.jpg", "operacao-interna-1.jpg", "operacao-barracao-novo.jpg"]) {
    assert.ok(html.includes(`proposal-assets/leverads/${foto}`), `falta a foto ${foto}`);
  }
  assert.ok(!html.includes("img-slot"), "nenhum slot vazio sobrou");
  assert.ok(!html.includes("Foto do galpão"), "o rótulo de placeholder saiu");
});

test("deck: o card de case leva logo, as três medidas de apoio e a régua no slide", () => {
  const html = deck([]);
  assert.match(html, /metricas\.slice\(1, 4\)/);   // as três medidas de apoio
  assert.match(html, /if \(c\.logoUrl\)/);          // logo quando o cliente autoriza
  assert.match(html, /10 minutos por anúncio, ao custo de um funcionário de R\$ 3\.000/);
  assert.equal(html.split("[CLIENTE] · [NICHO]").length - 1, 4, "quatro cards de exemplo enquanto nada está publicado");
});

// ── Números que se refazem sozinhos (28/09) ───────────────────────────────
import { panelCaseFacts, panelMetricValue, caseWithLiveNumbers } from "../src/proposals/cases.js";
import { liveCases, liveDeckCases, _resetLiveCases } from "../src/proposals/cases-live.js";

const SNAP = { gmvTotal: 442140.98, ordersTotal: 3006, listings: 574780, gmv30d: 82000 };

test("régua do painel: as quatro medidas do slide saem da mesma conta", () => {
  const f = panelCaseFacts(SNAP);
  assert.equal(f.headline, "574.780 anúncios criados pela plataforma ao longo da parceria.");
  assert.deepEqual(f.metrics.map((m) => m.metric), ["gmvTotal", "ordersTotal", "hoursSaved", "costAvoided"]);
  assert.equal(f.metrics[0].value, "R$ 442 mil");
  assert.equal(f.metrics[0].period, "todo o período");
  assert.equal(f.metrics[1].value, "3.006");
  // 10 min por anúncio = 574.780 / 6 = 95.796 h; ao custo de R$ 3.000 / 220 h.
  assert.equal(f.metrics[2].value, "95,8 mil h");
  assert.equal(f.metrics[3].value, "R$ 1,3 mi");
  assert.ok(f.metrics.every((m) => m.source === "painel"));
  // Sem base, a medida sai vazia (e o valor salvo é que continua valendo).
  assert.equal(panelMetricValue("gmvTotal", { gmvTotal: 0 }), "");
  assert.equal(panelMetricValue("inventada", SNAP), "");
});

test("case ao vivo: painel manda no número, o texto salvo manda na frase", () => {
  const doc = {
    name: "Motvia", headline: "282.418 anúncios criados pela plataforma ao longo da parceria.", headlineAuto: true,
    metrics: [
      { metric: "gmvTotal", label: "gerado na conta dele", value: "R$ 287 mil", period: "todo o período", source: "painel" },
      { metric: "", label: "vendas", value: "+105%", period: "", source: "cliente" },
      { metric: "ordersTotal", label: "pedidos", value: "2.229", period: "", source: "print" },
    ],
  };
  const vivo = caseWithLiveNumbers(doc, SNAP);
  assert.equal(vivo.metrics[0].value, "R$ 442 mil");
  assert.equal(vivo.metrics[0].label, "gerado na conta dele", "o rótulo escrito à mão fica");
  assert.equal(vivo.metrics[1].value, "+105%", "número sem chave não é tocado");
  assert.equal(vivo.metrics[2].value, "2.229", "número de print não vem do painel, mesmo com chave");
  assert.match(vivo.headline, /^574\.780 anúncios/);
  // Sem retrato do painel (banco do produto fora), o case passa intacto.
  assert.deepEqual(caseWithLiveNumbers(doc, null), doc);
  // Manchete escrita à mão (que não é a frase da régua) não é reescrita.
  const aMao = { ...doc, headlineAuto: false, headline: "Espelhou as contas e a conta 1 não perdeu venda" };
  assert.equal(caseWithLiveNumbers(aMao, SNAP).headline, aMao.headline);
});

test("liveDeckCases: a lista é a de hoje, pela régua de nicho e ordem", async () => {
  _resetLiveCases();
  const repo = makeMemRepo();
  await repo.create("cases", completo({ id: "ca_1", name: "Motvia", niche: "autopecas", order: 1 }));
  await repo.create("cases", completo({ id: "ca_2", name: "Vikn", niche: "autopecas", order: 4 }));
  await repo.create("cases", completo({ id: "ca_3", name: "Dyno Nutri", niche: "suplementos", order: 3, public: false }));
  const snapshot = async () => new Map();

  const cards = await liveDeckCases(repo, { niche: "autopecas", limit: 4, snapshot });
  assert.deepEqual(cards.map((c) => c.name), ["Motvia", "Vikn"], "case despublicado sai da apresentação");
  assert.equal(cards[0].customerId, undefined, "sai pela versão pública");
  _resetLiveCases();

  // Sem case publicado nenhum, devolve null e quem chama fica com o snapshot.
  const vazio = makeMemRepo();
  assert.equal(await liveDeckCases(vazio, { snapshot }), null);
  _resetLiveCases();
});

test("liveCases: org do case vem da evidência ou da ficha do cliente, e rascunho fica fora", async () => {
  _resetLiveCases();
  const repo = makeMemRepo();
  await repo.create("customers", { id: "cu_1", name: "Lupa", leveradsOrgId: "d70453cc-274c-4494-a77f-0520045aa348" });
  await repo.create("cases", completo({
    id: "ca_1", name: "Motvia", customerId: "", evidence: { orgId: "102f9143-c7d0-414c-9393-85fdd5fa3da8" },
    metrics: [{ metric: "gmvTotal", label: "gerado", value: "R$ 287 mil", period: "todo o período", source: "painel" }],
  }));
  await repo.create("cases", completo({
    id: "ca_2", name: "Lupa", customerId: "cu_1",
    metrics: [{ metric: "influenced30", label: "vendidos", value: "R$ 1", period: "últimos 30 dias", source: "painel" }],
  }));
  await repo.create("cases", completo({ id: "ca_3", name: "Rascunho", public: false }));

  const pedidas = [];
  const snapshot = async (orgs) => {
    pedidas.push(...orgs);
    return new Map([
      ["102f9143-c7d0-414c-9393-85fdd5fa3da8", SNAP],
      ["d70453cc-274c-4494-a77f-0520045aa348", { gmvTotal: 280728, ordersTotal: 1336, listings: 282418, gmv30d: 54321 }],
    ]);
  };
  const docs = await liveCases(repo, { snapshot });
  assert.deepEqual(pedidas.sort(), ["102f9143-c7d0-414c-9393-85fdd5fa3da8", "d70453cc-274c-4494-a77f-0520045aa348"]);
  const porNome = new Map(docs.map((d) => [d.name, d]));
  assert.equal(porNome.get("Motvia").metrics[0].value, "R$ 442 mil");
  assert.equal(porNome.get("Lupa").metrics[0].value, "R$ 54,3 mil");
  assert.equal(porNome.get("Rascunho"), undefined, "rascunho não vira prova");
  _resetLiveCases();
});

test("liveCases: painel fora do ar não derruba nem apaga o que já foi calculado", async () => {
  _resetLiveCases();
  const repo = makeMemRepo();
  await repo.create("cases", completo({
    id: "ca_1", name: "Motvia", evidence: { orgId: "102f9143-c7d0-414c-9393-85fdd5fa3da8" },
    metrics: [{ metric: "gmvTotal", label: "gerado", value: "R$ 287 mil", period: "", source: "painel" }],
  }));
  const quente = await liveCases(repo, { snapshot: async () => new Map([["102f9143-c7d0-414c-9393-85fdd5fa3da8", SNAP]]) });
  assert.equal(quente[0].metrics[0].value, "R$ 442 mil");
  // Cache vencido + banco fora: devolve o último bom, nunca vazio.
  const depois = await liveCases(repo, { ttlMs: -1, snapshot: async () => { throw new Error("db down"); } });
  assert.equal(depois[0].metrics[0].value, "R$ 442 mil");
  _resetLiveCases();

  // Cache frio + banco fora: lista vazia, e quem chama segue com o congelado.
  const vazio = await liveCases(repo, { timeoutMs: 50, snapshot: async () => { throw new Error("db down"); } });
  assert.equal(vazio.length, 0);
  _resetLiveCases();
});

test("case ao vivo: card do painel sem chave é reconhecido pelo rótulo da régua", () => {
  // É o caso do USACAR e do Vikn, cadastrados fora da migração: rótulos da
  // régua, fonte painel e nenhuma chave gravada. Sem isso, seriam justamente
  // os dois cards públicos que continuariam congelados.
  const doc = {
    name: "USACAR Autopeças",
    headline: "23.400 anúncios criados pela plataforma ao longo da parceria.",
    metrics: [
      { label: "gerado por anúncios da Lever", value: "R$ 94,9 mil", period: "todo o período", source: "painel" },
      { label: "pedidos gerados no período", value: "262", period: "", source: "painel" },
      { label: "de cadastro manual poupadas", value: "3,9 mil h", period: "", source: "painel" },
      { label: "de custo fixo evitado", value: "R$ 53 mil", period: "", source: "painel" },
      { label: "tirado do zero", value: "3 contas", period: "", source: "cliente" },
    ],
  };
  const vivo = caseWithLiveNumbers(doc, SNAP);
  assert.deepEqual(vivo.metrics.map((m) => m.value), ["R$ 442 mil", "3.006", "95,8 mil h", "R$ 1,3 mi", "3 contas"]);
  assert.match(vivo.headline, /^574\.780 anúncios/, "a manchete da régua acompanha mesmo sem o marcador");
  // Rótulo que não é da régua continua sendo texto: o painel não adivinha.
  const outro = caseWithLiveNumbers({ metrics: [{ label: "faturamento da loja", value: "R$ 10", source: "painel" }] }, SNAP);
  assert.equal(outro.metrics[0].value, "R$ 10");
});
