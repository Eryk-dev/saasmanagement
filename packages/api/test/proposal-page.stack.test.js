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
