// Empilhamento com PREÇO por item no slide de investimento (featLi com f.price):
// rótulo em cima, valor grande embaixo, sem o check. Aditivo — item sem price
// segue a lista de benefícios normal, então decks existentes não mudam.
// O slide renderiza NO CLIENTE, então o teste confere que o motor (featLi/CSS) e
// os dados vão embutidos no HTML servido (não o DOM final).

import test from "node:test";
import assert from "node:assert/strict";

const { proposalPageHtml } = await import("../src/proposal-page.js");

const render = (slide) => proposalPageHtml({
  id: "t", theme: { accent: "#23D8D3" }, showAll: false,
  calc: {}, state: {}, data: { lead: {}, answers: {} }, slides: [slide],
});

test("item com f.price → empilhado (stack-row): label + valor grande, sem check", () => {
  const html = render({
    key: "v", type: "pricing", revealPrice: true, eyebrow: "Investimento", title: "O pacote",
    benefitGroups: [{ title: "No pacote", items: [
      { label: "LeverAds · Escala", price: "7.188" },
      "Item comum sem preço",
    ] }],
    currency: false, price: "115.988", per: "à vista",
  });
  assert.match(html, /stack-row/, "classe do empilhado no featLi");
  assert.match(html, /\.stack-price \{/, "CSS do valor grande");
  assert.match(html, /f\.price != null/, "branch novo do featLi");
  assert.match(html, /"price":"7\.188"/, "dado do item com preço");
  assert.match(html, /Item comum sem preço/, "item string segue normal");
});

test("sem f.price o empilhado NÃO ativa (deck existente intacto)", () => {
  const html = render({
    key: "v", type: "pricing", eyebrow: "Preço", title: "Plano",
    features: ["Anúncios equalizados"], price: "{{calc.preco}}",
  });
  assert.match(html, /Anúncios equalizados/);
  // features são STRINGS: não geram item-objeto {label, price}, então o
  // empilhado (que depende de f.price num objeto) nunca aciona pra este deck.
  assert.doesNotMatch(html, /"label":/, "sem item-objeto = sem empilhado");
});

test("stageFeatures: encadeia features no layout de 2 colunas + blocos de mesma altura", () => {
  const html = render({
    key: "v", type: "pricing", revealPrice: true, stageFeatures: true,
    eyebrow: "Investimento", title: "O pacote", featuresTitle: "No pacote",
    features: ["LeverAds — 7.188", "LeverWMS — 58.800"], currency: false, price: "115.988",
  });
  assert.match(html, /price-wrap-stretch/, "classe de altura igual");
  assert.match(html, /staged && s\.stageFeatures/, "features viram stage-item");
  assert.match(html, /groups \|\| \(staged && s\.stageFeatures\)/, "fila inclui stageFeatures");
});

test("sem stageFeatures o layout de 2 colunas segue com tudo visível (sem regressão)", () => {
  const html = render({
    key: "v", type: "pricing", revealPrice: true, featuresTitle: "Inclui",
    features: ["Anúncios equalizados"], price: "{{calc.preco}}",
  });
  assert.match(html, /Anúncios equalizados/);
  // a classe/CSS stretch existe sempre no stylesheet; o que importa é o DADO:
  // sem o flag no slide, o className stretch nunca é aplicado no cliente.
  assert.doesNotMatch(html, /"stageFeatures":true/, "deck não opta pelo encadeamento");
});

test("price2: item com desconto embute o preço off + regra de risco na 2ª oferta", () => {
  const html = render({
    key: "v", type: "pricing", revealPrice: true, stageFeatures: true, featuresTitle: "No pacote",
    features: [{ label: "LeverAds", price: "7.188", price2: "5.750,40" }],
    currency: false, price: "115.988", offer2: { planTag: "20% OFF", price: "92.790,40" },
  });
  assert.match(html, /stack-price-off/, "span do preço com desconto");
  assert.match(html, /\.offer2-on \.stack-row \.stack-price \{/, "risca o cheio na 2ª oferta");
  assert.match(html, /f\.price2 != null/, "branch price2 no featLi");
  assert.match(html, /"price2":"5\.750,40"/, "dado do preço com desconto");
});

test("item sem price2 não gera o preço off (compat)", () => {
  const html = render({
    key: "v", type: "pricing", revealPrice: true, featuresTitle: "x",
    features: [{ label: "LeverWMS", price: "58.800" }], price: "115.988",
  });
  assert.match(html, /"price":"58\.800"/);
  assert.doesNotMatch(html, /"price2":/, "sem price2 no dado");
});

test("payments: opções de pagamento com ícone abaixo do valor; per vazio não vira /mês", () => {
  const html = render({
    key: "v", type: "pricing", revealPrice: true, featuresTitle: "x",
    features: [{ label: "A", price: "7" }], currency: false, price: "120.788", per: "",
    payments: [{ icon: "card", text: "12× de 10.065,67 sem juros" }, { icon: "pix", text: "10% no Pix: 108.709,20" }],
  });
  assert.match(html, /price-pay/, "bloco de pagamento");
  assert.match(html, /\.pay-row \{/, "CSS pay-row");
  assert.match(html, /o\.payments/, "branch payments no priceCardHtml");
  assert.match(html, /o\.per != null/, "per vazio explícito não cai em /mês");
});
