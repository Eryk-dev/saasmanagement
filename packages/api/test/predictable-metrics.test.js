// Réguas do Receita Previsível no metrics-core: classes de lead (Semente/Rede/
// Alvo), caixa em 3 baldes e o firstAt do contactAttribution (SLA de 1º toque).
// Invariante central: a soma das classes/baldes fecha com o total — nenhuma
// tela pode mostrar um recorte que não some no tile ao lado.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leadClassOf, LEAD_CLASSES, classCounts, cashBucketsIn, cashCollectedIn,
  contactAttribution, dayKey,
} from "../src/metrics-core.js";

const inWin = (iso) => !!iso && dayKey(iso) >= "2026-08-01" && dayKey(iso) <= "2026-08-31";

test("leadClassOf: indicação vira Semente, outbound vira Alvo, o resto é Rede", () => {
  assert.equal(leadClassOf({ source: "Indicação" }), "semente");
  assert.equal(leadClassOf({ utm: { source: "indicacao-cliente" } }), "semente");
  assert.equal(leadClassOf({ source: "Outbound · radar ML" }), "alvo");
  assert.equal(leadClassOf({ utm: { medium: "outbound" } }), "alvo");
  assert.equal(leadClassOf({ outbound: true }), "alvo");
  assert.equal(leadClassOf({ source: "Form · Diagnóstico LeverAds", utm: { source: "meta", medium: "paid" } }), "rede");
  assert.equal(leadClassOf({}), "rede");
  // Indicação vence mesmo se o lead também tiver marca de outbound (a régua
  // isReferralLead decide primeiro — semente é a classe mais valiosa).
  assert.equal(leadClassOf({ source: "Indicação", outbound: true }), "semente");
});

test("classCounts: soma das classes fecha com o total de leads e de ganhos", () => {
  const leads = [
    { id: "a", source: "Indicação", createdAt: "2026-08-02T12:00:00Z", amount: 5000 },
    { id: "b", source: "Form · Diagnóstico", utm: { medium: "paid" }, createdAt: "2026-08-03T12:00:00Z", amount: 7000 },
    { id: "c", source: "Outbound · radar", createdAt: "2026-08-04T12:00:00Z", amount: 12000 },
    { id: "d", utm: { medium: "paid" }, createdAt: "2026-07-10T12:00:00Z", amount: 9000 }, // fora da janela
  ];
  const winAt = new Map([["b", "2026-08-10T12:00:00Z"], ["c", "2026-08-12T12:00:00Z"]]);
  const by = classCounts(leads, inWin, winAt);
  const totalLeads = LEAD_CLASSES.reduce((a, c) => a + by[c].leads, 0);
  const totalWon = LEAD_CLASSES.reduce((a, c) => a + by[c].won, 0);
  const totalRevenue = LEAD_CLASSES.reduce((a, c) => a + by[c].revenue, 0);
  assert.equal(totalLeads, 3); // a, b, c (d entrou fora da janela)
  assert.equal(totalWon, winAt.size);
  assert.equal(totalRevenue, 19000);
  assert.deepEqual(by.semente, { leads: 1, won: 0, revenue: 0 });
  assert.deepEqual(by.rede, { leads: 1, won: 1, revenue: 7000 });
  assert.deepEqual(by.alvo, { leads: 1, won: 1, revenue: 12000 });
});

test("cashBucketsIn: novos + upsell + renovação = caixa da janela", () => {
  const customers = [
    { id: "c_novo", startedAt: "2026-08-05T12:00:00Z" },  // começou NA janela
    { id: "c_velho", startedAt: "2026-06-01T12:00:00Z" }, // base antiga
  ];
  const invoices = [
    { saas: "x", customer: "c_novo", status: "paid", paidAt: "2026-08-06T12:00:00Z", amount: 7000 },
    { saas: "x", customer: "c_velho", status: "paid", paidAt: "2026-08-10T12:00:00Z", amount: 599 },
    { saas: "x", customer: "c_velho", status: "paid", paidAt: "2026-08-11T12:00:00Z", amount: 1200, kind: "upsell" },
    { saas: "x", customer: "c_velho", status: "open", dueDate: "2026-08-20", amount: 400 },        // não paga: fora
    { saas: "x", customer: "c_velho", status: "paid", paidAt: "2026-07-10T12:00:00Z", amount: 900 }, // fora da janela
  ];
  const b = cashBucketsIn(invoices, customers, inWin);
  assert.deepEqual(b, { novos: 7000, upsell: 1200, renovacao: 599, total: 8799 });
  // O total dos baldes é o MESMO caixa da régua oficial do mês (fatura paga).
  assert.equal(b.total, cashCollectedIn(invoices, "2026-08"));
});

test("contactAttribution devolve firstAt (base do SLA de 1º toque)", () => {
  const leads = [{ id: "l1", createdAt: "2026-08-03T12:00:00Z" }];
  const acts = {
    l1: [
      { type: "whatsapp", at: "2026-08-03T12:04:00Z", author: "sdr" },
      { type: "call", at: "2026-08-03T13:00:00Z", author: "sdr" },
    ],
  };
  const { firstAt, leadIds } = contactAttribution({
    leads, actsOf: (id) => acts[id] || [], waMessages: [], saas: "x", inWin,
    humanIds: new Set(["sdr"]),
  });
  assert.ok(leadIds.has("l1"));
  assert.equal(firstAt.get("l1"), "2026-08-03T12:04:00Z"); // o PRIMEIRO toque humano
});
