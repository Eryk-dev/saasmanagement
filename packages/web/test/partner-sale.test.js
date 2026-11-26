import test from "node:test";
import assert from "node:assert/strict";
import { isPartnerSaleLead, partnersOf, partnerLabel, partnerLine } from "../src/lib/funnel.js";

// Venda de parceiro (26/11/2026): espelho do isPartnerSaleLead da API e o
// texto que o card do Pipeline e a ficha do lead mostram.
const cfg = { partners: [{ id: "segunda_venda", label: "Segunda Venda" }, { id: "", label: "sem id" }] };

test("isPartnerSaleLead: ter parceiro é ser venda de parceiro", () => {
  assert.equal(isPartnerSaleLead({ partner: "segunda_venda" }), true);
  assert.equal(isPartnerSaleLead({ partner: " " }), false);
  assert.equal(isPartnerSaleLead({ partnerSeller: "Marcos" }), false);
  assert.equal(isPartnerSaleLead(null), false);
});

test("partnersOf / partnerLabel / partnerLine", () => {
  assert.deepEqual(partnersOf(cfg), [{ id: "segunda_venda", label: "Segunda Venda" }], "opção sem id fica de fora");
  assert.deepEqual(partnersOf({}), []);
  assert.equal(partnerLabel(cfg, "segunda_venda"), "Segunda Venda");
  assert.equal(partnerLabel(cfg, "antigo"), "antigo", "opção que saiu da lista mostra o id");
  assert.equal(partnerLine(cfg, { partner: "segunda_venda", partnerSeller: " Marcos " }), "Segunda Venda · Marcos");
  assert.equal(partnerLine(cfg, { partner: "segunda_venda" }), "Segunda Venda");
  assert.equal(partnerLine(cfg, { partnerSeller: "Marcos" }), "");
});
