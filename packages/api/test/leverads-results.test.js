// Os números do slide `impacto` da proposta saem do portfólio real do LeverAds.
// O que estes testes travam: (1) o formato de texto que vai pro deck; (2) a
// regra de que a PÁGINA NUNCA ESPERA a consulta (stale-while-revalidate); (3)
// que falha de banco degrada pro fallback escrito no slide, sem derrubar nada.

import test from "node:test";
import assert from "node:assert/strict";

import {
  resultTokens, refreshResults, leveradsResults, presentationResults, leveradsPresentationResults, _resetResultsCache,
} from "../src/leverads-results.js";

const ROW = {
  clientes: 23, contas: 25,
  mes: 798213.70, mes_clientes: 597752.68, mes_nosso: 200461.02,
  gerado: 995461.02, gerado_clientes: 689296.97, gerado_nosso: 306164.05,
  anuncios: 738756, ritmo: 10426.47, dias: 3, participacao: 13.8,
};

const SUMMARY_ROW = { ...ROW, gmv_periodo: 18_634_412.87, gerado_periodo: 2_059_468.45, inicio_periodo: "2026-06-26" };

test("resumo do deck C calcula a participação na mesma janela, sem usar o all-time", () => {
  const summary = presentationResults(SUMMARY_ROW, Date.parse("2026-09-15T11:00:00Z"));
  assert.equal(summary.gmv, 18_634_412.87);
  assert.equal(summary.generated, 2_059_468.45);
  assert.equal(summary.participation, SUMMARY_ROW.gerado_periodo / SUMMARY_ROW.gmv_periodo * 100);
  assert.equal(summary.periodStart, "2026-06-26");
  assert.equal(summary.updatedAt, "2026-09-15T11:00:00.000Z");
  assert.equal(presentationResults({ ...SUMMARY_ROW, gerado_periodo: 0 }, 0).participation, 0);
  for (const patch of [{ gmv_periodo: 0 }, { gmv_periodo: null }, { gerado_periodo: null }, { gerado_periodo: -1 }, { gerado_periodo: Infinity }, { gerado_periodo: 20_000_000 }]) {
    assert.equal(presentationResults({ ...SUMMARY_ROW, ...patch }, 0), null);
  }
});

test("resumo mantém a última consulta boa e sua data durante falha, e atualiza no recálculo", async () => {
  _resetResultsCache();
  assert.equal(leveradsPresentationResults({ refresh: () => {} }), null);
  await refreshResults({ query: async () => [SUMMARY_ROW], now: () => 1_000 });
  const before = leveradsPresentationResults({ now: () => 1_001 });
  await refreshResults({ query: async () => { throw new Error("offline"); }, now: () => 2_000 });
  assert.deepEqual(leveradsPresentationResults({ now: () => 2_001 }), before);
  await refreshResults({ query: async () => [{ ...SUMMARY_ROW, gerado_periodo: 2_100_000 }], now: () => 3_000 });
  const after = leveradsPresentationResults({ now: () => 3_001 });
  assert.equal(after.generated, 2_100_000);
  assert.equal(after.updatedAt, "1970-01-01T00:00:03.000Z");
});

test("deck C já gerado recebe totais atuais ao abrir, preservando seu estado comercial", async () => {
  const Fastify = (await import("fastify")).default;
  const { makeMemRepo } = await import("./helpers/mem-repo.js");
  const { registerProposalRoutes } = await import("../src/routes.proposals.js");
  _resetResultsCache();
  await refreshResults({ query: async () => [SUMMARY_ROW] });
  const repo = makeMemRepo();
  const state = { frozen: true, customPriceCents: 123456 };
  await repo.create("proposals", { id: "pr_live_c", saas: "leverads", layout: "slides", state, editKey: "k_live", data: { lead: {} } });
  await repo.create("proposal_templates", { id: "pt_live_c", saas: "leverads", layout: "slides" });
  const app = Fastify();
  registerProposalRoutes(app, repo);
  for (const url of ["/p/pr_live_c?k=k_live", "/p/t/pt_live_c"]) {
    const response = await app.inject({ url });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /R\$ 18,6 mi/);
    assert.match(response.body, /R\$ 2,1 mi/);
    assert.match(response.body, /11,1% do faturamento/);
    assert.match(response.body, /base desde 26\/06\/2026/);
    assert.doesNotMatch(response.body, /12% do faturamento deles/);
  }
  assert.deepEqual((await repo.get("proposals", "pr_live_c")).state, state);
  _resetResultsCache();
  const { proposalSlidesPageHtml } = await import("../src/proposal-slides-page.js");
  const empty = proposalSlidesPageHtml({ state: {}, data: {} });
  assert.match(empty, /Resultados agregados temporariamente indisponíveis/);
  assert.doesNotMatch(empty, /<strong[^>]*>R\$ 8 mi/);
  await app.close();
});

test("linha do banco vira o texto que o deck mostra", () => {
  assert.deepEqual(resultTokens(ROW), {
    resClientes: "23",
    resContas: "25",
    resMes: "R$ 798 mil",
    resMesClientes: "R$ 598 mil",
    resMesNosso: "R$ 200 mil",
    resGeradoTudo: "R$ 995 mil",
    resGerado: "R$ 689 mil",
    resGeradoClientes: "R$ 689 mil",
    resGeradoNosso: "R$ 306 mil",
    resRitmo: "R$ 10,4 mil",     // casa decimal só onde ela informa
    resDias: "3",
    resAnuncios: "739 mil",
    resHoras: "185 mil",         // 738.756 anúncios × 15 min
    resParticipacao: "13,8%",
  });
});

// O total e a fatia dos clientes NUNCA se confundem: a nossa operação é prova
// ("a ferramenta nasceu aqui dentro"), não é resultado de cliente, então o deck
// precisa dos dois números separados pra poder dizer a verdade nos dois.
test("a nossa operação entra no total, mas separada da fatia dos clientes", () => {
  const t = resultTokens(ROW);
  assert.equal(t.resGeradoTudo, "R$ 995 mil");
  assert.equal(t.resGeradoClientes, "R$ 689 mil");
  // O nome antigo (`resGerado`) segue apontando pros CLIENTES: é ele que os
  // decks já na mão do cliente usam, e a frase de lá fala das contas deles.
  assert.equal(t.resGerado, "R$ 689 mil");
  assert.equal(t.resGeradoNosso, "R$ 306 mil");
  // Sem a nossa operação na base, o token da nossa fatia some (o deck cai no
  // fallback e a frase não mente).
  assert.equal(resultTokens({ ...ROW, gerado_nosso: 0 }).resGeradoNosso, undefined);
});

test("milhão vira milhão (e o plural acompanha)", () => {
  assert.equal(resultTokens({ ...ROW, gerado: 1_250_000 }).resGeradoTudo, "R$ 1,3 milhão");
  assert.equal(resultTokens({ ...ROW, gerado: 4_000_000 }).resGeradoTudo, "R$ 4 milhões");
});

test("métrica sem base honesta fica FORA (token ausente aciona o fallback do slide)", () => {
  const t = resultTokens({ clientes: 5, gerado: 0, anuncios: 0, ritmo: null, dias: null, participacao: null });
  assert.deepEqual(Object.keys(t), ["resClientes"]);
  // Portfólio vazio não vira "0 clientes" no deck: não devolve nada.
  assert.equal(resultTokens({ clientes: 0 }), null);
  assert.equal(resultTokens(null), null);
});

test("a página não espera a consulta: 1ª chamada volta vazia e agenda o cálculo", async () => {
  _resetResultsCache();
  let chamadas = 0;
  const query = async () => { chamadas++; return [ROW]; };

  const agora = leveradsResults({ refresh: () => refreshResults({ query }) });
  assert.equal(agora, null, "render não pode bloquear esperando o Postgres");
  await new Promise((r) => setImmediate(r));
  assert.equal(chamadas, 1);

  const depois = leveradsResults({ refresh: () => refreshResults({ query }) });
  assert.equal(depois.resRitmo, "R$ 10,4 mil");
});

test("cache segura a consulta pesada e só solta depois do TTL", async () => {
  _resetResultsCache();
  let chamadas = 0;
  const query = async () => { chamadas++; return [ROW]; };
  const refresh = () => refreshResults({ query, now: () => 1_000 });

  await refreshResults({ query, now: () => 1_000 });
  assert.equal(chamadas, 1);

  leveradsResults({ now: () => 1_000 + 3_600_000, ttlMs: 6 * 3_600_000, refresh });
  await new Promise((r) => setImmediate(r));
  assert.equal(chamadas, 1, "1h depois ainda é cache");

  leveradsResults({ now: () => 1_000 + 7 * 3_600_000, ttlMs: 6 * 3_600_000, refresh });
  await new Promise((r) => setImmediate(r));
  assert.equal(chamadas, 2, "passado o TTL, recalcula");
});

test("banco fora do ar não derruba a proposta nem apaga o número que já existe", async () => {
  _resetResultsCache();
  await refreshResults({ query: async () => [ROW], now: () => 1_000 });

  const quebrado = async () => { throw new Error("connection refused"); };
  assert.equal(await refreshResults({ query: quebrado }), null);
  assert.equal(leveradsResults({ refresh: () => {} }).resGeradoTudo, "R$ 995 mil", "mantém o último bom");

  // E consulta que volta sem portfólio também não zera o deck.
  await refreshResults({ query: async () => [{ clientes: 0 }] });
  assert.equal(leveradsResults({ refresh: () => {} }).resGeradoTudo, "R$ 995 mil");
});

test("a consulta é a MESMA função que alimenta a tela Resultados do produto", async () => {
  _resetResultsCache();
  let sql = "";
  await refreshResults({ query: async (q, params) => { sql = q; assert.equal(params[1], 7); return [ROW]; } });
  assert.match(sql, /public\.dashboard_portfolio/);
  assert.match(sql, /interval '30 days'/, "o ritmo do card é o dos últimos 30 dias");
  assert.match(sql, /org_revenue_generated/, "o acumulado vem da tabela all-time, não da janela de 180 dias");
  assert.match(sql, /percentile_cont/, "ritmo é MEDIANA (a média é puxada por outlier)");
});

// ── Fim a fim: da consulta ao HTML servido ──────────────────────────────────
// O deck monta o DOM NO NAVEGADOR, então o que dá pra provar aqui é que o
// número viaja no payload e que o motor embutido sabe repassá-lo.

test("GET /p/:id serve o número real no calc e o motor repassa no compute()", async () => {
  const Fastify = (await import("fastify")).default;
  const { makeMemRepo } = await import("./helpers/mem-repo.js");
  const { registerProposalRoutes } = await import("../src/routes.proposals.js");

  _resetResultsCache();
  await refreshResults({ query: async () => [ROW] });

  const repo = makeMemRepo();
  await repo.create("proposals", {
    id: "pr_res_1", saas: "leverads", theme: {}, calc: {}, state: {},
    data: { lead: {}, answers: {} }, editKey: "k1", views: 0,
    slides: [{
      key: "impacto", type: "compare", eyebrow: "O impacto",
      before: { label: "Custo de 1 funcionário", num: "R$ {{calc.custoFuncAnoK}}" },
      after: { label: "O que a Lever gera hoje", num: "{{calc.resRitmo||R$ 10,4 mil}}" },
    }],
  });

  const app = Fastify();
  registerProposalRoutes(app, repo);
  const res = await app.inject({ url: "/p/pr_res_1" });
  await app.close();

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"resRitmo":"R\$ 10,4 mil"/, "número vai no payload do calc");
  assert.match(res.body, /"resGeradoTudo":"R\$ 995 mil"/);
  assert.match(res.body, /"resGeradoClientes":"R\$ 689 mil"/, "a fatia dos clientes viaja separada do total");
  assert.match(res.body, /calc\.resRitmo\|\|R\$ 10,4 mil/, "token com fallback preservado no slide");
  assert.match(res.body, /'resGeradoTudo', 'resGeradoNosso'/, "compute() repassa os tokens do servidor");
});

test("sem número em cache a página sai igual (o slide cai no fallback)", async () => {
  const Fastify = (await import("fastify")).default;
  const { makeMemRepo } = await import("./helpers/mem-repo.js");
  const { registerProposalRoutes } = await import("../src/routes.proposals.js");

  _resetResultsCache();
  const repo = makeMemRepo();
  await repo.create("proposals", {
    id: "pr_res_2", saas: "leverads", theme: {}, calc: {}, state: {},
    data: { lead: {}, answers: {} }, editKey: "k2", views: 0,
    slides: [{ key: "impacto", type: "compare", after: { num: "{{calc.resRitmo||R$ 10,4 mil}}" } }],
  });

  const app = Fastify();
  registerProposalRoutes(app, repo);
  const res = await app.inject({ url: "/p/pr_res_2" });
  await app.close();

  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /"resRitmo"/, "sem cache, nada de resultado no calc");
  assert.match(res.body, /calc\.resRitmo\|\|R\$ 10,4 mil/, "o fallback escrito no deck continua lá");
});
