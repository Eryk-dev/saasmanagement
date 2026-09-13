// Churn: o card do CS e qualquer outra tela que precise de churn (o bônus de
// time, comp-months.js) leem a MESMA régua, churnRateIn do metrics-core:
// count e taxa na mesma base (ativos no fim da janela + churnados nela).
// Faz par com metrics-consistency.test.js (o contrato "mesma pergunta, mesmo
// número" entre telas).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { churnRateIn } from "../src/metrics-core.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Qualificando", kind: "qualificacao", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Follow-up", kind: "followup", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

const WIN = { since: "2026-07-01", until: "2026-07-31" };

test("churnRateIn: churnado na janela conta; churnado antes e nascido depois ficam fora da base", () => {
  const mine = [
    { id: "c1", startedAt: "2026-05-01T10:00:00.000Z" },
    { id: "c2", startedAt: "2026-05-01T10:00:00.000Z" },
    { id: "c3", startedAt: "2026-05-01T10:00:00.000Z" },
    // churnou DENTRO de julho: conta como churn e entra na base
    { id: "cx", startedAt: "2026-04-01T10:00:00.000Z", endedAt: "2026-07-10T10:00:00.000Z" },
    // churnou em JUNHO: já não estava ativo no fim de julho, fora da base
    { id: "cold", startedAt: "2026-03-01T10:00:00.000Z", endedAt: "2026-06-15T10:00:00.000Z" },
    // entra só em AGOSTO: ainda não existia no fim da janela, fora da base
    { id: "cfut", startedAt: "2026-08-03T10:00:00.000Z" },
  ];
  assert.deepEqual(churnRateIn(mine, WIN), { churned: 1, base: 4, pct: 25, retentionRate: 75 });
  // sem base (carteira vazia) a taxa é null, nunca 0 nem 100 inventado
  assert.deepEqual(churnRateIn([], WIN), { churned: 0, base: 0, pct: null, retentionRate: null });
  // sem churn = 100% de retenção, honesto
  assert.deepEqual(churnRateIn(mine.slice(0, 3), WIN), { churned: 0, base: 3, pct: 0, retentionRate: 100 });
});

test("churn do CS no placar = churnRateIn da carteira dele (mesma base, mesma taxa)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "u_cs", name: "Cris CS", roles: ["integrator"] });
  const mine = [
    { id: "c1", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" },
    { id: "c2", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" },
    { id: "c3", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" },
    { id: "cx", saas: "leverads", owner: "u_cs", startedAt: "2026-04-01T10:00:00.000Z", endedAt: "2026-07-10T10:00:00.000Z" },
    { id: "cold", saas: "leverads", owner: "u_cs", startedAt: "2026-03-01T10:00:00.000Z", endedAt: "2026-06-15T10:00:00.000Z" },
  ];
  for (const c of mine) await repo.create("customers", c);
  const app = Fastify();
  registerRoutes(app, repo, { scoreboard: { now: () => new Date("2026-07-28T12:00:00.000Z") } });
  const sb = (await app.inject({ url: `/api/scoreboard/leverads?since=${WIN.since}&until=${WIN.until}` })).json();
  const cs = sb.cs.find((p) => p.user === "u_cs");
  const rule = churnRateIn(mine, WIN);
  assert.equal(cs.churned, rule.churned);
  assert.equal(cs.retentionRate, rule.retentionRate);
  assert.equal(cs.retentionRate, 75);
  await app.close();
});

test("computeScoreboard é chamável fora da rota e devolve o mesmo payload", async () => {
  const { computeScoreboard } = await import("../src/routes.scoreboard.js");
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "u_cs", name: "Cris CS", roles: ["integrator"] });
  await repo.create("customers", { id: "c1", saas: "leverads", owner: "u_cs", startedAt: "2026-05-01T10:00:00.000Z" });
  const now = () => new Date("2026-07-28T12:00:00.000Z");
  const app = Fastify();
  registerRoutes(app, repo, { scoreboard: { now } });
  const viaRota = (await app.inject({ url: `/api/scoreboard/leverads?since=${WIN.since}&until=${WIN.until}` })).json();
  const product = await repo.get("products", "leverads");
  const direto = await computeScoreboard(repo, product, WIN, { now });
  assert.deepEqual(direto, viaRota);
  assert.equal(direto.saas, "leverads");
  assert.equal(direto.cs[0].activeAccounts, 1);
  await app.close();
});
