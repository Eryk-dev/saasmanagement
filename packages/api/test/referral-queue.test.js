// Fila de colheita: a quem pedir indicação HOJE, ordenado pela prova mais
// fresca (o que os anúncios da Lever venderam na conta do cliente nos últimos
// 30 dias), com janela de descanso pro mesmo cliente não ser perguntado duas
// vezes por duas pessoas.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { buildReferralQueue, askScript, MIN_DAYS } from "../src/routes.referrals.js";

const { registerRoutes } = await import("../src/routes.js");

const NOW = Date.parse("2026-09-12T12:00:00Z");
const diasAtras = (d) => new Date(NOW - d * 86_400_000).toISOString();
const ORG = (n) => `0000000${n}-0000-4000-8000-000000000000`;

// A prova vem do banco do produto; nos testes é um Map injetado.
const influenced = (map) => async () => new Map(Object.entries(map));

async function seed() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", funnel: [{ stage: "Novo lead", kind: "novo" }] });
  await repo.create("users", { id: "jonan", name: "Jonan", roles: ["integrator"] });
  // com prova grande
  await repo.create("customers", { id: "cu_a", saas: "leverads", name: "Xracing", owner: "jonan", leveradsOrgId: ORG(1), startedAt: diasAtras(90), leadId: "le_a" });
  // com prova pequena
  await repo.create("customers", { id: "cu_b", saas: "leverads", name: "Azul Pet", owner: "jonan", leveradsOrgId: ORG(2), startedAt: diasAtras(60) });
  // sem venda influenciada
  await repo.create("customers", { id: "cu_c", saas: "leverads", name: "Bralok", leveradsOrgId: ORG(3), startedAt: diasAtras(70) });
  // novo de casa: fora da fila (não houve resultado pra mostrar)
  await repo.create("customers", { id: "cu_d", saas: "leverads", name: "Recém", leveradsOrgId: ORG(4), startedAt: diasAtras(10) });
  // churnado: fora
  await repo.create("customers", { id: "cu_e", saas: "leverads", name: "Saiu", leveradsOrgId: ORG(5), startedAt: diasAtras(200), endedAt: diasAtras(5) });
  // sem org no cadastro: entra sem prova (e conta no gap de coverage)
  await repo.create("customers", { id: "cu_f", saas: "leverads", name: "Sem org", startedAt: diasAtras(120) });
  return repo;
}

const GMV = { [ORG(1)]: 181550, [ORG(2)]: 11118, [ORG(3)]: 562, [ORG(4)]: 99999, [ORG(5)]: 50000 };

test("fila: ordena pela prova, corta novo de casa e churnado, e mostra o gap cadastral", async () => {
  const repo = await seed();
  const q = await buildReferralQueue(repo, { saas: "leverads", now: () => NOW, influenced: influenced(GMV) });

  assert.deepEqual(q.rows.map((r) => r.customer), ["cu_a", "cu_b", "cu_c", "cu_f"]);
  assert.equal(q.rows[0].influenced30d, 181550);
  assert.equal(q.rows[0].bucket, "pedir");
  // R$ 562 influenciados não sustentam o pedido: aparece como prova fraca, não
  // como fila (medido na base real em 12/09/2026).
  assert.equal(q.rows[2].bucket, "prova_fraca");
  assert.equal(q.rows[3].bucket, "sem_prova");   // sem org vinculada: não há como provar
  assert.equal(q.totals.pedir, 2);
  assert.equal(q.totals.provaFraca, 1);
  assert.equal(q.totals.influencedSum, 193230);
  assert.deepEqual(q.coverage, { customers: 5, withOrg: 4 });
  // A frase do pedido acompanha a linha (a tela abre o WhatsApp com ela).
  assert.match(q.rows[0].script, /Xracing, os anúncios que a gente subiu venderam R\$\s181\.550/);
  assert.equal(q.rows.some((r) => r.customer === "cu_d"), false, `menos de ${MIN_DAYS} dias de casa fica fora`);
  assert.equal(q.rows.some((r) => r.customer === "cu_e"), false, "churnado fica fora");
});

test("pedido registrado tira o cliente da fila por 90 dias e cria a tarefa com a frase pronta", async (t) => {
  const repo = await seed();
  const app = Fastify(); registerRoutes(app, repo, { referrals: { now: () => NOW, influenced: influenced(GMV) } });
  await app.ready();
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/referrals/ask", payload: { customer: "cu_a", influenced30d: 181550, assignee: "jonan" } });
  assert.equal(res.statusCode, 201);

  const task = (await repo.list("tasks")).find((x) => (x.labels || []).includes("indicacao"));
  assert.match(task.title, /Pedir indicação pra Xracing/);
  assert.deepEqual(task.assignees, ["jonan"]);
  assert.match(task.description, /R\$\s181\.550/);       // o número do cliente na frase
  assert.match(task.description, /dois lojistas/);
  assert.match(task.description, /R\$ 500 se fechar/);

  const ev = (await repo.list("activities")).find((a) => a.meta?.event === "referral_asked");
  assert.equal(ev.meta.customer, "cu_a");
  assert.equal(ev.lead, "le_a");                        // carimbo na timeline do lead de origem

  const q = await buildReferralQueue(repo, { saas: "leverads", now: () => NOW, influenced: influenced(GMV) });
  assert.equal(q.rows.find((r) => r.customer === "cu_a").bucket, "descanso");
  assert.equal(q.totals.pedir, 1);

  // Passados 90 dias ele volta pra fila.
  const depois = NOW + 91 * 86_400_000;
  const q2 = await buildReferralQueue(repo, { saas: "leverads", now: () => depois, influenced: influenced(GMV) });
  assert.equal(q2.rows.find((r) => r.customer === "cu_a").bucket, "pedir");
});

test("a frase do pedido leva o número quando ele existe, e não mente quando não existe", () => {
  const com = askScript({ name: "Xracing", contact: "Barros da Silva", influenced30d: 181550 });
  assert.match(com, /^Barros, os anúncios que a gente subiu venderam R\$\s181\.550 na sua conta nos últimos 30 dias\./);
  assert.match(com, /dois lojistas/);
  assert.match(com, /Não procuro ninguém antes de você me dar o ok\./);
  assert.equal(com.includes("—"), false, "copy do Leo não usa travessão");

  const sem = askScript({ name: "Sem org", influenced30d: 0 });
  assert.equal(/R\$\s0/.test(sem), false, "sem prova, a frase não inventa número");
  assert.match(sem, /dois lojistas/);
});

test("indicações já colhidas aparecem na linha do cliente (o que ele já rendeu)", async () => {
  const repo = await seed();
  await repo.create("leads", { id: "l1", saas: "leverads", referredByCustomer: "cu_a", referralCollectedBy: "jonan", customerId: "cu_novo" });
  await repo.create("leads", { id: "l2", saas: "leverads", referredByCustomer: "cu_a", referralCollectedBy: "jonan" });
  await repo.create("leads", { id: "l3", saas: "leverads", referredByCustomer: "cu_a" }); // sem coletor: conta, mas não paga
  const q = await buildReferralQueue(repo, { saas: "leverads", now: () => NOW, influenced: influenced(GMV) });
  const row = q.rows.find((r) => r.customer === "cu_a");
  assert.equal(row.collected, 3);
  assert.equal(row.closed, 1);
  assert.equal(row.paid, 2);
});
