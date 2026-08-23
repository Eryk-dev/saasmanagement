import test from "node:test";
import assert from "node:assert/strict";
import { firstTouchText, isAutoPecas, leadPainFocus } from "../src/sdr-flow.js";

// Autopeças com dor de gestão (A-E) ouve clonagem + OEM juntos (Leo, 23/08);
// outros nichos seguem só na clonagem, e dor OEM não duplica o assunto.
test("firstTouchText: autopeças com dor A-E fala de clonagem E de OEM", () => {
  const t = firstTouchText({ nome: "Carlos", sdrName: "Manuela", resumo: "3 a 5 contas · autopeças", pain: { code: "E", mode: "clone" }, niche: "autopecas" });
  assert.match(t, /clonagem/);
  assert.match(t, /código OEM/);
});

test("firstTouchText: outro nicho com dor A-E não puxa OEM; dor OEM não duplica", () => {
  const semOem = firstTouchText({ nome: "Ana", resumo: "2 contas · moda", pain: { code: "A", mode: "clone" }, niche: "moda" });
  assert.ok(!/OEM/.test(semOem));
  const oem = firstTouchText({ nome: "Zé", resumo: "1 conta · autopeças", pain: { code: "OEM", mode: "oem" }, niche: "autopecas" });
  assert.equal((oem.match(/OEM/g) || []).length, 1, "dor OEM cita OEM uma vez só");
});

test("isAutoPecas aceita variações de escrita", () => {
  assert.ok(isAutoPecas("autopecas") && isAutoPecas("Auto Peças") && isAutoPecas("autopeças"));
  assert.ok(!isAutoPecas("moda") && !isAutoPecas(""));
});

test("leadPainFocus: dor OEM fora de autopeças cai pra clonagem; autopeças e nicho vazio mantêm OEM", () => {
  const product = { painMap: { OEM: "Anunciar pelo OEM", A: "Subir anúncios" } };
  assert.equal(leadPainFocus(product, { sourcePain: "OEM", niche: "eletronicos" }).mode, "clone");
  assert.equal(leadPainFocus(product, { sourcePain: "OEM", niche: "autopecas" }).mode, "oem");
  assert.equal(leadPainFocus(product, { sourcePain: "OEM" }).mode, "oem");
  assert.equal(leadPainFocus(product, { sourcePain: "A", niche: "autopecas" }).mode, "clone");
});
