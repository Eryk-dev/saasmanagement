// GET /api/sdr/agenda: a agenda como o robô SDR a enxerga, a partir de um dia
// (consulta do agente SDR que roda fora do cockpit). Só leitura.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { holdSlots, wallNow } from "../src/crm/agenda-slots.js";

const { registerRoutes } = await import("../src/routes.js");

// Próximo dia útil a pelo menos `min` dias de hoje, no relógio de Brasília.
function businessDay(min) {
  const d = wallNow();
  d.setUTCDate(d.getUTCDate() + min);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function world() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", kind: "novo" }, { stage: "Call agendada", kind: "call" }] });
  for (const u of [{ id: "leo", name: "Leonardo Parra", roles: ["closer"], compLevel: 1 }, { id: "vit", name: "Vitor Silva", roles: ["closer"], compLevel: 3 }]) await repo.create("users", u);
  await repo.create("leads", { id: "ana", saas: "leverads", name: "Ana", stage: "Novo lead" });
  await repo.create("leads", { id: "bia", saas: "leverads", name: "Bia", stage: "Novo lead" });
  return repo;
}

test("agenda do robô a partir de um dia: passa do corte da grade manual, sem almoço e dentro da janela de oferta", async (t) => {
  const repo = await world();
  const app = Fastify();
  registerRoutes(app, repo, {});
  t.after(() => app.close());
  const from = businessDay(9);
  const r = await app.inject({ method: "GET", url: `/api/sdr/agenda?saas=leverads&lead=ana&from=${from}&days=2` });
  assert.equal(r.statusCode, 200);
  const { slots } = r.json();
  assert.ok(slots.length > 30, `devolve o dia inteiro, não só 30 horários (${slots.length})`);
  assert.ok(slots.every((s) => s.at >= `${from}T00:00`), "nada antes do dia pedido");
  const hours = slots.map((s) => Number(s.at.slice(11, 13)) * 60 + Number(s.at.slice(14, 16)));
  assert.ok(hours.every((m) => m >= 8 * 60 && m + 60 <= 21 * 60), "só a janela de oferta do robô");
  assert.ok(hours.every((m) => !(m < 13 * 60 && m + 60 > 12 * 60)), "nenhuma conversa encosta no almoço");
});

test("agenda do robô tira o horário que outro lead está segurando e devolve a quem segura", async (t) => {
  const repo = await world();
  const app = Fastify();
  registerRoutes(app, repo, {});
  t.after(() => app.close());
  const from = businessDay(9);
  const held = `${from}T10:00`;
  const before = (await app.inject({ method: "GET", url: `/api/sdr/agenda?saas=leverads&lead=bia&from=${from}&days=1` })).json().slots;
  // Só há dúvida de reserva quando o horário some pra todo closer: os dois do mundo ficam com o mesmo horário preso.
  await holdSlots(repo, { saas: "leverads", leadId: "ana", slots: [{ at: held }] });
  const other = (await app.inject({ method: "GET", url: `/api/sdr/agenda?saas=leverads&lead=bia&from=${from}&days=1` })).json().slots;
  const owner = (await app.inject({ method: "GET", url: `/api/sdr/agenda?saas=leverads&lead=ana&from=${from}&days=1` })).json().slots;
  assert.ok(before.some((s) => s.at === held), "o horário estava livre");
  assert.ok(!other.some((s) => s.at === held), "outro lead não vê o horário reservado");
  assert.ok(owner.some((s) => s.at === held), "quem recebeu a oferta continua vendo");
});

test("agenda do robô recusa pedido sem produto ou com dia mal escrito", async (t) => {
  const repo = await world();
  const app = Fastify();
  registerRoutes(app, repo, {});
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "GET", url: "/api/sdr/agenda" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/sdr/agenda?saas=leverads&from=sexta" })).statusCode, 400);
});
