// Remarcar um NO-SHOW devolve o card pra etapa de call (Leo, 25/08). Editar só
// o horário deixava o card preso em "No show" com call futura — e a régua de
// lembretes exige etapa de call, então o lead remarcado não recebia nem a
// confirmação nem o link, e furava de novo (caso Alcindotzwicins).
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [
      { stage: "Qualificando", kind: "qualificacao" },
      { stage: "Call agendada", kind: "call" },
      { stage: "No show", kind: "contato" },
      { stage: "Follow-up", kind: "followup" },
    ],
  });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

const naiveIn = (hours) => {
  const d = new Date(Date.now() + hours * 3600_000);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:00`;
};

test("callAt FUTURO em card No show devolve pra etapa de call", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "No show", closer: "jonathan", callAt: "2026-08-24T16:00" });
  const novo = naiveIn(6);
  const r = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { callAt: novo } });
  assert.equal(r.statusCode, 200);
  const l = await repo.get("leads", "l1");
  assert.equal(l.stage, "Call agendada");
  assert.equal(l.callAt, novo);
});

test("callAt PASSADO não desfaz o furo, e etapa mandada no corpo manda", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "No show", callAt: "2026-08-24T16:00" });
  await app.inject({ method: "PATCH", url: "/api/leads/l2", payload: { callAt: "2026-08-20T10:00" } });
  assert.equal((await repo.get("leads", "l2")).stage, "No show");

  // Etapa explícita no PATCH continua sendo a verdade (nada de mover por cima).
  await repo.create("leads", { id: "l3", saas: "leverads", stage: "No show", callAt: "2026-08-24T16:00" });
  await app.inject({ method: "PATCH", url: "/api/leads/l3", payload: { callAt: naiveIn(5), stage: "Follow-up" } });
  assert.equal((await repo.get("leads", "l3")).stage, "Follow-up");
});

test("card que NÃO é no-show não é movido pelo horário novo", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l4", saas: "leverads", stage: "Qualificando" });
  await app.inject({ method: "PATCH", url: "/api/leads/l4", payload: { callAt: naiveIn(4) } });
  assert.equal((await repo.get("leads", "l4")).stage, "Qualificando");
});
