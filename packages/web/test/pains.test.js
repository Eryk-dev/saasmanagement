import test from "node:test";
import assert from "node:assert/strict";
import { painCodeOf } from "../src/lib/pain-code.js";

// Espelho do painCode da API (packages/api/src/marketing/attribution.js). O
// teste existe pra flagrar divergência: quando os dois discordam, a API grava
// a dor no lead e o cockpit mostra o card como "sem dor".
test("painCodeOf: etiquetas de produto valem; rótulo operacional não", () => {
  for (const tag of ["A", "E", "OEM", "ADS", "PRICE"]) {
    assert.equal(painCodeOf(`1436 [${tag.toLowerCase()}]`), tag);
  }
  assert.equal(painCodeOf("[TESTE] 1436"), null, "[TESTE] não é dor");
  assert.equal(painCodeOf("[PRICE] 1450"), "PRICE");
  assert.equal(painCodeOf("1450"), null);
  assert.equal(painCodeOf(""), null);
  assert.equal(painCodeOf(null), null);
});
