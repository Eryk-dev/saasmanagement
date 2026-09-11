// Board de cadência do Pipeline: colunas por DIA em vez de por etapa.
// (Mora no runner da API porque é o único do repo; o módulo é web/src/lib.)

import test from "node:test";
import assert from "node:assert/strict";

const { cadenceDayCol, CADENCE_COLS } = await import("../../web/src/lib/funnel.js");

const AGORA = Date.parse("2026-09-10T12:00:00Z");
const haDias = (n) => new Date(AGORA - n * 86400000).toISOString();

test("os 7 dias da cadência viram 7 colunas, mais a de quem esticou", () => {
  assert.equal(CADENCE_COLS.length, 8);
  assert.equal(CADENCE_COLS[0], "Dia 1");
  assert.equal(CADENCE_COLS[6], "Dia 7");
  assert.equal(CADENCE_COLS[7], "7+ dias");
});

test("o lead cai na coluna do dia em que está da cadência", () => {
  assert.equal(cadenceDayCol({ stageSince: haDias(0) }, AGORA), "Dia 1");
  assert.equal(cadenceDayCol({ stageSince: haDias(1) }, AGORA), "Dia 2");
  assert.equal(cadenceDayCol({ stageSince: haDias(6) }, AGORA), "Dia 7");
});

test("quem passou dos 7 dias é o que o board existe pra mostrar", () => {
  // A coluna "7+" é o ponto do board: no agrupamento por etapa esse lead está
  // no mesmo monte que o de hoje, e ninguém vê que ele esticou.
  assert.equal(cadenceDayCol({ stageSince: haDias(7) }, AGORA), "7+ dias");
  assert.equal(cadenceDayCol({ stageSince: haDias(60) }, AGORA), "7+ dias");
});

test("cai pro createdAt quando o lead nunca mudou de etapa", () => {
  assert.equal(cadenceDayCol({ createdAt: haDias(3) }, AGORA), "Dia 4");
});

test("data ausente, inválida ou no futuro não quebra nem some do board", () => {
  for (const l of [{}, { stageSince: "" }, { stageSince: "não é data" }, { stageSince: haDias(-5) }]) {
    assert.ok(CADENCE_COLS.includes(cadenceDayCol(l, AGORA)), `caiu fora das colunas: ${JSON.stringify(l)}`);
  }
  assert.equal(cadenceDayCol({}, AGORA), "Dia 1");
});

test("todo lead cai em exatamente uma coluna", () => {
  const vistos = new Set();
  for (let d = 0; d <= 30; d++) vistos.add(cadenceDayCol({ stageSince: haDias(d) }, AGORA));
  for (const c of vistos) assert.ok(CADENCE_COLS.includes(c));
  assert.equal(vistos.size, 8, "os 31 dias têm que cobrir as 8 colunas, sem inventar nenhuma");
});
