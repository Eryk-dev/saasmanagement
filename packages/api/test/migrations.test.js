import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  ensureIntegrationStage, migrateLeverAdsCrmFunnel, migrateLeverAdsSdrCadence, ensureFunnelKinds,
  ensureLossReasons, ensureNoShowReason, ensureSdrGoals, ensureCloserGoals, ensureUserRoles, ensureUserSaasScope, ensureUserScreens, DEFAULT_LOSS_REASONS,
} from "../src/migrations.js";

const FUNNEL = [
  { stage: "Inbox", conv: 1 },
  { stage: "Qualificação", conv: 0.5 },
  { stage: "Call closer", conv: 0.6 },
  { stage: "Negociação", conv: 0.7 },
  { stage: "Ganho", conv: 0.8 },
  { stage: "Perdido", conv: 0 },
];

test('insere "Integração" entre "Negociação" e "Ganho"', async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });

  const changed = await ensureIntegrationStage(repo);
  assert.equal(changed, true);

  const stages = (await repo.get("products", "leverads")).funnel.map((f) => f.stage);
  assert.deepEqual(stages, [
    "Inbox", "Qualificação", "Call closer", "Negociação", "Integração", "Ganho", "Perdido",
  ]);
});

test('insere com staleDays vazio (não marca card como parado)', async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });

  await ensureIntegrationStage(repo);
  const integ = (await repo.get("products", "leverads")).funnel.find((f) => f.stage === "Integração");
  assert.equal(integ.staleDays, "");
  assert.equal(integ.conv, 1);
});

test("reparo: Integração legada com staleDays=0 é normalizada pra vazio", async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [
      { stage: "Negociação", conv: 0.7 },
      { stage: "Integração", conv: 1, color: "", staleDays: 0 },
      { stage: "Ganho", conv: 0.8 },
    ],
  });

  const changed = await ensureIntegrationStage(repo);
  assert.equal(changed, true);
  const integ = (await repo.get("products", "leverads")).funnel.find((f) => f.stage === "Integração");
  assert.equal(integ.staleDays, "");
  // não duplica
  assert.equal((await repo.get("products", "leverads")).funnel.filter((f) => f.stage === "Integração").length, 1);

  // segunda passada: nada a fazer
  assert.equal(await ensureIntegrationStage(repo), false);
});

test("é idempotente — rodar de novo não duplica", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });

  await ensureIntegrationStage(repo);
  const second = await ensureIntegrationStage(repo);
  assert.equal(second, false);

  const count = (await repo.get("products", "leverads")).funnel.filter((f) => f.stage === "Integração").length;
  assert.equal(count, 1);
});

test('fallback: sem "Ganho", insere logo após "Negociação"', async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [{ stage: "Negociação", conv: 0.7 }, { stage: "Perdido", conv: 0 }],
  });

  await ensureIntegrationStage(repo);
  const stages = (await repo.get("products", "leverads")).funnel.map((f) => f.stage);
  assert.deepEqual(stages, ["Negociação", "Integração", "Perdido"]);
});

test('funil inesperado (sem "Negociação" nem "Ganho") — não mexe', async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [{ stage: "Lead", conv: 1 }, { stage: "Cliente", conv: 0.5 }],
  });

  const changed = await ensureIntegrationStage(repo);
  assert.equal(changed, false);
  const stages = (await repo.get("products", "leverads")).funnel.map((f) => f.stage);
  assert.deepEqual(stages, ["Lead", "Cliente"]);
});

test("produto sem funil ou inexistente — não quebra", async () => {
  const repo = makeMemRepo();
  assert.equal(await ensureIntegrationStage(repo), false); // produto inexistente
  await repo.create("products", { id: "leverads", name: "LeverAds" }); // sem funnel
  assert.equal(await ensureIntegrationStage(repo), false);
});

// ── Funil CRM SDR+Closer ────────────────────────────────────────────────────

const OLD_CRM_FUNNEL = [
  { stage: "Qualificação", conv: 0.5, color: "#111", staleDays: 5 },
  { stage: "Call closer", conv: 0.6 },
  { stage: "Negociação", conv: 0.7 },
  { stage: "Integração", conv: 1, staleDays: "" },
  { stage: "Ganho", conv: 0.8 },
  { stage: "Sem resposta", conv: 0 },
  { stage: "Desqualificado", conv: 0 },
  { stage: "Perdido", conv: 0 },
  { stage: "Mentoria", conv: 1 },
];

test("migra o funil antigo do leverads pro processo SDR+Closer", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: OLD_CRM_FUNNEL });
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Qualificação", stageSince: "2026-01-01T00:00:00Z" });
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "Call closer" });
  await repo.create("leads", { id: "l3", saas: "leverads", stage: "Negociação" });
  await repo.create("leads", { id: "l4", saas: "leverads", stage: "Sem resposta" });
  await repo.create("leads", { id: "l5", saas: "leverads", stage: "disqualified" });
  await repo.create("leads", { id: "l6", saas: "leverads", stage: "Ganho" });
  await repo.create("leads", { id: "l7", saas: "outro", stage: "Qualificação" }); // outro saas: intocado

  const r = await migrateLeverAdsCrmFunnel(repo);
  assert.ok(r && r.migrated === 5, `esperava 5 cards migrados, veio ${JSON.stringify(r)}`);

  const funnel = (await repo.get("products", "leverads")).funnel;
  assert.deepEqual(funnel.map((f) => f.stage), [
    "Novo lead", "Em contato", "Qualificando", "Call agendada", "Proposta enviada",
    "Follow-up", "Integração", "Ganho", "Perdido", "Desqualificado", "Mentoria",
  ]);
  // kind em toda linha; custom preservado como "outro"
  assert.ok(funnel.every((f) => f.kind));
  assert.equal(funnel.find((f) => f.stage === "Mentoria").kind, "outro");
  // herança do estágio equivalente
  assert.equal(funnel.find((f) => f.stage === "Qualificando").conv, 0.5);
  assert.equal(funnel.find((f) => f.stage === "Qualificando").color, "#111");
  assert.equal(funnel.find((f) => f.stage === "Follow-up").conv, 0.7);
  // cadência default
  assert.deepEqual(funnel.find((f) => f.stage === "Novo lead").cadence, { firstTouchHours: 2 });
  assert.deepEqual(funnel.find((f) => f.stage === "Follow-up").cadence, { maxAttempts: 8, retryDays: 3 });

  // cards renomeados SEM recarimbar stageSince
  assert.equal((await repo.get("leads", "l1")).stage, "Qualificando");
  assert.equal((await repo.get("leads", "l1")).stageSince, "2026-01-01T00:00:00Z");
  assert.equal((await repo.get("leads", "l2")).stage, "Call agendada");
  assert.equal((await repo.get("leads", "l3")).stage, "Follow-up");
  // Sem resposta vira perda estruturada
  assert.equal((await repo.get("leads", "l4")).stage, "Perdido");
  assert.equal((await repo.get("leads", "l4")).lostReason, "sem_resposta");
  assert.equal((await repo.get("leads", "l5")).stage, "Desqualificado");
  assert.equal((await repo.get("leads", "l6")).stage, "Ganho");
  assert.equal((await repo.get("leads", "l7")).stage, "Qualificação");

  // idempotente: 2ª rodada não casa a guarda (nomes novos presentes)
  assert.equal(await migrateLeverAdsCrmFunnel(repo), false);
});

test("guarda estrita: funil editado pelo dono não é sobrescrito", async () => {
  const repo = makeMemRepo();
  const edited = [{ stage: "Qualificação", conv: 1 }, { stage: "Fechamento", conv: 0.5 }, { stage: "Ganho", conv: 1 }];
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: edited });
  assert.equal(await migrateLeverAdsCrmFunnel(repo), false); // sem "Call closer"/"Negociação"
  assert.deepEqual((await repo.get("products", "leverads")).funnel, edited);
});

test("ensureFunnelKinds adiciona kind em todos os produtos, idempotente", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "a", funnel: [{ stage: "Inbox", conv: 1 }, { stage: "Ganho", conv: 1 }] });
  await repo.create("products", { id: "b", funnel: [{ stage: "X", kind: "call", conv: 1 }] });
  await repo.create("products", { id: "c" }); // sem funil — não quebra

  assert.equal(await ensureFunnelKinds(repo), 1); // só "a" muda
  const a = (await repo.get("products", "a")).funnel;
  assert.equal(a[0].kind, "novo");
  assert.equal(a[1].kind, "ganho");
  assert.equal(await ensureFunnelKinds(repo), 0); // 2ª rodada: nada
});

test("ensureLossReasons semeia a lista padrão sem sobrescrever custom", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "a" });
  await repo.create("products", { id: "b", lossReasons: [{ id: "x", label: "X" }] });

  assert.equal(await ensureLossReasons(repo), 1);
  assert.deepEqual((await repo.get("products", "a")).lossReasons, DEFAULT_LOSS_REASONS);
  assert.deepEqual((await repo.get("products", "b")).lossReasons, [{ id: "x", label: "X" }]);
  assert.equal(await ensureLossReasons(repo), 0);
});

test("ensureNoShowReason anexa 'não compareceu' só em funil com call, uma vez", async () => {
  const repo = makeMemRepo();
  // funil com call, sem o motivo → anexa
  await repo.create("products", { id: "lev", funnel: [{ stage: "Call agendada", kind: "call" }], lossReasons: [{ id: "preco", label: "Preço" }] });
  // funil sem call → só marca, não anexa
  await repo.create("products", { id: "semcall", funnel: [{ stage: "Novo", kind: "novo" }], lossReasons: [{ id: "x", label: "X" }] });
  // já tem o motivo → não duplica
  await repo.create("products", { id: "jatem", funnel: [{ stage: "Call", kind: "call" }], lossReasons: [{ id: "nao_compareceu", label: "outro texto" }] });

  assert.equal(await ensureNoShowReason(repo), 3);
  const lev = await repo.get("products", "lev");
  assert.ok(lev.lossReasons.some((r) => r.id === "nao_compareceu"));
  assert.ok(lev.lossReasons.some((r) => r.id === "preco")); // preserva os existentes
  assert.equal((await repo.get("products", "semcall")).lossReasons.length, 1); // não anexou
  assert.equal((await repo.get("products", "jatem")).lossReasons.filter((r) => r.id === "nao_compareceu").length, 1); // não duplicou

  assert.equal(await ensureNoShowReason(repo), 0); // idempotente (marcador)
});

test("ensureSdrGoals semeia metas de taxa só em funil com call, uma vez, sem duplicar", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "lev", funnel: [{ stage: "Call agendada", kind: "call" }] });
  await repo.create("products", { id: "semcall", funnel: [{ stage: "Novo", kind: "novo" }] });
  // meta de contactRate já existente (edição manual) não é duplicada
  await repo.create("goals", { id: "g0", saas: "lev", scope: "role", key: "sdr", metric: "contactRate", target: 90, period: "month" });

  assert.equal(await ensureSdrGoals(repo), 3); // bookingRate/showRate/callWinRate (contactRate já tinha)
  const gl = (await repo.list("goals")).filter((g) => g.saas === "lev" && g.key === "sdr");
  assert.deepEqual(gl.map((g) => g.metric).sort(), ["bookingRate", "callWinRate", "contactRate", "showRate"]);
  assert.equal(gl.find((g) => g.metric === "contactRate").target, 90); // preserva a manual
  assert.equal(gl.find((g) => g.metric === "bookingRate").target, 30);
  assert.equal((await repo.list("goals")).filter((g) => g.saas === "semcall").length, 0); // sem call, nada

  assert.equal(await ensureSdrGoals(repo), 0); // idempotente (marcador sdrGoalsV1)
});

test("ensureCloserGoals semeia metas de qualidade só em funil com call, uma vez", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "lev", funnel: [{ stage: "Call agendada", kind: "call" }] });
  await repo.create("products", { id: "semcall", funnel: [{ stage: "Novo", kind: "novo" }] });

  assert.equal(await ensureCloserGoals(repo), 2); // proposalWinRate + winRateCall
  const gl = (await repo.list("goals")).filter((g) => g.saas === "lev" && g.key === "closer");
  assert.deepEqual(gl.map((g) => g.metric).sort(), ["proposalWinRate", "winRateCall"]);
  assert.equal(gl.find((g) => g.metric === "proposalWinRate").target, 30);
  assert.equal((await repo.list("goals")).filter((g) => g.saas === "semcall").length, 0);
  assert.equal(await ensureCloserGoals(repo), 0); // idempotente (marcador closerGoalsV1)
});

test("ensureUserRoles espelha o time antigo e não inventa usuário", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", name: "Eryk" });
  await repo.create("users", { id: "leonardo", name: "Leonardo" });
  await repo.create("users", { id: "maria", name: "Maria" });
  await repo.create("users", { id: "ja", name: "Já tem", roles: ["sdr"] });

  assert.equal(await ensureUserRoles(repo), 3);
  assert.deepEqual((await repo.get("users", "eryk")).roles, ["integrator"]);
  assert.deepEqual((await repo.get("users", "leonardo")).roles, ["closer", "sdr"]);
  assert.deepEqual((await repo.get("users", "maria")).roles, []);
  assert.deepEqual((await repo.get("users", "ja")).roles, ["sdr"]);
  assert.equal((await repo.list("users")).length, 4); // jonathan NÃO foi criado
  assert.equal(await ensureUserRoles(repo), 0);
});

test("ensureUserSaasScope escopa a Ana na UniqueKids uma vez, sem inventar usuário", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "ana", name: "Ana", roles: ["closer"] });
  await repo.create("users", { id: "leonardo", name: "Leonardo", roles: ["closer"] });

  assert.equal(await ensureUserSaasScope(repo), 1);
  assert.equal((await repo.get("users", "ana")).saas, "uniquekids");
  assert.equal((await repo.get("users", "leonardo")).saas, undefined); // global segue global
  assert.equal(await ensureUserSaasScope(repo), 0); // idempotente

  // Admin limpou manualmente ("" = todos os produtos): a migração NÃO reaplica.
  await repo.update("users", "ana", { saas: "" });
  assert.equal(await ensureUserSaasScope(repo), 0);
  assert.equal((await repo.get("users", "ana")).saas, "");

  // Sem a Ana no banco, nada acontece (não cria usuário).
  const repo2 = makeMemRepo();
  assert.equal(await ensureUserSaasScope(repo2), 0);
  assert.equal((await repo2.list("users")).length, 0);
});

// Funil pós-CRM (o estado real do leverads antes da cadência SDR).
const CRM_FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1, cadence: { firstTouchHours: 2 } },
  { stage: "Em contato", kind: "contato", conv: 1, cadence: { maxAttempts: 5, retryDays: 1 } },
  { stage: "Qualificando", kind: "qualificacao", conv: 1, cadence: { maxAttempts: 5, retryDays: 1 } },
  { stage: "Call agendada", kind: "call", conv: 1, cadence: { maxAttempts: 3, retryDays: 1 } },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

test("migrateLeverAdsSdrCadence: remove Em contato (cards migram), cria Nutrição, ajusta cadências e pergunta staff", async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: CRM_FUNNEL,
    leadQuestions: [{ key: "accounts", label: "Contas?" }],
  });
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Em contato", nextActionAt: "2026-07-13T12:00:00Z" });
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "Novo lead" });
  await repo.create("leads", { id: "l3", saas: "outra", stage: "Em contato" });

  const r = await migrateLeverAdsSdrCadence(repo);
  assert.equal(r.movedCards, 1);
  const p = await repo.get("products", "leverads");
  const names = p.funnel.map((f) => f.stage);
  assert.ok(!names.includes("Em contato"), "Em contato removido");
  const nut = p.funnel.find((f) => f.stage === "Nutrição");
  assert.equal(nut.kind, "contato");
  assert.deepEqual(nut.cadence, { maxAttempts: 3, retryDays: 7, firstTouchHours: 480 });
  assert.equal(names.indexOf("Nutrição"), names.indexOf("Ganho") + 1, "Nutrição fica fora da régua, depois do Ganho");
  assert.deepEqual(p.funnel.find((f) => f.kind === "novo").cadence, { maxAttempts: 1, retryDays: 1, firstTouchHours: 2 });
  assert.deepEqual(p.funnel.find((f) => f.kind === "qualificacao").cadence, { maxAttempts: 2, retryDays: 1 });
  assert.equal((await repo.get("leads", "l1")).stage, "Qualificando");
  assert.equal((await repo.get("leads", "l1")).nextActionAt, "2026-07-13T12:00:00Z", "rename não recarimba o GPS");
  assert.equal((await repo.get("leads", "l3")).stage, "Em contato", "outro produto intacto");
  assert.ok(p.leadQuestions.some((q) => q.key === "staff"), "pergunta do time de marketing entra");
  assert.ok(p.sdrCadenceV1);

  // One-shot: rodada seguinte não faz nada, nem re-adiciona o que o dono apagar.
  await repo.update("products", "leverads", { leadQuestions: p.leadQuestions.filter((q) => q.key !== "staff") });
  assert.equal(await migrateLeverAdsSdrCadence(repo), false);
  assert.ok(!(await repo.get("products", "leverads")).leadQuestions.some((q) => q.key === "staff"));
});

test("migrateLeverAdsSdrCadence: reconhece a cadência antiga mesmo com chaves reordenadas (jsonb)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [
      { stage: "Novo lead", kind: "novo", conv: 1, cadence: { firstTouchHours: 2 } },
      // Postgres jsonb devolve retryDays antes de maxAttempts — tem que casar igual.
      { stage: "Qualificando", kind: "qualificacao", conv: 1, cadence: { retryDays: 1, maxAttempts: 5 } },
      { stage: "Ganho", kind: "ganho", conv: 1 },
    ],
  });
  await migrateLeverAdsSdrCadence(repo);
  const p = await repo.get("products", "leverads");
  assert.deepEqual(p.funnel.find((f) => f.kind === "qualificacao").cadence, { maxAttempts: 2, retryDays: 1 });
});

test("migrateLeverAdsSdrCadence: cadência já editada pelo dono não é sobrescrita", async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [
      { stage: "Novo lead", kind: "novo", conv: 1, cadence: { firstTouchHours: 4 } },
      { stage: "Qualificando", kind: "qualificacao", conv: 1, cadence: { maxAttempts: 7, retryDays: 2 } },
      { stage: "Ganho", kind: "ganho", conv: 1 },
    ],
  });
  await migrateLeverAdsSdrCadence(repo);
  const p = await repo.get("products", "leverads");
  assert.deepEqual(p.funnel.find((f) => f.kind === "novo").cadence, { firstTouchHours: 4 });
  assert.deepEqual(p.funnel.find((f) => f.kind === "qualificacao").cadence, { maxAttempts: 7, retryDays: 2 });
  assert.ok(p.funnel.some((f) => f.stage === "Nutrição"), "Nutrição entra mesmo com cadências customizadas");
});

test("ensureUserScreens restringe sdr e ana à operação (today+pipeline+tasks) uma vez, sem sobrescrever ajuste manual", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "sdr", name: "SDR" });
  await repo.create("users", { id: "ana", name: "Ana" });
  await repo.create("users", { id: "leonardo", name: "Leonardo" });

  assert.equal(await ensureUserScreens(repo), 2);
  assert.deepEqual((await repo.get("users", "sdr")).screens, ["today", "pipeline", "tasks"]);
  assert.deepEqual((await repo.get("users", "ana")).screens, ["today", "pipeline", "tasks"]);
  assert.equal((await repo.get("users", "leonardo")).screens, undefined); // admin segue com tudo
  assert.equal(await ensureUserScreens(repo), 0); // idempotente

  // Admin liberou tudo manualmente ([]): a migração NÃO reaplica.
  await repo.update("users", "sdr", { screens: [] });
  assert.equal(await ensureUserScreens(repo), 0);
  assert.deepEqual((await repo.get("users", "sdr")).screens, []);
});
