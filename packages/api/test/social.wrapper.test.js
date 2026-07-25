// O singleton `social` (wrapper preguiçoso de produção) precisa REPASSAR os
// argumentos — o bug #544 era o wrapper de igDemographics engolindo metric/
// extra, e "alcançados"/"engajados" voltavam com os dados de seguidores (os 3
// recortes idênticos na tela). Os testes de social.metrics usam makeSocial()
// direto e nunca pegariam isso; este arquivo importa o wrapper de verdade
// (env + fetch global stubados ANTES do primeiro uso).

import test from "node:test";
import assert from "node:assert/strict";

process.env.META_ACCESS_TOKEN = "tok-teste";
const calls = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  calls.push(Object.fromEntries(u.searchParams));
  return { status: 200, text: async () => JSON.stringify({ data: [] }) };
};

const { social } = await import("../src/social.js");

test("wrapper igDemographics repassa metric e extra (alcançados ≠ seguidores)", async () => {
  calls.length = 0;
  await social.igDemographics("ig1", "reached_audience_demographics", { period: "lifetime", timeframe: "last_30_days" });
  assert.ok(calls.length > 0);
  for (const p of calls) {
    assert.equal(p.metric, "reached_audience_demographics");
    assert.equal(p.timeframe, "last_30_days");
  }
});

test("wrapper igDemographics sem args mantém o default de seguidores", async () => {
  calls.length = 0;
  await social.igDemographics("ig1");
  assert.ok(calls.length > 0);
  for (const p of calls) {
    assert.equal(p.metric, "follower_demographics");
    assert.equal(p.period, "lifetime");
  }
});
