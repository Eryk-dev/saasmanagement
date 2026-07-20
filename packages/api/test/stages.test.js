// Semântica de estágios (src/stages.js): kind por linha do funil com fallback
// por heurística de nome — é o que mantém funis antigos (sem `kind`) e SaaS sem
// funil funcionando igual ao comportamento pré-CRM.

import test from "node:test";
import assert from "node:assert/strict";
import {
  guessKind, normalizeFunnel, kindOf, isWon, isWonLead, isPostSaleStage, wonAtOf, isLoss,
  ladderOf, stageByKind, firstStage, cadenceOf,
} from "../src/stages.js";

test("guessKind reconhece os nomes históricos do funil LeverAds", () => {
  assert.equal(guessKind("Ganho"), "ganho");
  assert.equal(guessKind("Closed Won"), "ganho");
  assert.equal(guessKind("Perdido"), "perdido");
  assert.equal(guessKind("Sem resposta"), "perdido");
  assert.equal(guessKind("Desqualificado"), "desqualificado");
  assert.equal(guessKind("disqualified"), "desqualificado");
  assert.equal(guessKind("Integração"), "integracao");
  assert.equal(guessKind("Acompanhamento"), "posvenda");
  assert.equal(guessKind("Pós-venda"), "posvenda");
  assert.equal(guessKind("Follow-up"), "followup");
  assert.equal(guessKind("Negociação"), "proposta");
  assert.equal(guessKind("Proposta enviada"), "proposta");
  assert.equal(guessKind("Call closer"), "call");
  assert.equal(guessKind("Call agendada"), "call");
  assert.equal(guessKind("Qualificação"), "qualificacao");
  assert.equal(guessKind("Em contato"), "contato");
  assert.equal(guessKind("Novo lead"), "novo");
  assert.equal(guessKind("Mentoria", 5, 8), "outro");
  assert.equal(guessKind("Etapa custom", 0, 4), "novo"); // 1º estágio sem nome reconhecível
});

test("normalizeFunnel adiciona kind e saneia cadence sem rejeitar nada", () => {
  const out = normalizeFunnel([
    { stage: "Qualificação", conv: 0.5 },
    { stage: "Ganho", kind: "ganho", cadence: { maxAttempts: "3", retryDays: 0, firstTouchHours: -2, lixo: 9 } },
    { stage: "X", kind: "inexistente", cadence: "não-objeto" },
  ]);
  assert.equal(out[0].kind, "qualificacao");
  assert.equal(out[0].cadence, undefined);
  assert.equal(out[1].kind, "ganho");
  assert.deepEqual(out[1].cadence, { maxAttempts: 3 }); // retryDays 0 e firstTouchHours -2 caem
  assert.equal(out[2].kind, "outro");
  assert.equal(out[2].cadence, undefined);
  assert.deepEqual(normalizeFunnel(null), []);
});

test("kindOf/isWon/isLoss: linha do funil vence, fallback por nome cobre legado", () => {
  const product = { funnel: [
    { stage: "Entrada", kind: "novo" },
    { stage: "Fechou!", kind: "ganho" },
    { stage: "Sumiu", kind: "perdido" },
  ] };
  assert.equal(kindOf(product, "Fechou!"), "ganho");
  assert.ok(isWon(product, "Fechou!"));
  assert.ok(isLoss(product, "Sumiu"));
  assert.ok(!isWon(product, "Entrada"));
  // Fallback: produto sem funil (ou stage fora do funil) usa os nomes históricos.
  assert.ok(isWon(null, "Ganho"));
  assert.ok(isWon({}, "Closed Won"));
  assert.ok(isLoss({}, "Perdido"));
  assert.equal(kindOf({}, "disqualified"), "desqualificado");
  assert.equal(kindOf({}, "Etapa qualquer"), null);
  // Linha sem kind cai na heurística por nome.
  assert.equal(kindOf({ funnel: [{ stage: "Call closer" }] }, "Call closer"), "call");
});

test("ladderOf corta no 1º ganho; sem ganho, régua = funil inteiro", () => {
  const product = { funnel: [
    { stage: "A", kind: "novo" }, { stage: "B", kind: "call" },
    { stage: "Ganho", kind: "ganho" }, { stage: "Perdido", kind: "perdido" },
  ] };
  assert.deepEqual(ladderOf(product), ["A", "B", "Ganho"]);
  assert.deepEqual(ladderOf({ funnel: [{ stage: "A", kind: "novo" }, { stage: "B", kind: "outro" }] }), ["A", "B"]);
});

test("stageByKind/firstStage/cadenceOf", () => {
  const product = { funnel: [
    { stage: "Novo lead", kind: "novo", cadence: { firstTouchHours: 2 } },
    { stage: "Desqualificado", kind: "desqualificado" },
  ] };
  assert.equal(stageByKind(product, "desqualificado").stage, "Desqualificado");
  assert.equal(stageByKind(product, "ganho"), null);
  assert.equal(firstStage(product), "Novo lead");
  assert.equal(firstStage({}), "");
  assert.deepEqual(cadenceOf(product, "Novo lead"), { firstTouchHours: 2 });
  assert.deepEqual(cadenceOf(product, "Desqualificado"), {});
});

// ── A venda como fato do lead (Ganho antes da Integração) ────────────────────

test("isWonLead: customerId sustenta a venda depois que o card sai do Ganho", () => {
  // Funil na ordem NOVA: fechar e depois entregar.
  const product = { funnel: [
    { stage: "Follow-up", kind: "followup" },
    { stage: "Ganho", kind: "ganho" },
    { stage: "Integração", kind: "integracao" },
  ] };
  const noGanho = { stage: "Ganho" };
  const naEntrega = { stage: "Integração", customerId: "cus_1" };
  const aberto = { stage: "Follow-up" };

  assert.equal(isWonLead(product, noGanho), true);
  // O ponto da mudança: medir por POSIÇÃO diria que este não vendeu.
  assert.equal(isWon(product, naEntrega.stage), false);
  assert.equal(isWonLead(product, naEntrega), true);
  assert.equal(isWonLead(product, aberto), false);
  assert.equal(isWonLead(product, null), false);
});

// Regra REVISADA em 20/07 (o Leo decidiu depois de ver 4 cards parados lá): na
// ordem nova, Integração fica DEPOIS do Ganho, então arrastar direto pra lá é
// fechar a venda. Antes esta asserção era o contrário — ver isPostSaleStage.
test("isWonLead: quem foi direto pra Integração conta como venda na ordem nova", () => {
  const product = { funnel: [{ stage: "Ganho", kind: "ganho" }, { stage: "Integração", kind: "integracao" }] };
  assert.equal(isWonLead(product, { stage: "Integração" }), true);
});

test("wonAtOf: wonAt vence o stageSince, que anda junto com o card", () => {
  assert.equal(wonAtOf({ wonAt: "2026-07-01T00:00:00Z", stageSince: "2026-08-20T00:00:00Z" }), "2026-07-01T00:00:00Z");
  assert.equal(wonAtOf({ stageSince: "2026-07-01T00:00:00Z" }), "2026-07-01T00:00:00Z"); // lead antigo, ainda no Ganho
  assert.equal(wonAtOf(null), "");
});

test("ladderOf: com o ganho no meio, a entrega sai da régua de venda", () => {
  const product = { funnel: [
    { stage: "Novo lead", kind: "novo" }, { stage: "Follow-up", kind: "followup" },
    { stage: "Ganho", kind: "ganho" }, { stage: "Integração", kind: "integracao" },
    { stage: "Acompanhamento", kind: "posvenda" },
  ] };
  assert.deepEqual(ladderOf(product), ["Novo lead", "Follow-up", "Ganho"]);
});

test("isPostSaleStage: só vale quando o ganho vem ANTES da entrega no funil", () => {
  const ordemNova = { funnel: [
    { stage: "Follow-up", kind: "followup" }, { stage: "Ganho", kind: "ganho" },
    { stage: "Integração", kind: "integracao" }, { stage: "Acompanhamento", kind: "posvenda" },
  ] };
  assert.equal(isPostSaleStage(ordemNova, "Integração"), true);
  assert.equal(isPostSaleStage(ordemNova, "Acompanhamento"), true);
  assert.equal(isPostSaleStage(ordemNova, "Follow-up"), false);
  assert.equal(isPostSaleStage(ordemNova, "Ganho"), false);

  // Ordem ANTIGA: a entrega vem antes do fechamento, então estar nela não diz
  // nada — contar ali inflaria a receita com quem ainda não fechou.
  const ordemAntiga = { funnel: [
    { stage: "Integração", kind: "integracao" }, { stage: "Ganho", kind: "ganho" },
  ] };
  assert.equal(isPostSaleStage(ordemAntiga, "Integração"), false);
  // Produto sem etapa de ganho nenhuma (uniquekids) não ganha venda de graça.
  assert.equal(isPostSaleStage({ funnel: [{ stage: "Integração", kind: "integracao" }] }, "Integração"), false);
});

test("isWonLead: na ordem nova, card na entrega conta mesmo sem customerId", () => {
  const product = { funnel: [
    { stage: "Ganho", kind: "ganho" }, { stage: "Integração", kind: "integracao" },
  ] };
  assert.equal(isWonLead(product, { stage: "Integração" }), true);
  // Na ordem antiga o MESMO card não conta.
  const antigo = { funnel: [
    { stage: "Integração", kind: "integracao" }, { stage: "Ganho", kind: "ganho" },
  ] };
  assert.equal(isWonLead(antigo, { stage: "Integração" }), false);
});
