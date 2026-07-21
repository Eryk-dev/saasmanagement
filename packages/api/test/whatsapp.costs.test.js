// Custo do período: a Meta trocou cobrança por conversa → por mensagem em
// 01/07/2025 e o conversation_analytics (COST) passou a devolver 0. Agora o
// custo real vem do pricing_analytics.

import test from "node:test";
import assert from "node:assert/strict";

const { makeWhatsapp } = await import("../src/whatsapp.js");

function fakeFetch(routes) {
  const calls = [];
  return Object.assign(async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [match, status, body] of routes) {
      if (u.includes(match)) return { status, text: async () => JSON.stringify(body) };
    }
    return { status: 404, text: async () => JSON.stringify({ error: { message: "rota fake não mapeada", code: 803 } }) };
  }, { calls });
}

test("conversationCosts consulta pricing_analytics (não o metric deprecado) e soma custo + volume", async () => {
  const f = fakeFetch([["/WABA1?", 200, {
    pricing_analytics: { data: [{ data_points: [
      { cost: 12.34, volume: 40 },
      { cost: 7.66, volume: 10 },
    ] }] },
  }]]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "PN1" });
  const out = await wa.conversationCosts("WABA1", { start: 1, end: 2 });
  assert.deepEqual(out, { cost: 20, messages: 50, model: "PMP" });
  // usa o campo NOVO, não o descontinuado
  assert.match(f.calls[0], /pricing_analytics/);
  assert.doesNotMatch(f.calls[0], /conversation_analytics/);
});

test("resposta vazia (conta sem cobrança no período) = R$ 0 de verdade", async () => {
  const f = fakeFetch([["/WABA1?", 200, { pricing_analytics: { data: [] } }]]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "PN1" });
  assert.deepEqual(await wa.conversationCosts("WABA1", { start: 1, end: 2 }), { cost: 0, messages: 0, model: "PMP" });
});

test("nomes alternativos de volume no data_point não zeram a contagem", async () => {
  const f = fakeFetch([["/WABA1?", 200, {
    pricing_analytics: { data: [{ data_points: [{ cost: 5, message_count: 3 }] }] },
  }]]);
  const wa = makeWhatsapp({ fetch: f, token: "t", phoneNumberId: "PN1" });
  const out = await wa.conversationCosts("WABA1", { start: 1, end: 2 });
  assert.equal(out.cost, 5);
  assert.equal(out.messages, 3);
});
