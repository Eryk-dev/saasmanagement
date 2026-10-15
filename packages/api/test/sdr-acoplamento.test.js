// Acoplamentos por string entre arquivos do robô SDR. Quando um lado muda e o
// outro não, nada quebra em runtime: o roteiro simplesmente para de disparar
// (demoOffered vira falso e a M2 do OEM não sai) ou a dica do computador sai
// duas vezes. Estes testes fazem o acoplamento gritar no npm test.

import test from "node:test";
import assert from "node:assert/strict";
import { PITCH_RX } from "../src/sdr/sdr-brain.js";
import { firstTouchText, firstTouchOemText, firstTouchPriceText, DEVICE_TIP } from "../src/sdr/sdr-flow.js";

test("PITCH_RX reconhece o pitch de todo 1º toque do motor (senão o roteiro M2 e 'pitch já feito' param sem erro) #R-005 #R-070 #R-071", () => {
  const textos = {
    oem: firstTouchOemText({ nome: "Zé" }),
    price: firstTouchPriceText({ nome: "Rafa" }),
    multi: firstTouchText({ nome: "Ana", sdrName: "Manuela", resumo: "2 contas · moda", pain: { code: "A", mode: "clone" }, niche: "moda" }),
    multiAutopecas: firstTouchText({ nome: "Carlos", sdrName: "Manuela", resumo: "3 contas · autopeças", pain: { code: "E", mode: "clone" }, niche: "autopecas" }),
    semDor: firstTouchText({ nome: "Bia", sdrName: "Manuela", resumo: "1 conta", pain: null, niche: "casa" }),
  };
  const semPitch = Object.entries(textos).filter(([, t]) => !PITCH_RX.test(t)).map(([k, t]) => `${k}: ${t.slice(0, 90)}`);
  assert.deepEqual(semPitch, [], `1º toque que PITCH_RX não reconhece como pitch:\n${semPitch.join("\n")}`);
});

test("a dica do computador do lembrete é a mesma frase que o cérebro usa pra não repetir a dica #R-061", () => {
  assert.match(DEVICE_TIP, /computador por perto/i);
});
