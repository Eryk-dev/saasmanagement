// Os números do slide `impacto` da proposta saem do portfólio real do LeverAds.
// O que estes testes travam: (1) o formato de texto que vai pro deck; (2) a
// regra de que a PÁGINA NUNCA ESPERA a consulta (stale-while-revalidate); (3)
// que falha de banco degrada pro fallback escrito no slide, sem derrubar nada.

import test from "node:test";
import assert from "node:assert/strict";

import {
  resultTokens, refreshResults, leveradsResults, _resetResultsCache,
} from "../src/leverads-results.js";

const ROW = {
  clientes: 23, gerado: 685502.67, anuncios: 738756,
  ritmo: 10426.47, dias: 3, participacao: 13.8,
};

test("linha do banco vira o texto que o deck mostra", () => {
  assert.deepEqual(resultTokens(ROW), {
    resClientes: "23",
    resGerado: "R$ 686 mil",
    resRitmo: "R$ 10,4 mil",     // casa decimal só onde ela informa
    resDias: "3",
    resAnuncios: "739 mil",
    resHoras: "185 mil",         // 738.756 anúncios × 15 min
    resParticipacao: "13,8%",
  });
});

test("milhão vira milhão (e o plural acompanha)", () => {
  assert.equal(resultTokens({ ...ROW, gerado: 1_250_000 }).resGerado, "R$ 1,3 milhão");
  assert.equal(resultTokens({ ...ROW, gerado: 4_000_000 }).resGerado, "R$ 4 milhões");
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
  assert.equal(leveradsResults({ refresh: () => {} }).resGerado, "R$ 686 mil", "mantém o último bom");

  // E consulta que volta sem portfólio também não zera o deck.
  await refreshResults({ query: async () => [{ clientes: 0 }] });
  assert.equal(leveradsResults({ refresh: () => {} }).resGerado, "R$ 686 mil");
});

test("a consulta é a MESMA função que alimenta a tela Resultados do produto", async () => {
  _resetResultsCache();
  let sql = "";
  await refreshResults({ query: async (q, params) => { sql = q; assert.equal(params[1], 7); return [ROW]; } });
  assert.match(sql, /public\.dashboard_portfolio/);
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
  assert.match(res.body, /"resGerado":"R\$ 686 mil"/);
  assert.match(res.body, /calc\.resRitmo\|\|R\$ 10,4 mil/, "token com fallback preservado no slide");
  assert.match(res.body, /'resClientes', 'resGerado', 'resRitmo'/, "compute() repassa os tokens do servidor");
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
