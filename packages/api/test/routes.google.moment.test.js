// Horário da call → evento no Google. A base tem DOIS formatos de callAt:
// naive ("YYYY-MM-DDTHH:MM", hora de Brasília, 103 leads) e ISO com fuso (lead
// que entrou por integração). Grudar "-03:00" no segundo dava "…Z-03:00" =
// Invalid Date, e criar o Meet estourava com "Invalid time value".

import test from "node:test";
import assert from "node:assert/strict";

const { callMoment, wallClockBrt } = await import("../src/routes.google.js");

test("callMoment aceita naive (hora de Brasília) e ISO com fuso, no MESMO instante", () => {
  // 17:30 em Brasília = 20:30 UTC, escrito das duas formas.
  assert.equal(callMoment("2026-07-22T17:30").toISOString(), "2026-07-22T20:30:00.000Z");
  assert.equal(callMoment("2026-07-22T17:30:00").toISOString(), "2026-07-22T20:30:00.000Z");
  assert.equal(callMoment("2026-07-22T20:30:00.000Z").toISOString(), "2026-07-22T20:30:00.000Z");
  assert.equal(callMoment("2026-07-22T17:30:00-03:00").toISOString(), "2026-07-22T20:30:00.000Z");
});

test("callMoment devolve null pra vazio e pra lixo (em vez de estourar depois)", () => {
  for (const v of ["", null, undefined, "   ", "amanhã", "23/07/2026"]) {
    assert.equal(callMoment(v), null, `${JSON.stringify(v)} devia virar null`);
  }
});

test("wallClockBrt devolve a hora de PAREDE em São Paulo, não a do servidor", () => {
  // O evento precisa cair às 17:30 pro time, tenha o servidor o fuso que tiver.
  assert.equal(wallClockBrt(new Date("2026-07-22T20:30:00.000Z")), "2026-07-22T17:30:00");
  // Vira o dia: 01:00 UTC ainda é o dia anterior às 22:00 em Brasília.
  assert.equal(wallClockBrt(new Date("2026-07-23T01:00:00.000Z")), "2026-07-22T22:00:00");
});

test("os dois formatos produzem o MESMO evento (era onde o Meet quebrava)", () => {
  const a = callMoment("2026-07-22T17:30");
  const b = callMoment("2026-07-22T20:30:00.000Z");
  assert.equal(wallClockBrt(a), wallClockBrt(b));
  assert.equal(a.toISOString(), b.toISOString());
});
