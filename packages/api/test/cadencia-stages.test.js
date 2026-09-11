// Cadência de 7 dias como etapas REAIS: as colunas Dia 2..Dia 7, o motor que
// move o lead quando vira o dia, e a troca de quem promove pra "Qualificando".

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { diaDaCadencia, etapaAlvo, estaNaCadencia, DIAS, NOMES_DIAS, CADENCIA_FLAG } = await import("../src/cadencia-stages.js");
const { makeCadenciaRunner } = await import("../src/cadencia-runner.js");
const { ensureCadenciaStages } = await import("../src/migrations.js");

const AGORA = Date.parse("2026-09-10T12:00:00Z");
const haDias = (n) => new Date(AGORA - n * 86400000).toISOString();

const FUNIL_BASE = [
  { stage: "Novo lead", kind: "novo", conv: 1, cadence: { firstTouchHours: 2 } },
  { stage: "Qualificando", kind: "qualificacao", conv: 1, cadence: { maxAttempts: 2, retryDays: 1 } },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Nutrição", kind: "contato", conv: 1, cadence: { firstTouchHours: 168, retryDays: 7 } },
];

async function repoPronto({ ligado = true } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "Leverads", funnel: FUNIL_BASE.map((f) => ({ ...f })) }, "leverads");
  await repo.create("app_config", { id: CADENCIA_FLAG, enabled: false }, CADENCIA_FLAG);
  if (ligado) {
    await repo.update("app_config", CADENCIA_FLAG, { enabled: true });
    await ensureCadenciaStages(repo);
  }
  return repo;
}

test("dia da cadência conta da entrada, com o dia da chegada sendo o Dia 1", () => {
  assert.equal(diaDaCadencia({ createdAt: haDias(0) }, AGORA), 1);
  assert.equal(diaDaCadencia({ createdAt: haDias(3) }, AGORA), 4);
  assert.equal(diaDaCadencia({ createdAt: haDias(30) }, AGORA), 31);
  assert.equal(diaDaCadencia({}, AGORA), 1, "sem data não pode sumir do board");
});

test("a etapa alvo é a coluna do dia; depois do 7 vai pra Nutrição", () => {
  assert.equal(etapaAlvo({ createdAt: haDias(0) }, AGORA), "Novo lead");
  assert.equal(etapaAlvo({ createdAt: haDias(1) }, AGORA), "Dia 2");
  assert.equal(etapaAlvo({ createdAt: haDias(6) }, AGORA), "Dia 7");
  assert.equal(etapaAlvo({ createdAt: haDias(7) }, AGORA), "Nutrição");
  // Funil sem Nutrição: não inventa etapa, deixa onde está.
  assert.equal(etapaAlvo({ createdAt: haDias(9) }, AGORA, { temNutricao: false }), null);
});

test("migração insere as colunas ENTRE Novo lead e Qualificando", async () => {
  const repo = await repoPronto();
  const nomes = (await repo.get("products", "leverads")).funnel.map((f) => f.stage);
  assert.deepEqual(nomes.slice(0, 8), ["Novo lead", ...NOMES_DIAS, "Qualificando"]);
});

test("migração é idempotente e desarmada não mexe no funil", async () => {
  const repo = await repoPronto();
  assert.equal(await ensureCadenciaStages(repo), 0, "rodar de novo não duplica coluna");

  const desligado = await repoPronto({ ligado: false });
  assert.equal(await ensureCadenciaStages(desligado), 0);
  assert.equal((await desligado.get("products", "leverads")).funnel.length, FUNIL_BASE.length);
});

test("as colunas de dia carregam o canal do toque daquele dia", async () => {
  const repo = await repoPronto();
  const funil = (await repo.get("products", "leverads")).funnel;
  const dia3 = funil.find((f) => f.stage === "Dia 3");
  assert.equal(dia3.kind, "contato");
  assert.equal(dia3.cadence.steps[0].canal, "audio");
  // Dia sem toque agendado existe como coluna mesmo assim — ver a espera é
  // metade do valor do board.
  assert.ok(funil.find((f) => f.stage === "Dia 4"));
});

test("o motor leva o lead pra coluna do dia em que ele está", async () => {
  const repo = await repoPronto();
  const l = await repo.create("leads", { saas: "leverads", stage: "Novo lead", createdAt: haDias(2) });
  const r = await makeCadenciaRunner({ repo }).tick(AGORA);
  assert.equal(r.movidos, 1);
  assert.equal((await repo.get("leads", l.id)).stage, "Dia 3");
});

test("passada perdida não deixa lead preso: ele pula direto pra coluna certa", async () => {
  // Invariante, não evento — deploy ou container reiniciado no fim de semana
  // não pode acumular lead na coluna errada.
  const repo = await repoPronto();
  const l = await repo.create("leads", { saas: "leverads", stage: "Novo lead", createdAt: haDias(5) });
  await makeCadenciaRunner({ repo }).tick(AGORA);
  assert.equal((await repo.get("leads", l.id)).stage, "Dia 6");
});

test("depois do dia 7 o lead cai na Nutrição", async () => {
  const repo = await repoPronto();
  const l = await repo.create("leads", { saas: "leverads", stage: "Dia 7", createdAt: haDias(9) });
  await makeCadenciaRunner({ repo }).tick(AGORA);
  assert.equal((await repo.get("leads", l.id)).stage, "Nutrição");
});

test("o relógio NUNCA move quem já saiu da cadência", async () => {
  const repo = await repoPronto();
  const fora = [];
  for (const stage of ["Qualificando", "Call agendada", "Ganho", "Nutrição"]) {
    fora.push(await repo.create("leads", { saas: "leverads", stage, createdAt: haDias(20) }));
  }
  const r = await makeCadenciaRunner({ repo }).tick(AGORA);
  assert.equal(r.movidos, 0);
  for (const l of fora) {
    const depois = await repo.get("leads", l.id);
    assert.equal(depois.stage, l.stage, `${l.stage} não podia ter sido movido pelo relógio`);
  }
});

test("desarmado, o motor não move ninguém", async () => {
  const repo = await repoPronto({ ligado: false });
  await repo.create("leads", { saas: "leverads", stage: "Novo lead", createdAt: haDias(4) });
  const r = await makeCadenciaRunner({ repo }).tick(AGORA);
  assert.equal(r.desligado, true);
  assert.equal(r.movidos, 0);
});

test("estaNaCadencia cobre Novo lead e as colunas de dia, e só elas", () => {
  assert.ok(estaNaCadencia("Novo lead"));
  for (const d of DIAS) assert.ok(estaNaCadencia(d.stage));
  for (const fora of ["Qualificando", "Call agendada", "Ganho", "Nutrição", "", null]) {
    assert.equal(estaNaCadencia(fora), false, `${fora} não é etapa de cadência`);
  }
});

// ── Quem promove pra "Qualificando" ───────────────────────────────────────
test("com as colunas de dia, o toque do SDR NÃO promove mais o lead", async () => {
  const { onOutboundMessage } = await import("../src/lead-flow.js");
  const repo = await repoPronto();
  const lead = await repo.create("leads", { saas: "leverads", stage: "Novo lead", createdAt: haDias(0) });

  await onOutboundMessage(repo, lead.id, { author: "sdr", text: "1º toque", now: new Date(AGORA) });

  const depois = await repo.get("leads", lead.id);
  assert.equal(depois.stage, "Novo lead", "toque sem resposta não pode promover");
  assert.equal(Number(depois.stageAttempts), 1, "mas o toque conta");
});

test("sem as colunas de dia, o comportamento antigo continua igual", async () => {
  const { onOutboundMessage } = await import("../src/lead-flow.js");
  const repo = await repoPronto({ ligado: false });
  const lead = await repo.create("leads", { saas: "leverads", stage: "Novo lead", createdAt: haDias(0) });

  await onOutboundMessage(repo, lead.id, { author: "sdr", text: "1º toque", now: new Date(AGORA) });

  assert.equal((await repo.get("leads", lead.id)).stage, "Qualificando");
});

test("toque dentro de uma coluna de dia também não promove", async () => {
  const { onOutboundMessage } = await import("../src/lead-flow.js");
  const repo = await repoPronto();
  const lead = await repo.create("leads", { saas: "leverads", stage: "Dia 3", createdAt: haDias(2) });

  await onOutboundMessage(repo, lead.id, { author: "sdr", text: "toque do dia 3", now: new Date(AGORA) });

  assert.equal((await repo.get("leads", lead.id)).stage, "Dia 3");
});

test("na Nutrição o toque continua promovendo — lá o reengajamento funcionou", async () => {
  const { onOutboundMessage } = await import("../src/lead-flow.js");
  const repo = await repoPronto();
  const lead = await repo.create("leads", { saas: "leverads", stage: "Nutrição", createdAt: haDias(20) });

  await onOutboundMessage(repo, lead.id, { author: "sdr", text: "retomada", now: new Date(AGORA) });

  assert.equal((await repo.get("leads", lead.id)).stage, "Qualificando");
});
