// Cache TTL com stale-while-revalidate (ttl-cache.js): o que as rotas de
// Instagram/WhatsApp dependem pra não bater na Graph a cada abertura de tela.
// Relógio injetado (`now`) pra andar o tempo sem esperar.

import test from "node:test";
import assert from "node:assert/strict";

const { makeTtlCache } = await import("../src/ttl-cache.js");

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.tick = (ms) => { t += ms; };
  return now;
}

test("fresco: 2ª chamada não roda o loader e sai como hit", async () => {
  const now = clock();
  const c = makeTtlCache({ ttl: 1000, now });
  let n = 0;
  const loader = async () => ({ n: ++n });
  assert.deepEqual(await c.getWithMeta("k", loader), { value: { n: 1 }, status: "miss" });
  now.tick(500);
  assert.deepEqual(await c.getWithMeta("k", loader), { value: { n: 1 }, status: "hit" });
  assert.equal(n, 1);
  assert.equal(await c.get("k", loader), (await c.getWithMeta("k", loader)).value);
});

test("velho dentro do staleTtl: devolve o velho na hora e renova atrás (uma vez)", async () => {
  const now = clock();
  const c = makeTtlCache({ ttl: 1000, staleTtl: 10_000, now });
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const loader = async () => { n++; if (n > 1) await gate; return { n }; };
  await c.get("k", loader);
  now.tick(2000);
  const a = await c.getWithMeta("k", loader);
  assert.deepEqual(a, { value: { n: 1 }, status: "stale" });
  // Segunda chamada enquanto a renovação corre: ainda o velho, sem loader novo.
  const b = await c.getWithMeta("k", loader);
  assert.equal(b.status, "stale");
  assert.equal(n, 2);
  release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await c.getWithMeta("k", loader), { value: { n: 2 }, status: "hit" });
});

test("vencido além do staleTtl: espera o loader (miss)", async () => {
  const now = clock();
  const c = makeTtlCache({ ttl: 1000, staleTtl: 2000, now });
  let n = 0;
  const loader = async () => ({ n: ++n });
  await c.get("k", loader);
  now.tick(5000);
  assert.deepEqual(await c.getWithMeta("k", loader), { value: { n: 2 }, status: "miss" });
});

test("concorrentes na mesma chave dividem uma promise só", async () => {
  const c = makeTtlCache({ ttl: 1000 });
  let n = 0;
  const loader = () => new Promise((r) => setTimeout(() => r({ n: ++n }), 10));
  const [a, b, d] = await Promise.all([c.get("k", loader), c.get("k", loader), c.get("k", loader)]);
  assert.equal(n, 1);
  assert.deepEqual([a, b, d], [{ n: 1 }, { n: 1 }, { n: 1 }]);
});

test("loader falhou com valor guardado: mantém o velho; sem valor: rejeita e a chave some", async () => {
  const now = clock();
  const c = makeTtlCache({ ttl: 1000, staleTtl: 10_000, now });
  let fail = false;
  let n = 0;
  const loader = async () => { if (fail) throw new Error("Graph caiu"); return { n: ++n }; };
  await c.get("k", loader);
  fail = true;
  now.tick(2000);
  assert.equal((await c.getWithMeta("k", loader)).status, "stale");
  await new Promise((r) => setImmediate(r));
  // Continua servindo o velho (e volta a tentar na próxima, sem envenenar).
  assert.deepEqual((await c.getWithMeta("k", loader)).value, { n: 1 });
  // Vencido de vez e falhando: ainda devolve o velho (não estoura a tela).
  now.tick(20_000);
  assert.deepEqual((await c.getWithMeta("k", loader)).value, { n: 1 });
  // Chave sem valor nenhum: o erro sobe e nada fica guardado.
  await assert.rejects(c.get("outra", loader), /Graph caiu/);
  assert.equal(c.has("outra"), false);
  fail = false;
  assert.deepEqual(await c.get("outra", loader), { n: 2 });
});

test("force ignora o TTL e espera o valor novo; invalidate/clear zeram", async () => {
  const now = clock();
  const c = makeTtlCache({ ttl: 60_000, now });
  let n = 0;
  const loader = async () => ({ n: ++n });
  await c.get("k", loader);
  assert.deepEqual(await c.getWithMeta("k", loader, { force: true }), { value: { n: 2 }, status: "miss" });
  assert.equal((await c.getWithMeta("k", loader)).status, "hit");
  c.invalidate("k");
  assert.equal(c.has("k"), false);
  assert.equal((await c.getWithMeta("k", loader)).status, "miss");
  c.clear();
  assert.equal(c.has("k"), false);
});

test("ttl é obrigatório", () => {
  assert.throws(() => makeTtlCache({}), /ttl/);
});
