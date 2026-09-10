// Cadência de 7 dias e roteamento da nutrição por motivo de saída.

import test from "node:test";
import assert from "node:assert/strict";

const { CADENCIAS, TRILHAS, trilhaPara, SEM_NUTRICAO, ENCERRAMENTO_DIA } = await import("../src/cadencia-nutricao.js");
const { normalizeFunnel } = await import("../src/stages.js");

test("cadência é concentrada na frente: metade dos toques nos 2 primeiros dias", () => {
  const s = CADENCIAS.prioritario.steps;
  const cedo = s.filter((x) => x.day <= 1).length;
  assert.ok(cedo >= s.length / 2, `só ${cedo} de ${s.length} toques nos 2 primeiros dias`);
});

test("cadência alterna canal — não é só ligação nem só whats", () => {
  for (const [nome, c] of Object.entries(CADENCIAS)) {
    if (nome === "leve") continue; // leve é whats puro, de propósito
    const canais = new Set(c.steps.map((s) => s.canal));
    assert.ok(canais.size > 1, `perfil ${nome} usa um canal só`);
  }
});

test("perfil leve não gasta ligação — é o que preserva a hora do SDR", () => {
  assert.ok(!CADENCIAS.leve.steps.some((s) => s.canal === "ligacao"));
});

test("todo perfil termina com o toque de encerramento dentro dos 7 dias", () => {
  for (const [nome, c] of Object.entries(CADENCIAS)) {
    const ultimo = c.steps[c.steps.length - 1];
    assert.equal(ultimo.janela, "encerramento", `perfil ${nome} não encerra`);
    assert.ok(ultimo.day <= ENCERRAMENTO_DIA, `perfil ${nome} passa de 7 dias`);
  }
});

test("normalizeFunnel aceita steps e mantém retrocompatibilidade", () => {
  const [comSteps, legado, sujo] = normalizeFunnel([
    { stage: "Em contato", kind: "contato", cadence: CADENCIAS.prioritario },
    { stage: "Follow-up", kind: "followup", cadence: { maxAttempts: 8, retryDays: 3 } },
    { stage: "Nutrição", kind: "contato", cadence: { steps: [{ day: -1, canal: "pombo" }, { day: 2, canal: "sinal-de-fumaca" }] } },
  ]);
  assert.equal(comSteps.cadence.steps.length, 6);
  assert.equal(comSteps.cadence.maxAttempts, 6);
  // funil antigo passa intacto
  assert.deepEqual(legado.cadence, { maxAttempts: 8, retryDays: 3 });
  // dia negativo é descartado; canal inválido cai no default em vez de rejeitar
  assert.equal(sujo.cadence.steps.length, 1);
  assert.equal(sujo.cadence.steps[0].canal, "whats");
});

test("nutrição: quem é pequeno demais não recebe demo da plataforma", () => {
  assert.equal(trilhaPara("porte_abaixo_do_piso"), TRILHAS.educacional.id);
  assert.notEqual(trilhaPara("porte_abaixo_do_piso"), TRILHAS.oferta.id);
});

test("nutrição: tamanho certo e momento errado recebe o vídeo com CTA", () => {
  assert.equal(trilhaPara("sem_resposta_7d"), TRILHAS.oferta.id);
  assert.equal(trilhaPara("nao_e_agora"), TRILHAS.oferta.id);
});

test("nutrição: opt-out e número inválido não recebem nada", () => {
  for (const r of SEM_NUTRICAO) assert.equal(trilhaPara(r), null, `${r} deveria ficar de fora`);
  assert.equal(trilhaPara(""), null);
});

test("motivo desconhecido cai na trilha mais conservadora", () => {
  assert.equal(trilhaPara("motivo_que_ainda_nao_existe"), TRILHAS.educacional.id);
});

test("as duas trilhas são exclusivas por motivo — ninguém recebe as duas", () => {
  const a = new Set(TRILHAS.oferta.reasons);
  for (const r of TRILHAS.educacional.reasons) assert.ok(!a.has(r), `motivo ${r} está nas duas trilhas`);
});
