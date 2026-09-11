// A fiação da classificação v2 sobe DESARMADA. O teste que importa é o
// primeiro: merge de código não pode mudar o que o lead vê nem ligar
// nutrição — isso depende de alinhamento com a SDR, não de deploy.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureClassificacaoV2, CLASSIFICACAO_V2_FLAG } = await import("../src/migrations.js");

const PERGUNTAS_ANTIGAS = [
  { key: "accounts", label: "Quantas contas?", options: [{ value: "3-5", label: "3 a 5 contas" }] },
  { key: "listings", label: "Quantos anúncios?", options: [{ value: "500-2000", label: "500 a 2 mil" }] },
];

async function repoComProduto() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "Leverads", leadQuestions: PERGUNTAS_ANTIGAS }, "leverads");
  return repo;
}

test("primeira subida: publica a flag desligada e NÃO toca em nada", async () => {
  const repo = await repoComProduto();
  const n = await ensureClassificacaoV2(repo);

  assert.equal(n, 0);
  const flag = await repo.get("app_config", CLASSIFICACAO_V2_FLAG);
  assert.equal(flag.enabled, false, "a flag tem que nascer desligada");

  // o formulário do lead continua exatamente como estava
  const p = await repo.get("products", "leverads");
  assert.deepEqual(p.leadQuestions, PERGUNTAS_ANTIGAS);
  assert.equal((await repo.list("sequences")).length, 0, "nenhuma sequência de nutrição criada");
});

test("rodar de novo com a flag desligada continua inerte (idempotente)", async () => {
  const repo = await repoComProduto();
  await ensureClassificacaoV2(repo);
  const n = await ensureClassificacaoV2(repo);
  assert.equal(n, 0);
  assert.deepEqual((await repo.get("products", "leverads")).leadQuestions, PERGUNTAS_ANTIGAS);
});

test("com a flag ligada: perguntas entram e sequências nascem inativas", async () => {
  const repo = await repoComProduto();
  await ensureClassificacaoV2(repo);
  await repo.update("app_config", CLASSIFICACAO_V2_FLAG, { enabled: true });

  const n = await ensureClassificacaoV2(repo);
  assert.ok(n > 0);

  const chaves = (await repo.get("products", "leverads")).leadQuestions.map((q) => q.key);
  for (const k of ["niche", "channel", "trigger", "tried", "orders", "ticket", "skus", "partsType", "repriceFreq"]) {
    assert.ok(chaves.includes(k), `faltou a pergunta ${k}`);
  }

  // Nutrição tem flag própria: ligar as perguntas não pode arrastar o robô.
  assert.equal((await repo.list("sequences")).length, 0, "nutrição não pode subir junto com as perguntas");

  await repo.update("app_config", CLASSIFICACAO_V2_FLAG, { nutricao: true });
  await ensureClassificacaoV2(repo);

  // Sequência criada mas NÃO ativa: o drip não dispara sozinho no primeiro boot.
  const seqs = await repo.list("sequences");
  assert.ok(seqs.length >= 2);
  for (const s of seqs) {
    assert.equal(s.active, false, `sequência ${s.id} nasceu ativa`);
    assert.ok(Array.isArray(s.trigger.reasons) && s.trigger.reasons.length);
  }
});

test("com a flag ligada, rodar de novo não duplica sequência", async () => {
  const repo = await repoComProduto();
  await ensureClassificacaoV2(repo);
  await repo.update("app_config", CLASSIFICACAO_V2_FLAG, { enabled: true, nutricao: true });
  await ensureClassificacaoV2(repo);
  const antes = (await repo.list("sequences")).length;
  await ensureClassificacaoV2(repo);
  assert.equal((await repo.list("sequences")).length, antes);
});
