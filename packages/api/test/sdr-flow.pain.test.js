import test from "node:test";
import assert from "node:assert/strict";
import { firstTouchText, firstTouchPriceText, isAutoPecas, leadPainFocus, priceMorningParts, reminderText } from "../src/sdr/sdr-flow.js";
import { SDR_TEMPLATES } from "../src/sdr/sdr-templates.leverads.js";

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

// Dor [PRICE] (Leo, 07/10): precificação vale em qualquer nicho, então não
// passa pela cerca de autopeças do OEM — e não entra no roteiro fixo do OEM,
// que é gateado em mode === "oem"); desde 08/10 ela TEM roteiro fixo próprio.
test("leadPainFocus: dor PRICE vira modo price em qualquer nicho", () => {
  const product = { painMap: { PRICE: "Preço desatualizado" } };
  for (const niche of ["autopecas", "moda", undefined]) {
    const f = leadPainFocus(product, { sourcePain: "PRICE", niche });
    assert.equal(f.mode, "price");
    assert.equal(f.label, "Preço desatualizado");
  }
});

// Roteiro Lever Price (copy do Leo, 08/10): abordagem fixa no molde do OEM,
// sem nome do SDR nem resumo; pitch completo (cadastro único, automático 24h a
// cada minuto, promoções nomeadas, promoção do vendedor como fallback).
test("firstTouchText: dor PRICE usa a abordagem fixa do roteiro, sem clonagem nem OEM", () => {
  const t = firstTouchText({ nome: "Rafa", sdrName: "Manuela", resumo: "autopeças · 5 mil anúncios", pain: { code: "PRICE", mode: "price" }, niche: "autopecas" });
  assert.equal(t, firstTouchPriceText({ nome: "Rafa" }));
  assert.match(t, /^Oiii Rafa, tudo bem\? Recebemos aqui seu interesse, com o Lever Price você cadastra uma vez só o custo, a margem e o imposto/);
  assert.match(t, /de forma automática/);
  assert.match(t, /24 horas por dia, a cada minuto/);
  assert.match(t, /relâmpago, campanhas como Black Friday e 10\.10, rebate/);
  assert.match(t, /cria a promoção do vendedor/);
  assert.match(t, /Isso ajudaria na sua operação\?$/);
  assert.ok(!/OEM|clonagem|Manuela|5 mil/.test(t), "sem segundo produto, sem SDR, sem resumo");
  assert.ok(!/concorr/.test(t), "o Price não é regra de concorrente");
  assert.ok(!/—/.test(t), "copy sem travessão");
  // Sem nome utilizável, a saudação fecha sem o nome.
  assert.match(firstTouchPriceText({ nome: "" }), /^Oiii, tudo bem\?/);
});

test("reminderText: lead de PRICE tem a manhã própria; 2h e 10min dividem o texto do OEM", () => {
  const manha = reminderText("manha", { nome: "Rafa", quando: "hoje às 11h", link: "", script: "price" });
  assert.equal(manha, priceMorningParts("Rafa", "hoje às 11h").join(" "));
  assert.match(manha, /^Bom dia Rafa, tudo bom\? Temos um horário reservado para hoje às 11h, tudo certo\? Na reunião vamos te mostrar na prática como o Lever Price cuida do preço e das promoções/);
  assert.match(manha, /Posso contar com sua presença\?/);
  assert.ok(!/OEM|anúncios completos/.test(manha));
  const link = "https://meet.google.com/abc";
  assert.equal(reminderText("2h", { nome: "Rafa", quando: "hoje às 11h", link, script: "price" }), reminderText("2h", { nome: "Rafa", quando: "hoje às 11h", link, oem: true }));
  assert.equal(reminderText("10min", { nome: "Rafa", quando: "hoje às 11h", link, script: "price" }), reminderText("10min", { nome: "Rafa", quando: "hoje às 11h", link, oem: true }));
  // Sem roteiro, o genérico de antes.
  assert.match(reminderText("manha", { nome: "Rafa", quando: "hoje às 11h", link: "" }), /^Bom dia/);
  assert.ok(!/Lever Price/.test(reminderText("manha", { nome: "Rafa", quando: "hoje às 11h", link: "" })));
});

test("templates: o roteiro Price tem a abordagem e a manhã próprias, com o corpo igual ao texto do motor", () => {
  const byName = Object.fromEntries(SDR_TEMPLATES.map((t) => [t.name, t]));
  const m1 = byName.sdr_primeiro_toque_price;
  assert.ok(m1 && m1.category === "MARKETING");
  assert.equal(m1.body.replace("{{1}}", "Rafa"), firstTouchPriceText({ nome: "Rafa" }));
  const manha = byName.sdr_lembrete_manha_price;
  assert.ok(manha && manha.category === "UTILITY");
  assert.equal(manha.body.replace("{{1}}", "Rafa").replace("{{2}}", "hoje às 11h"), priceMorningParts("Rafa", "hoje às 11h").join(" "));
  for (const t of [m1, manha]) {
    assert.ok(!/^\{\{/.test(t.body) && !/\}\}$/.test(t.body), `${t.name}: variável não pode abrir nem fechar o corpo (regra da Meta)`);
    assert.ok(!/—/.test(t.body), `${t.name}: sem travessão`);
    assert.ok(!/R\$|\d+ ?reais|Essencial|Escala|Enterprise/.test(t.body), `${t.name}: sem preço nem plano`);
  }
});
