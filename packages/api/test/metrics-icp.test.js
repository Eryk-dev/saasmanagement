// Os TRÊS espelhos da régua de contas × anúncios precisam andar juntos:
//   classificacao.js (IDX_*) · metrics-core.js (GRADE_*) · web/lib/ui.js (TIER_*)
// O comentário do repo só citava dois, e o terceiro ficou pra trás quando as
// faixas foram recortadas — resultado: lead dos formulários novos deixava de
// ser ICP, não ia pro pool de closer sênior e não contava no placar.
// Este teste existe pra isso não poder acontecer de novo em silêncio.

import test from "node:test";
import assert from "node:assert/strict";

const { leadGrade, isIcpLead, gradeBandKnown, ICP_GRADES } = await import("../src/metrics-core.js");
const { ACCOUNTS_OPTIONS, LISTINGS_OPTIONS, porteAds } = await import("../src/classificacao.js");
const { leadTier } = await import("../../web/src/lib/ui.js");

const FAIXAS_NOVAS = { accounts: ACCOUNTS_OPTIONS.map((o) => o.value), listings: LISTINGS_OPTIONS.map((o) => o.value) };
const FAIXAS_LEGADAS = { accounts: ["1", "2", "3-5", "6-10", "10+"], listings: ["0-100", "100-500", "500-2000", "2000-10000", "10000+"] };

test("os três espelhos dão a MESMA nota, faixa nova ou legada", () => {
  for (const conj of [FAIXAS_NOVAS, FAIXAS_LEGADAS]) {
    for (const accounts of conj.accounts) {
      for (const listings of conj.listings) {
        const lead = { accounts, listings };
        const metrics = leadGrade(lead);
        const classific = porteAds(lead);
        const web = leadTier(lead)?.grade;
        assert.equal(metrics, classific, `metrics-core × classificacao divergem em ${accounts} × ${listings}`);
        assert.equal(metrics, web, `metrics-core × web divergem em ${accounts} × ${listings}`);
      }
    }
  }
});

test("lead das faixas novas pode ser ICP — era o bug", () => {
  // Antes do fix, qualquer faixa nova caía em `?? 0` e nunca chegava a S/A/B.
  const grande = { accounts: "7-10", listings: "5000-10000" };
  assert.ok(ICP_GRADES.has(leadGrade(grande)), `operação grande virou grau ${leadGrade(grande)}`);
  assert.equal(isIcpLead(grande), true, "sem isto o lead não vai pro pool de closer sênior");
});

test("a régua reconhece as faixas novas na escrita de volta", () => {
  // gradeBandKnown é o guarda da tela zero da proposta: valor desconhecido não
  // atualiza a nota. Com as faixas novas fora, a proposta não conseguia
  // corrigir contas/anúncios do lead.
  for (const v of FAIXAS_NOVAS.accounts) assert.ok(gradeBandKnown("accounts", v), `accounts ${v} não reconhecida`);
  for (const v of FAIXAS_NOVAS.listings) assert.ok(gradeBandKnown("listings", v), `listings ${v} não reconhecida`);
  for (const v of FAIXAS_LEGADAS.accounts) assert.ok(gradeBandKnown("accounts", v), `accounts legada ${v} sumiu`);
});

test("faixa inventada continua sem nota, em vez de virar a pior", () => {
  assert.equal(gradeBandKnown("accounts", "quinhentas"), false);
  assert.equal(leadGrade({}), null, "lead sem resposta nenhuma fica fora da régua");
});
