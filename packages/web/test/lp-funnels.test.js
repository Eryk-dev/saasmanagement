import test from "node:test";
import assert from "node:assert/strict";
import { buildFunnelRows, buildPalavraRows, pickLeader } from "../src/lib/lp-funnels.js";

const SUMMARY = {
  funnels: [
    { funnel: "lp", sessions: 40, ctaSessions: 10, checkoutSessions: 6 },
    { funnel: "form", sessions: 35, ctaSessions: 20, checkoutSessions: 9 },
    { funnel: "app", sessions: 50, ctaSessions: 48 },
  ],
  palavras: [{ palavra: "teste", sessions: 12, ctaSessions: 5, byFunnel: { lp: { sessions: 7, ctaSessions: 2 } } }],
  conversions: {
    by_funnel: [{ funnel: "lp", created: 4, approved: 2, activated: 1, revenue_cents: 5580 }, { funnel: "form", created: 3, approved: 1, revenue_cents: 2790 }],
    by_palavra: [{ palavra: "teste", created: 2, approved: 1, revenue_cents: 2790, by_funnel: { lp: { approved: 1 } } }, { palavra: "mapa", created: 1, approved: 0, revenue_cents: 0 }],
  },
};

test("buildFunnelRows: sempre os 3 funis, dinheiro do banco e conversão pagos/sessão", () => {
  const rows = buildFunnelRows(SUMMARY);
  assert.deepEqual(rows.map((r) => r.id), ["lp", "form", "app"]);
  assert.equal(rows[0].approved, 2);
  assert.equal(rows[0].conversion, 2 / 40);
  assert.equal(rows[2].created, 0);
  assert.equal(rows[2].conversion, null, "app converte na loja, não no checkout");
});

test("buildFunnelRows: sem by_funnel (migration ausente) o dinheiro vira null", () => {
  const rows = buildFunnelRows({ funnels: SUMMARY.funnels, conversions: { by_utm: [] } });
  assert.equal(rows[0].approved, null);
  assert.equal(rows[0].revenue, null);
  assert.equal(rows[0].conversion, null);
  assert.equal(buildFunnelRows({}).length, 3);
});

test("pickLeader: pagos/sessão com amostra mínima, app fora", () => {
  const rows = buildFunnelRows(SUMMARY);
  assert.deepEqual(pickLeader(rows), { id: "lp", metric: "pagos/sessão", rate: 2 / 40 });
  // sem pagos: cai pra CTA/sessão
  const semPagos = buildFunnelRows({ funnels: SUMMARY.funnels });
  assert.equal(pickLeader(semPagos).id, "form");
  assert.equal(pickLeader(semPagos).metric, "CTA/sessão");
  // amostra pequena: ninguém é líder
  assert.equal(pickLeader(buildFunnelRows({ funnels: [{ funnel: "lp", sessions: 29, ctaSessions: 29 }] })), null);
});

test("buildPalavraRows: une beacon e banco por palavra", () => {
  const rows = buildPalavraRows(SUMMARY);
  const teste = rows.find((r) => r.palavra === "teste");
  assert.equal(teste.sessions, 12);
  assert.equal(teste.approved, 1);
  assert.equal(teste.byFunnel.lp.approved, 1);
  const mapa = rows.find((r) => r.palavra === "mapa");
  assert.equal(mapa.sessions, 0);
  assert.equal(mapa.created, 1);
  const semBanco = buildPalavraRows({ palavras: SUMMARY.palavras });
  assert.equal(semBanco[0].approved, null);
});
