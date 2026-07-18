import test from "node:test";
import assert from "node:assert/strict";
import { makeSalesWhatsapp } from "../src/sales-whatsapp.js";

const waFake = (display, { fail = false } = {}) => {
  let calls = 0;
  return {
    calls: () => calls,
    configured: () => true,
    async numberInfo() { calls++; if (fail) throw new Error("Graph fora"); return { display }; },
  };
};

test("salesWhatsapp: resolve o número conectado em dígitos e cacheia", async () => {
  const wa = waFake("+55 41 93618-3835");
  let t = 0;
  const resolve = makeSalesWhatsapp(() => wa, { ttlMs: 1000, now: () => t });

  assert.equal(await resolve(), "5541936183835");
  assert.equal(await resolve(), "5541936183835");
  assert.equal(wa.calls(), 1, "dentro do TTL não bate na Graph de novo");

  t = 2000;
  await resolve();
  assert.equal(wa.calls(), 2, "TTL vencido revalida");
});

test("salesWhatsapp: rajada simultânea vira UMA chamada; falha devolve o último conhecido", async () => {
  const wa = waFake("+55 41 93618-3835");
  const resolve = makeSalesWhatsapp(() => wa, { ttlMs: 1000, now: () => 0 });
  const [a, b, c] = await Promise.all([resolve(), resolve(), resolve()]);
  assert.deepEqual([a, b, c], ["5541936183835", "5541936183835", "5541936183835"]);
  assert.equal(wa.calls(), 1);

  // Graph fora do ar depois do TTL: mantém o número, nunca derruba a página
  let t = 0;
  const flaky = { configured: () => true, async numberInfo() { if (t === 0) return { display: "+55 41 93618-3835" }; throw new Error("Graph fora"); } };
  const r2 = makeSalesWhatsapp(() => flaky, { ttlMs: 10, now: () => t });
  assert.equal(await r2(), "5541936183835");
  t = 100;
  assert.equal(await r2(), "5541936183835");
});

test("salesWhatsapp: sem WhatsApp configurado devolve vazio (o form usa o número dele)", async () => {
  const resolve = makeSalesWhatsapp(() => ({ configured: () => false }));
  assert.equal(await resolve(), "");
  assert.equal(await makeSalesWhatsapp(() => null)(), "");
});
