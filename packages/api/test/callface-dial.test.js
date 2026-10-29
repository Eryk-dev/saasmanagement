// shared/callface-dial.js: a URL do discador da Callface leva o número NACIONAL
// (DDD + número, sem o 55) e o id do lead como deal_id.

import test from "node:test";
import assert from "node:assert/strict";
import { callfaceDialDigits, callfaceDialUrl, CALLFACE_DIAL_URL, CALLFACE_WINDOW } from "../src/shared/callface-dial.js";

test("dígitos nacionais: tira máscara, DDI 55 e zero de tronco", () => {
  assert.equal(callfaceDialDigits("+55 (11) 98765-4321"), "11987654321");
  assert.equal(callfaceDialDigits("5511987654321"), "11987654321");
  assert.equal(callfaceDialDigits("55 11 3333-4444"), "1133334444");
  assert.equal(callfaceDialDigits("1133334444"), "1133334444");
  assert.equal(callfaceDialDigits("041987654321"), "41987654321");
  assert.equal(callfaceDialDigits("(41) 9 8765-4321"), "41987654321");
});

test("DDD 55 (Santa Maria) não perde o próprio DDD", () => {
  assert.equal(callfaceDialDigits("55 99999-9999"), "55999999999");
});

test("número que não dá pra discar vira vazio", () => {
  assert.equal(callfaceDialDigits("+1 415 555 0000"), "");
  assert.equal(callfaceDialDigits("11 9765-432"), ""); // curto demais
  assert.equal(callfaceDialDigits("11 88765-4321"), ""); // 11 dígitos sem o 9 do celular
  assert.equal(callfaceDialDigits("00 98765-4321"), ""); // DDD inválido
  assert.equal(callfaceDialDigits("abc"), "");
  assert.equal(callfaceDialDigits(""), "");
  assert.equal(callfaceDialDigits(null), "");
});

test("URL do discador com call_to e deal_id", () => {
  assert.equal(callfaceDialUrl({ phone: "+55 (11) 98765-4321", leadId: "le_abc" }), `${CALLFACE_DIAL_URL}?call_to=11987654321&deal_id=le_abc`);
  assert.equal(callfaceDialUrl({ phone: "1133334444" }), `${CALLFACE_DIAL_URL}?call_to=1133334444`);
  assert.equal(callfaceDialUrl({ phone: "+1 415 555 0000", leadId: "le_x" }), "");
  assert.equal(CALLFACE_WINDOW, "Callface");
});
