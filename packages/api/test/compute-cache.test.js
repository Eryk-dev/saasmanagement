// compute-cache.js — cache de RESULTADO dos cálculos caros (pace, placar):
// vale até a próxima escrita no repo ou até o TTL; chamadas iguais em voo
// compartilham a promise; erro não fica; repo sem writeRev passa direto.

import test from "node:test";
import assert from "node:assert/strict";
import { memoCompute, forgetCompute } from "../src/compute-cache.js";
import { makeMemRepo } from "./helpers/mem-repo.js";

test("hit enquanto ninguém escreve; escrita no repo invalida", async () => {
  const repo = makeMemRepo();
  let calls = 0;
  const fn = () => { calls++; return { n: calls }; };
  assert.deepEqual(await memoCompute(repo, "k", fn), { n: 1 });
  assert.deepEqual(await memoCompute(repo, "k", fn), { n: 1 }, "segunda chamada vem do cache");
  await repo.create("leads", { id: "l1" });
  assert.deepEqual(await memoCompute(repo, "k", fn), { n: 2 }, "escrita derruba o cache");
  await repo.update("leads", "l1", { name: "x" });
  assert.deepEqual(await memoCompute(repo, "k", fn), { n: 3 });
  await repo.remove("leads", "l1");
  assert.deepEqual(await memoCompute(repo, "k", fn), { n: 4 });
  assert.equal(calls, 4);
});

test("chaves diferentes não se misturam; fresh pula o cache", async () => {
  const repo = makeMemRepo();
  let calls = 0;
  const fn = () => ++calls;
  assert.equal(await memoCompute(repo, "a", fn), 1);
  assert.equal(await memoCompute(repo, "b", fn), 2);
  assert.equal(await memoCompute(repo, "a", fn), 1);
  assert.equal(await memoCompute(repo, "a", fn, { fresh: true }), 3);
  assert.equal(await memoCompute(repo, "a", fn), 3, "o fresh renova a entrada");
});

test("TTL vencido recalcula", async () => {
  const repo = makeMemRepo();
  let calls = 0;
  const fn = () => ++calls;
  assert.equal(await memoCompute(repo, "k", fn, { ttlMs: 1 }), 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await memoCompute(repo, "k", fn, { ttlMs: 1 }), 2);
});

test("chamadas concorrentes compartilham UM cálculo", async () => {
  const repo = makeMemRepo();
  let calls = 0;
  const fn = () => new Promise((r) => setTimeout(() => r(++calls), 10));
  const [a, b, c] = await Promise.all([memoCompute(repo, "k", fn), memoCompute(repo, "k", fn), memoCompute(repo, "k", fn)]);
  assert.deepEqual([a, b, c], [1, 1, 1]);
  assert.equal(calls, 1);
});

test("erro não fica cacheado", async () => {
  const repo = makeMemRepo();
  let calls = 0;
  const fn = () => { calls++; if (calls === 1) throw new Error("boom"); return calls; };
  await assert.rejects(memoCompute(repo, "k", fn), /boom/);
  assert.equal(await memoCompute(repo, "k", fn), 2);
});

test("repos diferentes não enxergam o cálculo um do outro; repo sem writeRev não cacheia", async () => {
  const r1 = makeMemRepo(); const r2 = makeMemRepo();
  let calls = 0;
  const fn = () => ++calls;
  assert.equal(await memoCompute(r1, "k", fn), 1);
  assert.equal(await memoCompute(r2, "k", fn), 2);
  forgetCompute(r1);
  assert.equal(await memoCompute(r1, "k", fn), 3, "forget zera o repo");
  const plain = { list: async () => [] };
  assert.equal(await memoCompute(plain, "k", fn), 4);
  assert.equal(await memoCompute(plain, "k", fn), 5, "sem writeRev = sem cache");
});

test("leitor por requisição (metrics-reader) compartilha o cache do repo de baixo", async () => {
  const repo = makeMemRepo();
  let calls = 0;
  const fn = () => ++calls;
  const reader = (await import("../src/metrics-reader.js")).metricsReader(repo, "leverads");
  assert.equal(await memoCompute(reader, "k", fn), 1);
  assert.equal(await memoCompute(repo, "k", fn), 1, "a rota do pace e o placar veem o mesmo cálculo");
  await repo.create("leads", { id: "l1" });
  assert.equal(await memoCompute(reader, "k", fn), 2, "escrita no repo de baixo invalida pelo leitor também");
});
